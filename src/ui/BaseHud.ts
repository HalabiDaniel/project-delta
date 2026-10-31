import { BASE, type BuildingKind } from '../config';
import type { RaidReport } from '../base/Raids';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { fmt, level, metres, pct } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { SAY, SLOT_KIND_ICONS, SLOT_KIND_LABELS } from './strings';
import type { BaseInspectorView, BaseView, HudActions, PriceView, RaidAlertView, Stat } from './views';

export const BUILDING_ICONS: Record<BuildingKind | 'store', IconName> = {
  turret: 'turret', launcher: 'launcher', radar: 'radar', workshop: 'workshop', storage: 'storage', store: 'store',
};

const STATUS_ICON = { ok: 'ok', damaged: 'warn', destroyed: 'wrecked' } as const;

type TrayCategory = 'defense' | 'radar' | 'economy';
const TRAY_CATEGORY: Record<BuildingKind, TrayCategory> = { turret: 'defense', launcher: 'defense', radar: 'radar', workshop: 'economy', storage: 'economy' };
const CATEGORY_ICONS: Record<TrayCategory, IconName> = { defense: 'shield', radar: 'radar', economy: 'paper' };
const CATEGORY_LABELS: Record<TrayCategory, string> = { defense: 'Defense', radar: 'Detection', economy: 'Economy' };

function stats(list: readonly Stat[]): string {
  return list.map((s) => `<span class="stat" title="${esc(s.label)}"${s.tone ? ` data-tone="${s.tone}"` : ''}>${icon(s.icon)}<b>${esc(s.value)}</b>${s.delta ? `<em>${esc(s.delta)}</em>` : ''}</span>`).join('');
}

function price(p: PriceView): string {
  return p.missing > 0 ? `${icon('paper')}<b>${p.cost}</b><em class="missing">−${p.missing}</em>` : `${icon('paper')}<b>${p.cost}</b>`;
}

/**
 * Base management on T1, from above: a marker on every construction slot (what stands there, its
 * health, whether the chosen building fits), the base's state across the top, a build tray bottom
 * left, the selected slot's inspector bottom centre, and Repair all / Done bottom right.
 */
export class BaseHud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly markers = new Map<string, HTMLElement>();
  private trayKey = '';
  private inspKey = '';

  constructor(
    zones: { world: HTMLElement; tc: HTMLElement; bl: HTMLElement; bc: HTMLElement; br: HTMLElement },
    private readonly actions: HudActions,
  ) {
    const add = (host: HTMLElement, className: string, html: string) => {
      const node = document.createElement('div');
      node.className = className;
      node.innerHTML = html;
      host.appendChild(node);
      for (const n of node.querySelectorAll<HTMLElement>('[data-b]')) this.el[n.dataset.b!] = n;
      return node;
    };
    this.el.markers = add(zones.world, 'slot-markers', '');
    this.el.overview = add(zones.tc, 'base-overview card', /* html */ `
      <span class="ov" title="Weapons ready" data-b="ov-ready">${icon('shield')}<b data-b="ready"></b></span>
      <span class="ov" title="Radar" data-b="ov-radar">${icon('radar')}<b data-b="radar"></b></span>
      <span class="ov" title="Base condition" data-b="ov-integrity">${icon('base')}<b data-b="integrity"></b></span>`);
    this.el.tray = add(zones.bl, 'tray card', /* html */ `<div class="tray-items" data-b="tray-items"></div>`);
    this.el.inspector = add(zones.bc, 'base-insp card', '');
    this.el.actions = add(zones.br, 'base-actions', /* html */ `
      <button class="btn" data-b="repair-all" title="Repair everything">${icon('repair')}<span>${SAY.repairAll}</span><span class="price" data-b="repair-all-cost"></span></button>
      <button class="btn primary big" data-b="done"><kbd>B</kbd><span>${SAY.done}</span></button>`);
    bindButton(this.el['repair-all'], () => actions.base.repairAll());
    bindButton(this.el.done, () => actions.toggleBase());
  }

  render(v: BaseView | null, paused: boolean): void {
    const show = v !== null && !paused;
    for (const k of ['overview', 'tray', 'inspector', 'actions', 'markers']) toggle(this.el[k], show);
    if (!v || !show) return;
    this.renderMarkers(v);
    this.renderOverview(v);
    this.renderTray(v);
    this.renderInspector(v.inspector);
    toggle(this.el['repair-all'], v.repairAll.count > 0);
    (this.el['repair-all'] as HTMLButtonElement).disabled = v.repairAll.missing > 0;
    const costEl = this.el['repair-all-cost'];
    const key = `${v.repairAll.cost}:${v.repairAll.missing}`;
    if (costEl.dataset.key !== key) {
      costEl.dataset.key = key;
      costEl.innerHTML = price(v.repairAll);
    }
  }

  private renderMarkers(v: BaseView): void {
    const seen = new Set<string>();
    for (const s of v.slots) {
      let el = this.markers.get(s.id);
      if (!el) {
        el = document.createElement('button');
        el.className = 'slot-marker';
        el.innerHTML = `<span class="sm-icon"></span><span class="sm-level"></span><span class="sm-health"><i></i></span>`;
        bindButton(el, () => this.actions.base.selectSlot(s.id));
        this.el.markers.appendChild(el);
        this.markers.set(s.id, el);
      }
      const iconName: IconName = s.building ? BUILDING_ICONS[s.building] : SLOT_KIND_ICONS[s.kind];
      const iconEl = el.querySelector('.sm-icon') as HTMLElement;
      if (iconEl.dataset.icon !== iconName) {
        iconEl.dataset.icon = iconName;
        iconEl.innerHTML = icon(iconName);
      }
      el.title = s.building === 'store' ? `Paper store · ${pct(s.health)}` : s.building ? `${BASE.buildings[s.building].name} · level ${s.level} · ${pct(s.health)}` : SLOT_KIND_LABELS[s.kind];
      attr(el, 'data-state', s.building ? (s.status ?? 'ok') : 'empty');
      attr(el, 'data-fits', s.fits === null ? 'none' : String(s.fits));
      el.classList.toggle('selected', s.selected);
      text(el.querySelector('.sm-level') as HTMLElement, s.building && s.level > 1 ? '★'.repeat(s.level - 1) : '');
      const bar = el.querySelector('.sm-health') as HTMLElement;
      toggle(bar, !!s.building && s.status !== 'ok');
      width(bar.firstElementChild as HTMLElement, s.health);
      attr(bar.firstElementChild as HTMLElement, 'data-level', level(s.health));
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      toggle(el, s.onScreen);
      seen.add(s.id);
    }
    for (const [id, el] of this.markers) if (!seen.has(id)) toggle(el, false);
  }

  private renderOverview(v: BaseView): void {
    const o = v.overview;
    text(this.el.ready, o.total > 0 ? `${o.ready}/${o.total}` : '0');
    attr(this.el['ov-ready'], 'data-tone', o.total === 0 ? 'warn' : o.ready < o.total ? 'bad' : 'good');
    text(this.el.radar, o.radar === 'none' ? metres(o.detection) : o.radar === 'on' ? metres(o.detection) : SAY.offline);
    attr(this.el['ov-radar'], 'data-tone', o.radar === 'on' ? 'good' : o.radar === 'off' ? 'bad' : 'warn');
    this.el['ov-radar'].title = o.radar === 'none' ? 'No radar: raids are seen late' : o.radar === 'on' ? 'Radar: early warning range' : 'Radar destroyed';
    text(this.el.integrity, pct(o.integrity));
    attr(this.el['ov-integrity'], 'data-tone', o.integrity >= 0.99 ? 'good' : o.integrity > 0.6 ? 'warn' : 'bad');
  }

  private renderTray(v: BaseView): void {
    const key = v.tray.map((t) => `${t.kind}:${t.missing}:${t.placeable}:${t.chosen}`).join('|');
    if (key === this.trayKey) return;
    this.trayKey = key;
    const wrap = this.el['tray-items'];
    wrap.innerHTML = '';
    // Grouped by category: defense, radar, economy.
    let group: HTMLElement | null = null;
    let category = '';
    for (const t of v.tray) {
      const cat = TRAY_CATEGORY[t.kind];
      if (cat !== category) {
        category = cat;
        group = document.createElement('div');
        group.className = 'tray-group';
        group.innerHTML = `<span class="tray-cat" title="${CATEGORY_LABELS[cat]}">${icon(CATEGORY_ICONS[cat])}</span>`;
        wrap.appendChild(group);
      }
      const b = document.createElement('button');
      b.className = 'tray-item';
      b.classList.toggle('chosen', t.chosen);
      b.classList.toggle('short', t.missing > 0);
      b.disabled = !t.placeable;
      b.title = `${t.name}: ${t.purpose}${t.placeable ? '' : ' (no free slot for it)'}`;
      b.innerHTML = `${icon(BUILDING_ICONS[t.kind], 'icon tray-icon')}<span class="tray-name">${esc(t.short)}</span><span class="price">${price(t)}</span>`;
      bindButton(b, () => this.actions.base.choose(t.kind));
      group!.appendChild(b);
    }
  }

  private renderInspector(i: BaseInspectorView | null): void {
    toggle(this.el.inspector, i !== null);
    if (!i) return;
    const key = JSON.stringify(i);
    if (key === this.inspKey) return;
    this.inspKey = key;
    const host = this.el.inspector;
    if (i.type === 'empty') {
      const takes = i.takes.map((k) => `<span title="${esc(BASE.buildings[k].name)}">${icon(BUILDING_ICONS[k])}</span>`).join('');
      const c = i.chosen;
      host.innerHTML = `
        <div class="bi-head">${icon(SLOT_KIND_ICONS[i.slotKind])}<b>${esc(SLOT_KIND_LABELS[i.slotKind])}</b><span class="bi-takes">${takes}</span></div>
        ${c ? `<div class="bi-build"><span class="bi-what">${icon(BUILDING_ICONS[c.kind])}<b>${esc(c.name)}</b></span><span class="stats">${stats(c.effects)}</span></div>
          <button class="btn primary" data-act="build"${!c.fits || c.price.missing > 0 ? ' disabled' : ''}>${icon('build')}<span>${SAY.build}</span><span class="price">${price(c.price)}</span><kbd>Enter</kbd></button>`
          : `<div class="bi-pick">${icon('build')}<span>Pick a building</span></div>`}`;
    } else {
      const lv = Array.from({ length: i.maxLevel }, (_, n) => `<i class="${n < i.level ? 'on' : ''}"></i>`).join('');
      host.innerHTML = `
        <div class="bi-head">${icon(BUILDING_ICONS[i.kind])}<b>${esc(i.name)}</b><span class="lv" title="Level ${i.level}/${i.maxLevel}">${lv}</span>
          <span class="bi-status" data-state="${i.status}" title="${esc(ICON_NAMES[STATUS_ICON[i.status]])}">${icon(STATUS_ICON[i.status])}</span></div>
        <div class="meter" title="Health">${icon('health')}<span class="bar"><i data-level="${level(i.health / i.maxHealth)}" style="width:${pct(i.health / i.maxHealth)}"></i></span><b>${fmt(i.health)}/${fmt(i.maxHealth)}</b></div>
        <div class="stats">${stats(i.stats)}</div>
        <div class="bi-actions">
          ${i.upgrade ? `<button class="btn" data-act="upgrade"${i.upgrade.missing > 0 || i.status === 'destroyed' ? ' disabled' : ''} title="${esc(i.upgrade.next.map((s) => `${s.label} ${s.value}`).join(' · '))}">${icon('upgrade')}<span>${SAY.upgrade}</span><span class="price">${price(i.upgrade)}</span><span class="stats gain">${i.upgrade.next.filter((s) => s.delta).slice(0, 3).map((s) => `<span class="stat" title="${esc(`${s.label}: ${s.value}`)}">${icon(s.icon)}<em>${esc(s.delta!)}</em></span>`).join('')}</span><kbd>U</kbd></button>` : i.kind !== 'store' ? `<span class="tag" title="Fully upgraded">${icon('level')}${SAY.maxLevel}</span>` : ''}
          ${i.repair ? `<button class="btn" data-act="repair"${i.repair.missing > 0 ? ' disabled' : ''}>${icon('repair')}<span>${SAY.repair}</span><span class="price">${price(i.repair)}</span><kbd>R</kbd></button>` : ''}
          ${i.refund !== null ? `<button class="btn ghost${i.confirmingRemove ? ' confirm' : ''}" data-act="remove" title="Remove for a partial refund">${icon('remove')}<span>${i.confirmingRemove ? SAY.confirmRemove : ''}</span><span class="price">${icon('refund')}<b>+${i.refund}</b></span><kbd>X</kbd></button>` : ''}
        </div>`;
    }
    for (const b of host.querySelectorAll<HTMLElement>('[data-act]')) {
      const act = b.dataset.act as 'build' | 'upgrade' | 'repair' | 'remove';
      bindButton(b, () => this.actions.base[act]());
    }
  }
}

/**
 * Raids on T1: the early-warning alert while one is inbound (where from, how long, what it is
 * after, how many guns are ready, what to do about it), and the defense report once it is over.
 */
export class RaidHud {
  private readonly alert: HTMLElement;
  private readonly report: HTMLElement;
  private alertKey = '';
  private reportUntil = 0;

  constructor(host: HTMLElement) {
    this.alert = document.createElement('div');
    this.alert.className = 'raid-alert card';
    host.appendChild(this.alert);
    this.report = document.createElement('div');
    this.report.className = 'raid-report card';
    this.report.hidden = true;
    this.report.addEventListener('click', () => this.hideReport());
    host.appendChild(this.report);
  }

  render(r: RaidAlertView | null, paused: boolean): void {
    toggle(this.alert, r !== null && !paused);
    if (this.reportUntil && performance.now() > this.reportUntil) this.hideReport();
    if (!r) return;
    const key = JSON.stringify([r.state, r.direction, Math.ceil(r.eta), r.target, r.ready, r.total, r.escorted, r.distance !== null ? Math.round(r.distance / 10) : null, r.response?.key]);
    if (key === this.alertKey) return;
    this.alertKey = key;
    attr(this.alert, 'data-state', r.state);
    const escort = r.escorted ? `<span title="Escorted">${icon('escort')}</span>` : '';
    this.alert.innerHTML = `
      <div class="ra-row">${icon('bomber', 'icon ra-icon')}<b class="ra-title">${r.state === 'released' ? SAY.bombsAway : 'RAID'}</b>
        <span class="ra-dir" title="Coming from">${icon('heading')}<b>${r.direction}</b></span>
        ${r.state === 'inbound' ? `<span class="ra-eta" title="Time to target">${icon('clock')}<b>${Math.max(0, Math.ceil(r.eta))}s</b></span>` : ''}${escort}</div>
      <div class="ra-row">
        <span title="Target: ${esc(r.target)}">${icon(r.targetIcon)}<b>${esc(r.target.split(' ').slice(-1)[0])}</b></span>
        <span title="Weapons ready" data-tone="${r.total === 0 ? 'warn' : r.ready < r.total ? 'bad' : 'good'}">${icon('shield')}<b>${r.ready}/${r.total}</b></span>
        ${r.distance !== null ? `<span title="Distance from you">${icon('distance')}<b>${metres(r.distance)}</b></span>` : ''}
        <span title="${r.mission ? 'Mission reward' : 'Defense reward if you help'}">${icon('paper')}<b>+${r.reward}</b></span>
        ${r.response ? `<span class="ra-do"><kbd>${esc(r.response.key)}</kbd>${esc(r.response.label)}</span>` : ''}</div>`;
  }

  /** The defense report: one card, a few numbers, gone after a while or on click. */
  showReport(r: RaidReport): void {
    const row = (iconName: IconName, value: string, label: string, tone = '') => `<span class="stat" title="${esc(label)}" data-tone="${tone}">${icon(iconName)}<b>${value}</b></span>`;
    this.report.dataset.tone = r.repelled ? 'good' : 'bad';
    this.report.innerHTML = `
      <div class="rr-head">${icon(r.repelled ? 'shield' : 'raid')}<b>${r.repelled ? SAY.raidRepelled : SAY.baseHit}</b><span class="rr-where">T1</span></div>
      <div class="stats">
        ${row('bomber', String(r.aircraftDestroyed), `Raiders shot down (defenses ${r.byDefenses}, you ${r.byPlayer})`, r.aircraftDestroyed > 0 ? 'good' : '')}
        ${row('paper', r.paperLost > 0 ? `−${r.paperLost}` : '0', 'Paper lost', r.paperLost > 0 ? 'bad' : 'good')}
        ${r.prevented > 0 ? row('shield', `+${r.prevented}`, 'Paper saved', 'good') : ''}
        ${r.destroyed.length + r.damaged.length > 0 ? row('warn', String(r.destroyed.length + r.damaged.length), `Hit: ${[...r.destroyed, ...r.damaged].join(', ')}`, 'bad') : ''}
        ${r.repairCost > 0 ? row('repair', String(r.repairCost), 'Repair cost', 'warn') : ''}
        ${r.defenseDamage + r.playerDamage > 0 ? row('turret', pct(r.defenseDamage / (r.defenseDamage + r.playerDamage)), `Defenses' share of the damage (you: ${pct(r.playerDamage / (r.defenseDamage + r.playerDamage))})`) : ''}
      </div>
      <div class="rr-line">${esc(r.highlight)}</div>`;
    this.report.hidden = false;
    this.report.classList.remove('show');
    void this.report.offsetWidth;
    this.report.classList.add('show');
    this.reportUntil = performance.now() + 9000;
  }

  private hideReport(): void {
    this.report.hidden = true;
    this.reportUntil = 0;
  }
}

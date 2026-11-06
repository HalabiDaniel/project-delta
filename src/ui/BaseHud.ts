import { BASE, type BuildingKind } from '../config';
import { bind } from '../input/bindings';
import type { RaidReport } from '../base/Raids';
import { attrs, bar, button, card, chip, glyph, iconButton, pips, stat, tooltipAttrs, type Tone } from './components';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { fmt, level, metres, pct } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
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

const tip = (t: string): string => attrs(tooltipAttrs(t));
const TONE: Record<NonNullable<Stat['tone']>, Tone> = { good: 'good', bad: 'hostile', warn: 'warn' };

function stats(list: readonly Stat[]): string {
  return list.map((s) => stat({ icon: s.icon, value: s.value, label: s.label, delta: s.delta, deltaTone: s.delta ? 'good' : undefined, tone: s.tone ? TONE[s.tone] : undefined })).join('');
}

/**
 * A price as the paper icon and the cost, and, when the player can't afford it, what is MISSING
 * as a red chip ("−10", tooltip "Need 10 more paper"): what to earn, not just the total.
 */
export function priceHtml(p: PriceView): string {
  const name = p.missing > 0 ? `${p.cost} ${ICON_NAMES.paper} · ${SAY.need} ${p.missing}` : `${p.cost} ${ICON_NAMES.paper}`;
  const missing = p.missing > 0
    ? chip({ label: '', value: `−${p.missing}`, tone: 'hostile', className: 'missing', tip: `${SAY.need} ${p.missing} more ${ICON_NAMES.paper.toLowerCase()}`, attrs: { 'data-missing': p.missing } })
    : '';
  return `<span class="price" role="img" aria-label="${esc(name)}"${p.missing > 0 ? ' data-short' : ''}>${icon('paper')}<b class="num">${p.cost}</b>${missing}</span>`;
}

/**
 * Base management on T1, from above: a marker on every construction slot (what stands there, its
 * health, whether the chosen building fits), the base's state across the top, a build tray bottom
 * left, the selected slot's inspector bottom centre, and Repair all / Done bottom right. Costs
 * show what is missing; Remove asks with the confirm dialog (BaseMode).
 */
export class BaseHud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly markers = new Map<string, HTMLElement>();
  private trayKey = '';
  private inspKey = '';
  private shown = false;

  constructor(
    zones: { world: HTMLElement; tc: HTMLElement; bl: HTMLElement; bc: HTMLElement; br: HTMLElement },
    private readonly actions: HudActions,
  ) {
    const add = (host: HTMLElement, html: string): HTMLElement => {
      host.insertAdjacentHTML('beforeend', html);
      const node = host.lastElementChild as HTMLElement;
      for (const n of node.querySelectorAll<HTMLElement>('[data-b]')) this.el[n.dataset.b!] = n;
      return node;
    };
    this.el.markers = add(zones.world, `<div class="slot-markers" role="group" aria-label="${SAY.slot}"></div>`);
    this.el.overview = add(zones.tc, card({
      className: 'base-overview', label: SAY.base, fold: true,
      bodyHtml: /* html */ `
        <span class="ov" ${tip('Weapons ready')} data-b="ov-ready">${icon('shield')}<b class="num" data-b="ready"></b></span>
        <span class="ov" ${tip('Radar')} data-b="ov-radar">${icon('radar')}<b class="num" data-b="radar"></b></span>
        <span class="ov" ${tip('Base condition')} data-b="ov-integrity">${icon('base')}<b class="num" data-b="integrity"></b></span>`,
    }));
    this.el.tray = add(zones.bl, card({ className: 'tray', label: SAY.buildTray, bodyHtml: `<div class="tray-items" data-b="tray-items"></div>` }));
    this.el.inspector = add(zones.bc, card({ className: 'base-insp', label: SAY.slot, bodyHtml: '<div class="bi-body" data-b="insp"></div>' }));
    this.el.actions = add(zones.br, /* html */ `<div class="base-actions">
      ${button({ label: SAY.repairAll, icon: 'repair', tip: 'Repair everything', attrs: { 'data-b': 'repair-all' } })}
      ${button({ label: SAY.done, variant: 'primary', size: 'big', key: bind('base'), attrs: { 'data-b': 'done' } })}</div>`);
    this.el['repair-all'].querySelector('.ui-label')!.insertAdjacentHTML('afterend', '<span class="price-slot" data-b="repair-all-cost"></span>');
    this.el['repair-all-cost'] = this.el['repair-all'].querySelector<HTMLElement>('[data-b="repair-all-cost"]')!;
    bindButton(this.el['repair-all'], () => actions.base.repairAll());
    bindButton(this.el.done, () => actions.toggleBase());
    this.el.markers.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.markers.addEventListener('click', (e) => {
      const m = (e.target as Element).closest<HTMLElement>('.slot-marker');
      if (!m) return;
      e.stopPropagation();
      this.actions.base.selectSlot(m.dataset.slot!);
    });
    this.el['tray-items'].addEventListener('mousedown', (e) => e.preventDefault());
    this.el['tray-items'].addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.tray-item');
      if (!b || b.disabled) return;
      e.stopPropagation();
      this.actions.base.choose(b.dataset.kind as BuildingKind);
    });
    const insp = this.el.insp;
    insp.addEventListener('mousedown', (e) => e.preventDefault());
    insp.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      const act = b.dataset.act as 'build' | 'upgrade' | 'repair' | 'remove';
      this.actions.base[act]();
    });
  }

  render(v: BaseView | null, paused: boolean): void {
    const show = v !== null && !paused;
    for (const k of ['overview', 'tray', 'inspector', 'actions', 'markers']) toggle(this.el[k], show);
    if (v && show) {
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
        costEl.innerHTML = priceHtml(v.repairAll);
      }
    }
    // Opening base mode puts the highlight in the tray; closing returns it to what opened it.
    const open = v !== null && !paused;
    if (open !== this.shown) {
      this.shown = open;
      if (open) focusManager()?.openPanel(this.el.tray);
      else focusManager()?.closePanel(this.el.tray);
    }
  }

  private renderMarkers(v: BaseView): void {
    const seen = new Set<string>();
    for (const s of v.slots) {
      let el = this.markers.get(s.id);
      if (!el) {
        this.el.markers.insertAdjacentHTML('beforeend', `<button type="button" class="slot-marker" data-slot="${esc(s.id)}"><span class="sm-icon"></span><span class="sm-level"></span>${bar({ value: 1, label: ICON_NAMES.health, size: 'mini', className: 'sm-health' })}</button>`);
        el = this.el.markers.lastElementChild as HTMLElement;
        this.markers.set(s.id, el);
      }
      const iconName: IconName = s.building ? BUILDING_ICONS[s.building] : SLOT_KIND_ICONS[s.kind];
      const iconEl = el.querySelector('.sm-icon') as HTMLElement;
      if (iconEl.dataset.icon !== iconName) {
        iconEl.dataset.icon = iconName;
        iconEl.innerHTML = icon(iconName);
      }
      const name = s.building === 'store' ? `Paper store · ${pct(s.health)}` : s.building ? `${BASE.buildings[s.building].name} · level ${s.level} · ${pct(s.health)}` : SLOT_KIND_LABELS[s.kind];
      attr(el, 'aria-label', name);
      attr(el, 'data-tip', name);
      attr(el, 'data-state', s.building ? (s.status ?? 'ok') : 'empty');
      attr(el, 'data-fits', s.fits === null ? 'none' : String(s.fits));
      attr(el, 'aria-pressed', String(s.selected));
      el.classList.toggle('selected', s.selected);
      const lvKey = s.building && s.building !== 'store' && s.level > 1 ? String(s.level) : '';
      const lv = el.querySelector('.sm-level') as HTMLElement;
      if (lv.dataset.key !== lvKey) {
        lv.dataset.key = lvKey;
        lv.innerHTML = lvKey ? pips({ filled: s.level, total: s.level, label: `${ICON_NAMES.level} ${s.level}`, tone: 'gold' }) : '';
      }
      const meter = el.querySelector('.sm-health') as HTMLElement;
      toggle(meter, !!s.building && s.status !== 'ok');
      width(meter.firstElementChild as HTMLElement, s.health);
      attr(meter, 'data-level', level(s.health));
      const tr = `translate(${s.x}px, ${s.y}px)`;
      if (el.style.transform !== tr) el.style.transform = tr;
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
    attr(this.el['ov-radar'], 'data-tip', o.radar === 'none' ? 'No radar: raids are seen late' : o.radar === 'on' ? 'Radar: early warning range' : 'Radar destroyed');
    text(this.el.integrity, pct(o.integrity));
    attr(this.el['ov-integrity'], 'data-tone', o.integrity >= 0.99 ? 'good' : o.integrity > 0.6 ? 'warn' : 'bad');
  }

  private renderTray(v: BaseView): void {
    const key = v.tray.map((t) => `${t.kind}:${t.missing}:${t.placeable}:${t.chosen}`).join('|');
    if (key === this.trayKey) return;
    this.trayKey = key;
    // Grouped by category: defense, radar, economy. The first building that fits takes the highlight on open.
    const groups: string[] = [];
    let category = '';
    let items: string[] = [];
    const firstOpen = v.tray.find((t) => t.placeable)?.kind;
    const flush = () => {
      if (category) groups.push(`<div class="tray-group" role="group" aria-label="${CATEGORY_LABELS[category as TrayCategory]}"><span class="tray-cat" role="img" aria-label="${CATEGORY_LABELS[category as TrayCategory]}" ${tip(CATEGORY_LABELS[category as TrayCategory])}>${icon(CATEGORY_ICONS[category as TrayCategory])}</span>${items.join('')}</div>`);
      items = [];
    };
    for (const t of v.tray) {
      const cat = TRAY_CATEGORY[t.kind];
      if (cat !== category) {
        flush();
        category = cat;
      }
      const tipText = `${t.name}: ${t.purpose}${t.placeable ? '' : ' (no free slot for it)'}${t.missing > 0 ? ` · ${SAY.need} ${t.missing}` : ''}`;
      items.push(`<button type="button" class="tray-item${t.chosen ? ' chosen' : ''}${t.missing > 0 ? ' short' : ''}" data-kind="${t.kind}"${t.placeable ? '' : ' disabled'}${t.kind === firstOpen ? ' data-nav-default' : ''} aria-pressed="${t.chosen}" aria-label="${esc(tipText)}" ${tip(tipText)}>${icon(BUILDING_ICONS[t.kind], 'icon tray-icon')}<span class="tray-name">${esc(t.short)}</span>${priceHtml(t)}</button>`);
    }
    flush();
    this.el['tray-items'].innerHTML = groups.join('');
  }

  private renderInspector(i: BaseInspectorView | null): void {
    toggle(this.el.inspector, i !== null);
    if (!i) return;
    const key = JSON.stringify(i);
    if (key === this.inspKey) return;
    this.inspKey = key;
    const host = this.el.insp;
    if (i.type === 'empty') {
      const takes = i.takes.map((k) => `<span role="img" aria-label="${esc(BASE.buildings[k].name)}" ${tip(BASE.buildings[k].name)}>${icon(BUILDING_ICONS[k])}</span>`).join('');
      const c = i.chosen;
      attr(this.el.inspector, 'aria-label', SLOT_KIND_LABELS[i.slotKind]);
      host.innerHTML = `
        <div class="bi-head">${icon(SLOT_KIND_ICONS[i.slotKind])}<b>${esc(SLOT_KIND_LABELS[i.slotKind])}</b><span class="bi-takes">${takes}</span></div>
        ${c ? `<div class="bi-build"><span class="bi-what">${icon(BUILDING_ICONS[c.kind])}<b>${esc(c.name)}</b></span><span class="stats">${stats(c.effects)}</span></div>
          <div class="bi-actions">${button({ label: SAY.build, icon: 'build', variant: 'primary', key: { key: bind('confirm').key }, disabled: !c.fits || c.price.missing > 0, attrs: { 'data-act': 'build' } })}<span class="bi-price">${priceHtml(c.price)}</span></div>`
          : `<div class="bi-pick">${icon('build')}<span>Pick a building</span></div>`}`;
      return;
    }
    attr(this.el.inspector, 'aria-label', i.name);
    const lv = pips({ filled: i.level, total: i.maxLevel, label: `Level ${i.level}/${i.maxLevel}`, tone: 'friend', attrs: { 'data-tip': `Level ${i.level}/${i.maxLevel}` } });
    const hp = i.maxHealth > 0 ? i.health / i.maxHealth : 0;
    const actions: string[] = [];
    if (i.upgrade) {
      const gains = i.upgrade.next.filter((s) => s.delta).slice(0, 3).map((s) => `<span class="gain" role="img" aria-label="${esc(`${s.label}: ${s.value}`)}" ${tip(`${s.label}: ${s.value}`)}>${icon(s.icon)}<em class="num">${esc(s.delta!)}</em></span>`).join('');
      actions.push(`<div class="bi-action">${button({ label: SAY.upgrade, icon: 'upgrade', key: bind('upgrade'), disabled: i.upgrade.missing > 0 || i.status === 'destroyed', tip: i.upgrade.next.map((s) => `${s.label} ${s.value}`).join(' · '), attrs: { 'data-act': 'upgrade' } })}${priceHtml(i.upgrade)}<span class="stats gain-list">${gains}</span></div>`);
    } else if (i.kind !== 'store') {
      actions.push(chip({ label: SAY.maxLevel, icon: 'level', tip: 'Fully upgraded' }));
    }
    if (i.repair) actions.push(`<div class="bi-action">${button({ label: SAY.repair, icon: 'repair', key: bind('service'), disabled: i.repair.missing > 0, attrs: { 'data-act': 'repair' } })}${priceHtml(i.repair)}</div>`);
    if (i.refund !== null) {
      actions.push(`<div class="bi-action">${button({ label: SAY.remove, icon: 'remove', variant: 'danger', key: bind('swap'), tip: 'Remove for a partial refund (asks first)', attrs: { 'data-act': 'remove' } })}<span class="price refund" role="img" aria-label="${esc(`${ICON_NAMES.refund} +${i.refund}`)}" ${tip(ICON_NAMES.refund)}>${icon('refund')}<b class="num">+${i.refund}</b></span></div>`);
    }
    host.innerHTML = `
      <div class="bi-head">${icon(BUILDING_ICONS[i.kind])}<b>${esc(i.name)}</b>${lv}
        <span class="bi-status" data-state="${i.status}" role="img" aria-label="${esc(ICON_NAMES[STATUS_ICON[i.status]])}" ${tip(ICON_NAMES[STATUS_ICON[i.status]])}>${icon(STATUS_ICON[i.status])}</span></div>
      <div class="meter" ${tip(ICON_NAMES.health)}>${icon('health')}${bar({ value: hp, label: ICON_NAMES.health })}<b class="num">${fmt(i.health)}/${fmt(i.maxHealth)}</b></div>
      <div class="stats">${stats(i.stats)}</div>
      <div class="bi-actions">${actions.join('')}</div>`;
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
    host.insertAdjacentHTML('beforeend', `<div class="raid-alert ui-card" role="alert" aria-label="${SAY.raidInbound}" data-critical data-tone="hostile"></div>`);
    this.alert = host.lastElementChild as HTMLElement;
    host.insertAdjacentHTML('beforeend', card({ className: 'raid-report', label: SAY.defenseReport, elevation: 'floating', bodyHtml: '' }));
    this.report = host.lastElementChild as HTMLElement;
    this.report.hidden = true;
    this.report.addEventListener('click', () => this.hideReport());
  }

  render(r: RaidAlertView | null, paused: boolean): void {
    toggle(this.alert, r !== null && !paused);
    if (this.reportUntil && performance.now() > this.reportUntil) this.hideReport();
    if (!r) return;
    const key = JSON.stringify([r.state, r.direction, Math.ceil(r.eta), r.target, r.ready, r.total, r.escorted, r.distance !== null ? Math.round(r.distance / 10) : null, r.response?.key]);
    if (key === this.alertKey) return;
    this.alertKey = key;
    attr(this.alert, 'data-state', r.state);
    const escort = r.escorted ? `<span role="img" aria-label="${ICON_NAMES.escort}" ${tip('Escorted')}>${icon('escort')}</span>` : '';
    this.alert.innerHTML = `
      <div class="ra-row">${icon('bomber', 'icon ra-icon')}<b class="ra-title">${r.state === 'released' ? SAY.bombsAway : 'RAID'}</b>
        <span class="ra-dir" ${tip('Coming from')}>${icon('heading')}<b class="num">${r.direction}</b></span>
        ${r.state === 'inbound' ? `<span class="ra-eta" ${tip('Time to target')}>${icon('clock')}<b class="num">${Math.max(0, Math.ceil(r.eta))}s</b></span>` : ''}${escort}</div>
      <div class="ra-row">
        <span ${tip(`Target: ${r.target}`)}>${icon(r.targetIcon)}<b>${esc(r.target.split(' ').slice(-1)[0])}</b></span>
        <span ${tip('Weapons ready')} data-tone="${r.total === 0 ? 'warn' : r.ready < r.total ? 'bad' : 'good'}">${icon('shield')}<b class="num">${r.ready}/${r.total}</b></span>
        ${r.distance !== null ? `<span ${tip('Distance from you')}>${icon('distance')}<b class="num">${metres(r.distance)}</b></span>` : ''}
        <span ${tip(r.mission ? 'Mission reward' : 'Defense reward if you help')}>${icon('paper')}<b class="num">+${r.reward}</b></span>
        ${r.response ? `<span class="ra-do">${glyph({ key: r.response.key })}${esc(r.response.label)}</span>` : ''}</div>`;
  }

  /** The defense report: one card, a few numbers, gone after a while, on click or with its close button. */
  showReport(r: RaidReport): void {
    const row = (iconName: IconName, value: string, label: string, tone?: Tone) => stat({ icon: iconName, value, label, tone });
    attr(this.report, 'data-tone', r.repelled ? 'good' : 'hostile');
    const share = r.defenseDamage + r.playerDamage;
    (this.report.querySelector('.ui-card-body') as HTMLElement).innerHTML = `
      <div class="rr-head">${icon(r.repelled ? 'shield' : 'raid')}<b>${r.repelled ? SAY.raidRepelled : SAY.baseHit}</b><span class="rr-where num">T1</span>${iconButton({ icon: 'close', name: SAY.close, className: 'rr-close' })}</div>
      <div class="stats">
        ${row('bomber', String(r.aircraftDestroyed), `Raiders shot down (defenses ${r.byDefenses}, you ${r.byPlayer})`, r.aircraftDestroyed > 0 ? 'good' : undefined)}
        ${row('paper', r.paperLost > 0 ? `−${r.paperLost}` : '0', 'Paper lost', r.paperLost > 0 ? 'hostile' : 'good')}
        ${r.prevented > 0 ? row('shield', `+${r.prevented}`, 'Paper saved', 'good') : ''}
        ${r.destroyed.length + r.damaged.length > 0 ? row('warn', String(r.destroyed.length + r.damaged.length), `Hit: ${[...r.destroyed, ...r.damaged].join(', ')}`, 'hostile') : ''}
        ${r.repairCost > 0 ? row('repair', String(r.repairCost), 'Repair cost', 'warn') : ''}
        ${share > 0 ? row('turret', pct(r.defenseDamage / share), `Defenses' share of the damage (you: ${pct(r.playerDamage / share)})`) : ''}
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


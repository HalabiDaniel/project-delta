import { bind } from '../../input/bindings';
import { glyph } from '../components';
import { focusManager } from '../../input/FocusNav';
import { AIRCRAFT, BASE, DIRECTOR, STARTER_AIRCRAFT, type BuildingKind } from '../../config';
import { esc, toggle } from '../dom';
import { clock, count, fmt, num, paper, pct } from '../format';
import { icon, type IconName } from '../icons';
import { art, dock, dockButton, drawer, kbadge, kbutton, kchip, kiconButton, kmeter, kseg, kvRow, selectCard, tray } from '../kit';
import { MISSION_ICONS, STYLE_TEXT, T } from '../strings';
import type { BaseInspectorView, BaseView, HudActions, HudView, MissionCardView, PriceView, SlotMarkerView, TrayItemView } from '../views';
import type { DeskState } from '../flow';
import type { GarageCardView } from '../Garage';
import type { SuitabilityLevel } from '../../aircraft/Aircraft';
import type { BuildingModelId } from '../../assets/CustomModels';

const D = (): typeof T.desk => T.desk;

/** Which building model draws each kind (the tray's and inspector's art). */
const MODEL: Record<BuildingKind | 'store', BuildingModelId> = { turret: 'turret', launcher: 'launcher', radar: 'radar', workshop: 'workshop', storage: 'storage', store: 'command' };
const ICONS: Record<BuildingKind | 'store', IconName> = { turret: 'turret', launcher: 'launcher', radar: 'radar', workshop: 'workshop', storage: 'storage', store: 'store' };
type Category = 'defence' | 'support' | 'economy';
const CATEGORY: Record<BuildingKind, Category> = { turret: 'defence', launcher: 'defence', radar: 'support', workshop: 'economy', storage: 'economy' };

/** One fit badge for the selected plane: Good fit, Possible, Can't do it. */
export function fitTone(level: SuitabilityLevel): { label: string; tone: 'good' | 'warn' | 'hostile'; icon: IconName } {
  const d = D();
  if (level === 'recommended' || level === 'good') return { label: d.goodFit, tone: 'good', icon: 'ok' };
  if (level === 'possible') return { label: d.possible, tone: 'warn', icon: 'warn' };
  return { label: d.cantDo, tone: 'hostile', icon: 'wrecked' };
}

/** A price on a button: the paper icon and the cost; short of paper, the cost turns hostile. */
export function priceTag(p: PriceView): string {
  return `<span class="price-tag${p.missing > 0 ? ' short' : ''}">${icon('paper', 'icon pw-icon')}<b class="num">${esc(paper(p.cost))}</b></span>`;
}

/**
 * The desk in a match (v0.0.16, the design canvas's Desk · Idle / Build / Hangar / Missions). Four
 * states share one top bar and one dock:
 *   top bar  paper (capped: "100 / 300"), income, storage (meter, protected), defence status,
 *            the active mission (opens Missions), and Menu on the far right
 *   dock     Build (B), Hangar (H), Missions (Tab, count pip) · one big context button:
 *            Fold / Refit / Launch / Take off
 *   idle     nothing else: the 3D desk
 *   missions a right drawer of mission cards; reroll in the head, "Fly this mission" in the foot
 *   hangar   a right drawer: the selected plane's hero, four meters, the plane grid
 *   build    the tray on the dock, the 320px inspector top right, building name tags
 */
export class DeskHud {
  private readonly el: Record<string, HTMLElement> = {};
  private panel: 'idle' | 'hangar' | 'missions' = 'idle';
  private keys: Record<string, string> = {};
  private trayCategory: Category = 'defence';
  private detailsOpen = -1;
  private readonly markers = new Map<string, HTMLElement>();
  private lastView: HudView | null = null;
  private art: (key: string) => string | null = () => null;
  private shownPanel: string = 'idle';

  constructor(
    zones: { tl: HTMLElement; tr: HTMLElement; bc: HTMLElement; right: HTMLElement; world: HTMLElement },
    private readonly actions: HudActions,
  ) {
    const d = D();
    const add = (host: HTMLElement, cls: string, html = ''): HTMLElement => {
      const node = document.createElement('div');
      node.className = cls;
      node.innerHTML = html;
      host.appendChild(node);
      return node;
    };
    this.el.top = add(zones.tl, 'desk-top');
    this.el.menu = add(zones.tr, 'desk-menu', kiconButton({ icon: 'menu', name: T.say.menu, tipKey: bind('back', 'pause'), size: 'm', attrs: { 'data-act': 'menu' } }));
    this.el.tray = add(zones.bc, 'desk-tray');
    this.el.dock = add(zones.bc, 'desk-dock');
    this.el.drawer = add(zones.right, 'desk-drawer');
    this.el.inspector = add(zones.right, 'build-inspector');
    this.el.markers = add(zones.world, 'build-tags');
    this.el.outline = add(zones.world, 'pad-outline');
    this.el.outline.setAttribute('aria-hidden', 'true');
    for (const host of [this.el.top, this.el.menu, this.el.dock, this.el.tray, this.el.drawer, this.el.inspector, this.el.markers]) {
      host.addEventListener('mousedown', (e) => {
        if (!(e.target as Element).closest('input')) e.preventDefault();
      });
      host.addEventListener('click', (e) => this.click(e));
    }
    void d;
  }

  setArt(fn: (key: string) => string | null): void {
    this.art = fn;
    this.keys = {};
  }

  /** The desk state shown (the dock's active button). Build is the game's base mode. */
  state(v: HudView): DeskState {
    return v.baseMode ? 'build' : this.panel;
  }

  /** H, Tab, 1–3, Q / E: open a drawer (or close it when it is already open and `toggle`). */
  open(panel: 'hangar' | 'missions', toggleIt = true): void {
    const v = this.lastView;
    if (v?.baseMode) this.actions.toggleBase();
    this.panel = toggleIt && this.panel === panel ? 'idle' : panel;
  }

  /** Esc closes a drawer first. True when it did. */
  close(): boolean {
    if (this.panel === 'idle') return false;
    this.panel = 'idle';
    return true;
  }

  get drawerOpen(): boolean {
    return this.panel !== 'idle';
  }

  render(v: HudView): void {
    this.lastView = v;
    const atDesk = (v.phase === 'desk' || v.phase === 'building' || v.phase === 'ready') && !v.paused && v.result === null;
    const atHome = atDesk || (v.phase === 'landed' && !v.paused && v.result === null && v.base !== null);
    if (!atDesk && !v.baseMode) this.panel = 'idle';
    if (v.baseMode) this.panel = 'idle';
    toggle(this.el.top, atHome);
    toggle(this.el.menu, atHome);
    toggle(this.el.dock, atDesk || (v.baseMode && !v.paused));
    toggle(this.el.drawer, atDesk && this.panel !== 'idle');
    const build = v.baseMode && !v.paused && v.base !== null;
    toggle(this.el.tray, build);
    toggle(this.el.markers, build);
    if (!atHome) {
      this.outline(null);
      if (this.shownPanel !== 'idle') this.panelChanged('idle');
      toggle(this.el.inspector, false);
      return;
    }
    this.renderTop(v, build);
    this.renderDock(v);
    if (atDesk && this.panel === 'missions') this.renderMissions(v);
    if (atDesk && this.panel === 'hangar') this.renderHangar(v);
    this.outline(atDesk && this.panel === 'hangar' ? (v.pad ?? null) : null);
    if (build && v.base) {
      this.renderTray(v.base);
      this.renderMarkers(v.base);
    }
    this.renderInspector(build ? v.base?.inspector ?? null : null);
    const shown = build ? 'build' : this.panel;
    if (shown !== this.shownPanel) this.panelChanged(shown);
  }

  private panelChanged(shown: string): void {
    const fm = focusManager();
    const was = this.shownPanel;
    this.shownPanel = shown;
    if (was !== 'idle') fm?.closePanel(was === 'build' ? this.el.tray : this.el.drawer);
    const enter = shown === 'build' ? this.el.tray : shown !== 'idle' ? this.el.drawer : null;
    if (enter) {
      enter.dataset.enter = '';
      window.setTimeout(() => delete enter.dataset.enter, 260);
    }
    if (shown === 'build') fm?.openPanel(this.el.tray);
    else if (shown !== 'idle') fm?.openPanel(this.el.drawer);
  }

  private set(host: string, key: string, html: () => string): boolean {
    if (this.keys[host] === key) return false;
    this.keys[host] = key;
    this.el[host].innerHTML = html();
    return true;
  }

  // ---- Top bar -----------------------------------------------------------------------------------

  private renderTop(v: HudView, build: boolean): void {
    const d = D();
    const e = v.economy;
    const capped = e.paper >= e.capacity;
    const raid = v.raid;
    const card = v.cards?.[v.selected] ?? null;
    const op = card?.operation ?? null;
    const o = v.base?.overview;
    const key = JSON.stringify([fmt(e.paper), capped, e.capacity, num(e.rate, 1), e.state, Math.round((e.paper / Math.max(1, e.capacity)) * 10), e.protectedPaper, raid ? Math.ceil(raid.eta) : null, raid?.state, card?.title, op?.stage, op?.stages.length, build, o]);
    if (this.keys.top === key) return;
    this.keys.top = key;
    const fill = e.capacity > 0 ? e.paper / e.capacity : 0;
    const counter = `<span class="paper-pill" role="status" aria-label="${esc(T.front.paperLabel(paper(e.paper)))}"><span class="paper-pill-icon">${icon('paper', 'icon pw-icon')}</span><b class="num">${esc(fmt(e.paper))}</b>${capped ? `<span class="paper-cap num">/ ${esc(fmt(e.capacity))}</span>` : ''}<span class="delta num" data-e="delta"></span></span>`;
    const income = kchip({ icon: 'chart', value: d.perMinute(num(e.rate, 1)), size: 'hud', tone: e.state === 'full' ? 'warn' : 'plain', tip: e.state === 'full' ? T.economy.full : T.economy.perMinute(T.economy.paper) });
    const storage = kchip({
      icon: 'capacity', size: 'hud', tip: T.economy.storage(T.economy.paper),
      afterHtml: `${kmeter({ label: T.economy.storage(T.economy.paper), value: fill, segments: 5, hideLabel: true, tone: fill >= 1 ? 'hostile' : fill >= 0.9 ? 'warn' : 'good', className: 'chip-meter' })}<span class="chip-safe" data-tip="${esc(T.economy.protected)}">${icon('lock', 'icon pw-icon')}<b class="num">${esc(fmt(e.protectedPaper))}</b></span>`,
    });
    const defence = raid
      ? kchip({ icon: 'raid', label: raid.state === 'released' ? STYLE_TEXT.bombsAway : d.raidIncoming, value: raid.state === 'inbound' ? clock(Math.max(0, raid.eta)) : undefined, size: 'hud', tone: 'hostile', attrs: { 'data-critical': '' } })
      : kchip({ icon: 'shield', label: d.allClear, size: 'hud', tone: 'good' });
    const mission = card
      ? kchip({ icon: MISSION_ICONS[card.type], label: card.title, value: op ? `${count(op.stage + 1)}/${count(op.stages.length)}` : undefined, size: 'hud', button: true, tip: d.openMissions, className: 'mission-chip', attrs: { 'data-act': 'missions' } })
      : '';
    const base = build && o
      ? kchip({ icon: 'base', size: 'hud', className: 'base-chip', label: '', afterHtml: `<span class="chip-part" data-tip="${esc(T.base.weaponsReady)}">${icon('shield', 'icon pw-icon')}<b class="num">${count(o.ready)}/${count(o.total)}</b></span><span class="chip-part" data-tip="${esc(T.base.radar)}">${icon('radar', 'icon pw-icon')}<b class="num">${o.radar === 'off' ? esc(T.say.offline) : esc(T.units.metres(count(Math.round(o.detection))))}</b></span><span class="chip-part" data-tip="${esc(T.base.baseCondition)}">${icon('health', 'icon pw-icon')}<b class="num">${esc(pct(o.integrity))}</b></span>` })
      : '';
    this.el.top.innerHTML = `${counter}${income}${storage}${defence}${mission}${base}`;
  }

  /** "+50" / "−20" next to the paper, fading. */
  delta(delta: number): void {
    const el = this.el.top.querySelector<HTMLElement>('[data-e="delta"]');
    if (!el) return;
    el.textContent = delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`;
    el.dataset.tone = delta > 0 ? 'good' : 'bad';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---- Dock -------------------------------------------------------------------------------------

  private mainButton(v: HudView): string {
    const d = v.desk;
    const label = this.mainLabel(v);
    if (v.phase === 'landed') {
      return kbutton({ label: T.say.takeOff, icon: 'send', variant: 'primary', size: 'l', key: bind('launch', 'confirm'), hintKey: true, className: 'dock-main', attrs: { 'data-act': 'takeoff' } });
    }
    if (v.phase === 'building') {
      return `<button type="button" class="pw-btn primary dock-main building" data-variant="primary" data-size="l" disabled><span class="pw-label">${esc(D().folding(d.name))}</span><span class="dock-progress" style="--p:${Math.round(d.progress * 100)}%"></span></button>`;
    }
    const after = v.phase === 'desk' && !d.emergency && d.cost > 0 ? `<span class="dock-cost num">· ${esc(paper(d.cost))}</span>` : '';
    const key = v.phase === 'desk' ? bind('fold', 'confirm') : bind('launch', 'confirm');
    return kbutton({ label, icon: v.phase === 'desk' ? (d.kind === 'refit' ? 'repair' : 'build') : 'send', variant: 'primary', size: 'l', key, hintKey: true, disabled: v.phase === 'desk' && !d.canBuild, tip: d.note ?? undefined, afterHtml: after, className: 'dock-main', attrs: { 'data-act': v.phase === 'desk' ? 'build' : 'launch' } });
  }

  private mainLabel(v: HudView): string {
    const d = v.desk;
    if (v.phase === 'ready') return D().launch;
    if (d.emergency) return T.plane.emergency(AIRCRAFT[STARTER_AIRCRAFT].name);
    if (d.kind === 'rollout') return T.say.takeOff;
    return T.plane.build(T.plane.verb[d.kind], d.name);
  }

  private renderDock(v: HudView): void {
    const st = this.state(v);
    const d = v.desk;
    const n = v.cards?.length ?? 0;
    // v0.0.16: the maneuver for the next take-off, chosen here (on the pad or before folding).
    const pick = v.phase !== 'landed' ? v.maneuverPicker ?? null : null;
    const key = JSON.stringify([st, v.phase, d.kind, d.name, d.cost, d.canBuild, d.emergency, Math.round(d.progress * 20), n, v.base?.canFly, d.note, pick?.current?.id ?? null, pick?.canChange, pick?.count]);
    this.set('dock', key, () => dock({
      label: D().dock,
      itemsHtml: [
        dockButton({ id: 'build', icon: 'build', label: T.say.build, key: bind('base'), active: st === 'build', tip: D().buildTip }),
        dockButton({ id: 'hangar', icon: 'plane', label: D().hangar, key: bind('hangar'), active: st === 'hangar', disabled: v.baseMode && v.phase === 'landed' }),
        dockButton({ id: 'missions', icon: 'map', label: D().missions, key: bind('missions'), active: st === 'missions', pip: n > 0 ? count(n) : undefined, disabled: v.phase === 'landed' }),
        pick?.current
          ? kbutton({ label: T.maneuver.button(pick.current.name), icon: 'maneuver', size: 'l', key: bind('maneuverNext'), hintKey: true, disabled: !pick.canChange, tip: T.maneuver.pickInfo(pick.current.summary, pick.current.inspiredBy), afterHtml: pick.count > 1 ? `<span class="dock-cost num">${esc(T.maneuver.of(pick.index + 1, pick.count))}</span>` : '', className: 'maneuver-pick', attrs: { 'data-act': 'maneuver-next' } })
          : '',
      ].join(''),
      mainHtml: this.mainButton(v),
    }));
  }

  // ---- Missions -----------------------------------------------------------------------------------

  private renderMissions(v: HudView): void {
    const d = D();
    const cards = v.cards ?? [];
    const chosen = cards[v.selected];
    const swappable = !!chosen && chosen.slot !== 'event' && !chosen.operation?.active;
    const key = JSON.stringify(['m', cards.map((c) => [c.title, c.reward, c.threat.level, c.fits.map((f) => `${f.level}${f.selected}`), c.target, c.operation?.stage, c.expires !== null]), v.selected, v.swaps, swappable, this.detailsOpen, v.phase]);
    if (!this.set('drawer', key, () => drawer({
      id: 'missions-drawer',
      title: d.missions,
      icon: 'map',
      headHtml: kbutton({ label: d.swapsLeft(count(v.swaps), count(DIRECTOR.swaps.max)), icon: 'reset', variant: 'quiet', size: 's', disabled: !swappable || v.swaps <= 0 || v.phase !== 'desk' && v.phase !== 'building' && v.phase !== 'ready', tip: T.mission.swapTip, tipKey: bind('swap'), className: 'reroll', attrs: { 'data-act': 'swap' } }),
      bodyHtml: cards.map((c, i) => this.missionCard(c, i, i === v.selected)).join(''),
      footHtml: kbutton({ label: d.flyMission, icon: 'send', variant: 'primary', size: 'm', block: true, disabled: v.phase === 'desk' && !v.desk.canBuild, attrs: { 'data-act': 'fly', 'data-nav-default': '' } }),
      closeName: T.say.close,
      closeKey: bind('back'),
    }))) {
      // Countdowns tick in place, so the drawer is not redrawn every second.
      cards.forEach((c, i) => {
        const el = this.el.drawer.querySelector(`.m-pick[data-i="${i}"] .m-expires b`);
        const t = c.expires !== null ? clock(c.expires) : '';
        if (el && el.textContent !== t) el.textContent = t;
      });
    }
  }

  private missionCard(c: MissionCardView, i: number, selected: boolean): string {
    const d = D();
    const mine = c.fits.find((f) => f.selected);
    const fit = mine ? fitTone(mine.level) : null;
    const risk = `<span class="risk-pips" role="img" aria-label="${esc(T.common.labelValue(d.risk, count(c.threat.level)))}">${[1, 2, 3].map((n) => `<i${n <= c.threat.level ? ' data-on' : ''}></i>`).join('')}</span>`;
    const tip = T.common.dot([c.description, c.fits.map((f) => T.common.labelValue(f.name, fitTone(f.level).label)).join(', '), mine ? STYLE_TEXT.risk(mine.name) : '']).replace(/ · $/, '');
    const op = c.operation;
    const progress = selected && op
      ? `<span class="m-progress" role="img" aria-label="${esc(d.stage(count(op.stage + 1), count(op.stages.length)))}">${op.stages.map((s) => `<i data-status="${s.status}"></i>`).join('')}</span>`
      : '';
    const details = this.detailsOpen === i
      ? `<div class="m-details">${c.description ? `<p>${esc(c.description)}</p>` : ''}<div class="m-fits">${c.fits.map((f) => kbadge({ label: f.name, tone: fitTone(f.level).tone })).join('')}</div>${mine ? `<p class="m-risk">${icon('warn', 'icon pw-icon')}<span>${esc(STYLE_TEXT.risk(mine.name))}</span></p>` : ''}</div>`
      : '';
    return `<article class="m-card${selected ? ' tracked' : ''}" data-tip="${esc(tip)}">
      <button type="button" class="m-pick" data-act="pick" data-i="${i}" aria-pressed="${selected}" aria-label="${esc(T.common.dot([c.title, `+${fmt(c.reward)}`]))}">
        <span class="m-head"><span class="m-title">${esc(c.title)}</span>${selected ? kbadge({ label: d.tracking, tone: 'hostile', className: 'm-tracking' }) : glyph({ key: String(i + 1) }, { className: 'pw-key hint-key' })}</span>
        <span class="m-row"><span class="m-target">${c.target ? `<i class="pw-dot" style="--dot:var(--hostile)"></i>${esc(T.common.labelSpaceValue(d.desk, c.target.replace(/^T/, '')))}` : `${icon('offline', 'icon pw-icon')}${esc(d.anywhere)}`}</span>${risk}<b class="m-reward num">+${esc(fmt(c.reward))}${icon('paper', 'icon pw-icon')}</b></span>
        ${fit ? `<span class="m-fit">${kbadge({ label: fit.label, tone: fit.tone, icon: fit.icon })}${c.expires !== null ? `<span class="m-expires num">${icon('clock', 'icon pw-icon')}<b>${esc(clock(c.expires))}</b></span>` : ''}</span>` : ''}
        ${progress}
      </button>
      ${kbutton({ label: T.say.details, icon: 'more', variant: 'quiet', size: 's', className: `m-more${this.detailsOpen === i ? ' open' : ''}`, attrs: { 'data-act': 'details', 'data-i': String(i), 'aria-expanded': String(this.detailsOpen === i) } })}
      ${details}
    </article>`;
  }

  // ---- Hangar -----------------------------------------------------------------------------------

  private renderHangar(v: HudView): void {
    const d = D();
    const g = v.garage;
    if (!g) return;
    const sel = g.cards.find((c) => c.selected) ?? g.cards[0];
    const r = Object.fromEntries(g.inspector.ratings.map((x) => [x.key, x.value])) as Record<string, number>;
    const kept = g.cards.filter((c) => c.hangar !== null).length;
    const key = JSON.stringify(['h', g.cards.map((c) => [c.id, c.buildKind, c.buildCost, c.hangar, c.suitability, c.selected, c.affordable]), g.locked, v.phase, v.desk.canBuild, this.art(sel.id) !== null]);
    this.set('drawer', key, () => drawer({
      id: 'hangar-drawer',
      title: d.hangar,
      icon: 'plane',
      count: `${count(kept)} / ${count(g.cards.length)}`,
      bodyHtml: `
        <div class="h-hero">${art(this.art(sel.id), 'plane', sel.name)}</div>
        <div class="h-name"><h3>${esc(sel.name)}</h3>${kbadge({ label: sel.roleLabel })}</div>
        <div class="h-meters">
          ${kmeter({ label: d.speed, value: (r.speed ?? 0) / 5, valueText: count(r.speed ?? 0), segments: 10 })}
          ${kmeter({ label: d.hull, value: (r.durability ?? 0) / 5, valueText: count(r.durability ?? 0), segments: 10 })}
          ${kmeter({ label: d.ink, value: (r.firepower ?? 0) / 5, valueText: count(r.firepower ?? 0), segments: 10 })}
          ${kmeter({ label: d.bombs, value: (r.payload ?? 0) / 5, valueText: count(r.payload ?? 0), segments: 10 })}
        </div>
        <div class="h-details" aria-label="${esc(T.say.details)}">${kchip({ label: d.agility, value: count(r.maneuverability ?? 0) })}${kchip({ label: d.vision, value: count(r.stealth ?? 0) })}${kchip({ label: d.range, value: count(r.range ?? 0) })}</div>
        <h4 class="pw-section">${esc(d.yourPlanes)}</h4>
        <div class="h-grid">${g.cards.map((c) => this.planeCard(c, g.locked)).join('')}</div>`,
      footHtml: `${kbutton({ label: d.foldNew, icon: 'plus', size: 'm', disabled: v.phase !== 'desk' || !v.desk.canBuild || sel.buildKind !== 'fold', attrs: { 'data-act': 'build' } })}${kbutton({ label: d.fly(sel.name), icon: 'send', variant: 'primary', size: 'm', disabled: v.phase === 'desk' && !v.desk.canBuild, attrs: { 'data-act': 'fly', 'data-nav-default': '' } })}`,
      closeName: T.say.close,
      closeKey: bind('back'),
    }));
  }

  private planeCard(c: GarageCardView, locked: boolean): string {
    const fit = fitTone(c.suitability);
    const price = c.buildKind === 'rollout' ? `<span class="h-price">${icon('home', 'icon pw-icon')}</span>` : `<span class="h-price${c.affordable ? '' : ' short'}">${icon(c.buildKind === 'refit' ? 'repair' : 'paper', 'icon pw-icon')}<b class="num">${esc(paper(c.buildKind === 'refit' ? c.buildCost : c.cost))}</b></span>`;
    return selectCard({
      artHtml: art(this.art(c.id), 'plane', c.name),
      title: c.name,
      tagHtml: price,
      selected: c.selected,
      disabled: locked && !c.selected,
      cornerHtml: `<span class="h-fit" data-tone="${fit.tone}" role="img" aria-label="${esc(fit.label)}">${icon(fit.icon, 'icon pw-icon')}</span>`,
      tip: T.common.dot([c.name, c.roleLabel, fit.label]),
      className: 'h-card',
      attrs: { 'data-act': 'plane', 'data-id': c.id },
    });
  }

  /** The plane on the runway gets a sky-blue outline while the Hangar is open. */
  private outline(at: { x: number; y: number } | null): void {
    toggle(this.el.outline, at !== null);
    if (at) this.el.outline.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
  }

  // ---- Build --------------------------------------------------------------------------------------

  private renderTray(b: BaseView): void {
    const d = D();
    const cats: Category[] = ['defence', 'support', 'economy'];
    const items = b.tray.filter((t) => CATEGORY[t.kind] === this.trayCategory);
    const key = JSON.stringify([this.trayCategory, b.tray.map((t) => [t.kind, t.missing, t.placeable, t.chosen]), this.art('b:turret') !== null]);
    this.set('tray', key, () => tray({
      label: T.say.buildTray,
      tabsHtml: kseg({ id: 'tray-cat', label: T.say.buildTray, items: cats.map((c) => ({ value: c, label: d.categories[c], pressed: c === this.trayCategory })) }),
      cardsHtml: items.map((t) => this.trayCard(t)).join('') || `<p class="tray-empty">${esc(d.nothingHere)}</p>`,
    }));
  }

  private trayCard(t: TrayItemView): string {
    const d = D();
    const reason = !t.placeable ? d.noSlot : t.missing > 0 ? d.needPaper(paper(t.missing)) : t.purpose;
    return selectCard({
      artHtml: art(this.art(`b:${MODEL[t.kind]}`), ICONS[t.kind], t.name),
      title: t.short,
      tagHtml: priceTag(t),
      selected: t.chosen,
      disabled: !t.placeable || t.missing > 0,
      tip: T.common.dot([t.name, reason]),
      className: 'tray-card',
      attrs: { 'data-act': 'choose', 'data-kind': t.kind },
    });
  }

  private renderMarkers(b: BaseView): void {
    const seen = new Set<string>();
    for (const s of b.slots) {
      let el = this.markers.get(s.id) as HTMLButtonElement | undefined;
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'build-tag';
        el.dataset.act = 'slot';
        el.dataset.slot = s.id;
        this.el.markers.appendChild(el);
        this.markers.set(s.id, el!);
      }
      const name = this.slotName(s);
      const k = `${name}|${s.building}|${s.status}|${s.selected}|${s.fits}`;
      if (el.dataset.key !== k) {
        el.dataset.key = k;
        el.innerHTML = s.building ? `<span>${esc(name)}</span>` : icon('plus', 'icon pw-icon');
        el.setAttribute('aria-label', name);
        el.dataset.tip = name;
        el.dataset.kind = s.building ? 'building' : 'empty';
        el.dataset.state = s.status ?? 'ok';
        el.dataset.fits = s.fits === null ? 'none' : String(s.fits);
        el.setAttribute('aria-pressed', String(s.selected));
      }
      const tr = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      if (el.style.transform !== tr) el.style.transform = tr;
      toggle(el, s.onScreen);
      seen.add(s.id);
    }
    for (const [id, el] of this.markers) if (!seen.has(id)) toggle(el, false);
  }

  private slotName(s: SlotMarkerView): string {
    const d = D();
    if (s.building === 'store') return d.commandCenter;
    if (s.building) return s.level > 1 ? d.nameLevel(BASE.buildings[s.building].short, s.level) : BASE.buildings[s.building].short;
    return T.slotKind[s.kind];
  }

  private renderInspector(i: BaseInspectorView | null): void {
    toggle(this.el.inspector, i !== null);
    if (!i) {
      this.keys.inspector = '';
      return;
    }
    const d = D();
    const key = JSON.stringify([i, this.art('b:turret') !== null]);
    this.set('inspector', key, () => {
      const close = kiconButton({ icon: 'close', name: T.say.close, tipKey: bind('back'), className: 'insp-close', attrs: { 'data-act': 'base-done' } });
      if (i.type === 'empty') {
        const c = i.chosen;
        return `<section class="pw-panel insp" role="group" aria-label="${esc(T.slotKind[i.slotKind])}">
          <div class="insp-art">${art(c ? this.art(`b:${MODEL[c.kind]}`) : null, c ? ICONS[c.kind] : 'slot')}${close}</div>
          <div class="insp-body"><div class="insp-head"><h3>${esc(c ? c.name : T.slotKind[i.slotKind])}</h3></div>
          ${c ? kvRow(c.effects[0]?.label ?? d.makes, esc(c.effects[0]?.value ?? '')) : `<p class="insp-pick">${esc(T.base.pickBuilding)}</p>`}
          ${c ? `<div class="insp-actions">${kbutton({ label: d.buildCost(paper(c.price.cost)), icon: 'build', variant: 'primary', size: 'm', disabled: !c.fits || c.price.missing > 0, tip: c.price.missing > 0 ? d.needPaper(paper(c.price.missing)) : undefined, attrs: { 'data-act': 'base-build', 'data-nav-default': '' } })}</div>` : ''}</div></section>`;
      }
      const stat = i.stats[0];
      const next = i.upgrade?.next.find((s) => s.label === stat?.label) ?? i.upgrade?.next[0];
      const row = stat ? kvRow(stat.label, `${esc(stat.value)}${next && next.value !== stat.value ? `${icon('arrowLeft', 'icon pw-icon arrow-next')}<b class="good">${esc(next.value)}</b>` : ''}`) : '';
      const upgrade = i.upgrade
        ? kbutton({ label: d.upgradeCost(paper(i.upgrade.cost)), icon: 'upgrade', variant: 'primary', size: 'm', disabled: i.upgrade.missing > 0 || i.status === 'destroyed', tip: i.upgrade.missing > 0 ? d.needPaper(paper(i.upgrade.missing)) : undefined, tipKey: bind('upgrade'), attrs: { 'data-act': 'base-upgrade', 'data-nav-default': '' } })
        : kbadge({ label: T.say.maxLevel, tone: 'gold' });
      const repair = i.repair ? kiconButton({ icon: 'repair', name: d.repairCost(paper(i.repair.cost)), tipKey: bind('service'), disabled: i.repair.missing > 0, attrs: { 'data-act': 'base-repair' } }) : '';
      const sell = i.refund !== null ? kiconButton({ icon: 'remove', name: d.sell(paper(i.refund)), tipKey: bind('swap'), variant: 'danger', attrs: { 'data-act': 'base-remove' } }) : '';
      return `<section class="pw-panel insp" role="group" aria-label="${esc(i.name)}">
        <div class="insp-art">${art(this.art(`b:${MODEL[i.kind]}`), ICONS[i.kind], i.name)}${close}</div>
        <div class="insp-body"><div class="insp-head"><h3>${esc(i.kind === 'store' ? d.commandCenter : i.name)}</h3>${i.maxLevel > 1 ? kbadge({ label: d.level(count(i.level)), tone: 'gold' }) : ''}${i.status !== 'ok' ? kbadge({ label: i.status === 'destroyed' ? T.icon.wrecked : T.icon.warn, tone: 'hostile' }) : ''}</div>
        ${row}
        <div class="insp-actions">${upgrade}${repair}${sell}</div></div></section>`;
    });
  }

  // ---- Events --------------------------------------------------------------------------------------

  private click(e: Event): void {
    const t = e.target as Element;
    const seg = t.closest<HTMLButtonElement>('[data-seg="tray-cat"] > button');
    if (seg) {
      this.trayCategory = seg.dataset.v as Category;
      return;
    }
    const dockBtn = t.closest<HTMLButtonElement>('[data-dock]');
    if (dockBtn && !dockBtn.disabled) {
      e.stopPropagation();
      const id = dockBtn.dataset.dock;
      if (id === 'build') {
        this.panel = 'idle';
        this.actions.toggleBase();
      } else this.open(id as 'hangar' | 'missions');
      return;
    }
    const b = t.closest<HTMLElement>('[data-act]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    e.stopPropagation();
    const a = this.actions;
    switch (b.dataset.act) {
      case 'menu':
        return a.openMenu();
      case 'missions':
        return this.open('missions', false);
      case 'close':
        this.panel = 'idle';
        return;
      case 'swap':
        return a.swap();
      case 'pick':
        return a.select(Number(b.dataset.i));
      case 'details': {
        const i = Number(b.dataset.i);
        this.detailsOpen = this.detailsOpen === i ? -1 : i;
        return;
      }
      case 'plane':
        return a.selectAircraft(b.dataset.id as GarageCardView['id']);
      case 'build':
        return a.build();
      case 'launch':
        if (this.lastView?.baseMode) a.toggleBase();
        return a.launch();
      case 'takeoff':
        if (this.lastView?.baseMode) a.toggleBase();
        return a.takeOff();
      case 'fly': {
        this.panel = 'idle';
        const v = this.lastView;
        if (v?.phase === 'ready') a.launch();
        else if (v?.phase === 'desk') a.build();
        return;
      }
      case 'base-done':
        return a.toggleBase();
      case 'maneuver-next':
        return a.cycleManeuver?.(1);
      case 'choose':
        return a.base.choose(b.dataset.kind as BuildingKind);
      case 'slot':
        return a.base.selectSlot(b.dataset.slot!);
      case 'base-build':
        return a.base.build();
      case 'base-upgrade':
        return a.base.upgrade();
      case 'base-repair':
        return a.base.repair();
      case 'base-remove':
        return a.base.remove();
    }
  }
}

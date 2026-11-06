import { AIRCRAFT, LANDING, STARTER_AIRCRAFT } from '../config';
import { bind } from '../input/bindings';
import { attrs, bar, button, card, glyph, pips, tooltipAttrs } from './components';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { clock, count, fixed, fmt, level, metres, num, paper, pct } from './format';
import { icon, ICON_NAMES } from './icons';
import { SAY, STYLE_TEXT, T } from './strings';
import type { HudView } from './views';

const VERB = T.plane.verb;

/** Range is critical sooner than health: none left means gliding home. */
export function rangeLevel(fraction: number): 'ok' | 'worn' | 'critical' {
  return fraction > 0.25 ? 'ok' : fraction > 0 ? 'worn' : 'critical';
}

const tip = (text: string): string => attrs(tooltipAttrs(text));

/**
 * The plane, as icons and numbers: condition bottom left (health and range as bars with critical
 * thresholds), instruments bottom centre (speed, altitude, boost), weapons bottom right (ink as a
 * number, bombs as pips) with the one action that matters now. On the ground: the landing checks,
 * then the ground crew's buttons. At the desk: fold / refit / roll out, then launch.
 */
export class PlaneHud {
  private readonly el: Record<string, HTMLElement> = {};

  constructor(
    zones: { tr?: HTMLElement; bl: HTMLElement; bc: HTMLElement; br: HTMLElement; centre: HTMLElement },
    actions: { build: () => void; launch: () => void; rearm: () => void; takeOff: () => void; endSortie: () => void; base: () => void; rearmAndGo?: () => void },
  ) {
    const add = (host: HTMLElement, html: string): HTMLElement => {
      host.insertAdjacentHTML('beforeend', html);
      const node = host.lastElementChild as HTMLElement;
      for (const n of node.querySelectorAll<HTMLElement>('[data-p]')) this.el[n.dataset.p!] = n;
      return node;
    };
    // The style guide's Meter: icon and word, a segmented bar, the value as text.
    const meter = (p: string, iconName: 'health' | 'range', word: string): string =>
      `<div class="meter ui-meter" ${tip(ICON_NAMES[iconName])}><span class="ui-meter-label">${icon(iconName)}<span>${esc(word)}</span></span>${bar({ value: 1, label: ICON_NAMES[iconName], segments: 10, attrs: { 'data-p': p } })}<b class="num" data-p="${p}-n"></b></div>`;

    this.el.condition = add(zones.bl, card({
      className: 'condition', label: SAY.condition,
      bodyHtml: `<div class="cond-head"><span class="swatch" data-p="swatch"></span><b data-p="name"></b><span class="ui-badge-tag cond-role" data-p="role"></span></div>${meter('health', 'health', STYLE_TEXT.hull)}${meter('range', 'range', STYLE_TEXT.range)}`,
    }));
    this.el.landing = add(zones.bc, card({
      className: 'landing', label: ICON_NAMES.land, fold: false,
      bodyHtml: /* html */ `
        <span class="check" data-p="lg-speed" ${tip(T.plane.speedCheck(num(LANDING.maxSpeed)))}>${icon('speed')}<b class="num"></b></span>
        <span class="check" data-p="lg-sink" ${tip(T.plane.sinkCheck(num(LANDING.maxSink, 1)))}>${icon('land')}<b class="num"></b></span>
        <span class="check" data-p="lg-level" ${tip(T.plane.bankCheck)}>${icon('heading')}<b class="num"></b></span>`,
    }));
    this.el.instruments = add(zones.bc, card({
      className: 'instruments', label: SAY.instruments, fold: false,
      bodyHtml: /* html */ `
        <div class="gauge" ${tip(ICON_NAMES.speed)}>${icon('speed')}<b class="num" data-p="speed"></b><span class="speed-track">${bar({ value: 0, label: ICON_NAMES.speed, kind: 'progress', attrs: { 'data-p': 'speed-bar' } })}<em class="throttle-mark" data-p="throttle"></em></span><span class="hint-keys">${glyph(bind('throttleUp'))}${glyph(bind('throttleDown'))}</span></div>
        <div class="gauge" ${tip(ICON_NAMES.altitude)}>${icon('altitude')}<b class="num" data-p="alt"></b></div>
        <div class="gauge boost" data-p="boost" ${tip(ICON_NAMES.boost)}>${icon('boost')}${bar({ value: 1, label: ICON_NAMES.boost, kind: 'boost', attrs: { 'data-p': 'boost-bar' } })}${glyph(bind('boost'), { className: 'hint-key' })}</div>
        <div class="maneuver-slot" data-p="maneuvers" hidden></div>`,
    }));
    // Extension point for v0.0.16 (flight maneuvers): crease charges, the "fast enough" marker,
    // refusal reasons and contextual prompts go in this slot beside the boost meter, built from
    // the components (pips, chip, glyph). It is empty and hidden until then; filling it needs no
    // layout change (the instruments card is a flex row and grows to fit).
    this.el.maneuvers = this.el.instruments.querySelector<HTMLElement>('[data-p="maneuvers"]')!;
    this.el.ground = add(zones.bc, card({
      className: 'ground', label: ICON_NAMES.home, fold: false,
      bodyHtml: [
        `<span class="ground-where" ${tip(T.plane.landedAt)}>${icon('home')}<b>${esc(T.plane.home)}</b></span>`,
        `<span class="ground-status" data-p="gr-status"></span>`,
        button({ label: SAY.rearm, icon: 'rearm', key: bind('service'), tip: T.plane.rearmTip, attrs: { 'data-p': 'rearm' } }),
        button({ label: T.plane.rearmGo, icon: 'rearm', tip: T.plane.rearmGoTip, attrs: { 'data-p': 'rearmgo' } }),
        button({ label: SAY.takeOff, icon: 'plane', variant: 'primary', key: bind('launch', 'confirm'), attrs: { 'data-p': 'takeoff' } }),
        button({ label: SAY.endSortie, icon: 'close', key: { key: bind('confirm').key }, attrs: { 'data-p': 'end' } }),
        button({ label: SAY.base, icon: 'base', key: bind('base'), tip: SAY.base, tipKey: bind('base'), attrs: { 'data-p': 'gr-base' } }),
      ].join(''),
    }));
    // The rearm button carries its own progress.
    this.el.rearm.insertAdjacentHTML('beforeend', bar({ value: 0, label: SAY.rearming, kind: 'progress', size: 'mini', className: 'rearm-bar', attrs: { 'data-p': 'rearm-bar' } }));
    this.el['rearm-bar'] = this.el.rearm.querySelector<HTMLElement>('.rearm-bar')!;
    this.el.weapons = add(zones.br, card({
      className: 'weapons', label: SAY.weapons,
      bodyHtml: /* html */ `
        <div class="weapon" data-p="gun" ${tip(ICON_NAMES.ink)}><span class="weapon-icon">${icon('ink')}<b class="num" data-p="ammo"></b></span><span class="weapon-name">${esc(STYLE_TEXT.ink)}</span>${bar({ value: 1, label: ICON_NAMES.ink, size: 'thin', kind: 'progress', attrs: { 'data-p': 'ammo-bar' } })}${glyph(bind('firePrimary'), { className: 'weapon-key' })}</div>
        <div class="weapon" data-p="bombs" ${tip(ICON_NAMES.bombload)}><span class="weapon-icon">${icon('bombload')}</span><span class="weapon-name">${esc(STYLE_TEXT.bombs)}</span><span class="bomb-pips" data-p="bomb-pips"></span>${glyph(bind('fireSecondary'), { className: 'weapon-key' })}</div>`,
    }));
    // Fold / Launch: the primary button at the end of the desk's top bar (the style guide's DeskHud), top right.
    this.el.desk = add(zones.tr ?? zones.br, /* html */ `<div class="desk-action">
      <span class="desk-tag ui-chip" data-p="desk-tag"></span>
      ${button({ label: SAY.build, variant: 'primary', size: 'big', key: bind('fold', 'confirm'), attrs: { 'data-p': 'build' } })}
      ${card({ className: 'building', label: SAY.build, fold: false, bodyHtml: `${icon('plane')}${bar({ value: 0, label: SAY.build, kind: 'progress', attrs: { 'data-p': 'building-bar' } })}`, attrs: { 'data-p': 'building' } })}
      ${button({ label: SAY.launch, variant: 'primary', size: 'big', key: bind('launch', 'confirm'), attrs: { 'data-p': 'launch' } })}
    </div>`);
    if (zones.tr) zones.tr.prepend(this.el.desk);
    this.el.build.querySelector('.ui-glyph')!.insertAdjacentHTML('beforebegin', `<b class="cost num" data-p="build-cost"></b>`);
    this.el['build-cost'] = this.el.build.querySelector<HTMLElement>('.cost')!;
    this.el.boundary = add(zones.centre, /* html */ `<div class="boundary" role="alert" data-critical>${icon('warn')}<b data-p="bw-title"></b><span class="bw-count num" data-p="bw-count"></span></div>`);

    bindButton(this.el.build, actions.build);
    bindButton(this.el.launch, actions.launch);
    bindButton(this.el.rearm, actions.rearm);
    bindButton(this.el.takeoff, actions.takeOff);
    bindButton(this.el.rearmgo, () => actions.rearmAndGo?.());
    bindButton(this.el.end, actions.endSortie);
    bindButton(this.el['gr-base'], actions.base);
  }

  render(v: HudView): void {
    const flying = v.phase === 'flying' && !v.paused;
    const a = v.aircraft;
    const showPlane = a !== null && !v.paused && !v.baseMode;
    toggle(this.el.condition, showPlane);
    toggle(this.el.weapons, showPlane && a!.airborne);
    if (a && showPlane) {
      const swatch = this.el.swatch;
      if (swatch.dataset.c !== a.accent) {
        swatch.dataset.c = a.accent;
        swatch.style.background = a.accent;
      }
      text(this.el.name, a.name);
      attr(this.el.name, 'data-tip', a.roleLabel);
      text(this.el.role, a.roleLabel);
      const hp = a.maxHealth > 0 ? a.health / a.maxHealth : 0;
      const hpLevel = level(hp);
      setBar(this.el.health, hp, hpLevel);
      text(this.el['health-n'], pct(hp));
      const range = a.range > 0 ? a.rangeLeft / a.range : 0;
      const rLevel = rangeLevel(range);
      setBar(this.el.range, range, rLevel);
      text(this.el['range-n'], range > 0 ? metres(a.rangeLeft) : SAY.gliding);
      // Low health or no range: the condition card is a critical warning and never steps back.
      const critical = a.airborne && (hpLevel === 'critical' || rLevel === 'critical');
      if (this.el.condition.hasAttribute('data-critical') !== critical) this.el.condition.toggleAttribute('data-critical', critical);
      attr(this.el.condition, 'data-state', critical ? 'critical' : hpLevel === 'worn' || rLevel === 'worn' ? 'warning' : 'default');
      text(this.el.ammo, a.gun.ammo > 0 ? fmt(a.gun.ammo) : SAY.empty);
      setBar(this.el['ammo-bar'], a.gun.capacity > 0 ? a.gun.ammo / a.gun.capacity : 0, 'ok');
      attr(this.el.gun, 'data-state', a.gun.ammo === 0 ? 'empty' : a.gun.ammo / a.gun.capacity < 0.2 ? 'low' : 'ok');
      const b = a.bombs;
      const pipsEl = this.el['bomb-pips'];
      const key = `${b.capacity}:${b.loaded}`;
      if (pipsEl.dataset.key !== key) {
        pipsEl.dataset.key = key;
        pipsEl.innerHTML = b.capacity === 0
          ? `<span class="none" role="img" aria-label="${esc(T.common.labelSpaceValue(ICON_NAMES.bombload, count(0)))}">–</span>`
          : pips({ filled: b.loaded, total: b.capacity, label: T.plane.bombs(ICON_NAMES.bombload, b.loaded, b.capacity) });
      }
      const state = b.capacity === 0 ? 'none' : b.ready ? 'ready' : b.loaded > 0 ? 'reloading' : b.falling > 0 ? 'falling' : 'empty';
      attr(this.el.bombs, 'data-state', state);
    }

    const f = v.flight;
    toggle(this.el.instruments, flying && f !== null);
    if (f && flying) {
      text(this.el.speed, count(f.speed));
      width(this.el['speed-bar'].firstElementChild as HTMLElement, f.speedFrac);
      const left = `${Math.round(f.throttleFrac * 100)}%`;
      if (this.el.throttle.style.left !== left) this.el.throttle.style.left = left;
      text(this.el.alt, count(f.altitude));
      attr(this.el.boost, 'data-state', f.boost.state);
      width(this.el['boost-bar'].firstElementChild as HTMLElement, f.boost.level);
    }

    const l = v.landing;
    toggle(this.el.landing, l !== null && !v.paused);
    if (l) {
      check(this.el['lg-speed'], l.check.speedOk, `${count(l.speed)}/${num(LANDING.maxSpeed)}`);
      check(this.el['lg-sink'], l.check.sinkOk, `${fixed(Math.max(0, l.sink), 1)}/${num(LANDING.maxSink, 1)}`);
      check(this.el['lg-level'], l.check.levelOk, `${count(Math.abs(l.rollDeg))}°`);
      this.el.landing.classList.toggle('ok', l.check.ok);
    }

    const g = v.ground;
    toggle(this.el.ground, !!g?.stopped && !v.paused && !v.baseMode);
    if (g) {
      const status = this.el['gr-status'];
      const sKey = `${g.status}:${g.reward}:${g.timeLeft !== null ? Math.ceil(g.timeLeft) : ''}`;
      if (status.dataset.key !== sKey) {
        status.dataset.key = sKey;
        status.innerHTML =
          g.status === 'succeeded' ? `${icon('ok')}<b class="num">+${fmt(g.reward)}</b>`
          : g.status === 'failed' ? `${icon('wrecked')}`
          : g.status === 'active' ? `${icon('clock')}<b class="num">${g.timeLeft !== null ? clock(g.timeLeft) : '…'}</b>`
          : '';
        attr(status, 'data-tone', g.status === 'succeeded' ? 'good' : g.status === 'failed' ? 'bad' : 'info');
        attr(status, 'data-tip', g.status === 'succeeded' ? T.plane.missionComplete : g.status === 'failed' ? T.plane.missionFailed : T.plane.missionOn);
      }
      (this.el.rearm as HTMLButtonElement).disabled = !g.canRearm;
      toggle(this.el.rearmgo, g.canRearm && g.rearming === null);
      (this.el.takeoff as HTMLButtonElement).disabled = g.rearming !== null;
      text(this.el.rearm.querySelector<HTMLElement>('.ui-label')!, g.rearming !== null ? SAY.rearming : g.canRearm ? SAY.rearm : SAY.armed);
      toggle(this.el['rearm-bar'], g.rearming !== null);
      width(this.el['rearm-bar'].firstElementChild as HTMLElement, g.rearming ?? 0);
    }

    // At the desk: fold (or refit, roll out), then launch.
    const atDesk = (v.phase === 'desk' || v.phase === 'building' || v.phase === 'ready') && !v.paused && !v.baseMode;
    toggle(this.el.desk, atDesk);
    if (atDesk) {
      const d = v.desk;
      toggle(this.el.build, v.phase === 'desk');
      toggle(this.el.building, v.phase === 'building');
      toggle(this.el.launch, v.phase === 'ready');
      text(this.el.build.querySelector<HTMLElement>('.ui-label')!, d.emergency ? T.plane.emergency(AIRCRAFT[STARTER_AIRCRAFT].name) : T.plane.build(VERB[d.kind], d.name));
      const costEl = this.el['build-cost'];
      const cKey = `${d.emergency}:${d.cost}`;
      if (costEl.dataset.key !== cKey) {
        costEl.dataset.key = cKey;
        costEl.innerHTML = d.emergency || d.cost === 0 ? esc(SAY.free) : `${icon('paper')}${paper(d.cost)}`;
      }
      (this.el.build as HTMLButtonElement).disabled = !d.canBuild;
      attr(this.el.build, 'data-tip', d.note ?? '');
      width(this.el['building-bar'].firstElementChild as HTMLElement, d.progress);
      attr(this.el.building, 'data-tip', T.plane.build(VERB[d.kind], d.name));
      text(this.el.launch.querySelector<HTMLElement>('.ui-label')!, T.plane.launch(SAY.launch, d.name));
      const tag = this.el['desk-tag'];
      toggle(tag, d.tag !== null);
      text(tag, d.tag ?? '');
      attr(tag, 'data-tip', d.note ?? '');
      attr(tag, 'data-tone', d.noteTone === 'bad' ? 'hostile' : 'friend');
    }

    const b = v.boundary;
    const out = v.phase === 'flying' && b.state !== 'inside' && !v.paused;
    toggle(this.el.boundary, out);
    if (out) {
      attr(this.el.boundary, 'data-state', b.state);
      text(this.el['bw-title'], b.state === 'warning' ? T.plane.turnBack : T.plane.autopilot);
      text(this.el['bw-count'], b.state === 'warning' ? count(Math.ceil(b.countdown)) : '');
    }
  }
}

/** A Bar component's fill and level (its markup stays; only these change). */
function setBar(el: HTMLElement, fraction: number, lvl: string): void {
  width(el.firstElementChild as HTMLElement, fraction);
  attr(el, 'data-level', lvl);
  attr(el, 'aria-valuenow', String(Math.round(Math.max(0, Math.min(1, fraction)) * 100)));
}

function check(el: HTMLElement, ok: boolean, value: string): void {
  text(el.querySelector('b') as HTMLElement, value);
  el.classList.toggle('ok', ok);
}

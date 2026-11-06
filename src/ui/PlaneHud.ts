import { AIRCRAFT, LANDING, STARTER_AIRCRAFT } from '../config';
import { attrs, bar, button, card, glyph, pips, tooltipAttrs } from './components';
import { attr, bindButton, text, toggle, width } from './dom';
import { clock, fmt, level, metres, pct } from './format';
import { icon, ICON_NAMES } from './icons';
import { SAY } from './strings';
import type { HudView } from './views';

const VERB = { fold: 'Fold', refit: 'Refit', rollout: 'Roll out' } as const;

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
    zones: { bl: HTMLElement; bc: HTMLElement; br: HTMLElement; centre: HTMLElement },
    actions: { build: () => void; launch: () => void; rearm: () => void; takeOff: () => void; endSortie: () => void; base: () => void; rearmAndGo?: () => void },
  ) {
    const add = (host: HTMLElement, html: string): HTMLElement => {
      host.insertAdjacentHTML('beforeend', html);
      const node = host.lastElementChild as HTMLElement;
      for (const n of node.querySelectorAll<HTMLElement>('[data-p]')) this.el[n.dataset.p!] = n;
      return node;
    };
    const meter = (p: string, iconName: 'health' | 'range'): string =>
      `<div class="meter" ${tip(ICON_NAMES[iconName])}>${icon(iconName)}${bar({ value: 1, label: ICON_NAMES[iconName], attrs: { 'data-p': p } })}<b class="num" data-p="${p}-n"></b></div>`;

    this.el.condition = add(zones.bl, card({
      className: 'condition', label: SAY.condition,
      bodyHtml: `<div class="cond-head"><span class="swatch" data-p="swatch"></span><b data-p="name"></b></div>${meter('health', 'health')}${meter('range', 'range')}`,
    }));
    this.el.landing = add(zones.bc, card({
      className: 'landing', label: ICON_NAMES.land, fold: false,
      bodyHtml: /* html */ `
        <span class="check" data-p="lg-speed" ${tip(`Speed (under ${LANDING.maxSpeed})`)}>${icon('speed')}<b class="num"></b></span>
        <span class="check" data-p="lg-sink" ${tip(`Descent (under ${LANDING.maxSink} m/s)`)}>${icon('land')}<b class="num"></b></span>
        <span class="check" data-p="lg-level" ${tip('Bank')}>${icon('heading')}<b class="num"></b></span>`,
    }));
    this.el.instruments = add(zones.bc, card({
      className: 'instruments', label: SAY.instruments, fold: false,
      bodyHtml: /* html */ `
        <div class="gauge" ${tip(ICON_NAMES.speed)}>${icon('speed')}<b class="num" data-p="speed"></b><span class="speed-track">${bar({ value: 0, label: ICON_NAMES.speed, kind: 'progress', attrs: { 'data-p': 'speed-bar' } })}<em class="throttle-mark" data-p="throttle"></em></span><span class="hint-keys">${glyph({ key: 'W' })}${glyph({ key: 'S' })}</span></div>
        <div class="gauge" ${tip(ICON_NAMES.altitude)}>${icon('altitude')}<b class="num" data-p="alt"></b></div>
        <div class="gauge boost" data-p="boost" ${tip(ICON_NAMES.boost)}>${icon('boost')}${bar({ value: 1, label: ICON_NAMES.boost, kind: 'boost', attrs: { 'data-p': 'boost-bar' } })}${glyph({ key: 'Shift' }, { className: 'hint-key' })}</div>
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
        `<span class="ground-where" ${tip('Landed at T1')}>${icon('home')}<b>T1</b></span>`,
        `<span class="ground-status" data-p="gr-status"></span>`,
        button({ label: SAY.rearm, icon: 'rearm', key: { key: 'R' }, tip: 'Rearm ink and range (free)', attrs: { 'data-p': 'rearm' } }),
        button({ label: 'Rearm & go', icon: 'rearm', tip: 'Rearm, then take off as soon as the ground crew is done', attrs: { 'data-p': 'rearmgo' } }),
        button({ label: SAY.takeOff, icon: 'plane', variant: 'primary', key: { key: 'Space' }, attrs: { 'data-p': 'takeoff' } }),
        button({ label: SAY.endSortie, icon: 'close', key: { key: 'Enter' }, attrs: { 'data-p': 'end' } }),
        button({ label: SAY.base, icon: 'base', key: { key: 'B' }, tip: 'Base (B)', attrs: { 'data-p': 'gr-base' } }),
      ].join(''),
    }));
    // The rearm button carries its own progress.
    this.el.rearm.insertAdjacentHTML('beforeend', bar({ value: 0, label: SAY.rearming, kind: 'progress', size: 'mini', className: 'rearm-bar', attrs: { 'data-p': 'rearm-bar' } }));
    this.el['rearm-bar'] = this.el.rearm.querySelector<HTMLElement>('.rearm-bar')!;
    this.el.weapons = add(zones.br, card({
      className: 'weapons', label: SAY.weapons,
      bodyHtml: /* html */ `
        <div class="weapon" data-p="gun" ${tip(ICON_NAMES.ink)}>${icon('ink')}<b class="num" data-p="ammo"></b>${bar({ value: 1, label: ICON_NAMES.ink, size: 'thin', kind: 'progress', attrs: { 'data-p': 'ammo-bar' } })}${glyph({ key: 'LMB' }, { className: 'hint-key' })}</div>
        <div class="weapon" data-p="bombs" ${tip(ICON_NAMES.bombload)}>${icon('bombload')}<span class="bomb-pips" data-p="bomb-pips"></span>${glyph({ key: 'RMB' }, { className: 'hint-key' })}</div>`,
    }));
    this.el.desk = add(zones.br, /* html */ `<div class="desk-action">
      <span class="desk-tag ui-chip" data-p="desk-tag"></span>
      ${button({ label: SAY.build, variant: 'primary', size: 'big', key: { key: 'F' }, attrs: { 'data-p': 'build' } })}
      ${card({ className: 'building', label: SAY.build, fold: false, bodyHtml: `${icon('plane')}${bar({ value: 0, label: SAY.build, kind: 'progress', attrs: { 'data-p': 'building-bar' } })}`, attrs: { 'data-p': 'building' } })}
      ${button({ label: SAY.launch, variant: 'primary', size: 'big', key: { key: 'Space' }, attrs: { 'data-p': 'launch' } })}
    </div>`);
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
          ? `<span class="none" role="img" aria-label="${ICON_NAMES.bombload} 0">–</span>`
          : pips({ filled: b.loaded, total: b.capacity, label: `${ICON_NAMES.bombload} ${b.loaded}/${b.capacity}` });
      }
      const state = b.capacity === 0 ? 'none' : b.ready ? 'ready' : b.loaded > 0 ? 'reloading' : b.falling > 0 ? 'falling' : 'empty';
      attr(this.el.bombs, 'data-state', state);
    }

    const f = v.flight;
    toggle(this.el.instruments, flying && f !== null);
    if (f && flying) {
      text(this.el.speed, String(Math.round(f.speed)));
      width(this.el['speed-bar'].firstElementChild as HTMLElement, f.speedFrac);
      const left = `${Math.round(f.throttleFrac * 100)}%`;
      if (this.el.throttle.style.left !== left) this.el.throttle.style.left = left;
      text(this.el.alt, String(Math.round(f.altitude)));
      attr(this.el.boost, 'data-state', f.boost.state);
      width(this.el['boost-bar'].firstElementChild as HTMLElement, f.boost.level);
    }

    const l = v.landing;
    toggle(this.el.landing, l !== null && !v.paused);
    if (l) {
      check(this.el['lg-speed'], l.check.speedOk, `${Math.round(l.speed)}/${LANDING.maxSpeed}`);
      check(this.el['lg-sink'], l.check.sinkOk, `${Math.max(0, l.sink).toFixed(1)}/${LANDING.maxSink}`);
      check(this.el['lg-level'], l.check.levelOk, `${Math.round(Math.abs(l.rollDeg))}°`);
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
        attr(status, 'data-tip', g.status === 'succeeded' ? 'Mission complete' : g.status === 'failed' ? 'Mission failed' : 'Mission still on: ending the sortie abandons it');
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
      text(this.el.build.querySelector<HTMLElement>('.ui-label')!, d.emergency ? `Emergency ${AIRCRAFT[STARTER_AIRCRAFT].name}` : `${VERB[d.kind]} ${d.name}`);
      const costEl = this.el['build-cost'];
      const cKey = `${d.emergency}:${d.cost}`;
      if (costEl.dataset.key !== cKey) {
        costEl.dataset.key = cKey;
        costEl.innerHTML = d.emergency || d.cost === 0 ? SAY.free : `${icon('paper')}${d.cost}`;
      }
      (this.el.build as HTMLButtonElement).disabled = !d.canBuild;
      attr(this.el.build, 'data-tip', d.note ?? '');
      width(this.el['building-bar'].firstElementChild as HTMLElement, d.progress);
      attr(this.el.building, 'data-tip', `${VERB[d.kind]} ${d.name}`);
      text(this.el.launch.querySelector<HTMLElement>('.ui-label')!, `${SAY.launch} ${d.name}`);
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
      text(this.el['bw-title'], b.state === 'warning' ? 'Turn back' : 'Autopilot');
      text(this.el['bw-count'], b.state === 'warning' ? String(Math.ceil(b.countdown)) : '');
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

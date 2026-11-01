import { AIRCRAFT, LANDING, STARTER_AIRCRAFT } from '../config';
import { attr, bindButton, text, toggle, width } from './dom';
import { clock, fmt, level, metres, pct } from './format';
import { icon } from './icons';
import { SAY } from './strings';
import type { HudView } from './views';

const VERB = { fold: 'Fold', refit: 'Refit', rollout: 'Roll out' } as const;

/**
 * The plane, as icons and numbers: condition bottom left (health, range), instruments bottom
 * centre (speed, altitude, boost), weapons bottom right (ink, bombs) with the one action that
 * matters now. On the ground: the landing checks, then the ground crew's buttons. At the desk:
 * fold / refit / roll out, then launch.
 */
export class PlaneHud {
  private readonly el: Record<string, HTMLElement> = {};

  constructor(
    zones: { bl: HTMLElement; bc: HTMLElement; br: HTMLElement; centre: HTMLElement },
    actions: { build: () => void; launch: () => void; rearm: () => void; takeOff: () => void; endSortie: () => void; base: () => void },
  ) {
    const add = (host: HTMLElement, className: string, html: string) => {
      const node = document.createElement('div');
      node.className = className;
      node.innerHTML = html;
      host.appendChild(node);
      for (const n of node.querySelectorAll<HTMLElement>('[data-p]')) this.el[n.dataset.p!] = n;
      return node;
    };
    this.el.condition = add(zones.bl, 'condition card', /* html */ `
      <div class="cond-head"><span class="swatch" data-p="swatch"></span><b data-p="name"></b></div>
      <div class="meter" title="Health">${icon('health')}<span class="bar"><i data-p="health"></i></span><b data-p="health-n"></b></div>
      <div class="meter" title="Range">${icon('range')}<span class="bar"><i data-p="range"></i></span><b data-p="range-n"></b></div>`);
    this.el.landing = add(zones.bc, 'landing card', /* html */ `
      <span class="check" data-p="lg-speed" title="Speed (under ${LANDING.maxSpeed})">${icon('speed')}<b></b></span>
      <span class="check" data-p="lg-sink" title="Descent (under ${LANDING.maxSink} m/s)">${icon('land')}<b></b></span>
      <span class="check" data-p="lg-level" title="Bank">${icon('heading')}<b></b></span>`);
    this.el.instruments = add(zones.bc, 'instruments card', /* html */ `
      <div class="gauge" title="Speed">${icon('speed')}<b data-p="speed"></b><span class="bar speed"><i data-p="speed-bar"></i><em class="throttle-mark" data-p="throttle"></em></span><span class="hint-keys"><kbd>W</kbd><kbd>S</kbd></span></div>
      <div class="gauge" title="Altitude">${icon('altitude')}<b data-p="alt"></b></div>
      <div class="gauge boost" data-p="boost" title="Boost">${icon('boost')}<span class="bar"><i data-p="boost-bar"></i></span><kbd class="hint-key">Shift</kbd></div>`);
    this.el.ground = add(zones.bc, 'ground card', /* html */ `
      <span class="ground-where" title="Landed at T1">${icon('home')}<b>T1</b></span>
      <span class="ground-status" data-p="gr-status"></span>
      <button class="btn" data-p="rearm" title="Rearm ink and range (free)">${icon('rearm')}<span data-p="rearm-label">${SAY.rearm}</span><span class="bar mini"><i data-p="rearm-bar"></i></span><kbd>R</kbd></button>
      <button class="btn primary" data-p="takeoff">${icon('plane')}<span>${SAY.takeOff}</span><kbd>Space</kbd></button>
      <button class="btn ghost" data-p="end">${icon('close')}<span>${SAY.endSortie}</span><kbd>Enter</kbd></button>
      <button class="btn ghost" data-p="gr-base" title="Base (B)">${icon('base')}<kbd>B</kbd></button>`);
    this.el.weapons = add(zones.br, 'weapons card', /* html */ `
      <div class="weapon" data-p="gun" title="Ink">${icon('ink')}<b data-p="ammo"></b><span class="bar thin"><i data-p="ammo-bar"></i></span><kbd class="hint-key">LMB</kbd></div>
      <div class="weapon" data-p="bombs" title="Bombs">${icon('bombload')}<span class="bomb-pips" data-p="bomb-pips"></span><kbd class="hint-key">RMB</kbd></div>`);
    this.el.desk = add(zones.br, 'desk-action', /* html */ `
      <span class="desk-tag" data-p="desk-tag"></span>
      <button class="btn primary big" data-p="build"><kbd>F</kbd><span data-p="build-label"></span><b class="cost" data-p="build-cost"></b></button>
      <div class="building card" data-p="building">${icon('plane')}<span class="bar"><i data-p="building-bar"></i></span></div>
      <button class="btn primary big" data-p="launch"><kbd>Space</kbd><span data-p="launch-label">${SAY.launch}</span></button>`);
    this.el.boundary = add(zones.centre, 'boundary', /* html */ `${icon('warn')}<b data-p="bw-title"></b><span class="bw-count" data-p="bw-count"></span>`);

    bindButton(this.el.build, actions.build);
    bindButton(this.el.launch, actions.launch);
    bindButton(this.el.rearm, actions.rearm);
    bindButton(this.el.takeoff, actions.takeOff);
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
      this.el.swatch.style.background = a.accent;
      text(this.el.name, a.name);
      this.el.name.title = a.roleLabel;
      const hp = a.health / a.maxHealth;
      width(this.el.health, hp);
      attr(this.el.health, 'data-level', level(hp));
      text(this.el['health-n'], pct(hp));
      const range = a.range > 0 ? a.rangeLeft / a.range : 0;
      width(this.el.range, range);
      attr(this.el.range, 'data-level', range > 0.25 ? 'ok' : range > 0 ? 'worn' : 'critical');
      text(this.el['range-n'], range > 0 ? metres(a.rangeLeft) : SAY.gliding);
      text(this.el.ammo, a.gun.ammo > 0 ? fmt(a.gun.ammo) : SAY.empty);
      width(this.el['ammo-bar'], a.gun.capacity > 0 ? a.gun.ammo / a.gun.capacity : 0);
      attr(this.el.gun, 'data-state', a.gun.ammo === 0 ? 'empty' : a.gun.ammo / a.gun.capacity < 0.2 ? 'low' : 'ok');
      const b = a.bombs;
      const pips = this.el['bomb-pips'];
      const key = `${b.capacity}:${b.loaded}`;
      if (pips.dataset.key !== key) {
        pips.dataset.key = key;
        pips.innerHTML = b.capacity === 0 ? '<i class="none">–</i>' : Array.from({ length: b.capacity }, (_, i) => `<i class="${i < b.loaded ? 'full' : ''}"></i>`).join('');
      }
      const state = b.capacity === 0 ? 'none' : b.ready ? 'ready' : b.loaded > 0 ? 'reloading' : b.falling > 0 ? 'falling' : 'empty';
      attr(this.el.bombs, 'data-state', state);
    }

    const f = v.flight;
    toggle(this.el.instruments, flying && f !== null);
    if (f) {
      text(this.el.speed, String(Math.round(f.speed)));
      width(this.el['speed-bar'], f.speedFrac);
      this.el.throttle.style.left = `${Math.round(f.throttleFrac * 100)}%`;
      text(this.el.alt, String(Math.round(f.altitude)));
      attr(this.el.boost, 'data-state', f.boost.state);
      width(this.el['boost-bar'], f.boost.level);
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
          g.status === 'succeeded' ? `${icon('ok')}<b>+${fmt(g.reward)}</b>`
          : g.status === 'failed' ? `${icon('wrecked')}`
          : g.status === 'active' ? `${icon('clock')}<b>${g.timeLeft !== null ? clock(g.timeLeft) : '…'}</b>`
          : '';
        attr(status, 'data-tone', g.status === 'succeeded' ? 'good' : g.status === 'failed' ? 'bad' : 'info');
        status.title = g.status === 'succeeded' ? 'Mission complete' : g.status === 'failed' ? 'Mission failed' : 'Mission still on: ending the sortie abandons it';
      }
      (this.el.rearm as HTMLButtonElement).disabled = !g.canRearm;
      (this.el.takeoff as HTMLButtonElement).disabled = g.rearming !== null;
      text(this.el['rearm-label'], g.rearming !== null ? SAY.rearming : g.canRearm ? SAY.rearm : SAY.armed);
      toggle(this.el['rearm-bar'].parentElement!, g.rearming !== null);
      width(this.el['rearm-bar'], g.rearming ?? 0);
    }

    // At the desk: fold (or refit, roll out), then launch.
    const atDesk = (v.phase === 'desk' || v.phase === 'building' || v.phase === 'ready') && !v.paused && !v.baseMode;
    toggle(this.el.desk, atDesk);
    if (atDesk) {
      const d = v.desk;
      toggle(this.el.build, v.phase === 'desk');
      toggle(this.el.building, v.phase === 'building');
      toggle(this.el.launch, v.phase === 'ready');
      text(this.el['build-label'], d.emergency ? `Emergency ${AIRCRAFT[STARTER_AIRCRAFT].name}` : `${VERB[d.kind]} ${d.name}`);
      const costEl = this.el['build-cost'];
      const cKey = `${d.emergency}:${d.cost}`;
      if (costEl.dataset.key !== cKey) {
        costEl.dataset.key = cKey;
        costEl.innerHTML = d.emergency || d.cost === 0 ? SAY.free : `${icon('paper')}${d.cost}`;
      }
      (this.el.build as HTMLButtonElement).disabled = !d.canBuild;
      this.el.build.title = d.note ?? '';
      width(this.el['building-bar'], d.progress);
      this.el.building.title = `${VERB[d.kind]} ${d.name}`;
      text(this.el['launch-label'], `${SAY.launch} ${d.name}`);
      const tag = this.el['desk-tag'];
      toggle(tag, d.tag !== null);
      text(tag, d.tag ?? '');
      tag.title = d.note ?? '';
      attr(tag, 'data-tone', d.noteTone);
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

function check(el: HTMLElement, ok: boolean, value: string): void {
  text(el.querySelector('b') as HTMLElement, value);
  el.classList.toggle('ok', ok);
}

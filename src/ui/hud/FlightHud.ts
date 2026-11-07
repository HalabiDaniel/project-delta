import { bind } from '../../input/bindings';
import { glyph } from '../components';
import { LANDING, MANEUVERS } from '../../config';
import { esc, toggle } from '../dom';
import { clock, count, fixed, fmt, num, pct, level as levelOf } from '../format';
import { icon } from '../icons';
import { dock, kbadge, kbutton, kchip, kiconButton, kmeter, setMeter, statusBar } from '../kit';
import { MISSION_ICONS, STYLE_TEXT, T } from '../strings';
import type { HudActions, HudView, TrackerView } from '../views';

const FL = (): typeof T.flight => T.flight;

/**
 * The flight HUD (v0.0.16, the design canvas's HUD · In flight). Every edge element sits on the
 * shared safe margin; nothing enters the centre 40% of the screen.
 *   top left      the paper pill and the mission card (330px): title, the objectives as an icon
 *                 checklist (done in good green), the reward
 *   top centre    the alert slot (raids, the boundary): one at a time (BaseHud's RaidHud, MpHud)
 *   top right     a 300px column: the status bar (players, the clock, Pause), then the kill feed
 *   bottom left   the plane card (360px): name and role, Hull and Boost meters, speed and altitude
 *                 as big numbers with the throttle as a thin bar under the speed
 *   bottom centre four 104px action tiles: Ink (LMB), Bomb (RMB), Boost (Shift), Home (R)
 *   bottom right  the mini-map
 * Landed: the ground crew's row (Rearm, Rearm & go, Take off, End sortie) in the dock's place.
 */
export class FlightHud {
  private readonly el: Record<string, HTMLElement> = {};
  private trackerKey = '';
  private groundKey = '';
  private lastStatus: string | null = null;

  constructor(
    zones: { tl: HTMLElement; tc: HTMLElement; tr: HTMLElement; bl: HTMLElement; bc: HTMLElement },
    private readonly actions: HudActions,
    private readonly onToast: (iconName: Parameters<typeof icon>[0], text: string, tone: 'good' | 'hostile' | 'warn' | 'plain') => void,
  ) {
    const f = FL();
    const add = (host: HTMLElement, cls: string, html: string, prepend = false): HTMLElement => {
      const node = document.createElement('div');
      node.className = cls;
      node.innerHTML = html;
      if (prepend) host.prepend(node);
      else host.appendChild(node);
      for (const n of node.querySelectorAll<HTMLElement>('[data-f]')) this.el[n.dataset.f!] = n;
      return node;
    };
    this.el.paper = add(zones.tl, 'flight-paper', `<span class="paper-pill small" role="status"><span class="paper-pill-icon">${icon('paper', 'icon pw-icon')}</span><b class="num" data-f="paper-n"></b><span class="delta num" data-f="delta"></span></span>`);
    this.el.mission = add(zones.tl, 'mission-card pw-panel', '');
    this.el.status = add(zones.tr, 'flight-status', statusBar({
      label: f.status,
      cellsHtml: [
        `<span data-f="players-cell">${icon('users', 'icon pw-icon')}<b class="num" data-f="players"></b></span>`,
        `<span data-f="clock-cell">${icon('clock', 'icon pw-icon')}<b class="num" data-f="clock"></b></span>`,
        kiconButton({ icon: 'pause', name: T.say.menu, tipKey: bind('back', 'pause'), className: 'pad-skip', attrs: { 'data-act': 'pause' } }),
      ],
    }), true);
    this.el.plane = add(zones.bl, 'plane-card pw-panel', `
      <div class="pc-head"><b class="pc-name" data-f="name"></b><span data-f="role"></span></div>
      ${kmeter({ label: f.hull, value: 1, valueText: '', segments: 10, tone: 'good', attrs: { 'data-f': 'hull' } })}
      ${kmeter({ label: f.boost, value: 1, valueText: '', segments: 10, tone: 'progress', attrs: { 'data-f': 'boost' } })}
      <div class="pc-numbers">
        <div class="pc-num"><span class="pc-big"><b class="num" data-f="speed"></b><small>${esc(f.speedUnit)}</small></span><span class="pc-throttle" role="img" aria-label="${esc(f.throttle)}"><i data-f="throttle"></i></span></div>
        <div class="pc-num"><span class="pc-big"><b class="num" data-f="alt"></b><small>${esc(f.altUnit)}</small></span><span class="pc-label">${esc(f.altitude)}</span></div>
      </div>`);
    const tile = (id: string, i: Parameters<typeof icon>[0], label: string, key: ReturnType<typeof bind>, pip: boolean) =>
      `<div class="action-tile" data-f="t-${id}" role="group" aria-label="${esc(label)}">${pip ? `<span class="pw-pip num" data-f="${id}-n"></span>` : ''}${icon(i, 'icon pw-icon')}<span class="action-label">${esc(label)}</span>${glyph(key, { className: 'pw-key' })}</div>`;
    this.el.actions = add(zones.bc, 'action-bar', [
      tile('ink', 'ink', f.ink, bind('firePrimary'), true),
      tile('bomb', 'bombload', f.bomb, bind('fireSecondary'), true),
      tile('boost', 'boost', f.boostTile, bind('boost'), false),
      tile('home', 'home', f.home, bind('service'), false),
      // v0.0.16: the maneuver in the slot, its readiness, and a note (why a press did nothing, the air brake, a loop).
      `<div class="action-tile maneuver-tile" data-f="t-maneuver" role="group" aria-label="${esc(T.maneuver.slot)}"><span class="mv-note" data-f="mv-note" hidden></span>${icon('maneuver', 'icon pw-icon')}<span class="action-label" data-f="mv-name"></span><span class="mv-ready"><i data-f="mv-ready"></i></span>${glyph(bind('maneuver'), { className: 'pw-key' })}</div>`,
    ].join(''));
    this.el.landing = add(zones.bc, 'landing-checks', `
      ${kchip({ icon: 'speed', value: '', attrs: { 'data-f': 'lg-speed', 'data-tip': T.plane.speedCheck(num(LANDING.maxSpeed)) } })}
      ${kchip({ icon: 'land', value: '', attrs: { 'data-f': 'lg-sink', 'data-tip': T.plane.sinkCheck(num(LANDING.maxSink, 1)) } })}
      ${kchip({ icon: 'heading', value: '', attrs: { 'data-f': 'lg-level', 'data-tip': T.plane.bankCheck } })}`);
    this.el.ground = add(zones.bc, 'ground-dock', '');
    this.el.boundary = add(zones.tc, 'boundary pw-panel', `${icon('warn', 'icon pw-icon')}<b data-f="bw-title"></b><span class="bw-count num" data-f="bw-count"></span>`);
    this.el.boundary.setAttribute('role', 'alert');
    this.el.boundary.toggleAttribute('data-critical', true);
    for (const host of [this.el.status, this.el.ground]) {
      host.addEventListener('mousedown', (e) => e.preventDefault());
      host.addEventListener('click', (e) => this.click(e));
    }
  }

  render(v: HudView, mp: { players: number; maxPlayers: number; sessionLeft: number | null } | null): void {
    const flying = v.phase === 'flying' && !v.paused;
    const air = (v.phase === 'flying' || v.phase === 'landed') && !v.paused && v.result === null && !v.baseMode;
    toggle(this.el.paper, air);
    if (air) this.renderPaper(v);
    this.renderMission(air ? v.tracker : null);
    this.watchStatus(v);

    // Status bar: players and the session clock in multiplayer; the mission clock solo; Pause.
    toggle(this.el.status, flying);
    if (flying) {
      toggle(this.el['players-cell'].parentElement!, mp !== null);
      if (mp) this.text('players', `${count(mp.players)}/${count(mp.maxPlayers)}`);
      const t = mp?.sessionLeft ?? v.tracker?.timeLeft ?? null;
      toggle(this.el['clock-cell'].parentElement!, t !== null);
      if (t !== null) this.text('clock', clock(Math.max(0, t)));
      this.el['clock-cell'].parentElement!.toggleAttribute('data-urgent', t !== null && t < (mp ? 60 : 10));
    }

    // Plane card.
    const a = v.aircraft;
    const showPlane = air && a !== null;
    toggle(this.el.plane, showPlane);
    if (a && showPlane) {
      this.text('name', a.name);
      const roleHtml = kbadge({ label: a.roleLabel });
      if (this.el.role.dataset.k !== a.roleLabel) {
        this.el.role.dataset.k = a.roleLabel;
        this.el.role.innerHTML = roleHtml;
      }
      const hp = a.maxHealth > 0 ? a.health / a.maxHealth : 0;
      const lvl = levelOf(hp);
      setMeter(this.el.hull, hp, pct(hp), lvl === 'ok' ? 'good' : lvl === 'worn' ? 'warn' : 'hostile');
      this.el.plane.toggleAttribute('data-critical', a.airborne && lvl === 'critical');
    }
    const f = v.flight;
    if (f && flying) {
      setMeter(this.el.boost, f.boost.level, pct(f.boost.level), f.boost.state === 'cooldown' ? 'warn' : 'progress');
      this.text('speed', count(f.speed));
      this.text('alt', count(f.altitude));
      const w = `${Math.round(Math.max(0, Math.min(1, f.throttleFrac)) * 100)}%`;
      if (this.el.throttle.style.width !== w) this.el.throttle.style.width = w;
    }

    // Action tiles.
    toggle(this.el.actions, flying && a !== null && v.landing === null);
    if (a && flying) {
      this.text('ink-n', a.gun.ammo > 0 ? fmt(a.gun.ammo) : '0');
      this.el['t-ink'].dataset.state = a.gun.ammo === 0 ? 'empty' : a.gun.ammo / Math.max(1, a.gun.capacity) < 0.2 ? 'low' : 'ok';
      this.text('bomb-n', count(a.bombs.loaded));
      this.el['t-bomb'].dataset.state = a.bombs.capacity === 0 || a.bombs.loaded === 0 ? 'empty' : a.bombs.ready ? 'ok' : 'low';
      this.el['t-boost'].dataset.state = f?.boost.state === 'active' ? 'on' : f?.boost.state === 'cooldown' ? 'low' : 'ok';
    }
    const mv = flying ? f?.maneuver : undefined;
    toggle(this.el['t-maneuver'], !!mv);
    if (mv) {
      const tile = this.el['t-maneuver'];
      tile.dataset.state = mv.state === 'none' ? 'empty' : mv.state === 'active' || mv.state === 'loop' ? 'on' : mv.state === 'cooldown' ? 'low' : 'ok';
      this.text('mv-name', mv.name);
      const tip = mv.id ? MANEUVERS[mv.id].summary : T.maneuver.noneTip;
      if (tile.dataset.tip !== tip) tile.dataset.tip = tip;
      const w = `${Math.round((mv.state === 'none' ? 0 : mv.readiness) * 100)}%`;
      if (this.el['mv-ready'].style.width !== w) this.el['mv-ready'].style.width = w;
      const note = mv.refusal ?? (mv.state === 'loop' ? T.maneuver.loop : mv.airbrake ? T.maneuver.airbrake : null);
      toggle(this.el['mv-note'], note !== null);
      this.text('mv-note', note ?? '');
      this.el['mv-note'].dataset.tone = mv.refusal ? 'hostile' : 'friend';
    }

    // Landing checks, then the ground crew.
    const l = v.landing;
    toggle(this.el.landing, l !== null && !v.paused);
    if (l) {
      this.check('lg-speed', l.check.speedOk, `${count(l.speed)}/${num(LANDING.maxSpeed)}`);
      this.check('lg-sink', l.check.sinkOk, `${fixed(Math.max(0, l.sink), 1)}/${num(LANDING.maxSink, 1)}`);
      this.check('lg-level', l.check.levelOk, `${count(Math.abs(l.rollDeg))}°`);
    }
    this.renderGround(v);

    const b = v.boundary;
    const out = v.phase === 'flying' && b.state !== 'inside' && !v.paused;
    toggle(this.el.boundary, out);
    if (out) {
      this.el.boundary.dataset.state = b.state;
      this.text('bw-title', b.state === 'warning' ? T.plane.turnBack : T.plane.autopilot);
      this.text('bw-count', b.state === 'warning' ? count(Math.ceil(b.countdown)) : '');
    }
  }

  private renderPaper(v: HudView): void {
    this.text('paper-n', fmt(v.economy.paper));
  }

  delta(delta: number): void {
    const el = this.el.delta;
    el.textContent = delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`;
    el.dataset.tone = delta > 0 ? 'good' : 'bad';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** A failed mission or a crash becomes a toast (it replaces the old full-width strip). */
  private watchStatus(v: HudView): void {
    const status = v.phase === 'crashed' ? 'crashed' : v.tracker?.status ?? null;
    if (status === this.lastStatus) return;
    const was = this.lastStatus;
    this.lastStatus = status;
    if (was === null) return;
    if (status === 'crashed') this.onToast('crumple', STYLE_TEXT.crumpled, 'hostile');
    else if (status === 'failed') this.onToast('wrecked', v.tracker?.failure ? T.mission.failed : T.mission.failed, 'hostile');
  }

  private renderMission(t: TrackerView | null): void {
    toggle(this.el.mission, t !== null);
    if (!t) return;
    const key = JSON.stringify([t.title, t.type, t.status, t.reward, t.objectives.map((o) => [o.label, o.icon, o.done, o.open])]);
    if (key === this.trackerKey) return;
    this.trackerKey = key;
    const current = t.objectives.find((o) => o.open) ?? t.objectives.find((o) => !o.done);
    this.el.mission.dataset.status = t.status;
    this.el.mission.setAttribute('role', 'group');
    this.el.mission.setAttribute('aria-label', t.title);
    this.el.mission.innerHTML = `<div class="mc-head">${icon(MISSION_ICONS[t.type], 'icon pw-icon')}<h2 class="mc-title">${esc(t.title)}</h2></div>
      <ol class="mc-steps">${t.objectives.map((o) => `<li${o.done ? ' data-done' : o === current ? ' data-now' : ''}>${icon(o.done ? 'ok' : o.icon, 'icon pw-icon')}<span>${esc(o.label)}</span></li>`).join('')}</ol>
      <p class="mc-reward">${icon('trophy', 'icon pw-icon')}<b class="num">+${esc(fmt(t.reward))}</b>${icon('paper', 'icon pw-icon')}</p>`;
    if (t.hint) this.el.mission.dataset.tip = t.hint;
  }

  private renderGround(v: HudView): void {
    const g = v.ground;
    const show = !!g?.stopped && !v.paused && !v.baseMode && v.result === null;
    toggle(this.el.ground, show);
    if (!g || !show) return;
    const pick = v.maneuverPicker ?? null;
    const key = JSON.stringify([g.canRearm, g.rearming !== null ? Math.round(g.rearming * 20) : null, g.status, pick?.current?.id ?? null, pick?.canChange]);
    if (key === this.groundKey) return;
    this.groundKey = key;
    const f = FL();
    const rearmLabel = g.rearming !== null ? T.say.rearming : g.canRearm ? T.say.rearm : T.say.armed;
    this.el.ground.innerHTML = dock({
      label: f.groundCrew,
      itemsHtml: [
        kbutton({ label: rearmLabel, icon: 'rearm', size: 'l', key: bind('service'), hintKey: true, disabled: !g.canRearm, tip: T.plane.rearmTip, afterHtml: g.rearming !== null ? `<span class="dock-progress" style="--p:${Math.round(g.rearming * 100)}%"></span>` : '', attrs: { 'data-act': 'rearm' } }),
        g.canRearm && g.rearming === null ? kbutton({ label: T.plane.rearmGo, icon: 'reset', size: 'l', tip: T.plane.rearmGoTip, attrs: { 'data-act': 'rearm-go' } }) : '',
        // v0.0.16: the maneuver for the next take-off can be changed here, after landing.
        pick?.current ? kbutton({ label: T.maneuver.button(pick.current.name), icon: 'maneuver', size: 'l', key: bind('maneuverNext'), hintKey: true, disabled: !pick.canChange, tip: T.maneuver.pickInfo(pick.current.summary, pick.current.inspiredBy), attrs: { 'data-act': 'maneuver-next' } }) : '',
        kbutton({ label: T.say.endSortie, icon: 'close', size: 'l', key: { key: bind('confirm').key }, hintKey: true, attrs: { 'data-act': 'end' } }),
        kbutton({ label: T.say.base, icon: 'build', size: 'l', key: bind('base'), hintKey: true, attrs: { 'data-act': 'base' } }),
      ].join(''),
      mainHtml: kbutton({ label: T.say.takeOff, icon: 'send', variant: 'primary', size: 'l', key: bind('launch', 'confirm'), hintKey: true, disabled: g.rearming !== null, attrs: { 'data-act': 'takeoff', 'data-nav-default': '' } }),
    });
  }

  private check(id: string, ok: boolean, value: string): void {
    const el = this.el[id];
    const b = el.querySelector('.pw-chip-value');
    if (b && b.textContent !== value) b.textContent = value;
    el.dataset.tone = ok ? 'good' : 'warn';
  }

  private text(id: string, value: string): void {
    const el = this.el[id];
    if (el && el.textContent !== value) el.textContent = value;
  }

  private click(e: Event): void {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    const a = this.actions;
    switch (b.dataset.act) {
      case 'pause':
        return a.openMenu();
      case 'rearm':
        return a.rearm();
      case 'rearm-go':
        return a.rearmAndGo();
      case 'end':
        return a.endSortie();
      case 'base':
        return a.toggleBase();
      case 'takeoff':
        return a.takeOff();
      case 'maneuver-next':
        return a.cycleManeuver?.(1);
    }
  }
}

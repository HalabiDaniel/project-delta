import { attr, bindButton, esc, text, toggle } from './dom';
import { fmt } from './format';
import { icon, type IconName } from './icons';
import { SAY } from './strings';
import type { GraphicsPreset, OutlineChoice } from '../render/GraphicsSettings';
import type { HintMode, HudActions, HudView, SessionView } from './views';
import { getPadSettings, setPadSettings, type PadLevel } from '../input/Controls';

/** The controller's mapping, shown in the menu while a controller is in use. */
const PAD_CONTROLS: Array<[string, IconName, string]> = [
  ['L stick', 'heading', 'Steer'],
  ['R stick', 'distance', 'Look'],
  ['RT', 'ink', 'Ink'],
  ['LT', 'bombload', 'Bomb'],
  ['RB', 'boost', 'Boost'],
  ['LB + L', 'speed', 'Throttle / bank'],
  ['A', 'ok', 'Confirm, launch'],
  ['B', 'close', 'Back'],
  ['X', 'rearm', 'Rearm, repair'],
  ['Y', 'base', 'Base · hold: hints'],
  ['LB / RB', 'plane', 'Aircraft (home)'],
  ['LT / RT', 'reach', 'Mission (home)'],
  ['D-pad', 'more', 'Menus · emotes'],
  ['View', 'book', 'Logbook · scores'],
  ['Menu', 'info', 'Pause'],
];

const CONTROLS: Array<[string, IconName, string]> = [
  ['Mouse', 'heading', 'Steer'],
  ['W / S', 'speed', 'Throttle'],
  ['A / D', 'plane', 'Bank'],
  ['Shift', 'boost', 'Boost'],
  ['LMB', 'ink', 'Ink'],
  ['RMB', 'bombload', 'Bomb'],
  ['1 – 4', 'reach', 'Mission'],
  ['Q / E', 'plane', 'Aircraft'],
  ['F', 'build', 'Fold'],
  ['Space', 'plane', 'Launch'],
  ['R', 'rearm', 'Rearm'],
  ['B', 'base', 'Base'],
  ['X', 'swap', 'Swap card'],
  ['L', 'book', 'Logbook'],
  ['H', 'info', 'Key hints'],
  ['M', 'sound', 'Sound'],
];

/** The multiplayer game (?mp) shares this menu: the mode link and the reset button change. */
const MULTIPLAYER = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mp');

/** "This session" / "Last time" as icon stats. */
export function sessionStats(s: SessionView): string {
  const stat = (iconName: IconName, value: string, label: string) => `<span class="stat" title="${esc(label)}">${icon(iconName)}<b>${value}</b></span>`;
  return `<div class="stats session">${[
    stat('ok', String(s.missionsCompleted), `Missions completed${s.missionsFailed ? ` (${s.missionsFailed} failed)` : ''}`),
    stat('paper', `+${fmt(s.paperEarned)}`, 'Paper earned'),
    stat('paper', `−${fmt(s.paperSpent)}`, 'Paper spent'),
    stat('crumple', String(s.aircraftLost), 'Aircraft lost'),
    stat('kills', String(s.enemiesDestroyed), 'Enemies destroyed'),
    stat('clock', `${s.minutes}m`, 'Time'),
  ].join('')}</div>${s.best !== '—' ? `<div class="session-best" title="Best performance">${icon('medal')}<span>${esc(s.best)}</span></div>` : ''}`;
}

/**
 * The pause menu (buttons, settings and a compact controls grid) and the welcome card on
 * arrival. No rules to read: those come as tips the first time they matter.
 */
export class Menus {
  private readonly overlay: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement, actions: HudActions) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = /* html */ `
      <div class="overlay-card card">
        <div class="menu-head"><b class="brand">paperwars<span>.io</span></b><small data-u="version"></small><h2 data-u="title"></h2></div>
        <div class="menu-actions">
          <button class="btn primary" data-u="resume">${icon('plane')}<span>${SAY.resume}</span><kbd>Esc</kbd></button>
          <button class="btn" data-u="logbook">${icon('book')}<span>${SAY.logbook}</span><kbd>L</kbd></button>
          <button class="btn" data-u="sound"></button>
          <a class="btn" data-u="mode" href="${MULTIPLAYER ? '?' : '?mp'}">${icon(MULTIPLAYER ? 'home' : 'fighter')}<span>${MULTIPLAYER ? 'Single-player' : 'Multiplayer'}</span></a>
        </div>
        <div class="settings">
          <div class="setting" title="Key hints on the HUD"><span>${icon('info')}Hints</span><span class="seg" data-u="hints">
            <button data-v="auto">Auto</button><button data-v="on">On</button><button data-v="off">Off</button></span></div>
          <div class="setting" title="HUD size"><span>${icon('distance')}Size</span><span class="seg" data-u="scale">
            <button data-v="0.9">S</button><button data-v="1">M</button><button data-v="1.15">L</button></span></div>
          <div class="setting" title="Graphics quality: shadows, decorations, outline detail and resolution"><span>${icon('graphics')}Graphics</span><span class="seg" data-u="gfx">
            <button data-v="low">Low</button><button data-v="medium">Med</button><button data-v="high">High</button></span></div>
          <div class="setting" title="Pencil outlines: off, or how detailed"><span>${icon('pencil')}Outlines</span><span class="seg" data-u="outlines">
            <button data-v="off">Off</button><button data-v="low">Low</button><button data-v="medium">Med</button><button data-v="high">High</button></span></div>
          <div class="setting" title="How strongly outlines are drawn"><span>${icon('pencil')}Lines</span><span class="seg" data-u="lines">
            <button data-v="0.6">Faint</button><button data-v="1">Normal</button><button data-v="1.4">Bold</button></span></div>
        </div>
        <div data-u="session"></div>
        <div class="settings pad-only">
          <div class="setting" title="Controller: pull back to climb"><span>${icon('heading')}Invert Y</span><span class="seg" data-u="pad-invert">
            <button data-v="off">Off</button><button data-v="on">On</button></span></div>
          <div class="setting" title="Controller steering sensitivity"><span>${icon('plane')}Stick</span><span class="seg" data-u="pad-stick">
            <button data-v="low">Low</button><button data-v="medium">Med</button><button data-v="high">High</button></span></div>
          <div class="setting" title="Controller camera sensitivity"><span>${icon('distance')}Camera</span><span class="seg" data-u="pad-camera">
            <button data-v="low">Low</button><button data-v="medium">Med</button><button data-v="high">High</button></span></div>
        </div>
        <div class="controls kbd-only">${CONTROLS.map(([key, i, label]) => `<div title="${esc(label)}"><kbd>${key}</kbd>${icon(i)}<span>${label}</span></div>`).join('')}</div>
        <div class="controls pad-only">${PAD_CONTROLS.map(([key, i, label]) => `<div title="${esc(label)}"><b class="pad-key">${key}</b>${icon(i)}<span>${label}</span></div>`).join('')}</div>
        <div class="menu-transfer" data-u="transfer" hidden></div>
        <div class="menu-foot"><span class="save-note" data-u="save"></span>${MULTIPLAYER ? `<button class="btn ghost small" data-u="move" title="Get a one-time code to play as yourself on another computer">${icon('swap')}<span>Another computer</span></button>` : ''}<button class="btn ghost danger small" data-u="reset"></button></div>
      </div>`;
    root.appendChild(this.overlay);
    this.welcome = document.createElement('div');
    this.welcome.className = 'welcome';
    this.welcome.innerHTML = /* html */ `
      <div class="welcome-card card">
        <b class="brand">paperwars<span>.io</span></b>
        <h2 data-u="wc-title"></h2>
        <div class="wc-paper" title="Paper">${icon('paper')}<b data-u="wc-paper"></b></div>
        <div data-u="wc-session"></div>
        <button class="btn primary" data-u="wc-go">${icon('home')}<span>${SAY.continue}</span><kbd>Enter</kbd></button>
      </div>`;
    root.appendChild(this.welcome);
    for (const r of [this.overlay, this.welcome]) for (const n of r.querySelectorAll<HTMLElement>('[data-u]')) this.el[n.dataset.u!] = n;
    bindButton(this.el.resume, actions.resume);
    bindButton(this.el.logbook, actions.openLogbook);
    bindButton(this.el.sound, actions.toggleSound);
    bindButton(this.el.reset, actions.resetProgress);
    if (this.el.move) bindButton(this.el.move, () => actions.moveDevice?.());
    bindButton(this.el['wc-go'], actions.dismissWelcome);
    this.welcome.addEventListener('click', () => actions.dismissWelcome());
    this.overlay.addEventListener('click', (e) => e.target === this.overlay && actions.resume());
    for (const b of this.el.hints.querySelectorAll<HTMLElement>('button')) bindButton(b, () => actions.setHints(b.dataset.v as HintMode));
    for (const b of this.el.scale.querySelectorAll<HTMLElement>('button')) bindButton(b, () => actions.setUiScale(Number(b.dataset.v)));
    for (const b of this.el.gfx.querySelectorAll<HTMLElement>('button')) bindButton(b, () => actions.setGraphicsPreset(b.dataset.v as GraphicsPreset));
    for (const b of this.el.outlines.querySelectorAll<HTMLElement>('button')) bindButton(b, () => actions.setOutlines(b.dataset.v as OutlineChoice));
    for (const b of this.el.lines.querySelectorAll<HTMLElement>('button')) bindButton(b, () => actions.setOutlineIntensity(Number(b.dataset.v)));
    for (const b of this.el['pad-invert'].querySelectorAll<HTMLElement>('button')) bindButton(b, () => setPadSettings({ ...getPadSettings(), invertY: b.dataset.v === 'on' }));
    for (const b of this.el['pad-stick'].querySelectorAll<HTMLElement>('button')) bindButton(b, () => setPadSettings({ ...getPadSettings(), stick: b.dataset.v as PadLevel }));
    for (const b of this.el['pad-camera'].querySelectorAll<HTMLElement>('button')) bindButton(b, () => setPadSettings({ ...getPadSettings(), camera: b.dataset.v as PadLevel }));
    text(this.el.version, `v${__APP_VERSION__}`);
  }

  render(v: HudView): void {
    toggle(this.overlay, v.paused);
    if (v.paused) {
      text(this.el.title, v.phase === 'flying' ? 'Paused' : SAY.menu);
      const html = sessionStats(v.menu.session);
      if (this.el.session.dataset.html !== html) {
        this.el.session.dataset.html = html;
        this.el.session.innerHTML = html;
      }
      toggle(this.el.logbook, v.phase !== 'flying');
      const sKey = String(v.menu.settings.muted);
      if (this.el.sound.dataset.key !== sKey) {
        this.el.sound.dataset.key = sKey;
        this.el.sound.innerHTML = `${icon(v.menu.settings.muted ? 'mute' : 'sound')}<span>${v.menu.settings.muted ? 'Off' : 'On'}</span><kbd>M</kbd>`;
      }
      for (const b of this.el.hints.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === v.menu.settings.hints);
      for (const b of this.el.scale.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', Number(b.dataset.v) === v.menu.settings.uiScale);
      const g = v.menu.settings.graphics;
      for (const b of this.el.gfx.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === g.preset);
      for (const b of this.el.outlines.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === g.outlines);
      for (const b of this.el.lines.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', Number(b.dataset.v) === g.intensity);
      toggle(this.el.lines.parentElement!, g.outlines !== 'off');
      const pad = getPadSettings();
      for (const b of this.el['pad-invert'].querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', (b.dataset.v === 'on') === pad.invertY);
      for (const b of this.el['pad-stick'].querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === pad.stick);
      for (const b of this.el['pad-camera'].querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === pad.camera);
      text(this.el.reset, MULTIPLAYER ? 'Leave classroom' : v.menu.confirmingReset ? SAY.confirmReset : SAY.reset);
      this.el.reset.classList.toggle('confirm', v.menu.confirmingReset);
      this.el.reset.title = MULTIPLAYER ? 'Leave this classroom for good: your desk is freed' : 'Delete all progress (asks twice)';
      text(this.el.save, v.menu.saveNote);
      const t = v.menu.transfer ?? null;
      const tKey = t ? `${t.code}/${t.minutes}` : '';
      if (this.el.transfer.dataset.key !== tKey) {
        this.el.transfer.dataset.key = tKey;
        this.el.transfer.innerHTML = t
          ? `${icon('swap')}<span>On the other computer, open the multiplayer menu and enter</span><b class="transfer-code">${esc(t.code)}</b><small>Works once, for ${t.minutes} min</small>`
          : '';
      }
      toggle(this.el.transfer, t !== null);
    }
    const w = v.welcome;
    toggle(this.welcome, w !== null);
    if (w) {
      text(this.el['wc-title'], w.restored ? 'Welcome back' : 'Welcome');
      text(this.el['wc-paper'], fmt(w.paper));
      attr(this.el['wc-title'], 'title', w.problems > 0 ? `${w.problems} damaged save entries were repaired` : '');
      const html = w.session ? sessionStats(w.session) : '';
      if (this.el['wc-session'].dataset.html !== html) {
        this.el['wc-session'].dataset.html = html;
        this.el['wc-session'].innerHTML = html;
      }
    }
  }
}

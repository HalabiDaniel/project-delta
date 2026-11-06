import { attrs, button, card, glyph, stat, tooltipAttrs } from './components';
import { attr, bindButton, esc, text, toggle } from './dom';
import { fmt } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
import { SAY } from './strings';
import type { GraphicsPreset } from '../render/GraphicsSettings';
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
const MULTIPLAYER = typeof window !== 'undefined' && ['mp', 'invite'].some((k) => new URLSearchParams(window.location.search).has(k));

/** "This session" / "Last time" as icon stats. */
export function sessionStats(s: SessionView): string {
  return `<div class="stats session">${[
    stat({ icon: 'ok', value: String(s.missionsCompleted), label: `Missions completed${s.missionsFailed ? ` (${s.missionsFailed} failed)` : ''}` }),
    stat({ icon: 'paper', value: `+${fmt(s.paperEarned)}`, label: 'Paper earned', tone: 'good' }),
    stat({ icon: 'paper', value: `−${fmt(s.paperSpent)}`, label: 'Paper spent' }),
    stat({ icon: 'crumple', value: String(s.aircraftLost), label: 'Aircraft lost' }),
    stat({ icon: 'kills', value: String(s.enemiesDestroyed), label: 'Enemies destroyed' }),
    stat({ icon: 'clock', value: `${s.minutes}m`, label: 'Time' }),
  ].join('')}</div>${s.best !== '—' ? `<div class="session-best" ${attrs(tooltipAttrs('Best performance'))}>${icon('medal')}<span>${esc(s.best)}</span></div>` : ''}`;
}

/** A setting: its name and a segmented choice (aria-pressed; the chosen one is filled and underlined). */
function setting(id: string, iconName: IconName, label: string, tipText: string, items: Array<[string, string]>): string {
  return `<div class="setting" ${attrs(tooltipAttrs(tipText))}><span class="setting-name">${icon(iconName)}${esc(label)}</span><span class="seg" role="group" aria-label="${esc(label)}" data-u="${id}">${items
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('')}</span></div>`;
}

const LEVELS: Array<[string, string]> = [['low', 'Low'], ['medium', 'Med'], ['high', 'High']];

/**
 * The pause menu (Resume, the settings, the controls, leave or reset) and the welcome card on
 * arrival. No rules to read: those come as tips the first time they matter. Each opens with the
 * highlight on its main button and gives it back to what was highlighted before when it closes.
 * Reset (single-player) and Leave classroom (multiplayer) ask with the confirm dialog first (the
 * HUD's guarded actions).
 */
export class Menus {
  private readonly overlay: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private pausedShown = false;
  private welcomeShown = false;

  constructor(root: HTMLElement, actions: HudActions) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = card({
      className: 'overlay-card', label: SAY.menu, elevation: 'floating', attrs: { role: 'dialog', 'aria-labelledby': 'menu-title' },
      bodyHtml: /* html */ `
        <div class="menu-head"><b class="brand">paperwars<span>.io</span></b><small data-u="version"></small><h2 id="menu-title" data-u="title"></h2></div>
        <div class="menu-actions">
          ${button({ label: SAY.resume, icon: 'plane', variant: 'primary', key: { key: 'Esc', pad: 'menu' }, attrs: { 'data-u': 'resume', 'data-nav-default': '' } })}
          ${button({ label: SAY.logbook, icon: 'book', key: { key: 'L' }, attrs: { 'data-u': 'logbook' } })}
          ${button({ label: '', icon: 'sound', key: { key: 'M' }, attrs: { 'data-u': 'sound' } })}
          <a class="ui-button" data-variant="secondary" data-u="mode" href="${MULTIPLAYER ? '?' : '?mp'}">${icon(MULTIPLAYER ? 'home' : 'fighter', 'icon ui-icon')}<span class="ui-label">${MULTIPLAYER ? 'Single-player' : 'Multiplayer'}</span></a>
        </div>
        <section class="menu-section" aria-labelledby="menu-settings"><h3 id="menu-settings">${icon('graphics')}${SAY.settings}</h3>
          <div class="settings">
            ${setting('hints', 'info', 'Hints', 'Key hints on the HUD', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}
            ${setting('scale', 'distance', 'Size', 'HUD size', [['0.9', 'S'], ['1', 'M'], ['1.15', 'L']])}
            ${setting('gfx', 'graphics', 'Graphics', 'Graphics quality: shadows, decorations and resolution', LEVELS)}
          </div>
          <div class="settings pad-only">
            ${setting('pad-invert', 'heading', 'Invert Y', 'Controller: pull back to climb', [['off', 'Off'], ['on', 'On']])}
            ${setting('pad-stick', 'plane', 'Stick', 'Controller steering sensitivity', LEVELS)}
            ${setting('pad-camera', 'distance', 'Camera', 'Controller camera sensitivity', LEVELS)}
          </div>
        </section>
        <div data-u="session"></div>
        <div class="controls kbd-only">${CONTROLS.map(([key, i, label]) => `<div ${attrs(tooltipAttrs(label))}>${glyph({ key })}${icon(i)}<span>${esc(label)}</span></div>`).join('')}</div>
        <div class="controls pad-only">${PAD_CONTROLS.map(([key, i, label]) => `<div ${attrs(tooltipAttrs(label))}><b class="pad-key">${key}</b>${icon(i)}<span>${esc(label)}</span></div>`).join('')}</div>
        <div class="menu-transfer" data-u="transfer" hidden></div>
        <div class="menu-foot"><span class="save-note" data-u="save"></span>${MULTIPLAYER
          ? `${button({ label: 'Feedback', icon: 'pencil', size: 'small', key: { key: 'F8' }, tip: 'Tell the developer about a bug, a frustration or what you enjoyed (F8)', attrs: { 'data-u': 'feedback' } })}${button({ label: 'Another computer', icon: 'swap', size: 'small', tip: 'Get a one-time code to play as yourself on another computer', attrs: { 'data-u': 'move' } })}`
          : ''}${button({ label: 'Tutorial', icon: 'tip', size: 'small', tip: 'Show the step-by-step tutorial again', attrs: { 'data-u': 'tutorial' } })}${button({
            label: MULTIPLAYER ? 'Leave classroom' : SAY.reset, icon: MULTIPLAYER ? 'close' : 'remove', size: 'small', variant: 'danger',
            tip: MULTIPLAYER ? 'Leave this classroom for good: your desk is freed (asks first)' : 'Delete all progress (asks first)', attrs: { 'data-u': 'reset' },
          })}</div>`,
    });
    root.appendChild(this.overlay);
    this.welcome = document.createElement('div');
    this.welcome.className = 'welcome';
    this.welcome.innerHTML = card({
      className: 'welcome-card', label: SAY.welcome, elevation: 'floating', attrs: { role: 'dialog', 'aria-labelledby': 'wc-title' },
      bodyHtml: /* html */ `
        <b class="brand">paperwars<span>.io</span></b>
        <h2 id="wc-title" data-u="wc-title"></h2>
        <div class="wc-paper" ${attrs(tooltipAttrs('Paper'))}>${icon('paper')}<b class="num" data-u="wc-paper"></b></div>
        <div data-u="wc-session"></div>
        ${button({ label: SAY.continue, icon: 'home', variant: 'primary', key: { key: 'Enter' }, attrs: { 'data-u': 'wc-go', 'data-nav-default': '' } })}
        ${MULTIPLAYER ? '' : `<a class="ui-button" data-variant="secondary" data-size="small" data-u="wc-mp" href="?mp" ${attrs(tooltipAttrs('Play with others in a shared classroom'))}>${icon('fighter', 'icon ui-icon')}<span class="ui-label">Multiplayer</span></a>`}`,
    });
    root.appendChild(this.welcome);
    // Hidden until the first render says otherwise (multiplayer doesn't render the HUD before a desk is claimed).
    this.overlay.hidden = true;
    this.welcome.hidden = true;
    for (const r of [this.overlay, this.welcome]) for (const n of r.querySelectorAll<HTMLElement>('[data-u]')) this.el[n.dataset.u!] = n;
    bindButton(this.el.resume, actions.resume);
    bindButton(this.el.logbook, actions.openLogbook);
    bindButton(this.el.sound, actions.toggleSound);
    bindButton(this.el.reset, actions.resetProgress);
    bindButton(this.el.tutorial, () => {
      actions.restartTutorial();
      actions.resume();
    });
    if (this.el.move) bindButton(this.el.move, () => actions.moveDevice?.());
    if (this.el.feedback) bindButton(this.el.feedback, () => actions.openFeedback?.());
    bindButton(this.el['wc-go'], actions.dismissWelcome);
    this.welcome.addEventListener('click', (e) => (e.target as HTMLElement).closest('[data-u="wc-mp"]') || actions.dismissWelcome());
    this.overlay.addEventListener('click', (e) => e.target === this.overlay && actions.resume());
    const seg = (id: string, fn: (v: string) => void) => {
      for (const b of this.el[id].querySelectorAll<HTMLElement>('button')) bindButton(b, () => fn(b.dataset.v!));
    };
    seg('hints', (v) => actions.setHints(v as HintMode));
    seg('scale', (v) => actions.setUiScale(Number(v)));
    seg('gfx', (v) => actions.setGraphicsPreset(v as GraphicsPreset));
    seg('pad-invert', (v) => setPadSettings({ ...getPadSettings(), invertY: v === 'on' }));
    seg('pad-stick', (v) => setPadSettings({ ...getPadSettings(), stick: v as PadLevel }));
    seg('pad-camera', (v) => setPadSettings({ ...getPadSettings(), camera: v as PadLevel }));
    text(this.el.version, `v${__APP_VERSION__}`);
  }

  render(v: HudView): void {
    toggle(this.overlay, v.paused);
    if (v.paused !== this.pausedShown) {
      this.pausedShown = v.paused;
      const panel = this.overlay.firstElementChild as HTMLElement;
      if (v.paused) focusManager()?.openPanel(panel);
      else focusManager()?.closePanel(panel);
    }
    if (v.paused) {
      text(this.el.title, v.phase === 'flying' ? SAY.paused : SAY.menu);
      const html = sessionStats(v.menu.session);
      if (this.el.session.dataset.html !== html) {
        this.el.session.dataset.html = html;
        this.el.session.innerHTML = html;
      }
      toggle(this.el.logbook, v.phase !== 'flying');
      const muted = v.menu.settings.muted;
      const sKey = String(muted);
      if (this.el.sound.dataset.key !== sKey) {
        this.el.sound.dataset.key = sKey;
        this.el.sound.querySelector('svg')!.outerHTML = icon(muted ? 'mute' : 'sound', 'icon ui-icon');
        text(this.el.sound.querySelector<HTMLElement>('.ui-label')!, muted ? 'Off' : 'On');
        attr(this.el.sound, 'aria-label', `${ICON_NAMES.sound}: ${muted ? 'Off' : 'On'}`);
        attr(this.el.sound, 'aria-pressed', String(!muted));
      }
      const pressed = (id: string, on: (value: string) => boolean) => {
        for (const b of this.el[id].querySelectorAll<HTMLElement>('button')) {
          const yes = on(b.dataset.v!);
          b.classList.toggle('on', yes);
          attr(b, 'aria-pressed', String(yes));
        }
      };
      pressed('hints', (x) => x === v.menu.settings.hints);
      pressed('scale', (x) => Number(x) === v.menu.settings.uiScale);
      pressed('gfx', (x) => x === v.menu.settings.graphics.preset);
      const pad = getPadSettings();
      pressed('pad-invert', (x) => (x === 'on') === pad.invertY);
      pressed('pad-stick', (x) => x === pad.stick);
      pressed('pad-camera', (x) => x === pad.camera);
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
    if ((w !== null) !== this.welcomeShown) {
      this.welcomeShown = w !== null;
      const panel = this.welcome.firstElementChild as HTMLElement;
      if (w) focusManager()?.openPanel(panel);
      else focusManager()?.closePanel(panel);
    }
    if (w) {
      text(this.el['wc-title'], w.restored ? 'Welcome back' : 'Welcome');
      text(this.el['wc-paper'], fmt(w.paper));
      attr(this.el['wc-title'], 'data-tip', w.problems > 0 ? `${w.problems} damaged save entries were repaired` : '');
      const html = w.session ? sessionStats(w.session) : '';
      if (this.el['wc-session'].dataset.html !== html) {
        this.el['wc-session'].dataset.html = html;
        this.el['wc-session'].innerHTML = html;
      }
    }
  }
}

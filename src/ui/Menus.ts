import { attrs, button, card, glyph, stat, tooltipAttrs } from './components';
import { bind, keyFor, padButtonFor, pair, type Action } from '../input/bindings';
import { padTemplate, type GlyphSpec } from '../input/glyphs';
import { attr, bindButton, esc, text, toggle } from './dom';
import { fmt } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
import { ACCESS_TEXT, SAY } from './strings';
import { TEXT_SCALES, type CaptionMode, type MotionMode } from './access';
import type { GraphicsPreset } from '../render/GraphicsSettings';
import type { HintMode, HudActions, HudView, SessionView } from './views';
import { getPadSettings, setPadSettings, type PadLevel } from '../input/Controls';

/** A row of the pause menu's controls grid: the binding, an icon and what it does. */
export interface ControlRow {
  spec: GlyphSpec;
  icon: IconName;
  label: string;
}

/** A controller template for an action's button ("{rt}"), from the bindings. */
const padOf = (action: Action): string => `{${padButtonFor(action) ?? 'south'}}`;
/** A controller-only row: the glyph is a template filled for the controller family in use. */
const padRow = (template: string, iconName: IconName, label: string): ControlRow => ({ spec: { key: padTemplate(template, 'xbox'), padText: template }, icon: iconName, label });

/**
 * The controller's mapping, shown in the menu while a controller is in use. Read from the
 * bindings and drawn for the controller in use (Xbox, PlayStation or generic labels) by applyGlyphs.
 */
export function padControls(): ControlRow[] {
  return [
    padRow('{lstick}', 'heading', 'Steer'),
    padRow('{rstick}', 'distance', 'Look'),
    padRow(padOf('firePrimary'), 'ink', 'Ink'),
    padRow(padOf('fireSecondary'), 'bombload', 'Bomb'),
    padRow(padOf('boost'), 'boost', 'Boost'),
    padRow(`${padOf('modifier')} + L`, 'speed', 'Throttle / bank'),
    padRow(padOf('confirm'), 'ok', 'Confirm, launch'),
    padRow(padOf('back'), 'close', 'Back'),
    padRow(padOf('service'), 'rearm', 'Rearm, repair'),
    padRow(padOf('base'), 'base', 'Base · hold: hints'),
    padRow(`${padOf('prevAircraft')} / ${padOf('nextAircraft')}`, 'plane', 'Aircraft (home)'),
    padRow(`${padOf('prevMission')} / ${padOf('nextMission')}`, 'reach', 'Mission (home)'),
    padRow('{dpad}', 'more', 'Menus · emotes'),
    padRow(padOf('logbook'), 'book', 'Logbook · scores'),
    padRow(padOf('pause'), 'info', 'Pause'),
  ];
}

/** The keyboard and mouse mapping, from the bindings. */
export function keyboardControls(): ControlRow[] {
  return [
    { spec: { key: 'Mouse', padText: '{lstick}' }, icon: 'heading', label: 'Steer' },
    { spec: pair(bind('throttleUp'), bind('throttleDown')), icon: 'speed', label: 'Throttle' },
    { spec: pair(bind('bankLeft'), bind('bankRight')), icon: 'plane', label: 'Bank' },
    { spec: bind('boost'), icon: 'boost', label: 'Boost' },
    { spec: bind('firePrimary'), icon: 'ink', label: 'Ink' },
    { spec: bind('fireSecondary'), icon: 'bombload', label: 'Bomb' },
    { spec: { key: `${keyFor('pick1')} – ${keyFor('pick4')}` }, icon: 'reach', label: 'Mission' },
    { spec: pair(bind('prevAircraft'), bind('nextAircraft')), icon: 'plane', label: 'Aircraft' },
    { spec: bind('fold'), icon: 'build', label: 'Fold' },
    { spec: bind('launch'), icon: 'plane', label: 'Launch' },
    { spec: bind('service'), icon: 'rearm', label: 'Rearm' },
    { spec: bind('base'), icon: 'base', label: 'Base' },
    { spec: bind('swap'), icon: 'swap', label: 'Swap card' },
    { spec: bind('logbook'), icon: 'book', label: 'Logbook' },
    { spec: bind('hints'), icon: 'info', label: 'Key hints' },
    { spec: bind('sound'), icon: 'sound', label: 'Sound' },
  ];
}

/** The controls grid: a glyph, an icon and a word per row (glyphs follow the device live). */
export function controlsGridHtml(rows: ControlRow[], className: string): string {
  return `<div class="controls ${className}">${rows.map((r) => `<div ${attrs(tooltipAttrs(r.label))}>${glyph(r.spec)}${icon(r.icon)}<span>${esc(r.label)}</span></div>`).join('')}</div>`;
}

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
          ${button({ label: SAY.resume, icon: 'plane', variant: 'primary', key: bind('back', 'pause'), attrs: { 'data-u': 'resume', 'data-nav-default': '' } })}
          ${button({ label: SAY.logbook, icon: 'book', key: bind('logbook'), attrs: { 'data-u': 'logbook' } })}
          ${button({ label: '', icon: 'sound', key: bind('sound'), attrs: { 'data-u': 'sound' } })}
          <a class="ui-button" data-variant="secondary" data-u="mode" href="${MULTIPLAYER ? '?' : '?mp'}">${icon(MULTIPLAYER ? 'home' : 'fighter', 'icon ui-icon')}<span class="ui-label">${MULTIPLAYER ? 'Single-player' : 'Multiplayer'}</span></a>
        </div>
        <section class="menu-section" aria-labelledby="menu-settings"><h3 id="menu-settings">${icon('graphics')}${SAY.settings}</h3>
          <div class="settings">
            ${setting('hints', 'info', 'Hints', 'Key hints on the HUD', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}
            ${setting('scale', 'distance', 'Size', 'HUD size', [['0.9', 'S'], ['1', 'M'], ['1.15', 'L']])}
            ${setting('gfx', 'graphics', 'Graphics', 'Graphics quality: shadows, decorations and resolution', LEVELS)}
          </div>
          <h3 id="menu-access">${icon('info')}${esc(ACCESS_TEXT.section)}</h3>
          <div class="settings access" role="group" aria-labelledby="menu-access">
            ${setting('a-palette', 'graphics', ACCESS_TEXT.palette.label, ACCESS_TEXT.palette.tip, [['standard', ACCESS_TEXT.palette.standard], ['colourblind', ACCESS_TEXT.palette.colourblind]])}
            ${setting('a-text', 'pencil', ACCESS_TEXT.text.label, ACCESS_TEXT.text.tip, TEXT_SCALES.map((t) => [String(t), `${Math.round(t * 100)}%`]))}
            ${setting('a-contrast', 'info', ACCESS_TEXT.contrast.label, ACCESS_TEXT.contrast.tip, [['off', ACCESS_TEXT.contrast.normal], ['on', ACCESS_TEXT.contrast.high]])}
            ${setting('a-motion', 'speed', ACCESS_TEXT.motion.label, ACCESS_TEXT.motion.tip, [['auto', ACCESS_TEXT.motion.auto], ['full', ACCESS_TEXT.motion.full], ['reduced', ACCESS_TEXT.motion.reduced]])}
            ${setting('a-captions', 'sound', ACCESS_TEXT.captions.label, ACCESS_TEXT.captions.tip, [['auto', ACCESS_TEXT.captions.auto], ['on', ACCESS_TEXT.captions.on], ['off', ACCESS_TEXT.captions.off]])}
            ${setting('a-safe', 'distance', ACCESS_TEXT.safeArea.label, ACCESS_TEXT.safeArea.tip, [['off', ACCESS_TEXT.safeArea.off], ['on', ACCESS_TEXT.safeArea.on]])}
          </div>
          <div class="settings pad-only">
            ${setting('pad-invert', 'heading', 'Invert Y', 'Controller: pull back to climb', [['off', 'Off'], ['on', 'On']])}
            ${setting('pad-stick', 'plane', 'Stick', 'Controller steering sensitivity', LEVELS)}
            ${setting('pad-camera', 'distance', 'Camera', 'Controller camera sensitivity', LEVELS)}
          </div>
        </section>
        <div data-u="session"></div>
        ${controlsGridHtml(keyboardControls(), 'kbd-only')}
        ${controlsGridHtml(padControls(), 'pad-only')}
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
        ${button({ label: SAY.continue, icon: 'home', variant: 'primary', key: bind('confirm'), attrs: { 'data-u': 'wc-go', 'data-nav-default': '' } })}
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
    seg('a-palette', (v) => actions.setAccess({ palette: v === 'colourblind' ? 'colourblind' : 'standard' }));
    seg('a-text', (v) => actions.setAccess({ textScale: Number(v) }));
    seg('a-contrast', (v) => actions.setAccess({ highContrast: v === 'on' }));
    seg('a-motion', (v) => actions.setAccess({ motion: v as MotionMode }));
    seg('a-captions', (v) => actions.setAccess({ captions: v as CaptionMode }));
    seg('a-safe', (v) => actions.setAccess({ safeArea: v === 'on' }));
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
      const a = v.menu.settings.access;
      pressed('a-palette', (x) => x === a.palette);
      pressed('a-text', (x) => Number(x) === a.textScale);
      pressed('a-contrast', (x) => (x === 'on') === a.highContrast);
      pressed('a-motion', (x) => x === a.motion);
      pressed('a-captions', (x) => x === a.captions);
      pressed('a-safe', (x) => (x === 'on') === a.safeArea);
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

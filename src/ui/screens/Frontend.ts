import { esc } from '../dom';
import { icon, type IconName } from '../icons';
import {
  art, avatar, brand, checkbox, divider, field, kbadge, kbutton, kchip, kiconButton, kmeter, kseg, ktabs, kvRow, panel, sectionLabel, selectCard, stepper, swatches,
} from '../kit';
import { T } from '../strings';
import { clock, count, date, fmt, paper, pct } from '../format';
import { focusManager } from '../../input/FocusNav';
import type { Flow, FlowState, Screen, SettingsTab } from '../flow';
import { SettingsScreen, type SettingsActions, type SettingsExtras } from './SettingsScreen';
import type { SettingsView } from '../views';
import {
  CALLSIGN_RULE, emailProblem, passwordStrength, PASSWORD_MIN,
  type AccountService, type Friend, type HostedRoom, type LeaderboardPeriod, type LeaderboardService, type LeaderRow, type Matchmaking, type Profile, type Region, type RoomService,
} from '../../net/services';
import type { AircraftId } from '../../config';
import './screens.css';

// ---- What the front end needs from the game ------------------------------------------------------

export interface PlaneChoice {
  id: AircraftId;
  name: string;
  role: string;
}

export interface AchievementItem {
  id: string;
  title: string;
  detail: string;
  /** When it was earned (ms), or null. */
  at: number | null;
}

export interface SoloSetup {
  classroom: 'room4b' | 'lab' | 'library';
  plane: AircraftId;
  rivals: number;
  difficulty: 'easy' | 'normal' | 'sneaky' | 'pet';
  team: number;
}

export interface FrontendHost {
  version: string;
  account: AccountService & { setTeam?(team: number): void };
  matchmaking: Matchmaking;
  rooms: RoomService;
  leaderboard: LeaderboardService;
  /** The four planes offered as a start (solo and multiplayer). */
  starters: readonly PlaneChoice[];
  art(key: string): string | null;
  paper(): number;
  achievements(): AchievementItem[];
  records(): Array<[string, string]>;
  /** For the leaderboard's own row. */
  me(): { paper: number; kills: number; plane: string | null };
  settings(): SettingsView;
  settingsExtras(): SettingsExtras;
  settingsActions: Omit<SettingsActions, 'back' | 'signIn' | 'signOut'>;
  /** Play solo → Start. */
  startSolo(setup: SoloSetup): void;
  /** Off to the multiplayer client (a page load). */
  goMultiplayer(params: Record<string, string>): void;
  /** The camera preset behind this screen, or null for none (setup screens have no scene). */
  scene(preset: 'login' | 'menu' | null): void;
  /** Settings opened from Pause: Back returns to the match's Pause. */
  backToPause(): void;
}

const F = (): typeof T.front => T.front;

const SOLO_KEY = 'paperwars.solo';
const DEFAULT_SOLO: SoloSetup = { classroom: 'lab', plane: 'lightning', rivals: 5, difficulty: 'normal', team: 2 };

function loadSolo(): SoloSetup {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SOLO_KEY) ?? '{}') as Partial<SoloSetup>;
    return {
      classroom: (['room4b', 'lab', 'library'] as const).includes(raw.classroom as SoloSetup['classroom']) ? raw.classroom! : DEFAULT_SOLO.classroom,
      plane: typeof raw.plane === 'string' ? (raw.plane as AircraftId) : DEFAULT_SOLO.plane,
      rivals: Number.isInteger(raw.rivals) ? Math.min(7, Math.max(1, raw.rivals!)) : DEFAULT_SOLO.rivals,
      difficulty: (['easy', 'normal', 'sneaky', 'pet'] as const).includes(raw.difficulty as SoloSetup['difficulty']) ? raw.difficulty! : DEFAULT_SOLO.difficulty,
      team: Number.isInteger(raw.team) ? Math.min(8, Math.max(1, raw.team!)) : DEFAULT_SOLO.team,
    };
  } catch {
    return { ...DEFAULT_SOLO };
  }
}

const CLASSROOMS: Array<[SoloSetup['classroom'], number]> = [['room4b', 6], ['lab', 8], ['library', 12]];
const team = (n: number): string => `var(--team-${Math.min(8, Math.max(1, n))})`;

/** A classroom's mini desk layout: rows of desks, yours in sky blue. */
function deskLayout(desks: number, compact = false): string {
  const perRow = desks <= 6 ? 5 : desks <= 8 ? 5 : 5;
  const rows: number[] = [];
  for (let left = desks; left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return `<span class="desk-layout${compact ? ' compact' : ''}" aria-hidden="true">${rows.map((n, r) => `<span class="desk-row">${Array.from({ length: n }, (_, i) => `<i${r === 0 && i === n - 1 && desks === 8 ? ' data-you' : ''}></i>`).join('')}</span>`).join('')}</span>`;
}

type MpTab = 'quick' | 'host' | 'join';
type QuickState = { kind: 'finding'; started: number } | { kind: 'joining'; title: string; players: number; capacity: number; id: string; at: number } | { kind: 'offline' } | { kind: 'stopped' };

type SocialProvider = 'google' | 'github' | 'discord';

/** Brand marks for the sign-in providers (filled, so they read at button size). */
const SOCIAL_SVG: Readonly<Record<SocialProvider, string>> = {
  google: '<svg class="icon social-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>',
  github: '<svg class="icon social-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
  discord: '<svg class="icon social-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 12.6 12.6 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.53 9.05-.32 13.6.1 18.09a19.9 19.9 0 0 0 6.04 3.05c.49-.66.92-1.36 1.3-2.1a12.9 12.9 0 0 1-2.04-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.2 0c.16.13.33.26.5.38-.65.39-1.33.71-2.05.98.38.74.81 1.44 1.3 2.1a19.8 19.8 0 0 0 6.05-3.05c.5-5.2-.84-9.71-3.58-13.72zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.1 2.16 2.42c0 1.33-.95 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.1 2.16 2.42c0 1.33-.94 2.42-2.16 2.42z"/></svg>',
};

/**
 * Every screen outside a match, on one layer over the living desk scene: Loading, Login, Create
 * account, the main menu, Play solo, Multiplayer (Quick play, Host, Join), Leaderboard,
 * Achievements, Settings and Credits. Layouts are drawn on the design canvas's 1440 × 900 frame
 * and scaled to the window (the stage keeps the window's aspect, so edge-anchored pieces stay at
 * the edges). The DOM sits on the scene with no dimming.
 */
export class Frontend {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly settings: SettingsScreen;
  private screenEl: HTMLElement | null = null;
  private rendered: Screen | null = null;
  private progressText = '';
  private progress = 0;
  // Form state
  /** The provider named in the "not yet" note after a social button is pressed. */
  private socialNote = '';
  private login = { email: '', password: '', show: false, keep: true, error: '' as string };
  private signup = { callsign: '', email: '', password: '', show: false, agree: false, touched: { callsign: false, email: false, password: false }, error: '' };
  private solo: SoloSetup = loadSolo();
  private mpTab: MpTab = 'quick';
  private mpPlane: AircraftId = 'lightning';
  private region: Region = 'auto';
  private quick: QuickState = { kind: 'stopped' };
  private quickAbort: AbortController | null = null;
  private ping: number | null = null;
  private room: HostedRoom | null = null;
  private roomSettings = { classroom: 'lab', minutes: 15 as 10 | 15 | 20, fillWithAi: true, friendsWithoutCode: false };
  private joinCode = '';
  private friends: Friend[] = [];
  private lbPeriod: LeaderboardPeriod = 'week';
  private lbRows: LeaderRow[] = [];
  private lbSearch = '';
  private achFilter: 'all' | 'earned' | 'locked' = 'all';
  private ticker = 0;

  constructor(
    host: HTMLElement,
    private readonly game: FrontendHost,
    private readonly flow: Flow,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'front';
    this.el.innerHTML = `<div class="front-stage"></div>`;
    host.appendChild(this.el);
    this.stage = this.el.firstElementChild as HTMLElement;
    const sa = () => game.settingsActions;
    this.settings = new SettingsScreen(document.createElement('div'), {
      setHints: (m) => sa().setHints(m),
      setUiScale: (n) => sa().setUiScale(n),
      setAccess: (p) => sa().setAccess(p),
      setGraphicsPreset: (p) => sa().setGraphicsPreset(p),
      toggleSound: () => sa().toggleSound(),
      setVolume: (v) => sa().setVolume(v),
      restartTutorial: () => sa().restartTutorial(),
      resetProgress: () => sa().resetProgress(),
      back: () => this.back(),
      signIn: () => this.flow.go('login'),
      signOut: () => {
        game.account.signOut();
        this.flow.go('login');
      },
    }, (tab) => this.flow.setSettingsTab(tab));
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('input', (e) => this.input(e));
    this.el.addEventListener('submit', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => {
      // Enter in a form field submits its form's primary action.
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        this.el.querySelector<HTMLButtonElement>('.pw-btn.primary[data-act]')?.click();
      }
    });
    window.addEventListener('resize', () => this.fit());
    this.fit();
    flow.onChange((s, prev) => this.changed(s, prev));
    this.mpPlane = this.solo.plane;
    this.draw();
  }

  /** The stage scale: the design's 1440 × 900 frame fitted to the window, its aspect kept. */
  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.max(0.6, Math.min(2.4, Math.min(w / 1440, h / 900)));
    this.el.style.setProperty('--fs', String(s));
    this.el.style.setProperty('--stage-w', `${w / s}px`);
    this.el.style.setProperty('--stage-h', `${h / s}px`);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  // ---- Loading -------------------------------------------------------------------------------------

  setProgress(done: number, total: number, label?: string): void {
    this.progress = total > 0 ? Math.min(1, done / total) : 0;
    this.progressText = label ?? (total > 0 ? F().folding(count(done), count(total)) : F().foldingPlain);
    if (this.flow.screen !== 'boot') return;
    const meter = this.stage.querySelector('.boot-meter');
    if (meter) {
      meter.outerHTML = this.bootMeter();
    }
    const line = this.stage.querySelector('.boot-line');
    if (line) line.textContent = this.progressText;
  }

  /** The scene is ready: the loading backdrop goes (the living desk shows through). */
  sceneReady(): void {
    this.el.dataset.scene = 'on';
  }

  private bootMeter(): string {
    return kmeter({ label: F().loading, value: this.progress, segments: 20, hideLabel: true, className: 'boot-meter' });
  }

  // ---- Flow -------------------------------------------------------------------------------------

  private changed(s: FlowState, prev: Screen): void {
    if (prev === 'multiplayer' && s.screen !== 'multiplayer') this.stopQuick();
    if (s.screen === 'settings') this.settings.open(s.settingsTab, document.documentElement.dataset.device === 'gamepad' ? 'gamepad' : 'keyboard');
    this.draw();
  }

  /** Esc / B on a menu screen: one level back (Settings from Pause goes back to Pause). */
  back(): boolean {
    if (this.flow.screen === 'settings' && this.flow.state.settingsFrom === 'pause') {
      this.game.backToPause();
      return true;
    }
    if (this.flow.screen === 'login' || this.flow.screen === 'signup') {
      if (!this.game.account.current()) this.game.account.continueAsGuest();
      this.socialNote = '';
      this.flow.go('menu');
      return true;
    }
    return this.flow.back();
  }

  /** Each frame while visible: the clocks (elapsed search time, the joining countdown). */
  update(): void {
    if (this.el.hidden) return;
    const now = performance.now();
    if (now - this.ticker < 250) return;
    this.ticker = now;
    if (this.flow.screen === 'multiplayer' && this.mpTab === 'quick') {
      const q = this.quick;
      if (q.kind === 'finding') {
        const el = this.stage.querySelector('[data-q="elapsed"] .pw-chip-value');
        if (el) el.textContent = clock((now - q.started) / 1000);
      } else if (q.kind === 'joining' && now - q.at > 3000) {
        this.game.goMultiplayer({ session: q.id, plane: this.mpPlane });
      }
    }
    if (this.flow.screen === 'settings') this.settings.render(this.game.settings(), this.game.settingsExtras());
  }

  private draw(): void {
    const screen = this.flow.screen;
    this.el.hidden = screen === 'match';
    this.el.dataset.screen = screen;
    if (screen === 'match') {
      this.rendered = 'match';
      return;
    }
    this.game.scene(screen === 'login' || screen === 'signup' || screen === 'boot' ? 'login' : screen === 'menu' ? 'menu' : null);
    const first = this.rendered !== screen;
    this.rendered = screen;
    const html = this.html(screen);
    if (screen === 'settings') {
      this.stage.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'front-sheet pw-panel screen-sheet';
      wrap.dataset.margin = '';
      wrap.appendChild(this.settings.el);
      this.stage.appendChild(wrap);
      this.settings.render(this.game.settings(), this.game.settingsExtras());
      this.screenEl = wrap;
    } else {
      this.stage.innerHTML = html;
      this.screenEl = this.stage.firstElementChild as HTMLElement | null;
    }
    if (first) {
      this.screenEl?.classList.add('pw-anim');
      focusManager()?.reset(`front:${screen}`);
    }
    if (screen === 'multiplayer' && this.mpTab === 'quick' && this.quick.kind === 'stopped' && first) this.startQuick();
    if (screen === 'leaderboard' && first) this.loadLeaderboard();
    if (screen === 'multiplayer' && this.mpTab === 'join' && first) this.loadFriends();
  }

  /** Redraws the screen but keeps the caret in a text field. */
  private redraw(): void {
    const active = document.activeElement as HTMLInputElement | null;
    const id = active?.tagName === 'INPUT' ? active.id : null;
    const caret = id ? active!.selectionStart : null;
    this.draw();
    if (id) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) {
        el.focus({ preventScroll: true });
        if (caret !== null) el.setSelectionRange(caret, caret);
      }
    }
  }

  private html(screen: Screen): string {
    switch (screen) {
      case 'boot':
        return this.bootHtml();
      case 'login':
        return this.loginHtml();
      case 'signup':
        return this.signupHtml();
      case 'menu':
        return this.menuHtml();
      case 'solo':
        return this.soloHtml();
      case 'multiplayer':
        return this.mpHtml();
      case 'leaderboard':
        return this.leaderboardHtml();
      case 'achievements':
        return this.achievementsHtml();
      case 'credits':
        return this.creditsHtml();
      default:
        return '';
    }
  }

  // ---- Screens ------------------------------------------------------------------------------------

  private brand(): string {
    return `<div class="front-brand">${brand(F().brand)}</div>`;
  }

  private bootHtml(): string {
    return `<div class="front-scene-screen">${this.brand()}
      ${panel({ className: 'boot-panel', label: F().loading, bodyHtml: `${this.bootMeter()}<p class="boot-line" role="status">${esc(this.progressText || F().foldingPlain)}</p>` })}</div>`;
  }

  private loginHtml(): string {
    const f = F();
    const l = this.login;
    const pw = kiconButton({ icon: l.show ? 'eyeOff' : 'eye', name: l.show ? f.hidePassword : f.showPassword, variant: 'quiet', attrs: { 'data-act': 'toggle-password' } });
    return `<div class="front-scene-screen">${this.brand()}${this.authBack()}
      ${panel({ className: 'auth-panel', margin: true, label: f.welcomeBack, tag: 'section', bodyHtml: `
        <h1 class="auth-title">${esc(f.welcomeBack)}</h1>
        <p class="auth-sub">${esc(f.loginSub)}</p>
        <form class="auth-form" novalidate>
          ${field({ id: 'login-email', label: f.email, attrs: { inputmode: 'email' }, value: l.email, placeholder: f.emailPlaceholder, icon: 'mail', autocomplete: 'email', error: l.error === 'email' ? f.errors.email : undefined })}
          ${field({ id: 'login-password', label: f.password, type: l.show ? 'text' : 'password', value: l.password, placeholder: f.passwordPlaceholder, icon: 'lock', autocomplete: 'current-password', trailingHtml: pw, error: l.error === 'unknown' ? f.errors.unknown : l.error === 'password' ? f.errors.passwordEmpty : undefined })}
          <div class="auth-row">${checkbox({ id: 'login-keep', labelHtml: esc(f.keepSignedIn), checked: l.keep })}<button type="button" class="pw-link" data-act="forgot">${esc(f.forgot)}</button></div>
          ${l.error === 'reset' ? `<p class="auth-note" role="status">${icon('info', 'icon pw-icon')}<span>${esc(f.resetUnavailable)}</span></p>` : ''}
          ${kbutton({ label: f.signIn, icon: 'logIn', variant: 'primary', size: 'xl', block: true, attrs: { 'data-act': 'sign-in', 'data-nav-default': '' } })}
          ${divider(f.or)}
          ${this.socialHtml(f.signInWith)}
          ${kbutton({ label: f.guest, icon: 'user', size: 'l', block: true, attrs: { 'data-act': 'guest' } })}
          <p class="auth-switch">${esc(f.newHere)} <button type="button" class="pw-link" data-act="to-signup">${esc(f.createAccount)}</button></p>
        </form>` })}</div>`;
  }

  /** Back to the main menu from Login / Create account (as a guest when nobody is signed in). */
  private authBack(): string {
    return `<div class="auth-back">${kbutton({ label: F().backToMenu, icon: 'arrowLeft', size: 's', attrs: { 'data-act': 'back' } })}</div>`;
  }

  /** Three small "continue with" buttons: Google, GitHub, Discord. */
  private socialHtml(withLabel: (provider: string) => string): string {
    const f = F();
    const btn = (id: SocialProvider, name: string) =>
      `<button type="button" class="pw-btn social-btn" data-variant="paper" data-size="m" data-social="${id}" data-act="social" aria-label="${esc(withLabel(name))}" title="${esc(withLabel(name))}">${SOCIAL_SVG[id]}<span class="pw-label">${esc(name)}</span></button>`;
    return `<div class="social-row">${btn('google', f.google)}${btn('github', f.github)}${btn('discord', f.discord)}</div>${this.socialNote ? `<p class="auth-note" role="status">${icon('info', 'icon pw-icon')}<span>${esc(f.socialUnavailable(this.socialNote))}</span></p>` : ''}`;
  }

  private signupHtml(): string {
    const f = F();
    const s = this.signup;
    const callsignOk = CALLSIGN_RULE.test(s.callsign);
    const emailIssue = emailProblem(s.email);
    const strength = passwordStrength(s.password);
    const pw = kiconButton({ icon: s.show ? 'eyeOff' : 'eye', name: s.show ? f.hidePassword : f.showPassword, variant: 'quiet', attrs: { 'data-act': 'toggle-password' } });
    let meter = '<span class="strength" aria-hidden="true">';
    for (let i = 0; i < 4; i++) meter += `<i${i < strength ? ' data-on' : ''} data-level="${strength}"></i>`;
    meter += `</span><span class="sr-only" role="status">${esc(f.strength[strength] ?? '')}</span>`;
    const emailError = s.touched.email && emailIssue ? (emailIssue === 'domain' ? f.errors.domain : emailIssue === 'at' ? f.errors.at : f.errors.email) : undefined;
    const callsignError = s.touched.callsign && !callsignOk ? f.callsignHelp : undefined;
    const pwError = s.touched.password && s.password.length < PASSWORD_MIN ? f.errors.passwordShort(PASSWORD_MIN) : undefined;
    return `<div class="front-scene-screen">${this.brand()}${this.authBack()}
      ${panel({ className: 'auth-panel', margin: true, label: f.makePilot, bodyHtml: `
        <h1 class="auth-title">${esc(f.makePilot)}</h1>
        <p class="auth-sub">${esc(f.signupSub)}</p>
        <form class="auth-form" novalidate>
          ${field({ id: 'signup-callsign', label: f.callsign, value: s.callsign, placeholder: f.callsignPlaceholder, icon: 'user', autocomplete: 'nickname', maxLength: 16, help: callsignError ? undefined : f.callsignHelp, error: callsignError, valid: callsignOk, validLabel: f.valid })}
          ${field({ id: 'signup-email', label: f.email, attrs: { inputmode: 'email' }, value: s.email, placeholder: f.emailPlaceholder, icon: 'mail', autocomplete: 'email', error: emailError })}
          ${field({ id: 'signup-password', label: f.password, type: s.show ? 'text' : 'password', value: s.password, placeholder: f.passwordNew, icon: 'lock', autocomplete: 'new-password', trailingHtml: pw, belowHtml: meter, error: pwError })}
          ${checkbox({ id: 'signup-agree', checked: s.agree, labelHtml: f.agree(`<a class="pw-link" href="#" data-act="terms">${esc(f.terms)}</a>`, `<a class="pw-link" href="#" data-act="privacy">${esc(f.privacy)}</a>`) })}
          ${s.error ? `<p class="auth-error" role="alert">${esc(s.error)}</p>` : ''}
          ${kbutton({ label: f.createAccountBtn, icon: 'check', variant: 'primary', size: 'xl', block: true, attrs: { 'data-act': 'sign-up', 'data-nav-default': '' } })}
          ${divider(f.or)}
          ${this.socialHtml(f.signUpWith)}
          <p class="auth-switch">${esc(f.already)} <button type="button" class="pw-link" data-act="to-login">${esc(f.signIn)}</button></p>
        </form>` })}</div>`;
  }

  private menuHtml(): string {
    const f = F();
    const p = this.game.account.current();
    const name = p && !p.guest ? p.callsign : f.guestPilot;
    const tile = (id: string, primary: boolean, planeKey: string, i: IconName, title: string, sub: string) =>
      `<button type="button" class="menu-tile${primary ? ' primary' : ''}" data-act="${id}"${primary ? ' data-nav-default' : ''}><span class="menu-tile-art">${art(this.game.art(planeKey), 'plane')}</span><span class="menu-tile-title">${icon(i, 'icon pw-icon')}<span>${esc(title)}</span></span><span class="menu-tile-sub">${esc(sub)}</span></button>`;
    return `<div class="front-scene-screen menu-screen">${this.brand()}
      <div class="menu-account">${kchip({ label: name, size: 'hud', afterHtml: '', className: 'menu-who', attrs: { 'aria-label': name } }).replace('<span class="pw-chip-label">', `${avatar({ name: name || '?', colour: team(p?.team ?? 2), size: 's' })}<span class="pw-chip-label">`)}${!p || p.guest ? kbutton({ label: f.signIn, icon: 'logIn', variant: 'primary', size: 'm', attrs: { 'data-act': 'to-login' } }) : ''}</div>
      <nav class="menu-col" aria-label="${esc(f.mainMenu)}">
        <div class="menu-tiles">${tile('solo', true, 'lightning', 'play', f.playSolo, f.vsAi)}${tile('multiplayer', false, 'thug', 'users', f.multiplayer, f.onlineUpTo(8))}</div>
        <div class="menu-grid">
          ${kbutton({ label: f.leaderboard, icon: 'trophy', size: 'l', block: true, attrs: { 'data-act': 'leaderboard' } })}
          ${kbutton({ label: f.achievements, icon: 'award', size: 'l', block: true, attrs: { 'data-act': 'achievements' } })}
          ${kbutton({ label: f.settings, icon: 'sliders', size: 'l', block: true, attrs: { 'data-act': 'settings' } })}
          ${kbutton({ label: f.credits, icon: 'heart', size: 'l', block: true, attrs: { 'data-act': 'credits' } })}
        </div>
      </nav>
      <p class="menu-version">${esc(f.version(this.game.version))}</p></div>`;
  }

  private head(title: string, rightHtml = ''): string {
    return `<header class="screen-head">${kbutton({ label: F().back, icon: 'arrowLeft', size: 's', attrs: { 'data-act': 'back' } })}<h1 class="screen-title">${esc(title)}</h1><span class="screen-head-end">${rightHtml}</span></header>`;
  }

  private paperChip(): string {
    return `<span class="paper-pill" role="status" aria-label="${esc(F().paperLabel(paper(this.game.paper())))}"><span class="paper-pill-icon">${icon('paper', 'icon pw-icon')}</span><b class="num">${esc(fmt(this.game.paper()))}</b></span>`;
  }

  private soloHtml(): string {
    const f = F();
    const s = this.solo;
    const classrooms = CLASSROOMS.map(([id, desks]) => selectCard({ artHtml: deskLayout(desks), title: f.classrooms[id], tag: f.desks(desks), selected: s.classroom === id, attrs: { 'data-pick': 'classroom', 'data-v': id } })).join('');
    const planes = this.game.starters.map((p) => selectCard({ artHtml: art(this.game.art(p.id), 'plane', p.name), title: p.name, tag: p.role, selected: s.plane === p.id, attrs: { 'data-pick': 'plane', 'data-v': p.id } })).join('');
    const diff = kseg({ id: 'difficulty', label: f.difficulty, items: (['easy', 'normal', 'sneaky', 'pet'] as const).map((d) => ({ value: d, label: f.difficulties[d], pressed: s.difficulty === d })) });
    const teams = swatches({ id: 'team', label: f.teamColour, items: Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), name: f.teamName(i + 1), colour: team(i + 1), selected: s.team === i + 1 })) });
    const plane = this.game.starters.find((p) => p.id === s.plane);
    const summary = panel({
      className: 'match-summary', inset: true, label: f.yourMatch,
      bodyHtml: `<h2 class="summary-title">${esc(f.yourMatch)}</h2>
        <div class="summary-rows">${kvRow(f.classroom, esc(f.classrooms[s.classroom]))}${kvRow(f.rivals, esc(f.rivalsValue(s.rivals, f.difficulties[s.difficulty])))}${kvRow(f.plane, esc(plane?.name ?? ''))}${kvRow(f.startingPaper, `${esc(fmt(this.game.paper()))}${icon('paper', 'icon pw-icon')}`)}${kvRow(f.winBy, esc(f.winByValue))}</div>
        ${kbutton({ label: f.start, icon: 'play', variant: 'primary', size: 'xl', block: true, attrs: { 'data-act': 'start-solo', 'data-nav-default': '' } })}`,
    });
    return `<div class="front-sheet pw-panel screen-sheet" data-margin>
      ${this.head(f.playSolo, this.paperChip())}
      <div class="solo-grid">
        <div class="solo-left">
          <section class="setup-section">${sectionLabel(f.classroom)}<div class="cards-3">${classrooms}</div></section>
          <section class="setup-section">${sectionLabel(f.startingPlane)}<div class="cards-4">${planes}</div></section>
          <div class="setup-row">
            <section class="setup-section">${sectionLabel(f.rivals)}${stepper({ id: 'rivals', label: f.rivals, value: s.rivals, min: 1, max: 7, decName: f.fewer, incName: f.more, note: f.max(7) })}</section>
            <section class="setup-section span-2">${sectionLabel(f.difficulty)}${diff}</section>
          </div>
          <section class="setup-section">${sectionLabel(f.teamColour)}${teams}</section>
        </div>
        ${summary}
      </div></div>`;
  }

  private mpHtml(): string {
    const f = F();
    const tabs = ktabs({ id: 'mp-tabs', label: f.multiplayer, tabs: [{ id: 'quick', label: f.quickPlay, selected: this.mpTab === 'quick' }, { id: 'host', label: f.host, selected: this.mpTab === 'host' }, { id: 'join', label: f.join, selected: this.mpTab === 'join' }] });
    const body = this.mpTab === 'quick' ? this.quickHtml() : this.mpTab === 'host' ? this.hostHtml() : this.joinHtml();
    return `<div class="front-sheet pw-panel screen-sheet" data-margin>${this.head(f.multiplayer, tabs)}<div class="mp-body" data-tab="${this.mpTab}">${body}</div></div>`;
  }

  private quickHtml(): string {
    const f = F();
    const q = this.quick;
    const planeRows = this.game.starters.map((p) => selectCard({ row: true, artHtml: art(this.game.art(p.id), 'plane', p.name), title: p.name, tag: p.role, selected: this.mpPlane === p.id, attrs: { 'data-pick': 'mp-plane', 'data-v': p.id } })).join('');
    const regions = kseg({ id: 'region', label: f.region, items: (['auto', 'europe', 'americas', 'asia'] as const).map((r) => ({ value: r, label: f.regions[r], pressed: this.region === r, tip: r === 'auto' || this.game.matchmaking.regions ? undefined : f.regionSoon })) });
    let title = f.finding;
    let line = f.findingLine;
    let actions = kbutton({ label: f.cancel, icon: 'close', size: 's', attrs: { 'data-act': 'cancel-quick' } });
    let chips = `${kchip({ icon: 'clock', value: clock(q.kind === 'finding' ? (performance.now() - q.started) / 1000 : 0), attrs: { 'data-q': 'elapsed' } })}${kchip({ icon: 'wifi', label: this.ping !== null ? f.regionPing(f.regions[this.region], count(this.ping)) : f.regions[this.region] })}`;
    if (q.kind === 'joining') {
      title = f.joining;
      line = f.joiningLine(q.title || f.aClassroom, count(q.players), count(q.capacity));
      actions = kbutton({ label: f.cancel, icon: 'close', size: 's', attrs: { 'data-act': 'cancel-quick' } });
    } else if (q.kind === 'offline') {
      title = f.offline;
      line = f.offlineLine;
      chips = '';
      actions = kbutton({ label: f.retry, icon: 'reset', variant: 'primary', size: 'm', attrs: { 'data-act': 'retry-quick', 'data-nav-default': '' } });
    } else if (q.kind === 'stopped') {
      title = f.ready;
      line = f.findingLine;
      chips = '';
      actions = kbutton({ label: f.findMatch, icon: 'play', variant: 'primary', size: 'm', attrs: { 'data-act': 'retry-quick', 'data-nav-default': '' } });
    }
    const blips = q.kind === 'finding' || q.kind === 'joining'
      ? `<i class="blip" style="--x:24%;--y:32%;--c:${team(1)}"></i><i class="blip" style="--x:72%;--y:24%;--c:${team(4)}"></i><i class="blip" style="--x:74%;--y:70%;--c:${team(6)}"></i>`
      : '';
    return `<div class="quick-grid">
      ${panel({ className: 'quick-panel', inset: true, label: title, bodyHtml: `
        <div class="radar${q.kind === 'finding' ? ' sweeping' : ''}" aria-hidden="true"><span class="radar-sweep"></span><span class="radar-ring r1"></span><span class="radar-ring r2"></span>${blips}<span class="radar-plane">${art(this.game.art(this.mpPlane), 'plane')}</span></div>
        <h2 class="quick-title" role="status">${esc(title)}</h2>
        <p class="quick-line">${esc(line)}</p>
        ${chips ? `<div class="quick-chips">${chips}</div>` : ''}
        <div class="quick-actions">${actions}</div>` })}
      <div class="quick-side">
        <section class="setup-section">${sectionLabel(f.yourPlane)}<div class="plane-rows">${planeRows}</div></section>
        <section class="setup-section">${sectionLabel(f.region)}${regions}</section>
      </div></div>`;
  }

  private hostHtml(): string {
    const f = F();
    const p = this.game.account.current();
    const me = { name: p && !p.guest ? p.callsign : f.you, team: p?.team ?? 2 };
    this.room ??= this.game.rooms.host(me, { ...this.roomSettings });
    const r = this.room;
    const rs = this.roomSettings;
    const classrooms = CLASSROOMS.map(([id, desks]) => selectCard({ title: f.classrooms[id], tag: f.desks(desks), selected: rs.classroom === id, className: 'compact', attrs: { 'data-pick': 'room-classroom', 'data-v': id } })).join('');
    const length = kseg({ id: 'length', label: f.matchLength, items: ([10, 15, 20] as const).map((m) => ({ value: String(m), label: f.minutes(m), pressed: rs.minutes === m })) });
    const slots = r.slots.map((s, i) => {
      if (s.status === 'ai') return `<div class="slot" data-empty><span class="slot-num num">${i + 1}</span><span class="slot-name">${esc(f.aiRival)}</span></div>`;
      const status = s.status === 'host' ? kbadge({ label: f.hostBadge, icon: 'crown', tone: 'gold' }) : s.status === 'ready' ? `<span class="slot-ready" role="img" aria-label="${esc(f.ready)}">${icon('ok', 'icon pw-icon')}</span>` : `<span class="slot-joining">${esc(f.joiningSlot)}</span>`;
      return `<div class="slot"${s.status === 'host' ? ' data-you' : ''}>${avatar({ name: s.name, colour: team(s.team), size: 's' })}<span class="slot-name">${esc(s.name)}</span>${status}</div>`;
    }).join('');
    const humans = r.slots.filter((s) => s.status !== 'ai').length;
    return `<div class="host-grid">
      <div class="host-side">
        <section class="setup-section">${sectionLabel(f.classroom)}<div class="cards-3">${classrooms}</div></section>
        <section class="setup-section">${sectionLabel(f.matchLength)}${length}</section>
        <div class="toggle-rows">
          ${this.toggleRow('fill-ai', f.fillWithAi, rs.fillWithAi)}
          ${this.toggleRow('friends-open', f.friendsWithoutCode, rs.friendsWithoutCode)}
        </div>
      </div>
      ${panel({ className: 'room-panel', inset: true, label: f.roomCode, bodyHtml: `
        <div class="room-head"><div><span class="pw-section">${esc(f.roomCode)}</span><b class="room-code num">${esc(r.code)}</b></div>
          <div class="room-head-actions">${this.game.rooms.available ? '' : kbadge({ label: f.preview, tone: 'warn', tip: f.previewTip })}${kbutton({ label: f.copy, icon: 'copy', size: 's', attrs: { 'data-act': 'copy-code' } })}${kbutton({ label: f.invite, icon: 'userPlus', size: 's', attrs: { 'data-act': 'invite' } })}</div></div>
        <div class="slots">${slots}</div>
        <footer class="room-foot"><span class="room-count"><b class="num">${count(humans)} / ${count(r.slots.length)}</b> ${esc(f.players)}</span>${kbutton({ label: f.closeRoom, icon: 'logOut', size: 's', attrs: { 'data-act': 'close-room' } })}${kbutton({ label: f.startMatch, icon: 'play', variant: 'primary', size: 'm', tip: this.game.rooms.available ? undefined : f.startMatchTip, attrs: { 'data-act': 'start-room', 'data-nav-default': '' } })}</footer>` })}
    </div>`;
  }

  private toggleRow(id: string, label: string, on: boolean): string {
    return `<div class="pw-setting"><span class="pw-setting-label">${esc(label)}</span><span class="pw-setting-control"><button type="button" class="pw-toggle" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-toggle="${id}"><i></i></button></span></div>`;
  }

  private joinHtml(): string {
    const f = F();
    const friends = this.friends.map((fr) => {
      const full = fr.players >= fr.capacity;
      return `<div class="friend-row">${avatar({ name: fr.name, colour: team(fr.team) })}<span class="friend-text"><b>${esc(fr.name)}</b><span>${esc(f.friendRoom(fr.room, count(fr.players), count(fr.capacity)))}</span></span>${full ? kbadge({ label: f.full }) : kbutton({ label: f.join, size: 's', attrs: { 'data-act': 'join-friend', 'data-v': fr.room } })}</div>`;
    }).join('');
    return `<div class="join-grid">
      ${panel({ className: 'join-panel', inset: true, label: f.gotCode, bodyHtml: `
        <h2 class="join-title">${esc(f.gotCode)}</h2><p class="join-line">${esc(f.askHost)}</p>
        <label class="pw-field-label" for="join-code">${esc(f.roomCode)}</label>
        <input class="code-input num" id="join-code" value="${esc(this.joinCode)}" maxlength="11" autocomplete="off" spellcheck="false" placeholder="${esc(f.codePlaceholder)}" aria-describedby="join-help">
        <span class="pw-field-help" id="join-help">${esc(f.codeHelp)}</span>
        ${kbutton({ label: f.joinRoom, icon: 'logIn', variant: 'primary', size: 'xl', block: true, disabled: this.joinCode.replace(/[^A-Za-z0-9]/g, '').length < 6, attrs: { 'data-act': 'join-code', 'data-nav-default': '' } })}` })}
      <section class="friends">${sectionLabel(f.friendsNow)}
        <div class="friend-list">${friends || `<p class="friends-empty">${esc(f.noFriends)}</p>`}
          <div class="friend-row" data-add>${`<span class="pw-avatar add" aria-hidden="true">${icon('userPlus', 'icon pw-icon')}</span>`}<span class="friend-text"><b>${esc(f.addFriend)}</b></span>${kbutton({ label: f.add, size: 's', disabled: !this.game.rooms.available, tip: f.friendsSoon, attrs: { 'data-act': 'add-friend' } })}</div>
        </div></section>
    </div>`;
  }

  private leaderboardHtml(): string {
    const f = F();
    const period = kseg({ id: 'period', label: f.period, items: (['week', 'all', 'friends'] as const).map((p) => ({ value: p, label: f.periods[p], pressed: this.lbPeriod === p })) });
    const rows = this.lbRows;
    const top = [rows.find((r) => r.rank === 2) ?? null, rows.find((r) => r.rank === 1) ?? null, rows.find((r) => r.rank === 3) ?? null];
    const podium = top.map((r, i) => {
      const rank = [2, 1, 3][i];
      return `<div class="podium-col" data-rank="${rank}">
        <span class="podium-plane">${r ? art(r.plane ? this.game.art(r.plane) : null, 'plane') : ''}</span>
        ${r ? avatar({ name: r.name, colour: team(r.team) }) : '<span class="pw-avatar empty" aria-hidden="true"></span>'}
        <b class="podium-name">${esc(r?.name ?? f.emptySpot)}</b><span class="podium-paper num">${r ? `${esc(fmt(r.paper))}${icon('paper', 'icon pw-icon')}` : ''}</span>
        <span class="podium-block num">${rank}</span></div>`;
    }).join('');
    const q = this.lbSearch.trim().toLowerCase();
    const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
    const table = `<table class="ranks" aria-label="${esc(f.rankings)}"><thead><tr><th scope="col">#</th><th scope="col">${esc(f.pilot)}</th><th scope="col" class="n">${esc(f.paperEarned)}</th><th scope="col" class="n">${esc(f.shotDown)}</th><th scope="col" class="n">${esc(f.winRate)}</th></tr></thead><tbody>${list
      .map((r) => `<tr${r.you ? ' data-you' : ''}><td class="num">${count(r.rank)}</td><td><span class="rank-pilot"><i class="pw-dot round" style="--dot:${team(r.team)}"></i>${esc(r.name)}${r.you ? `<span class="you-tag">${esc(f.youTag)}</span>` : ''}</span></td><td class="n num">${esc(fmt(r.paper))}</td><td class="n num">${count(r.kills)}</td><td class="n num">${pct(r.winRate)}</td></tr>`)
      .join('')}</tbody></table>`;
    return `<div class="front-sheet pw-panel screen-sheet" data-margin>${this.head(f.leaderboard, period)}
      <div class="lb-grid">
        <div class="podium-wrap"><div class="podium">${podium}</div><p class="lb-note">${esc(f.resets)}</p></div>
        <div class="lb-right">
          ${field({ id: 'lb-search', label: f.findPilot, value: this.lbSearch, placeholder: f.findPilot, icon: 'search', className: 'lb-search' })}
          ${panel({ className: 'ranks-panel', inset: true, label: f.rankings, bodyHtml: table })}
          <p class="lb-info">${icon('info', 'icon pw-icon')}<span>${esc(this.game.leaderboard.available ? f.rankedBy : f.rankingsSoon)}</span></p>
        </div>
      </div></div>`;
  }

  private achievementsHtml(): string {
    const f = F();
    const all = this.game.achievements();
    const earned = all.filter((a) => a.at !== null).length;
    const list = all.filter((a) => this.achFilter === 'all' || (this.achFilter === 'earned') === (a.at !== null));
    const filters = kseg({ id: 'ach-filter', label: f.filter, items: [
      { value: 'all', label: f.filterAll(count(all.length)), pressed: this.achFilter === 'all' },
      { value: 'earned', label: f.filterEarned(count(earned)), pressed: this.achFilter === 'earned' },
      { value: 'locked', label: f.filterLocked(count(all.length - earned)), pressed: this.achFilter === 'locked' },
    ] });
    const cards = list.map((a) => `<article class="ach-card"${a.at === null ? ' data-locked' : ''} aria-label="${esc(a.title)}">
      <div class="ach-head"><span class="ach-disc">${icon(a.at !== null ? 'award' : 'lock', 'icon pw-icon')}</span><h3 class="ach-title">${esc(a.title)}</h3></div>
      <p class="ach-detail">${esc(a.detail)}</p>
      <p class="ach-status">${a.at !== null ? `${icon('ok', 'icon pw-icon')}<span>${esc(f.unlockedOn(date(a.at)))}</span>` : `${icon('lock', 'icon pw-icon')}<span>${esc(f.locked)}</span>`}</p></article>`).join('');
    const records = this.game.records();
    return `<div class="front-sheet pw-panel screen-sheet" data-margin>${this.head(f.achievements)}
      <div class="ach-bar">${filters}<span class="ach-progress"><b class="num">${count(earned)} / ${count(all.length)}</b>${kmeter({ label: f.achievements, value: all.length ? earned / all.length : 0, segments: 14, hideLabel: true })}</span></div>
      <div class="ach-scroll" data-nav-scroll>
        <div class="ach-grid">${cards || `<p class="friends-empty">${esc(f.nothingHere)}</p>`}</div>
        <section class="records">${sectionLabel(f.records)}<div class="records-rows">${records.map(([k, v]) => kvRow(k, esc(v))).join('')}</div></section>
      </div></div>`;
  }

  private creditsHtml(): string {
    const f = F();
    const c = f.creditsList;
    const group = (title: string, rows: ReadonlyArray<readonly [string, string]>) => `<section class="credit-group"><h2>${esc(title)}</h2><dl>${Object.values(rows).map((r) => Object.values(r) as string[]).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`;
    return `<div class="credits-screen">
      <div class="credits-back">${kbutton({ label: f.back, icon: 'arrowLeft', size: 's', attrs: { 'data-act': 'back', 'data-nav-default': '' } })}</div>
      <span class="credits-plane p1">${art(this.game.art('raptor'), 'plane')}</span><span class="credits-plane p2">${art(this.game.art('ghost'), 'plane')}</span><span class="credits-plane p3">${art(this.game.art('swift'), 'plane')}</span>
      ${panel({ className: 'credits-panel', margin: true, label: f.credits, bodyHtml: `
        <div class="credits-brand"><span class="pw-logo">${icon('send', 'icon pw-icon')}</span><h1 class="credits-name">${esc(f.brand)}</h1><p class="credits-tag">${esc(f.tagline)}</p></div>
        <div class="credits-body" data-nav-scroll>${group(c.madeBy, c.made)}${group(c.builtWith, c.built)}${group(c.fonts, c.type)}</div>` })}
      <p class="credits-foot">${esc(f.creditsFoot(this.game.version))}</p></div>`;
  }

  // ---- Data ------------------------------------------------------------------------------------

  private startQuick(): void {
    this.stopQuick();
    const abort = new AbortController();
    this.quickAbort = abort;
    this.quick = { kind: 'finding', started: performance.now() };
    void this.game.matchmaking.ping(abort.signal).then((ms) => {
      this.ping = ms;
    });
    this.game.matchmaking.find(this.region, abort.signal).then(
      (m) => {
        if (abort.signal.aborted) return;
        this.quick = { kind: 'joining', title: m.title, players: m.players, capacity: m.capacity, id: m.id, at: performance.now() };
        if (this.flow.screen === 'multiplayer') this.redraw();
      },
      () => {
        if (abort.signal.aborted) return;
        this.quick = { kind: 'offline' };
        if (this.flow.screen === 'multiplayer') this.redraw();
      },
    );
  }

  private stopQuick(): void {
    this.quickAbort?.abort();
    this.quickAbort = null;
    this.quick = { kind: 'stopped' };
  }

  private loadLeaderboard(): void {
    const p = this.game.account.current();
    const me = this.game.me();
    void this.game.leaderboard.rows(this.lbPeriod, { name: p && !p.guest ? p.callsign : F().you, team: p?.team ?? 2, ...me }).then((rows) => {
      this.lbRows = rows;
      if (this.flow.screen === 'leaderboard') this.redraw();
    });
  }

  private loadFriends(): void {
    void this.game.rooms.friends().then((list) => {
      this.friends = list;
      if (this.flow.screen === 'multiplayer' && this.mpTab === 'join') this.redraw();
    });
  }

  // ---- Events ------------------------------------------------------------------------------------

  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    switch (t.id) {
      case 'login-email':
        this.login.email = t.value;
        return;
      case 'login-password':
        this.login.password = t.value;
        return;
      case 'login-keep':
        this.login.keep = t.checked;
        return;
      case 'signup-callsign':
        this.signup.callsign = t.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
        this.signup.touched.callsign = this.signup.callsign.length >= 3 || this.signup.touched.callsign;
        this.redraw();
        return;
      case 'signup-email':
        this.signup.email = t.value;
        this.signup.touched.email = this.signup.touched.email || /@.*\./.test(t.value) || this.signup.email.includes('@');
        this.redraw();
        return;
      case 'signup-password':
        this.signup.password = t.value;
        this.redraw();
        return;
      case 'signup-agree':
        this.signup.agree = t.checked;
        return;
      case 'join-code': {
        const raw = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
        this.joinCode = raw.length > 3 ? `${raw.slice(0, raw.length > 6 ? 5 : 3)}-${raw.slice(raw.length > 6 ? 5 : 3)}` : raw;
        this.redraw();
        return;
      }
      case 'lb-search':
        this.lbSearch = t.value;
        this.redraw();
        return;
    }
  }

  private click(e: Event): void {
    const t = e.target as Element;
    const pick = t.closest<HTMLElement>('[data-pick]');
    if (pick && !(pick as HTMLButtonElement).disabled) return this.picked(pick.dataset.pick!, pick.dataset.v!);
    const tab = t.closest<HTMLElement>('[role="tab"][data-tab]');
    if (tab && this.flow.screen === 'multiplayer') {
      const next = tab.dataset.tab as MpTab;
      if (next === this.mpTab) return;
      this.mpTab = next;
      if (next !== 'quick') this.stopQuick();
      this.draw();
      if (next === 'quick') this.startQuick();
      if (next === 'join') this.loadFriends();
      this.redraw();
      return;
    }
    const seg = t.closest<HTMLButtonElement>('[data-seg] > button[data-v]');
    if (seg && !seg.disabled) return this.segment(seg.parentElement!.dataset.seg!, seg.dataset.v!);
    const step = t.closest<HTMLButtonElement>('[data-step]');
    if (step && !step.disabled) {
      this.solo.rivals = Math.min(7, Math.max(1, this.solo.rivals + Number(step.dataset.step)));
      this.saveSolo();
      return this.redraw();
    }
    const sw = t.closest<HTMLElement>('[data-toggle]');
    if (sw) {
      if (sw.dataset.toggle === 'fill-ai') this.roomSettings.fillWithAi = !this.roomSettings.fillWithAi;
      if (sw.dataset.toggle === 'friends-open') this.roomSettings.friendsWithoutCode = !this.roomSettings.friendsWithoutCode;
      return this.redraw();
    }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (t.closest('a[href="#"]')) e.preventDefault();
    this.action(act, t.closest<HTMLElement>('[data-act]')!);
  }

  private picked(kind: string, v: string): void {
    if (kind === 'classroom') this.solo.classroom = v as SoloSetup['classroom'];
    else if (kind === 'plane') this.solo.plane = v as AircraftId;
    else if (kind === 'mp-plane') this.mpPlane = v as AircraftId;
    else if (kind === 'room-classroom') this.roomSettings.classroom = v;
    this.saveSolo();
    this.redraw();
  }

  private segment(id: string, v: string): void {
    switch (id) {
      case 'difficulty':
        this.solo.difficulty = v as SoloSetup['difficulty'];
        break;
      case 'team':
        this.solo.team = Number(v);
        this.game.account.setTeam?.(this.solo.team);
        break;
      case 'region':
        this.region = v as Region;
        if (this.quick.kind === 'finding') this.startQuick();
        break;
      case 'length':
        this.roomSettings.minutes = Number(v) as 10 | 15 | 20;
        break;
      case 'period':
        this.lbPeriod = v as LeaderboardPeriod;
        this.loadLeaderboard();
        break;
      case 'ach-filter':
        this.achFilter = v as 'all' | 'earned' | 'locked';
        break;
    }
    this.saveSolo();
    this.redraw();
  }

  private saveSolo(): void {
    try {
      window.localStorage.setItem(SOLO_KEY, JSON.stringify(this.solo));
    } catch {
      /* private mode */
    }
  }

  private action(act: string, el: HTMLElement): void {
    const acc = this.game.account;
    switch (act) {
      case 'back':
        this.back();
        return;
      case 'toggle-password':
        if (this.flow.screen === 'login') this.login.show = !this.login.show;
        else this.signup.show = !this.signup.show;
        this.redraw();
        document.getElementById(this.flow.screen === 'login' ? 'login-password' : 'signup-password')?.focus();
        return;
      case 'forgot':
        void acc.requestPasswordReset(this.login.email).then((sent) => {
          this.login.error = sent ? '' : 'reset';
          this.redraw();
        });
        return;
      case 'sign-in':
        void acc.signIn(this.login.email, this.login.password, this.login.keep).then((r) => {
          if (r.ok) {
            this.login = { ...this.login, password: '', error: '' };
            this.flow.go('menu');
          } else {
            this.login.error = r.problem === 'email' ? 'email' : r.problem === 'password' ? 'password' : 'unknown';
            this.redraw();
          }
        });
        return;
      case 'guest':
        acc.continueAsGuest();
        this.flow.go('menu');
        return;
      case 'to-signup':
        this.socialNote = '';
        this.flow.go('signup');
        return;
      case 'to-login':
        this.socialNote = '';
        this.flow.go('login');
        return;
      case 'social': {
        const f = F();
        const id = el.dataset.social as SocialProvider | undefined;
        this.socialNote = id === 'google' ? f.google : id === 'github' ? f.github : id === 'discord' ? f.discord : '';
        this.redraw();
        return;
      }
      case 'sign-up': {
        const s = this.signup;
        s.touched = { callsign: true, email: true, password: true };
        if (!s.agree) {
          s.error = F().errors.terms;
          this.redraw();
          return;
        }
        void acc.signUp(s.callsign, s.email.trim(), s.password).then((r) => {
          if (r.ok) {
            this.signup = { callsign: '', email: '', password: '', show: false, agree: false, touched: { callsign: false, email: false, password: false }, error: '' };
            this.flow.go('menu');
          } else {
            s.error = r.problem === 'terms' ? F().errors.terms : '';
            this.redraw();
          }
        });
        return;
      }
      case 'terms':
      case 'privacy':
        return;
      case 'solo':
      case 'multiplayer':
      case 'leaderboard':
      case 'achievements':
      case 'credits':
        this.flow.go(act);
        return;
      case 'settings':
        this.flow.openSettings('game', 'menu');
        return;
      case 'start-solo':
        this.saveSolo();
        this.game.startSolo({ ...this.solo });
        return;
      case 'cancel-quick':
        this.stopQuick();
        this.redraw();
        return;
      case 'retry-quick':
        this.startQuick();
        this.redraw();
        return;
      case 'copy-code':
        void navigator.clipboard?.writeText(this.room?.code ?? '').catch(() => {});
        el.dataset.done = '';
        return;
      case 'invite': {
        const code = this.room?.code ?? '';
        const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
        if (nav.share) void nav.share({ title: F().brand, text: F().inviteText(code) }).catch(() => {});
        else void navigator.clipboard?.writeText(F().inviteText(code)).catch(() => {});
        return;
      }
      case 'close-room':
        this.room = null;
        this.mpTab = 'quick';
        this.draw();
        this.startQuick();
        this.redraw();
        return;
      case 'start-room':
        // Private rooms are not on the server yet: the match starts through matchmaking.
        this.game.goMultiplayer({ quick: '1', plane: this.mpPlane });
        return;
      case 'join-code':
        this.game.goMultiplayer({ quick: '1', invite: this.joinCode.replace(/[^A-Z0-9]/g, ''), plane: this.mpPlane });
        return;
      case 'join-friend':
        this.game.goMultiplayer({ session: el.dataset.v ?? '', plane: this.mpPlane });
        return;
    }
  }

  /** Settings from Pause (the match is paused under it). */
  openSettings(tab: SettingsTab): void {
    this.flow.openSettings(tab, 'pause');
  }
}

export type { Profile };

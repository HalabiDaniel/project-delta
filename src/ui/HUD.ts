import type { RaidReport } from '../base/Raids';
import { bind } from '../input/bindings';
import { AirHud } from './AirHud';
import { Alerts, Tips, type AlertOptions, type AlertTone } from './Alerts';
import { ConfirmDialog, glyph } from './components';
import { guardActions, installConfirmDialog } from './confirm';
import { RaidHud } from './BaseHud';
import { esc, toggle, type ScreenPoint } from './dom';
import type { IconName } from './icons';
import { MiniMap, miniMapFrame } from './MiniMap';
import { T } from './strings';
import { ThreatHud } from './ThreatHud';
import type { HudActions, HudView } from './views';
import { WorldLabels } from './WorldLabels';
import { accessTokens, DEFAULT_ACCESS, captionsShown, type AccessSettings } from './access';
import { Captions } from './Captions';
import { applyLayout, layoutFor } from './layout';
import type { SoundName } from './Sounds';
import { applyTokens } from './tokens';
import { DeskHud } from './hud/DeskHud';
import { FlightHud } from './hud/FlightHud';
import { CoachMarks, PauseMenu, ResultPanel, Toasts } from './hud/Overlays';
import type { DeskState, SettingsTab } from './flow';
import type { KitTone } from './kit';
import './hud.css';
// The design system's shared rules: the focus ring, the focus tooltip, reduced motion, components.
import './components.css';
import './hud/hud2.css';

export type { ScreenPoint } from './dom';
export type * from './views';
export type { AlertTone } from './Alerts';

/** The fixed zones (see the class comment). `right` holds the drawers and the build inspector. */
export type HudZone = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br' | 'centre' | 'right';

/** The multiplayer game (?mp, ?invite) shares the HUD; Reset becomes Leave classroom there. */
const MULTIPLAYER = typeof window !== 'undefined' && ['mp', 'invite'].some((k) => new URLSearchParams(window.location.search).has(k));

/**
 * How much of a fight the player is in, from the threat and air views: 0 calm, 1 something is
 * tracking or attacking, 2 under fire or locked. In a fight (1+) the less urgent panels step back
 * (lower opacity, smaller) and return after it (plan v0.0.15 §3C); critical warnings never do.
 */
export function combatLevel(v: Pick<HudView, 'phase' | 'paused' | 'threat' | 'air'>): 0 | 1 | 2 {
  if (v.phase !== 'flying' || v.paused) return 0;
  const t = v.threat;
  const firing = !!t && (t.lock !== null || t.panel?.status === 'engaged' || t.ring.some((r) => r.state === 'firing' || r.state === 'incoming' || r.state === 'locking'));
  if (firing) return 2;
  const attacked = !!v.air?.markers.some((m) => m.attacking);
  if (attacked || (t !== null && t.ring.length > 0)) return 1;
  return 0;
}

/** Sets the de-emphasis classes on the HUD root: `combat` in any fight, `combat-hot` under fire. */
export function applyCombat(root: HTMLElement, level: 0 | 1 | 2): void {
  root.classList.toggle('combat', level > 0);
  root.classList.toggle('combat-hot', level === 2);
}

/** What the multiplayer layer adds to the status bar. */
export interface MatchStatus {
  players: number;
  maxPlayers: number;
  sessionLeft: number | null;
}

/**
 * The match HUD (v0.0.16, after the approved design canvas). Every edge element sits on one safe
 * margin, clamp(16px, 2vw, 32px), from the window or from the centred 16:9 area ("16:9 HUD"); top
 * widgets share one top line and bottom widgets one bottom line.
 *   desk     top bar (tl), Menu (tr), the dock (bc), drawers and the build inspector (right), the
 *            build tray over the dock (bc) — src/ui/hud/DeskHud.ts
 *   flight   mission card (tl), alert slot (tc), status bar and kill feed (tr), plane card (bl),
 *            action tiles (bc), mini-map (br) — src/ui/hud/FlightHud.ts
 *   overlays the result card, Pause (with Settings over the match), the session drawer, toasts and
 *            the tutorial's coach marks — src/ui/hud/Overlays.ts
 * The centre 40% of the screen stays clear in flight. Each module draws its own part from the view.
 */
export class HUD {
  private readonly world: WorldLabels;
  private readonly raids: RaidHud;
  private readonly alerts: Alerts;
  private readonly tips: Tips;
  private readonly minimap: MiniMap;
  private readonly threats: ThreatHud;
  private readonly air: AirHud;
  private readonly desk: DeskHud;
  private readonly flight: FlightHud;
  private readonly result: ResultPanel;
  private readonly pause: PauseMenu;
  private readonly coach: CoachMarks;
  private readonly toasts: Toasts;
  private readonly zones: Record<HudZone, HTMLElement>;
  private readonly flash: HTMLElement;
  private readonly lockHint: HTMLElement;
  private readonly captions: Captions;
  /** Keep the zones in a 16:9 area on ultrawide screens (an accessibility setting). */
  private safeArea = DEFAULT_ACCESS.safeArea;
  private accessKey = '';
  private lastRender = performance.now();
  private lastView: HudView | null = null;
  /** Multiplayer's players and session clock, for the status bar. */
  matchStatus: MatchStatus | null = null;
  /** The confirm dialog for destructive actions (src/ui/confirm.ts). */
  readonly confirmDialog: ConfirmDialog;
  /** The actions with End sortie, Reset / Leave and Abandon behind the confirm dialog (for keyboard shortcuts too). */
  readonly guarded: HudActions;

  constructor(
    readonly root: HTMLElement,
    rawActions: HudActions,
  ) {
    root.classList.add('hud');
    this.confirmDialog = new ConfirmDialog(document.body);
    installConfirmDialog(this.confirmDialog);
    // End sortie, Reset / Leave and Abandon ask first, in single-player and multiplayer alike.
    const actions = guardActions(rawActions, { multiplayer: MULTIPLAYER, view: () => this.lastView });
    this.guarded = actions;
    const layer = div(root, 'world-layer');
    this.flash = div(root, 'damage-flash');
    const zone = (name: string) => div(root, `zone zone-${name}`);
    this.zones = { tl: zone('tl'), tc: zone('tc'), tr: zone('tr'), bl: zone('bl'), bc: zone('bc'), br: zone('br'), centre: zone('centre'), right: zone('right') };
    this.world = new WorldLabels(layer);
    this.air = new AirHud(layer);
    this.threats = new ThreatHud(layer, this.zones.tc);
    this.raids = new RaidHud(this.zones.tc);
    this.toasts = new Toasts(this.zones.tc);
    this.alerts = new Alerts(this.zones.tc);
    this.tips = new Tips(this.zones.tc);
    this.desk = new DeskHud({ tl: this.zones.tl, tr: this.zones.tr, bc: this.zones.bc, right: this.zones.right, world: layer }, actions);
    this.flight = new FlightHud(
      { tl: this.zones.tl, tc: this.zones.tc, tr: this.zones.tr, bl: this.zones.bl, bc: this.zones.bc },
      actions,
      (i, text, tone) => this.toasts.show(i, text, tone),
    );
    // The mini-map, bottom right: round, with a rim, N, the desk you are over and zoom inside the rim.
    this.minimap = new MiniMap(miniMapFrame(this.zones.br));
    this.result = new ResultPanel(root, actions.continueToDesk);
    this.pause = new PauseMenu(root, this.zones.right, actions);
    // Sound captions, above the action tiles.
    this.captions = new Captions(this.zones.bc);
    this.coach = new CoachMarks(root, actions.skipTutorial);
    window.addEventListener('resize', () => this.fit());
    this.fit();
    // Reduced motion on "auto" follows the system setting, also when it changes.
    window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => {
      this.accessKey = '';
    });
    this.lockHint = div(root, 'hint lock-hint');
    this.lockHint.innerHTML = `${glyph({ key: bind('back').key })}<span>${esc(T.hud.lockClick)}</span>`;
    this.lockHint.dataset.tip = T.hud.lockTip;
  }

  /** Lays the zones and overlays out for the window (src/ui/layout.ts). */
  private fit(): void {
    applyLayout(document.documentElement, layoutFor(window.innerWidth, window.innerHeight, { safeArea: this.safeArea }));
  }

  /**
   * The accessibility settings, live: palette, text size, contrast and motion through the tokens,
   * the 16:9 safe area, and whether sound captions show (`muted`: auto shows them while it is off).
   */
  setAccess(s: AccessSettings, muted: boolean): void {
    const key = `${JSON.stringify(s)}|${muted}`;
    if (key === this.accessKey) return;
    this.accessKey = key;
    applyTokens(document.documentElement, accessTokens(s));
    this.captions.enabled = captionsShown(s.captions, muted);
    if (s.safeArea !== this.safeArea) {
      this.safeArea = s.safeArea;
      this.fit();
    }
  }

  /** The cards' art (plane and building thumbnails). */
  setArt(fn: (key: string) => string | null): void {
    this.desk.setArt(fn);
  }

  /** A sound played: its caption, when captions are on (Sounds.onCue). */
  caption(name: SoundName, angle: number | null = null): void {
    this.captions.sound(name, angle);
  }

  // ---- Desk states and overlays (keys from the game) ---------------------------------------------

  /** The desk state the dock shows. */
  deskState(): DeskState {
    return this.lastView ? this.desk.state(this.lastView) : 'idle';
  }

  /** H / Tab (and 1–3, Q / E with `toggle` false): open the Hangar or Missions drawer. */
  openDesk(panel: 'hangar' | 'missions', toggleIt = true): void {
    this.desk.open(panel, toggleIt);
  }

  /** L: the session drawer. */
  toggleSession(): void {
    this.pause.toggleSession();
  }

  /** Esc: closes Settings, a drawer or the session drawer first. True when something closed. */
  back(): boolean {
    if (this.pause.closeSettings()) return true;
    if (this.pause.isSessionOpen) {
      this.pause.toggleSession(false);
      return true;
    }
    return this.desk.close();
  }

  /** Settings opened over the match (Pause → Settings / Controls). */
  openSettings(tab: SettingsTab): void {
    this.pause.openSettings(tab);
  }

  get settingsOpen(): boolean {
    return this.pause.isSettingsOpen;
  }

  render(v: HudView): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.lastView = v;
    const flying = v.phase === 'flying' && !v.paused;
    this.root.classList.toggle('in-flight', flying);
    this.root.classList.toggle('base-mode', v.baseMode);
    this.root.classList.toggle('hints', v.hints);
    this.root.classList.toggle('paused', v.paused);
    this.root.dataset.desk = this.desk.state(v);
    this.root.classList.toggle('drawer-open', this.desk.drawerOpen || this.pause.isSessionOpen || (v.baseMode && v.base?.inspector != null));
    this.setAccess(v.menu.settings.access, v.menu.settings.muted);
    // In a fight, the less urgent parts of the HUD step back.
    applyCombat(this.root, combatLevel(v));

    this.desk.render(v);
    this.flight.render(v, this.matchStatus);
    this.result.render(v.result, v.paused);
    this.raids.render(v.paused ? null : v.raid, v.paused);
    this.pause.render(v);
    this.world.render(v);
    this.threats.render(flying ? v.threat : null);
    this.air.render(v.paused ? null : v.air);
    this.minimap.render(v.minimap, dt);
    toggle(this.zones.br, (v.phase === 'flying' || v.phase === 'landed') && !v.paused && v.result === null && !v.baseMode);
    this.alerts.update();
    this.tips.update();
    this.captions.update();
    this.coach.render(v);
    toggle(this.lockHint, flying && !v.pointerLocked);
  }

  /** A short note: a toast, top centre (critical ones keep the alert queue's priority). */
  alert(iconName: IconName, title: string, value: string | null, tone: AlertTone, seconds?: number, opts?: AlertOptions): void {
    if (opts?.critical) {
      this.alerts.show(iconName, title, value, tone, seconds, opts);
      return;
    }
    const kit: KitTone = tone === 'good' ? 'good' : tone === 'bad' ? 'hostile' : tone === 'warn' ? 'warn' : 'plain';
    this.toasts.show(iconName, title, kit, value ?? undefined);
  }

  /** A first-time tip (only when the tutorial is not running: one note at a time). */
  tip(text: string, keys: string[] = []): void {
    if (this.lastView?.tutorial) return;
    this.tips.show(text, keys);
  }

  raidReport(report: RaidReport): void {
    this.raids.showReport(report);
  }

  paperDelta(delta: number): void {
    this.desk.delta(delta);
    this.flight.delta(delta);
  }

  pop(word: string, tone: 'good' | 'bad' | 'info', at: ScreenPoint): void {
    this.world.pop(word, tone, at);
  }

  damageNumber(amount: number, at: ScreenPoint, kill = false): void {
    this.world.damageNumber(amount, at, kill);
  }

  hitMarker(kill: boolean): void {
    this.world.hitMarker(kill);
  }

  damageDirection(angle: number, amount: number): void {
    this.threats.damageDirection(angle, amount);
  }

  threatNote(message: string, tone: 'good' | 'bad' | 'info'): void {
    this.threats.note(message, tone);
  }

  damageFlash(amount: number): void {
    const el = this.flash;
    el.style.setProperty('--strength', String(Math.min(1, 0.35 + amount / 60)));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /**
   * One of the fixed zones, for panels added from outside the HUD (the multiplayer layer): what
   * goes in a zone scales with the HUD size and the window, from that zone's corner.
   */
  zone(name: HudZone): HTMLElement {
    return this.zones[name];
  }

  /** HUD size (0.9 / 1 / 1.15): every zone scales from its own corner. */
  setScale(scale: number): void {
    this.root.style.setProperty('--ui-scale', String(scale));
  }
}

function div(parent: HTMLElement, className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  parent.appendChild(el);
  return el;
}

/**
 * The screen flow (v0.0.16): which screen is up, and where Back goes.
 *
 *   boot → login (or straight to the main menu when a session or guest profile exists)
 *   login ⇄ signup → menu
 *   menu → solo (setup) → match · multiplayer · leaderboard · achievements · settings · credits
 *   match: desk (idle, build, hangar, missions) → flight → result → desk; pause over desk or flight
 *
 * Pure: no DOM. The front end (src/ui/screens/Frontend.ts) renders `screen`; the game asks
 * `inMatch` to decide whether to simulate. Esc / the controller's Start goes `back()` on menu
 * screens; in a match the game opens Pause instead.
 */

export type Screen =
  | 'boot'
  | 'login'
  | 'signup'
  | 'menu'
  | 'solo'
  | 'multiplayer'
  | 'leaderboard'
  | 'achievements'
  | 'settings'
  | 'credits'
  | 'match';

/** The in-match desk states (the HUD's dock). */
export type DeskState = 'idle' | 'build' | 'hangar' | 'missions';

/** Settings tabs (also opened from Pause on the matching tab). */
export type SettingsTab = 'game' | 'sound' | 'accessibility' | 'controls' | 'account';

/** Where Back goes from each screen. Settings goes back to where it was opened from. */
const PARENT: Readonly<Record<Screen, Screen | null>> = {
  boot: null,
  login: null,
  signup: 'login',
  menu: null,
  solo: 'menu',
  multiplayer: 'menu',
  leaderboard: 'menu',
  achievements: 'menu',
  settings: 'menu',
  credits: 'menu',
  match: null,
};

export interface FlowState {
  screen: Screen;
  /** Settings opened over a paused match returns there. */
  settingsFrom: Screen | 'pause';
  settingsTab: SettingsTab;
  /** A screen opened from a match (Achievements from the session drawer) goes back to it. */
  returnTo: Screen | null;
}

export class Flow {
  private s: FlowState = { screen: 'boot', settingsFrom: 'menu', settingsTab: 'game', returnTo: null };
  private readonly listeners = new Set<(s: FlowState, prev: Screen) => void>();

  get screen(): Screen {
    return this.s.screen;
  }

  get state(): Readonly<FlowState> {
    return this.s;
  }

  /** The game runs (and the HUD shows) only in a match. */
  get inMatch(): boolean {
    return this.s.screen === 'match';
  }

  /** Booted: to the main menu when someone is signed in or a guest profile exists, else to Login. */
  booted(hasProfile: boolean): void {
    this.go(hasProfile ? 'menu' : 'login');
  }

  go(screen: Screen, returnTo: Screen | null = null): void {
    if (screen === this.s.screen) return;
    const prev = this.s.screen;
    this.s = { ...this.s, screen, returnTo };
    for (const l of this.listeners) l(this.s, prev);
  }

  openSettings(tab: SettingsTab = 'game', from: Screen | 'pause' = this.s.screen): void {
    this.s = { ...this.s, settingsTab: tab, settingsFrom: from };
    if (this.s.screen === 'settings') {
      for (const l of this.listeners) l(this.s, 'settings');
      return;
    }
    this.go('settings');
  }

  setSettingsTab(tab: SettingsTab): void {
    this.s = { ...this.s, settingsTab: tab };
  }

  /** One level back. Returns false when there is nowhere to go (Login, the main menu, a match). */
  back(): boolean {
    const here = this.s.screen;
    if (here === 'settings') {
      const from = this.s.settingsFrom;
      this.go(from === 'pause' ? 'match' : from);
      return true;
    }
    if (this.s.returnTo) {
      this.go(this.s.returnTo);
      return true;
    }
    const parent = PARENT[here];
    if (!parent) return false;
    this.go(parent);
    return true;
  }

  onChange(fn: (s: FlowState, prev: Screen) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

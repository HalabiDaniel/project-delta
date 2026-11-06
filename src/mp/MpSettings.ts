import { UI_SCALES } from '../systems/SaveGame';
import type { HintMode } from '../ui/views';

/**
 * Multiplayer's own interface settings (v0.0.15 phase 5): the HUD size and the key hints, kept in
 * this browser next to the other `paperwars.mp.*` keys. Single-player keeps the same two in its
 * save (SaveGame `settings.hints` / `settings.uiScale`); the server keeps neither, so a player's
 * choice survives a reload and a new session without a protocol change.
 */
export const MP_SETTINGS_KEY = 'paperwars.mp.settings';

export interface MpSettings {
  hints: HintMode;
  /** One of UI_SCALES (S / M / L = 0.9 / 1 / 1.15). */
  uiScale: number;
}

export const DEFAULT_MP_SETTINGS: Readonly<MpSettings> = { hints: 'auto', uiScale: 1 };

const HINT_MODES: readonly HintMode[] = ['auto', 'on', 'off'];

/** Only what we recognise: an unknown hint mode or HUD size falls back to the default. */
export function normaliseMpSettings(raw: unknown): MpSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    hints: HINT_MODES.includes(o.hints as HintMode) ? (o.hints as HintMode) : DEFAULT_MP_SETTINGS.hints,
    uiScale: UI_SCALES.includes(o.uiScale as number) ? (o.uiScale as number) : DEFAULT_MP_SETTINGS.uiScale,
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadMpSettings(store: Store | null = defaultStore()): MpSettings {
  try {
    const text = store?.getItem(MP_SETTINGS_KEY);
    return normaliseMpSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_MP_SETTINGS };
  }
}

export function saveMpSettings(settings: MpSettings, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(MP_SETTINGS_KEY, JSON.stringify(normaliseMpSettings(settings)));
  } catch {
    // Private browsing or a full store: the setting lasts until the page closes.
  }
}

/** Key hints in multiplayer: always, never (H still shows them while held), or for a new player's first missions. */
export function hintsShown(mode: HintMode, held: boolean, firstMissions: boolean): boolean {
  if (held || mode === 'on') return true;
  if (mode === 'off') return false;
  return firstMissions;
}

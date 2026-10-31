import type { OutlineQuality } from './outline/OutlineRenderer';

/**
 * Graphics settings. They belong to the computer, not to the player's progress: they live in
 * their own local-storage entry, survive a progress reset and never travel with a save.
 *
 * A preset sets everything at once; changing the outlines afterwards keeps the rest of the preset.
 */
export type GraphicsPreset = 'low' | 'medium' | 'high';
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];

export type ShadowLevel = 'off' | 'low' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  /** Pencil outlines on or off, and how detailed. */
  outlines: boolean;
  outlineQuality: OutlineQuality;
  /** Stroke opacity: 0.6 faint, 1 normal, 1.4 bold. */
  outlineIntensity: number;
  shadows: ShadowLevel;
  /** How many decorations the territories show (1 few … 3 all). */
  detail: 1 | 2 | 3;
  /** Highest device pixels per CSS pixel the game renders at (lower is faster on big screens). */
  resolution: number;
}

export const OUTLINE_INTENSITIES: readonly number[] = [0.6, 1, 1.4];

type PresetValues = Omit<GraphicsSettings, 'preset' | 'outlineIntensity'>;

export const PRESETS: Record<GraphicsPreset, PresetValues> = {
  low: { outlines: true, outlineQuality: 'low', shadows: 'off', detail: 1, resolution: 1 },
  medium: { outlines: true, outlineQuality: 'medium', shadows: 'low', detail: 2, resolution: 1.5 },
  high: { outlines: true, outlineQuality: 'high', shadows: 'high', detail: 3, resolution: 2 },
};

/** Shadow map size per level (0 = no shadows). */
export const SHADOW_RESOLUTION: Record<ShadowLevel, number> = { off: 0, low: 1024, high: 2048 };

export const DEFAULT_GRAPHICS: GraphicsSettings = { preset: 'high', ...PRESETS.high, outlineIntensity: 1 };

/** Switches to a preset, keeping the player's outline intensity. */
export function withPreset(current: GraphicsSettings, preset: GraphicsPreset): GraphicsSettings {
  return { ...current, preset, ...PRESETS[preset] };
}

/** The outline choice in the menu: off, or one of the qualities. */
export type OutlineChoice = 'off' | OutlineQuality;

export function withOutlines(current: GraphicsSettings, choice: OutlineChoice): GraphicsSettings {
  return choice === 'off' ? { ...current, outlines: false } : { ...current, outlines: true, outlineQuality: choice };
}

export function outlineChoice(s: GraphicsSettings): OutlineChoice {
  return s.outlines ? s.outlineQuality : 'off';
}

export function withIntensity(current: GraphicsSettings, intensity: number): GraphicsSettings {
  return { ...current, outlineIntensity: nearest(intensity, OUTLINE_INTENSITIES) };
}

/** Does every value still match the preset (the menu marks it as chosen)? */
export function matchesPreset(s: GraphicsSettings): boolean {
  const p = PRESETS[s.preset];
  return s.outlines === p.outlines && s.outlineQuality === p.outlineQuality && s.shadows === p.shadows && s.detail === p.detail && s.resolution === p.resolution;
}

/** Anything read from storage, made safe: unknown or damaged values fall back to the defaults. */
export function normalizeGraphics(raw: unknown): GraphicsSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GRAPHICS };
  const r = raw as Record<string, unknown>;
  const preset = GRAPHICS_PRESETS.includes(r.preset as GraphicsPreset) ? (r.preset as GraphicsPreset) : DEFAULT_GRAPHICS.preset;
  const base = { preset, ...PRESETS[preset], outlineIntensity: DEFAULT_GRAPHICS.outlineIntensity };
  const qualities: readonly OutlineQuality[] = ['low', 'medium', 'high'];
  const shadows: readonly ShadowLevel[] = ['off', 'low', 'high'];
  return {
    preset,
    outlines: typeof r.outlines === 'boolean' ? r.outlines : base.outlines,
    outlineQuality: qualities.includes(r.outlineQuality as OutlineQuality) ? (r.outlineQuality as OutlineQuality) : base.outlineQuality,
    outlineIntensity: typeof r.outlineIntensity === 'number' && Number.isFinite(r.outlineIntensity) ? nearest(r.outlineIntensity, OUTLINE_INTENSITIES) : base.outlineIntensity,
    shadows: shadows.includes(r.shadows as ShadowLevel) ? (r.shadows as ShadowLevel) : base.shadows,
    detail: r.detail === 1 || r.detail === 2 || r.detail === 3 ? r.detail : base.detail,
    resolution: typeof r.resolution === 'number' && Number.isFinite(r.resolution) ? Math.min(3, Math.max(0.5, r.resolution)) : base.resolution,
  };
}

const KEY = 'paperwars.graphics';

/** Reads the settings; missing or blocked storage gives the defaults. */
export function loadGraphics(storage: Pick<Storage, 'getItem'> | null): GraphicsSettings {
  try {
    const text = storage?.getItem(KEY);
    return normalizeGraphics(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

export function saveGraphics(storage: Pick<Storage, 'setItem'> | null, settings: GraphicsSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the settings last for this visit.
  }
}

/** The browser's local storage, or null where it is blocked. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function nearest(value: number, options: readonly number[]): number {
  return options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), options[0]);
}

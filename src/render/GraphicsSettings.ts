/**
 * Graphics settings. They belong to the computer, not to the player's progress: they live in
 * their own local-storage entry, survive a progress reset and never travel with a save.
 *
 * A preset sets everything at once.
 */
export type GraphicsPreset = 'low' | 'medium' | 'high';
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];

export type ShadowLevel = 'off' | 'low' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  shadows: ShadowLevel;
  /** How many decorations the territories show (1 few … 3 all). */
  detail: 1 | 2 | 3;
  /** Highest device pixels per CSS pixel the game renders at (lower is faster on big screens). */
  resolution: number;
}

type PresetValues = Omit<GraphicsSettings, 'preset'>;

export const PRESETS: Record<GraphicsPreset, PresetValues> = {
  low: { shadows: 'off', detail: 1, resolution: 1 },
  medium: { shadows: 'low', detail: 2, resolution: 1.5 },
  high: { shadows: 'high', detail: 3, resolution: 2 },
};

/** Shadow map size per level (0 = no shadows). */
export const SHADOW_RESOLUTION: Record<ShadowLevel, number> = { off: 0, low: 1024, high: 2048 };

/** Medium since v0.0.15: safer on laptops. Saved settings keep their own preset. */
export const DEFAULT_GRAPHICS: GraphicsSettings = { preset: 'medium', ...PRESETS.medium };

/** Switches to a preset. */
export function withPreset(current: GraphicsSettings, preset: GraphicsPreset): GraphicsSettings {
  return { ...current, preset, ...PRESETS[preset] };
}

/** Does every value still match the preset (the menu marks it as chosen)? */
export function matchesPreset(s: GraphicsSettings): boolean {
  const p = PRESETS[s.preset];
  return s.shadows === p.shadows && s.detail === p.detail && s.resolution === p.resolution;
}

/**
 * Anything read from storage, made safe: unknown or damaged values fall back to the defaults.
 * Settings saved before v0.0.15 may still hold the removed outline fields; they are ignored.
 */
export function normalizeGraphics(raw: unknown): GraphicsSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GRAPHICS };
  const r = raw as Record<string, unknown>;
  const preset = GRAPHICS_PRESETS.includes(r.preset as GraphicsPreset) ? (r.preset as GraphicsPreset) : DEFAULT_GRAPHICS.preset;
  const base = { preset, ...PRESETS[preset] };
  const shadows: readonly ShadowLevel[] = ['off', 'low', 'high'];
  return {
    preset,
    shadows: shadows.includes(r.shadows as ShadowLevel) ? (r.shadows as ShadowLevel) : base.shadows,
    detail: r.detail === 1 || r.detail === 2 || r.detail === 3 ? r.detail : base.detail,
    resolution: typeof r.resolution === 'number' && Number.isFinite(r.resolution) ? Math.min(3, Math.max(0.5, r.resolution)) : base.resolution,
  };
}

/**
 * The key changed in v0.0.11 (outlines defaulted to off then); the pencil outlines were removed in
 * v0.0.15, and their old fields in this entry are ignored.
 */
const KEY = 'paperwars.graphics.v2';

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

// ---- Budgets (v0.0.11) ------------------------------------------------------------------------

/**
 * What a frame may cost on each preset, measured on the test computers in the desk view and in
 * flight: draw calls (shadow passes included, as the engine counts them), triangles drawn and
 * texture memory. `?perf` shows the frame against its preset's budget,
 * and `paperwars.assets.report()` / `paperwars.budget()` report it.
 */
export interface PerfBudget {
  drawCalls: number;
  triangles: number;
  textureMb: number;
  /** Initial load on a typical home connection (seconds), for the record. */
  loadSeconds: number;
}

export const BUDGETS: Record<GraphicsPreset, PerfBudget> = {
  low: { drawCalls: 350, triangles: 250_000, textureMb: 96, loadSeconds: 10 },
  medium: { drawCalls: 550, triangles: 450_000, textureMb: 160, loadSeconds: 10 },
  high: { drawCalls: 800, triangles: 700_000, textureMb: 256, loadSeconds: 10 },
};

/**
 * Small repeated parts (aerials, crates' tape, door handles) further than this from the camera
 * are not drawn: the level of detail that matters at this scale (metres; Infinity keeps all).
 */
export const DETAIL_DISTANCE: Record<GraphicsPreset, number> = { low: 160, medium: 260, high: Infinity };

export interface BudgetCheck {
  preset: GraphicsPreset;
  budget: PerfBudget;
  ok: boolean;
  /** The measures over budget, e.g. `drawCalls 912/800`. */
  over: string[];
}

/** Compares a measurement with its preset's budget. Missing measures are not judged. */
export function checkBudget(
  preset: GraphicsPreset,
  measured: Partial<Pick<PerfBudget, 'drawCalls' | 'triangles' | 'textureMb' | 'loadSeconds'>>,
): BudgetCheck {
  const budget = BUDGETS[preset];
  const over: string[] = [];
  for (const k of Object.keys(budget) as Array<keyof PerfBudget>) {
    const v = measured[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > budget[k]) over.push(`${k} ${Math.round(v * 10) / 10}/${budget[k]}`);
  }
  return { preset, budget, ok: over.length === 0, over };
}

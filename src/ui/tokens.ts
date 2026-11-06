/**
 * The design tokens: the one source of truth for colour, spacing, radius, type, elevation, motion
 * and focus (docs/DESIGN_SYSTEM.md, plan v0.0.15 §1A).
 *
 * `applyTokens()` writes them as CSS custom properties on `:root`, so every stylesheet (hud.css,
 * mp.css, components.css) and every element on the page (also those outside `#hud`) reads the
 * same values. Canvas code (the mini-map, owner colours, markers) reads the same values with
 * `colour(name)`; inline styles can use `cssColour(name)` (a `var(--name)` reference).
 *
 * A colour-blind palette is a token swap: same names, different values. Reduced motion zeroes the
 * motion durations; high contrast makes panels solid and darkens the quiet inks; text scale and
 * HUD scale multiply the type sizes and the zones.
 */

// ---- Colour ----------------------------------------------------------------------------------------

/** Every colour token. The CSS custom property is `--` + the name. */
export const COLOUR_NAMES = [
  // Surfaces
  'paper', 'paper-solid', 'paper-2', 'edge', 'backdrop',
  // Ink
  'ink', 'ink-2', 'ink-3', 'on-colour',
  // Meaning
  'friend', 'hostile', 'warn', 'good', 'off', 'objective', 'neutral',
  // Status
  'threat-1', 'threat-2', 'threat-3', 'tracking', 'locking', 'firing', 'gold', 'silver', 'bronze',
  // Focus
  'focus', 'focus-glow',
  // Over the 3D world: text shadows, dark bar tracks, reticles, comic pop words, the tip's bulb
  'marker-shadow', 'marker-track', 'reticle', 'pop-good', 'pop-bad', 'tip-glow',
  // Tinted chip pairs: background and text
  'chip-good-bg', 'chip-good-fg', 'chip-friend-bg', 'chip-friend-fg', 'chip-hostile-bg', 'chip-hostile-fg',
  'chip-warn-bg', 'chip-warn-fg', 'chip-gold-bg', 'chip-gold-fg', 'chip-streak-bg', 'chip-streak-fg',
] as const;

export type ColourName = (typeof COLOUR_NAMES)[number];
export type Palette = Readonly<Record<ColourName, string>>;
export type PaletteName = 'standard' | 'colourblind';

/** The v0.0.7–v0.0.14 colours, unchanged, plus objective orange, neutral grey, focus and chips. */
const STANDARD: Palette = {
  paper: 'rgba(251, 248, 241, 0.93)',
  'paper-solid': '#fbf8f1',
  'paper-2': '#efe8d9',
  edge: '#ddd2bb',
  backdrop: 'rgba(29, 39, 71, 0.35)',
  ink: '#1d2747',
  'ink-2': '#4a5373',
  'ink-3': '#8a90a6',
  'on-colour': '#ffffff',
  friend: '#2f6fe4',
  hostile: '#d6372e',
  warn: '#df8f14',
  good: '#1f9d55',
  off: '#a3a6b1',
  objective: '#ea6a0f',
  neutral: '#8e93a3',
  'threat-1': '#d7a40b',
  'threat-2': '#e8761a',
  'threat-3': '#d6372e',
  tracking: '#f59e0b',
  locking: '#a855f7',
  firing: '#d6372e',
  gold: '#c9940f',
  silver: '#8a93a6',
  bronze: '#b4703c',
  focus: '#f59e0b',
  'focus-glow': 'rgba(245, 158, 11, 0.25)',
  'marker-shadow': 'rgba(0, 0, 0, 0.6)',
  'marker-track': 'rgba(0, 0, 0, 0.3)',
  reticle: 'rgba(255, 255, 255, 0.9)',
  'pop-good': '#fde047',
  'pop-bad': '#fca5a5',
  'tip-glow': '#fde68a',
  'chip-good-bg': '#d9f2e3',
  'chip-good-fg': '#167a41',
  'chip-friend-bg': '#dbe7fd',
  'chip-friend-fg': '#1f4fae',
  'chip-hostile-bg': '#fbdcd9',
  'chip-hostile-fg': '#a3241c',
  'chip-warn-bg': '#fcebcc',
  'chip-warn-fg': '#96600a',
  'chip-gold-bg': '#fcefc7',
  'chip-gold-fg': '#8a6406',
  'chip-streak-bg': '#fde7d4',
  'chip-streak-fg': '#b4501a',
};

/**
 * Colour-blind safe (Okabe–Ito based): blue and vermillion for friend and hostile, bluish green for
 * good, orange for warning, reddish purple for objective and locking. Threat levels step in
 * lightness as well as hue, so they read under protanopia, deuteranopia and tritanopia. Surfaces
 * and inks do not change.
 */
const COLOURBLIND: Palette = {
  ...STANDARD,
  friend: '#0072b2',
  hostile: '#d55e00',
  warn: '#e69f00',
  good: '#009e73',
  objective: '#cc79a7',
  neutral: '#8e93a3',
  'threat-1': '#c9a400',
  'threat-2': '#e69f00',
  'threat-3': '#d55e00',
  tracking: '#e69f00',
  locking: '#cc79a7',
  firing: '#d55e00',
  focus: '#e69f00',
  'focus-glow': 'rgba(230, 159, 0, 0.28)',
  'chip-good-bg': '#d3efe6',
  'chip-good-fg': '#00664a',
  'chip-friend-bg': '#d6e9f5',
  'chip-friend-fg': '#005282',
  'chip-hostile-bg': '#f7dfcc',
  'chip-hostile-fg': '#9a4200',
  'chip-warn-bg': '#fbecc9',
  'chip-warn-fg': '#855b00',
  'chip-streak-bg': '#f5e0ec',
  'chip-streak-fg': '#8f3d6d',
};

export const PALETTES: Readonly<Record<PaletteName, Palette>> = { standard: STANDARD, colourblind: COLOURBLIND };

/** High-contrast panels: solid card stock, darker quiet inks and edges. Applied over either palette. */
const HIGH_CONTRAST: Partial<Palette> = {
  paper: '#fbf8f1',
  'paper-2': '#e6dcc6',
  edge: '#9c8f74',
  'ink-2': '#2e3858',
  'ink-3': '#555d78',
  backdrop: 'rgba(29, 39, 71, 0.55)',
};

/** Who owns a thing, as the art direction colours it: blue player, red hostile, grey neutral, orange objective. */
export type Owner = 'player' | 'hostile' | 'neutral' | 'objective';
export const OWNER_COLOURS: Readonly<Record<Owner, ColourName>> = { player: 'friend', hostile: 'hostile', neutral: 'neutral', objective: 'objective' };

// ---- Spacing, radius, type, elevation, motion, focus ------------------------------------------------

/** A 4 px based scale: --s1 = 4px … --s8 = 32px. */
export const SPACING = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 28, s8: 32 } as const;

export const RADIUS = { r: '10px', 'r-s': '7px', 'r-pill': '999px' } as const;

/** One bold tabular face for numbers, one plain face for words. */
export const FACES = {
  font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  num: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/** Type sizes in px: three sizes (s, m, l) plus display (xl); xs is for key caps and fine print. */
export const TYPE = { 't-xs': 11, 't-s': 12, 't-m': 15, 't-l': 21, 't-xl': 30 } as const;

export const ELEVATION = {
  'shadow-flat': 'none',
  shadow: '0 1px 0 rgba(29, 39, 71, 0.05), 0 6px 18px rgba(29, 39, 71, 0.16)',
  'shadow-lift': '0 2px 0 rgba(29, 39, 71, 0.06), 0 10px 26px rgba(29, 39, 71, 0.22)',
} as const;

/** Durations in ms; zeroed by reduced motion. */
export const DURATIONS = { 'dur-fold': 160, 'dur-pop': 220, 'dur-fade': 180, 'dur-slide': 200, 'dur-tip': 120 } as const;
export const EASING = {
  'ease-pop': 'cubic-bezier(0.2, 0.9, 0.3, 1.2)',
  'ease-out': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  'ease-in': 'cubic-bezier(0.5, 0, 0.8, 0.4)',
} as const;

export const FOCUS = { 'focus-width': '3px', 'focus-offset': '2px', 'focus-glow-width': '6px' } as const;

/** How long the focus manager waits before showing a focused control's tooltip. */
export const TIP_DELAY_MS = 450;

// ---- Options and output -----------------------------------------------------------------------------

export interface TokenOptions {
  palette?: PaletteName;
  highContrast?: boolean;
  reducedMotion?: boolean;
  /** Multiplies every type size (independent of the HUD size). 1 = as designed. */
  textScale?: number;
  /** The HUD size (S / M / L = 0.9 / 1 / 1.15); written as --ui-scale. */
  hudScale?: number;
}

export type ResolvedTokenOptions = Required<TokenOptions>;

export const DEFAULT_TOKEN_OPTIONS: ResolvedTokenOptions = { palette: 'standard', highContrast: false, reducedMotion: false, textScale: 1, hudScale: 1 };

export function resolveOptions(options: TokenOptions = {}): ResolvedTokenOptions {
  const scale = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    palette: options.palette === 'colourblind' ? 'colourblind' : 'standard',
    highContrast: options.highContrast === true,
    reducedMotion: options.reducedMotion === true,
    textScale: scale(options.textScale, 1),
    hudScale: scale(options.hudScale, 1),
  };
}

/** The palette in effect for these options (high contrast applied). */
export function paletteFor(options: TokenOptions = {}): Palette {
  const o = resolveOptions(options);
  return o.highContrast ? { ...PALETTES[o.palette], ...HIGH_CONTRAST } : PALETTES[o.palette];
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
const ms = (n: number): string => `${n}ms`;

/** Every custom property (with its `--` prefix) and its value for these options. */
export function tokenVars(options: TokenOptions = {}): Record<string, string> {
  const o = resolveOptions(options);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(paletteFor(o))) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(SPACING)) out[`--${name}`] = px(value);
  for (const [name, value] of Object.entries(RADIUS)) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(FACES)) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(TYPE)) out[`--${name}`] = px(value * o.textScale);
  out['--t-display'] = out['--t-xl'];
  out['--text-scale'] = String(o.textScale);
  for (const [name, value] of Object.entries(ELEVATION)) out[`--${name}`] = value;
  out['--elev-flat'] = ELEVATION['shadow-flat'];
  out['--elev-raised'] = ELEVATION.shadow;
  out['--elev-floating'] = ELEVATION['shadow-lift'];
  for (const [name, value] of Object.entries(DURATIONS)) out[`--${name}`] = ms(o.reducedMotion ? 0 : value);
  for (const [name, value] of Object.entries(EASING)) out[`--${name}`] = value;
  // Composite motion tokens, ready for `animation:` / `transition:`.
  out['--motion-fold'] = `${out['--dur-fold']} ${EASING['ease-pop']}`;
  out['--motion-pop'] = `${out['--dur-pop']} ${EASING['ease-pop']}`;
  out['--motion-fade'] = `${out['--dur-fade']} ${EASING['ease-out']}`;
  out['--motion-slide'] = `${out['--dur-slide']} ${EASING['ease-out']}`;
  // The v0.0.7 name for the fold-in, kept so existing rules keep working.
  out['--fast'] = out['--motion-fold'];
  for (const [name, value] of Object.entries(FOCUS)) out[`--${name}`] = value;
  out['--ui-scale'] = String(o.hudScale);
  return out;
}

/** The tokens as a `:root { … }` block (for tests, docs and a static fallback). */
export function tokenCss(options: TokenOptions = {}): string {
  const body = Object.entries(tokenVars(options)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {\n${body}\n}\n`;
}

// ---- Applying them ----------------------------------------------------------------------------------

let active: ResolvedTokenOptions = { ...DEFAULT_TOKEN_OPTIONS };
let activePalette: Palette = paletteFor(active);
const listeners: Array<(o: ResolvedTokenOptions) => void> = [];

/**
 * Writes every token on `root` (the document's `:root` by default) and marks the options as data
 * attributes (`data-palette`, `data-contrast`, `data-motion`) for the few rules that need them.
 * Options not given keep their current value, so `applyTokens({ palette: 'colourblind' })` only
 * swaps the palette. Returns the options now in effect.
 */
export function applyTokens(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null, options: TokenOptions = {}): ResolvedTokenOptions {
  active = resolveOptions({ ...active, ...options });
  activePalette = paletteFor(active);
  if (root) {
    for (const [k, v] of Object.entries(tokenVars(active))) root.style.setProperty(k, v);
    root.dataset.palette = active.palette;
    root.dataset.contrast = active.highContrast ? 'high' : 'normal';
    root.dataset.motion = active.reducedMotion ? 'reduced' : 'full';
  }
  for (const h of listeners) h(active);
  return active;
}

/** The options last applied. */
export function tokenOptions(): ResolvedTokenOptions {
  return { ...active };
}

/** Called after every applyTokens (canvas code redraws in the new palette). Returns an unsubscribe. */
export function onTokensChange(handler: (o: ResolvedTokenOptions) => void): () => void {
  listeners.push(handler);
  return () => {
    const i = listeners.indexOf(handler);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** What the player's system asks for (reduced motion, more contrast), for the boot defaults. */
export function systemTokenOptions(): TokenOptions {
  const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  return { reducedMotion: mq('(prefers-reduced-motion: reduce)'), highContrast: mq('(prefers-contrast: more)') };
}

// ---- Reading colours in code ----------------------------------------------------------------------

/** A colour's value in the palette in effect (for canvas `fillStyle`, WebGL tints, …). */
export function colour(name: ColourName, palette?: PaletteName): string {
  return palette ? PALETTES[palette][name] : activePalette[name];
}

/** A colour as a CSS reference (`var(--friend)`), for inline styles that follow palette swaps. */
export function cssColour(name: ColourName): string {
  return `var(--${name})`;
}

/** An owner's colour (player, hostile, neutral, objective). */
export function ownerColour(owner: Owner, palette?: PaletteName): string {
  return colour(OWNER_COLOURS[owner], palette);
}

/** A colour as sRGB 0–1 plus alpha, for engine colours. Accepts #rgb, #rrggbb and rgb(a)(). */
export function colourRgb(name: ColourName, palette?: PaletteName): [number, number, number, number] {
  return parseColour(colour(name, palette));
}

export function parseColour(value: string): [number, number, number, number] {
  const v = value.trim();
  if (v.startsWith('#')) {
    const hex = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1);
    const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), hex.length >= 8 ? n(6) : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) throw new Error(`Not a colour: ${value}`);
  const [r, g, b, a] = m[1].split(',').map((s) => parseFloat(s));
  return [r / 255, g / 255, b / 255, a ?? 1];
}

/** A colour with a different alpha, as `rgba()` (canvas fills of a token at a set opacity). */
export function withAlpha(name: ColourName, alpha: number, palette?: PaletteName): string {
  const [r, g, b] = colourRgb(name, palette);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

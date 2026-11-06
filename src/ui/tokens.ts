/**
 * The design tokens: the one source of truth for colour, spacing, radius, type, elevation, motion
 * and focus (docs/DESIGN_SYSTEM.md, plan v0.0.15 §1A).
 *
 * `applyTokens()` writes them as CSS custom properties on `:root`, so every stylesheet (hud.css,
 * mp.css, components.css) and every element on the page (also those outside `#hud`) reads the
 * same values. Canvas code (the mini-map, owner colours, markers) reads the same values with
 * `colour(name)`; inline styles can use `cssColour(name)` (a `var(--name)` reference).
 *
 * The values are the developer's style guide (docs/style-guide/, 2026-11-06): two themes, Daylight
 * and Lights out, with the guide's names (`paper-100`, `ink-900`, `pencil-400`, `sky-500`, …) and
 * the older semantic names (`--paper`, `--ink`, `--friend`, `--hostile`, …) as aliases onto them.
 * A colour-blind palette is a token swap: same names, different values, in either theme. Reduced
 * motion zeroes the motion durations; high contrast makes panels solid and darkens the quiet inks; text scale and
 * HUD scale multiply the type sizes and the zones.
 */

// ---- Colour ----------------------------------------------------------------------------------------

/**
 * The style guide's colour names (docs/style-guide/design-system/tokens.json, the developer's
 * paperwars.io design system, 2026-11-06). Each has a value in both themes, Daylight (notebook
 * paper on a wooden desk) and Lights out (chalkboard green).
 */
export const BASE_COLOUR_NAMES = [
  'paper-100', 'paper-50', 'desk-200', 'rule-300', 'margin-red',
  'ink-900', 'ink-600', 'graphite',
  'pencil-400', 'pencil-600', 'cardboard-400', 'cardboard-700', 'eraser-300', 'sticky-200', 'tape-100',
  'sky-500', 'raid-500', 'win-500', 'on-signal',
  'team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6', 'team-7', 'team-8',
] as const;

/**
 * The semantic names from v0.0.7–v0.0.14 (and phase 2), kept as aliases onto the style guide's
 * values, so every existing rule keeps working: `--paper` is the card stock (`paper-50`), `--ink`
 * is `ink-900`, `--friend` is `sky-500`, `--hostile` is `raid-500`, `--good` is `win-500`, …
 */
export const SEMANTIC_COLOUR_NAMES = [
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

/** Every colour token. The CSS custom property is `--` + the name. */
export const COLOUR_NAMES = [...BASE_COLOUR_NAMES, ...SEMANTIC_COLOUR_NAMES] as const;

export type BaseColourName = (typeof BASE_COLOUR_NAMES)[number];
export type ColourName = (typeof COLOUR_NAMES)[number];
export type Palette = Readonly<Record<ColourName, string>>;
type BasePalette = Readonly<Record<BaseColourName, string>>;
export type PaletteName = 'standard' | 'colourblind';
/** The two themes of the style guide. */
export type ThemeName = 'daylight' | 'lightsOut';
export const THEME_NAMES: readonly ThemeName[] = ['daylight', 'lightsOut'];

/** Daylight: the style guide's light values, unchanged. */
const DAYLIGHT: BasePalette = {
  'paper-100': '#fbf8f1', 'paper-50': '#ffffff', 'desk-200': '#eadcc2', 'rule-300': '#a9c3e4', 'margin-red': '#e8828a',
  'ink-900': '#26242c', 'ink-600': '#5c5965', graphite: '#26242c',
  'pencil-400': '#f5c23a', 'pencil-600': '#c98f00', 'cardboard-400': '#c8975a', 'cardboard-700': '#7a5228', 'eraser-300': '#f29bb0',
  'sticky-200': '#f6e7b4', 'tape-100': '#fffdf6',
  'sky-500': '#2f6fc0', 'raid-500': '#c9353e', 'win-500': '#267a41', 'on-signal': '#ffffff',
  'team-1': '#e0464e', 'team-2': '#2f6fc0', 'team-3': '#f5c23a', 'team-4': '#2f8a4c', 'team-5': '#8b5cc7', 'team-6': '#f08a2c', 'team-7': '#1fa6a6', 'team-8': '#e86fa8',
};

/** Lights out: the style guide's dark values (chalkboard green), unchanged. */
const LIGHTS_OUT: BasePalette = {
  'paper-100': '#1e2926', 'paper-50': '#283632', 'desk-200': '#151d1b', 'rule-300': '#3d524c', 'margin-red': '#7a3a3e',
  'ink-900': '#f3efe4', 'ink-600': '#b3b8ad', graphite: '#26242c',
  'pencil-400': '#f5c23a', 'pencil-600': '#c98f00', 'cardboard-400': '#c8975a', 'cardboard-700': '#e0b47c', 'eraser-300': '#f29bb0',
  'sticky-200': '#e9d9a2', 'tape-100': '#cfd5cc',
  'sky-500': '#7fb0ef', 'raid-500': '#ff7a7f', 'win-500': '#6fcf8a', 'on-signal': '#1b1a20',
  'team-1': '#e0464e', 'team-2': '#5b93dc', 'team-3': '#f5c23a', 'team-4': '#4fb06c', 'team-5': '#a57ddc', 'team-6': '#f08a2c', 'team-7': '#2fc0c0', 'team-8': '#e86fa8',
};

/**
 * The colours the style guide has no name for (warning amber, objective orange, threat steps,
 * lock purple, medals, grey), per theme. Daylight's warning is pencil-600 darkened to #b58000 and
 * the objective orange is #d9650f, so their icons hold 3:1 on paper (pencil-600 itself is 2.8:1).
 */
type Extras = Pick<Record<ColourName, string>, 'warn' | 'off' | 'objective' | 'neutral' | 'threat-1' | 'threat-2' | 'tracking' | 'locking' | 'gold' | 'silver' | 'bronze' | 'backdrop'>;
const EXTRAS: Readonly<Record<ThemeName, Extras>> = {
  daylight: {
    warn: '#b58000', off: '#a3a0aa', objective: '#d9650f', neutral: '#8a8796', 'threat-1': '#b88300', 'threat-2': '#d9650f',
    tracking: '#c98f00', locking: '#8b5cc7', gold: '#b8870e', silver: '#7d8597', bronze: '#a8652f', backdrop: 'rgba(38, 36, 44, 0.45)',
  },
  lightsOut: {
    warn: '#f5c23a', off: '#5d6b66', objective: '#f08a2c', neutral: '#8f9a94', 'threat-1': '#f5c23a', 'threat-2': '#f08a2c',
    tracking: '#f5c23a', locking: '#b892e6', gold: '#f5c23a', silver: '#b9c0c9', bronze: '#e0a070', backdrop: 'rgba(0, 0, 0, 0.55)',
  },
};

/**
 * Colour-blind safe (Okabe–Ito based), per theme: blue and vermillion for friend and hostile,
 * bluish green for good, orange for warning, reddish purple for objective and locking. Threat
 * levels step in lightness as well as hue. It changes the signal colours (`sky-500`, `raid-500`,
 * `win-500`) and the meanings built on them; surfaces, inks and team colours stay.
 */
const COLOURBLIND: Readonly<Record<ThemeName, Partial<BasePalette> & Partial<Extras>>> = {
  daylight: {
    'sky-500': '#0072b2', 'raid-500': '#c35600', 'win-500': '#007a5a',
    warn: '#c08500', objective: '#c675a2', 'threat-1': '#c9a400', 'threat-2': '#e69f00', tracking: '#e69f00', locking: '#c675a2',
  },
  lightsOut: {
    'sky-500': '#56b4e9', 'raid-500': '#ff8f4d', 'win-500': '#4fd6a8',
    warn: '#f0c020', objective: '#e8a3cc', 'threat-1': '#f0e442', 'threat-2': '#e69f00', tracking: '#e69f00', locking: '#e8a3cc',
  },
};

/** High-contrast panels, per theme: darker (lighter at night) quiet inks, edges and wells, a darker backdrop. */
const HIGH_CONTRAST: Readonly<Record<ThemeName, Partial<BasePalette> & Partial<Extras>>> = {
  daylight: { 'ink-600': '#3d3a45', 'desk-200': '#e4d3b3', 'rule-300': '#5c5965', backdrop: 'rgba(38, 36, 44, 0.65)' },
  lightsOut: { 'ink-600': '#dcdfd6', 'paper-50': '#1e2926', 'rule-300': '#8fa39b', backdrop: 'rgba(0, 0, 0, 0.72)' },
};

/** `a` mixed into `b` (t = share of a), as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseColour(a);
  const [br, bg, bb] = parseColour(b);
  const c = (x: number, y: number): string => Math.round((x * t + y * (1 - t)) * 255).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/** The semantic aliases from the base colours and extras of one theme. */
function withSemantics(theme: ThemeName, b: BasePalette, x: Extras): Palette {
  const day = theme === 'daylight';
  // Tinted chips: a pale wash of the signal on paper, text in a darker (day) or the light (night) signal.
  const tint = (c: string): string => mix(c, b['paper-50'], day ? 0.14 : 0.12);
  const deep = (c: string): string => (day ? mix(c, '#000000', 0.78) : mix(c, b['ink-900'], 0.6));
  return {
    ...b,
    paper: b['paper-50'],
    'paper-solid': b['paper-50'],
    'paper-2': b['desk-200'],
    edge: b['rule-300'],
    backdrop: x.backdrop,
    ink: b['ink-900'],
    'ink-2': b['ink-600'],
    'ink-3': b['ink-600'],
    'on-colour': b['on-signal'],
    friend: b['sky-500'],
    hostile: b['raid-500'],
    warn: x.warn,
    good: b['win-500'],
    off: x.off,
    objective: x.objective,
    neutral: x.neutral,
    'threat-1': x['threat-1'],
    'threat-2': x['threat-2'],
    'threat-3': b['raid-500'],
    tracking: x.tracking,
    locking: x.locking,
    firing: b['raid-500'],
    gold: x.gold,
    silver: x.silver,
    bronze: x.bronze,
    focus: b['sky-500'],
    // No glow in the style guide: the ring is a solid 3px line.
    'focus-glow': 'rgba(0, 0, 0, 0)',
    'marker-shadow': 'rgba(0, 0, 0, 0.6)',
    'marker-track': 'rgba(0, 0, 0, 0.3)',
    reticle: '#ffffff',
    'pop-good': b['pencil-400'],
    'pop-bad': b['eraser-300'],
    'tip-glow': b['pencil-400'],
    'chip-good-bg': tint(b['win-500']),
    'chip-good-fg': deep(b['win-500']),
    'chip-friend-bg': tint(b['sky-500']),
    'chip-friend-fg': deep(b['sky-500']),
    'chip-hostile-bg': tint(b['raid-500']),
    'chip-hostile-fg': deep(b['raid-500']),
    'chip-warn-bg': tint(x.warn),
    'chip-warn-fg': day ? mix(x.warn, '#000000', 0.62) : x.warn,
    'chip-gold-bg': tint(b['pencil-400']),
    'chip-gold-fg': day ? '#6f5200' : b['pencil-400'],
    'chip-streak-bg': tint(b['eraser-300']),
    'chip-streak-fg': day ? '#a3324f' : b['eraser-300'],
  };
}

function buildPalette(theme: ThemeName, palette: PaletteName, highContrast: boolean): Palette {
  const base = theme === 'daylight' ? DAYLIGHT : LIGHTS_OUT;
  const over = { ...(palette === 'colourblind' ? COLOURBLIND[theme] : {}), ...(highContrast ? HIGH_CONTRAST[theme] : {}) };
  const b = { ...base } as Record<BaseColourName, string>;
  const x = { ...EXTRAS[theme] } as Record<keyof Extras, string>;
  for (const [k, v] of Object.entries(over)) {
    if (k in b) b[k as BaseColourName] = v as string;
    else x[k as keyof Extras] = v as string;
  }
  return withSemantics(theme, b, x);
}

/** Every theme × palette × contrast, built once. */
const PALETTE_CACHE = new Map<string, Palette>();
function cachedPalette(theme: ThemeName, palette: PaletteName, highContrast: boolean): Palette {
  const key = `${theme}/${palette}/${highContrast}`;
  let p = PALETTE_CACHE.get(key);
  if (!p) PALETTE_CACHE.set(key, (p = buildPalette(theme, palette, highContrast)));
  return p;
}

/** The Daylight palettes (standard and colour-blind). */
export const PALETTES: Readonly<Record<PaletteName, Palette>> = { standard: cachedPalette('daylight', 'standard', false), colourblind: cachedPalette('daylight', 'colourblind', false) };
/** Both themes, both palettes. */
export const THEME_PALETTES: Readonly<Record<ThemeName, Readonly<Record<PaletteName, Palette>>>> = {
  daylight: PALETTES,
  lightsOut: { standard: cachedPalette('lightsOut', 'standard', false), colourblind: cachedPalette('lightsOut', 'colourblind', false) },
};

/** Who owns a thing, as the art direction colours it: blue player, red hostile, grey neutral, orange objective. */
export type Owner = 'player' | 'hostile' | 'neutral' | 'objective';
export const OWNER_COLOURS: Readonly<Record<Owner, ColourName>> = { player: 'friend', hostile: 'hostile', neutral: 'neutral', objective: 'objective' };

/** Team colours by seat (team-1 … team-8). Always shown with the desk number or a crest, never alone. */
export const TEAM_COLOURS: readonly ColourName[] = ['team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6', 'team-7', 'team-8'];

// ---- Spacing, radius, type, elevation, motion, focus ------------------------------------------------

/** A 4 px based scale: --s1 = 4px … --s8 = 32px (the v0.0.7 names). */
export const SPACING = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 28, s8: 32 } as const;
/** The style guide's spacing names (4 px base). */
export const SPACE = { 'space-1': 4, 'space-2': 8, 'space-3': 12, 'space-4': 16, 'space-5': 20, 'space-6': 24, 'space-8': 32, 'space-10': 40, 'space-12': 48 } as const;

/** The style guide's radii; `--r` (cards, buttons) is radius-md, `--r-s` radius-sm. */
export const RADIUS = { r: '12px', 'r-s': '6px', 'r-pill': '999px', 'radius-sm': '6px', 'radius-md': '12px', 'radius-lg': '20px', 'radius-pill': '999px' } as const;

/** Marker outlines: hairlines and dividers, buttons and chips (2px), cards and panels (3px), focus. */
export const STROKES = { 'stroke-hair': '1px', 'stroke-line': '2px', 'stroke-card': '3px', 'stroke-focus': '3px' } as const;

/**
 * The style guide's faces, self-hosted (src/ui/fonts.ts): Lilita One for display (titles, plane
 * names, HUD numbers), Nunito for everything you read, Kalam for hand-written hints only.
 */
export const FACES = {
  'font-display': "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif",
  'font-body': "Nunito, ui-rounded, system-ui, sans-serif",
  'font-note': "Kalam, 'Comic Neue', 'Segoe Print', cursive",
  /** Words (the v0.0.7 name). */
  font: "Nunito, ui-rounded, system-ui, sans-serif",
  /** Numbers: the display face (tabular where it allows). */
  num: "'Lilita One', 'Arial Rounded MT Bold', system-ui, sans-serif",
  /** Key caps and codes. */
  mono: "Nunito, ui-rounded, system-ui, sans-serif",
} as const;

/**
 * Type sizes in px. The HUD's scale (xs … xl) keeps its sizes, so the zones fit as tuned; the style
 * guide's named styles are added (label 12, body-sm 14, body 16, doodle 18, title 24, counter 28,
 * display 40, display-xl 64). Every size follows the text scale.
 */
export const TYPE = {
  't-xs': 11, 't-s': 12, 't-m': 15, 't-l': 21, 't-xl': 30,
  't-label': 12, 't-body-sm': 14, 't-body': 16, 't-doodle': 18, 't-title': 24, 't-counter': 28, 't-display-l': 40, 't-display-xl': 64,
} as const;

/**
 * Hard offset shadows, no blur: things look like stacked paper and cardboard, not glass. The style
 * guide's `shadow-press` (under pencil buttons), `shadow-card` (under paper cards) and
 * `shadow-lift` (picked up, open), plus the marker shadows under panels (`shadow-hard`, 4px, and
 * `shadow-hard-lg`, 5px, in graphite, which stays dark in both themes).
 */
const SHADOWS: Readonly<Record<ThemeName, Record<string, string>>> = {
  daylight: {
    'shadow-press': '0 3px 0 #c98f00', 'shadow-card': '0 3px 0 #d8c7a6', 'shadow-lift': '4px 6px 0 #26242c1f',
    'shadow-hard-sm': '2px 2px 0 #26242c', 'shadow-hard': '4px 4px 0 #26242c', 'shadow-hard-lg': '5px 5px 0 #26242c',
  },
  lightsOut: {
    'shadow-press': '0 3px 0 #c98f00', 'shadow-card': '0 3px 0 #0f1513', 'shadow-lift': '4px 6px 0 #00000059',
    'shadow-hard-sm': '2px 2px 0 #0b100f', 'shadow-hard': '4px 4px 0 #0b100f', 'shadow-hard-lg': '5px 5px 0 #0b100f',
  },
};

/** Durations in ms; zeroed by reduced motion (which keeps `--dur-calm`, a 120ms fade, instead). */
export const DURATIONS = { 'dur-fold': 220, 'dur-pop': 220, 'dur-fade': 180, 'dur-slide': 200, 'dur-tip': 120, 'dur-press': 90 } as const;
/** The fade that replaces springs under reduced motion. */
export const CALM_MS = 120;
export const EASING = {
  /** Springy overshoot, like paper flopping onto a desk. */
  'ease-pop': 'cubic-bezier(0.3, 1.6, 0.5, 1)',
  'ease-out': 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  'ease-in': 'cubic-bezier(0.5, 0, 0.8, 0.4)',
} as const;

/** The focus ring: stroke-focus (3px) in sky-500, 2px offset, no glow. */
export const FOCUS = { 'focus-width': '3px', 'focus-offset': '2px', 'focus-glow-width': '0px' } as const;

/** How long the focus manager waits before showing a focused control's tooltip. */
export const TIP_DELAY_MS = 450;

// ---- Options and output -----------------------------------------------------------------------------

export interface TokenOptions {
  /** Daylight (default) or Lights out. */
  theme?: ThemeName;
  palette?: PaletteName;
  highContrast?: boolean;
  reducedMotion?: boolean;
  /** Multiplies every type size (independent of the HUD size). 1 = as designed. */
  textScale?: number;
  /** The HUD size (S / M / L = 0.9 / 1 / 1.15); written as --ui-scale. */
  hudScale?: number;
}

export type ResolvedTokenOptions = Required<TokenOptions>;

export const DEFAULT_TOKEN_OPTIONS: ResolvedTokenOptions = { theme: 'daylight', palette: 'standard', highContrast: false, reducedMotion: false, textScale: 1, hudScale: 1 };

export function resolveOptions(options: TokenOptions = {}): ResolvedTokenOptions {
  const scale = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    theme: options.theme === 'lightsOut' ? 'lightsOut' : 'daylight',
    palette: options.palette === 'colourblind' ? 'colourblind' : 'standard',
    highContrast: options.highContrast === true,
    reducedMotion: options.reducedMotion === true,
    textScale: scale(options.textScale, 1),
    hudScale: scale(options.hudScale, 1),
  };
}

/** The palette in effect for these options (theme, colour-blind swap, high contrast). */
export function paletteFor(options: TokenOptions = {}): Palette {
  const o = resolveOptions(options);
  return cachedPalette(o.theme, o.palette, o.highContrast);
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
const ms = (n: number): string => `${n}ms`;

/** Every custom property (with its `--` prefix) and its value for these options. */
export function tokenVars(options: TokenOptions = {}): Record<string, string> {
  const o = resolveOptions(options);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(paletteFor(o))) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(SPACING)) out[`--${name}`] = px(value);
  for (const [name, value] of Object.entries(SPACE)) out[`--${name}`] = px(value);
  for (const [name, value] of Object.entries(RADIUS)) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(STROKES)) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(FACES)) out[`--${name}`] = value;
  for (const [name, value] of Object.entries(TYPE)) out[`--${name}`] = px(value * o.textScale);
  out['--t-display'] = out['--t-xl'];
  out['--text-scale'] = String(o.textScale);
  const sh = SHADOWS[o.theme];
  for (const [name, value] of Object.entries(sh)) out[`--${name}`] = value;
  // Elevation: flat, raised (a marker shadow under panels), floating (dialogs, alerts, tooltips).
  out['--shadow-flat'] = 'none';
  out['--shadow'] = sh['shadow-hard'];
  out['--elev-flat'] = 'none';
  out['--elev-raised'] = sh['shadow-hard'];
  out['--elev-floating'] = sh['shadow-hard-lg'];
  for (const [name, value] of Object.entries(DURATIONS)) out[`--${name}`] = ms(o.reducedMotion ? 0 : value);
  out['--dur-calm'] = ms(CALM_MS);
  for (const [name, value] of Object.entries(EASING)) out[`--${name}`] = value;
  // Composite motion tokens, ready for `animation:` / `transition:`.
  out['--motion-fold'] = `${out['--dur-fold']} ${EASING['ease-pop']}`;
  out['--motion-pop'] = `${out['--dur-pop']} ${EASING['ease-pop']}`;
  out['--motion-fade'] = `${out['--dur-fade']} ${EASING['ease-out']}`;
  out['--motion-slide'] = `${out['--dur-slide']} ${EASING['ease-out']}`;
  out['--motion-press'] = `${out['--dur-press']} ${EASING['ease-out']}`;
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
    root.dataset.theme = active.theme === 'lightsOut' ? 'lights-out' : 'daylight';
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
  return palette ? THEME_PALETTES[active.theme][palette][name] : activePalette[name];
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

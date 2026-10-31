/**
 * Art direction in numbers: the pencil outlines, the paper shading, the light and the material
 * library. Rendering only; gameplay tuning stays in ../config.ts. Colours are sRGB 0–1.
 *
 * Changing the look of the whole game should mostly mean changing this file. See
 * docs/ART_DIRECTION.md for what each part is for and how to add to it.
 */

export type Rgb = readonly [number, number, number];

// ---- Pencil outlines -----------------------------------------------------------------------

/**
 * How important an object is decides how strongly it is drawn:
 * - hero: aircraft, the things the player watches most closely;
 * - structure: buildings, defenses, targets, landmarks, the platforms' edges;
 * - prop: decorations on the territories;
 * - background: scenery far from the action.
 */
export type OutlineTier = 'hero' | 'structure' | 'prop' | 'background';
export const OUTLINE_TIERS: readonly OutlineTier[] = ['hero', 'structure', 'prop', 'background'];

export interface StrokeStyle {
  /** Line width in CSS pixels up close. */
  width: number;
  /** Line opacity up close (before the player's intensity setting). */
  opacity: number;
  /** A fold sharper than this (degrees between the two faces' normals) is drawn as a crease. */
  creaseAngle: number;
  /** How far strokes run past the corners, in pixels, like quick pencil lines. */
  overshoot: number;
  /** Full width out to this distance (m); further away lines thin in proportion… */
  fullWidthDistance: number;
  /** …down to this share of the width. */
  minWidthScale: number;
  /** Lines fade out between these distances (m), so far scenery doesn't turn to scribble. */
  fadeStart: number;
  fadeEnd: number;
}

export const OUTLINE = {
  /** Dark graphite, a little blue: never pure black. */
  color: [0.16, 0.16, 0.2] as Rgb,
  /** Strokes are pulled this share of their distance towards the camera, so they win against their own faces. */
  depthBias: 0.0025,
  /** Sideways wobble of each stroke end, pixels (at Medium quality). */
  wobble: 0.45,
  /** Strokes shorter than this on screen (px) fade away: tiny details at distance stay clean. */
  minLength: 2.5,
  tiers: {
    hero: { width: 3.2, opacity: 0.95, creaseAngle: 32, overshoot: 2.5, fullWidthDistance: 16, minWidthScale: 0.5, fadeStart: 170, fadeEnd: 320 },
    structure: { width: 2.7, opacity: 0.9, creaseAngle: 35, overshoot: 3, fullWidthDistance: 22, minWidthScale: 0.42, fadeStart: 150, fadeEnd: 300 },
    prop: { width: 2.1, opacity: 0.78, creaseAngle: 38, overshoot: 2.2, fullWidthDistance: 18, minWidthScale: 0.38, fadeStart: 80, fadeEnd: 190 },
    background: { width: 1.5, opacity: 0.5, creaseAngle: 45, overshoot: 1.5, fullWidthDistance: 30, minWidthScale: 0.3, fadeStart: 140, fadeEnd: 280 },
  } satisfies Record<OutlineTier, StrokeStyle>,
} as const;

// ---- Paper shading ---------------------------------------------------------------------------

export const SHADING = {
  /**
   * The sun's soft cel ramp: light switches on between these two values of N·L, so surfaces read
   * as two or three flat tones with a soft edge between them instead of a smooth gradient.
   */
  rampLow: -0.08,
  rampHigh: 0.42,
  /** A share of plain Lambert mixed back in, so big flat areas still show their tilt. */
  lambertMix: 0.2,
  /** Ambient from above (sky, slightly blue) and below (bounce off the desks, warm). */
  skyAmbient: [0.62, 0.66, 0.78] as Rgb,
  groundAmbient: [0.5, 0.44, 0.4] as Rgb,
  /** Paper grain on every lit surface: repeats per metre and strength (0 = none). */
  grainScale: 1.1,
  grainStrength: 0.1,
} as const;

// ---- Light and atmosphere ---------------------------------------------------------------------

export const LIGHTING = {
  sunColor: [1, 0.95, 0.85] as Rgb,
  sunIntensity: 0.95,
  /** Pitch and yaw of the sun, degrees. High, from behind the home → centre approach. */
  sunAngles: [28, -135, 0] as const,
  /** Shadows are kept light: the bluish ambient shows through them. */
  shadowIntensity: 0.62,
  shadowDistance: 120,
  /** Matches the camera's clear colour (PALETTE.sky) so distant haze blends into the sky. */
  sky: [0.74, 0.86, 0.96] as Rgb,
  fogStart: 220,
  fogEnd: 560,
} as const;

// ---- Materials -------------------------------------------------------------------------------

/** The procedural textures the material library can use (see shading/textures.ts). */
export type TextureId =
  | 'paper'
  | 'notebook'
  | 'graph'
  | 'cardboard'
  | 'corrugated'
  | 'kraft'
  | 'wood'
  | 'hatching'
  | 'rubber'
  | 'tape'
  | 'pencilWood'
  | 'ink';

/**
 * One entry of the material library. Every surface in the game should come from here so the whole
 * world shares one look; Synty imports are adapted to the nearest entry.
 */
export interface MaterialDef {
  color: Rgb;
  texture?: TextureId;
  /** Texture repeats per metre (the geometry's UVs are in metres). */
  tiling?: number;
  /** Paper grain on top; defaults to on. Plastic and ink go without. */
  grain?: boolean;
  /** 0 = matte paper; plastic and ink get a little sheen. */
  gloss?: number;
  /** Shown from both sides (a single sheet). */
  doubleSided?: boolean;
}

/** The material categories of the art direction. Ids are `category/variant`. */
export const MATERIALS = {
  'paper/white': { color: [0.96, 0.95, 0.91], texture: 'paper', tiling: 0.25, doubleSided: true },
  'paper/notebook': { color: [0.95, 0.94, 0.9], texture: 'notebook', tiling: 1 / 6 },
  'paper/graph': { color: [0.95, 0.95, 0.92], texture: 'graph', tiling: 1 / 12 },
  'paper/sticky': { color: [1, 0.9, 0.42], texture: 'paper', tiling: 0.3 },
  'paper/blue': { color: [0.36, 0.58, 0.95], texture: 'paper', tiling: 0.3 },
  'paper/red': { color: [0.93, 0.36, 0.33], texture: 'paper', tiling: 0.3 },
  'paper/green': { color: [0.45, 0.78, 0.48], texture: 'paper', tiling: 0.3 },
  'paper/yellow': { color: [0.99, 0.84, 0.32], texture: 'paper', tiling: 0.3 },
  'paper/pink': { color: [0.98, 0.62, 0.72], texture: 'paper', tiling: 0.3 },
  'cardboard/side': { color: [0.8, 0.62, 0.42], texture: 'cardboard', tiling: 0.35 },
  'cardboard/edge': { color: [0.8, 0.62, 0.42], texture: 'corrugated', tiling: 1.6 },
  'cardboard/dark': { color: [0.64, 0.48, 0.31], texture: 'kraft', tiling: 0.35 },
  'tape/masking': { color: [0.96, 0.89, 0.68], texture: 'tape', tiling: 0.5 },
  'tape/blue': { color: [0.3, 0.52, 0.93], texture: 'tape', tiling: 0.5 },
  'tape/grey': { color: [0.68, 0.72, 0.78], texture: 'tape', tiling: 0.5 },
  'ink/blue': { color: [0.16, 0.3, 0.72], texture: 'ink', tiling: 0.3, grain: false, gloss: 0.35 },
  'ink/black': { color: [0.12, 0.12, 0.16], texture: 'ink', tiling: 0.3, grain: false, gloss: 0.35 },
  'ink/red': { color: [0.78, 0.16, 0.18], texture: 'ink', tiling: 0.3, grain: false, gloss: 0.35 },
  'pencil/graphite': { color: [0.26, 0.26, 0.3], grain: false, gloss: 0.25 },
  'pencil/marking': { color: [0.45, 0.46, 0.52], texture: 'hatching', tiling: 0.5 },
  'pencil/yellow': { color: [0.99, 0.78, 0.18] },
  'pencil/wood': { color: [0.95, 0.8, 0.6], texture: 'pencilWood', tiling: 0.8 },
  'pencil/metal': { color: [0.74, 0.76, 0.8], gloss: 0.45, grain: false },
  'rubber/pink': { color: [0.97, 0.6, 0.66], texture: 'rubber', tiling: 0.5, grain: false },
  'rubber/blue': { color: [0.48, 0.66, 0.92], texture: 'rubber', tiling: 0.5, grain: false },
  'wood/desk': { color: [0.82, 0.62, 0.42], texture: 'wood', tiling: 0.08 },
  'wood/ruler': { color: [0.93, 0.78, 0.52], texture: 'wood', tiling: 0.2 },
  'plastic/clear': { color: [0.8, 0.9, 0.96], gloss: 0.6, grain: false },
  'plastic/red': { color: [0.88, 0.26, 0.24], gloss: 0.5, grain: false },
  'plastic/blue': { color: [0.26, 0.48, 0.88], gloss: 0.5, grain: false },
  'plastic/green': { color: [0.32, 0.7, 0.42], gloss: 0.5, grain: false },
} satisfies Record<string, MaterialDef>;

export type MaterialId = keyof typeof MATERIALS;

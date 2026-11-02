import type { PropId } from '../../assets/manifest';
import type { MaterialId } from '../../render/style';
import type { LandmarkId } from '../props/landmarks';

/**
 * How a territory looks, as data: what its platform is made of, what covers it, what lies on it
 * and which landmark marks it. Themes are cosmetic: they never change production, defenses or
 * rewards.
 *
 * Coordinates are (u, v) in metres from the platform's middle: u along the territory's facing
 * (for T1, along the runway towards the centre of the world), v to its right.
 */
export type ThemeId = 'notebook' | 'graph' | 'cardboard' | 'colored' | 'artDesk';

export interface TerritoryTheme {
  id: ThemeId;
  name: string;
  /** The block the platform is made of (a desk, a cardboard slab…). */
  slab: MaterialId;
  /** What covers its top, a little smaller than the platform (a layout may choose another colour). */
  sheet: MaterialId;
  /** How far in from the edge the sheet stops (m). */
  sheetInset: number;
  /**
   * Flat markings drawn on the sheet: a notebook's red margin and binder holes, a flattened box's
   * fold lines and printed arrows, an art desk's paint splashes.
   */
  markings: 'margin' | 'box' | 'paint' | null;
  /** Props the territory's scatter picks from (flat or low: none of them is solid). */
  scatter: readonly PropId[];
}

export const THEMES: Record<ThemeId, TerritoryTheme> = {
  notebook: {
    id: 'notebook', name: 'Notebook', slab: 'wood/desk', sheet: 'paper/notebook', sheetInset: 0.8, markings: 'margin',
    scatter: ['pencil.yellow', 'pencil.red', 'eraser', 'stickyNote.yellow', 'paperBall', 'paperClip', 'tapeRoll', 'paperStack'],
  },
  graph: {
    id: 'graph', name: 'Graph Paper', slab: 'wood/desk', sheet: 'paper/graph', sheetInset: 0.8, markings: null,
    scatter: ['protractor', 'pencil.blue', 'pencil.yellow', 'shavings', 'eraser', 'paperClip', 'stickyNote.green'],
  },
  cardboard: {
    id: 'cardboard', name: 'Cardboard', slab: 'cardboard/edge', sheet: 'cardboard/side', sheetInset: 0.35, markings: 'box',
    scatter: ['tapeRoll', 'paperBall', 'paperStack', 'stickyNote.yellow', 'pencil.red', 'paperClip'],
  },
  colored: {
    id: 'colored', name: 'Colored Paper', slab: 'wood/desk', sheet: 'paper/green', sheetInset: 1.2, markings: null,
    scatter: ['glueStick', 'paperBall', 'stickyNote.pink', 'crayon.red', 'crayon.blue', 'pencil.blue', 'eraser'],
  },
  artDesk: {
    id: 'artDesk', name: 'Art Desk', slab: 'wood/desk', sheet: 'paper/white', sheetInset: 0.8, markings: 'paint',
    scatter: ['crayon.red', 'crayon.blue', 'crayon.green', 'crayon.purple', 'glueStick', 'stickyNote.pink', 'paperBall'],
  },
};

/** How much decoration the graphics settings allow; each placement says from which level it shows. */
export type Detail = 1 | 2 | 3;

export interface Placement {
  prop: PropId;
  at: readonly [number, number];
  /** Degrees, turning left seen from above. */
  yaw?: number;
  /** Shown from this decoration level (1 always, 3 only on High). */
  detail?: Detail;
}

export interface TerritoryLayout {
  theme: ThemeId;
  /** The sheet's material when not the theme's own (colored paper comes in several colours). */
  sheet?: MaterialId;
  landmark: { id: LandmarkId; at: readonly [number, number]; yaw: number } | null;
  props: readonly Placement[];
  /** Where the owner's pennants stand when the territory is someone's home. */
  flags?: ReadonlyArray<readonly [number, number]>;
}

/**
 * Home Desk (T1). Everything stays off the runway and the take-off path (|v| < 5), the
 * construction slots (BASE.slots), the paper store and the base camera's view of them.
 */
export const HOME_DESK: TerritoryLayout = {
  theme: 'notebook',
  landmark: { id: 'pencilCup', at: [16, -16], yaw: 20 },
  flags: [[-18.4, -18.4], [-18.4, 18.4], [18.4, 18.4]],
  props: [
    { prop: 'bookStack', at: [-14.6, 15.8], yaw: 18 },
    { prop: 'globe', at: [-14.8, -15.6], yaw: 0 },
    { prop: 'pencil.yellow', at: [5.5, 18.4], yaw: 4 },
    { prop: 'pencil.red', at: [12.4, 14.2], yaw: 35, detail: 2 },
    { prop: 'pencil.blue', at: [-3, -18.3], yaw: 190 },
    { prop: 'ruler', at: [-16, -18.8], yaw: -2 },
    { prop: 'eraser', at: [16.2, 7.4], yaw: 28 },
    { prop: 'paperStack', at: [-11.6, 17.6], yaw: -10, detail: 2 },
    { prop: 'tapeRoll', at: [8.6, -18], detail: 2 },
    { prop: 'paperBall', at: [14.6, 17.4], detail: 2 },
    { prop: 'paperBall', at: [17.3, 15.2], yaw: 70, detail: 3 },
    { prop: 'paperBall', at: [11.6, -6.6], yaw: 130, detail: 3 },
    { prop: 'stickyNote.yellow', at: [16.8, -7.6], yaw: 14 },
    { prop: 'stickyNote.pink', at: [14.6, -9.4], yaw: -22, detail: 3 },
    { prop: 'stickyNote.yellow', at: [-3.2, 18.6], yaw: 8, detail: 3 },
  ],
};

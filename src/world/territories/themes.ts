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
export type ThemeId = 'notebook';

export interface TerritoryTheme {
  id: ThemeId;
  name: string;
  /** The block the platform is made of (a desk, a cardboard slab…). */
  slab: MaterialId;
  /** What covers its top, a little smaller than the platform. */
  sheet: MaterialId;
  /** How far in from the edge the sheet stops (m). */
  sheetInset: number;
}

export const THEMES: Record<ThemeId, TerritoryTheme> = {
  notebook: { id: 'notebook', name: 'Notebook', slab: 'wood/desk', sheet: 'paper/notebook', sheetInset: 0.8 },
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
  landmark: { id: LandmarkId; at: readonly [number, number]; yaw: number } | null;
  props: readonly Placement[];
}

/**
 * Home Desk (T1). Everything stays off the runway and the take-off path (|v| < 5), the
 * construction slots (BASE.slots), the paper store and the base camera's view of them.
 */
export const HOME_DESK: TerritoryLayout = {
  theme: 'notebook',
  landmark: { id: 'pencilCup', at: [16, -16], yaw: 20 },
  props: [
    { prop: 'flag.player', at: [-18.4, -18.4], yaw: 45 },
    { prop: 'flag.player', at: [-18.4, 18.4], yaw: -45 },
    { prop: 'flag.player', at: [18.4, 18.4], yaw: -135 },
    { prop: 'bookStack', at: [-14.6, 15.8], yaw: 18 },
    { prop: 'globe', at: [-14.8, -15.6], yaw: 0, detail: 2 },
    { prop: 'pencil.yellow', at: [5.5, 18.4], yaw: 4 },
    { prop: 'pencil.red', at: [12.4, 14.2], yaw: 35, detail: 2 },
    { prop: 'pencil.blue', at: [-3, -18.3], yaw: 190 },
    { prop: 'ruler', at: [-0.5, -16.9], yaw: -2 },
    { prop: 'eraser', at: [16.2, 7.4], yaw: 28 },
    { prop: 'paperStack', at: [-11.6, 17.6], yaw: -10, detail: 2 },
    { prop: 'tapeRoll', at: [-9.4, -16.4], detail: 2 },
    { prop: 'paperBall', at: [14.6, 17.4], detail: 2 },
    { prop: 'paperBall', at: [17.3, 15.2], yaw: 70, detail: 3 },
    { prop: 'paperBall', at: [11.6, -6.6], yaw: 130, detail: 3 },
    { prop: 'stickyNote.yellow', at: [16.8, -7.6], yaw: 14 },
    { prop: 'stickyNote.pink', at: [14.6, -9.4], yaw: -22, detail: 3 },
    { prop: 'stickyNote.yellow', at: [3.5, 14.6], yaw: 8, detail: 3 },
  ],
};

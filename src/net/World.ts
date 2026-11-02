import { PVP, THREAT, WORLD, type PlayerSide } from '../config';
import { layoutDefenses, type DefenseLayout } from '../defenses/Layout';
import { generateTerritories } from '../world/Grid';
import type { Territory } from '../world/Territory';
import type { Collider } from '../combat/Collision';
import { allDecorColliders, decorFootprints } from '../world/territories/decor';

/**
 * The shared classroom: the same 4 × 4 desks as single-player but with no home of its own,
 * and the AI's defenses on every defended territory. Server and clients both build it from the
 * same pure functions, so an installation id means the same thing everywhere. When a player claims
 * a territory its AI defenses are taken away (the player's base goes up instead); when it is
 * released they come back.
 */
export interface SharedWorld {
  territories: Territory[];
  layout: DefenseLayout;
  /** Territories players may claim: all but the centre. */
  claimable: string[];
  /** Every desk's landmark and tall props, solid for everyone (the same shapes as single-player's). */
  decor: Collider[];
  /** The ground they stand on, for missions' precision spots. */
  decorGround: Array<{ x: number; z: number; r: number }>;
}

export function sharedWorld(): SharedWorld {
  const territories = generateTerritories(WORLD.gridSize, WORLD.territorySize, WORLD.gap, THREAT.map, null);
  const decorGround = decorFootprints(territories);
  const layout = layoutDefenses(territories, decorGround);
  return { territories, layout, claimable: territories.filter((t) => t.id !== PVP.centre).map((t) => t.id), decor: allDecorColliders(territories), decorGround };
}

/** A player's side: their plane, their base, their friendly AI. */
export function sideOf(playerId: string): PlayerSide {
  return `p:${playerId}`;
}

/** The player a side belongs to, or null for 'enemy' (the AI) and single-player's 'player'. */
export function ownerOfSide(side: string): string | null {
  return side.startsWith('p:') ? side.slice(2) : null;
}

/** Territory names from the art direction, for messages ("Raid Ann's Notebook Ridge"). */
export const TERRITORY_NAMES: Record<string, string> = {
  T1: 'Home Desk',
  T2: 'Pencil Point',
  T3: 'Notebook Ridge',
  T4: 'Eraser Fields',
  T5: 'Margin Hill',
  T6: 'Ink Valley',
  T7: 'Cardboard Fort',
  T8: 'Ruler Crossing',
  T9: 'Scrap Corner',
  T10: 'Glue Gulch',
  T11: 'Paper Citadel',
  T12: 'Crayon Canyon',
  T13: 'Sharpener Point',
  T14: 'Compass Rise',
  T15: 'Stapler Bay',
  T16: 'Back Row',
};

export function territoryName(id: string): string {
  return TERRITORY_NAMES[id] ?? id;
}

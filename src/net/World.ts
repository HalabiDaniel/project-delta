import { PVP, THREAT, WORLD, type PlayerSide } from '../config';
import { layoutDefenses, type DefenseLayout } from '../defenses/Layout';
import { generateTerritories } from '../world/Grid';
import type { Territory } from '../world/Territory';

/**
 * The shared classroom: the same 3 × 3 territories as single-player but with no home of its own,
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
}

export function sharedWorld(): SharedWorld {
  const territories = generateTerritories(WORLD.gridSize, WORLD.territorySize, WORLD.gap, THREAT.map, null);
  const layout = layoutDefenses(territories, []);
  return { territories, layout, claimable: territories.filter((t) => t.id !== PVP.centre).map((t) => t.id) };
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
  T5: 'Paper Citadel',
  T6: 'Ink Valley',
  T7: 'Cardboard Fort',
  T8: 'Ruler Crossing',
  T9: 'Scrap Corner',
};

export function territoryName(id: string): string {
  return TERRITORY_NAMES[id] ?? id;
}

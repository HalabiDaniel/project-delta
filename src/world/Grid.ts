import { THREAT, WORLD, type ThreatLevel } from '../config';
import { Territory } from './Territory';

/**
 * Lays out gridSize × gridSize square territories, numbered T1… row by row, separated by empty
 * gaps and centred on the origin. `homeId` (T1 by default) belongs to the player; the others get
 * their threat level from `threats` (unlisted ones are unprotected). Multiplayer passes no home:
 * ownership there is decided by the server as players claim territories.
 */
export function generateTerritories(
  gridSize: number = WORLD.gridSize,
  size: number = WORLD.territorySize,
  gap: number = WORLD.gap,
  threats: Readonly<Record<string, ThreatLevel>> = THREAT.map,
  homeId: string | null = WORLD.homeId,
): Territory[] {
  const spacing = size + gap;
  const offset = (gridSize - 1) / 2;
  const territories: Territory[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const id = `T${row * gridSize + col + 1}`;
      const home = id === homeId;
      territories.push(
        new Territory(id, (col - offset) * spacing, (row - offset) * spacing, size, home ? 'player' : null, WORLD.thickness, home ? 0 : (threats[id] ?? 0)),
      );
    }
  }
  return territories;
}

/**
 * Which way a home's runway runs: towards the middle of the classroom, along the desk (the runway
 * lies square on the desk top, so it can't point diagonally). Along z (the desk's depth, the
 * territory's full 40) unless the middle is clearly more to the side.
 */
export function homeHeading(home: { x: number; z: number }): { x: number; z: number } {
  const dx = -home.x;
  const dz = -home.z;
  if (Math.abs(dz) >= Math.abs(dx) - 1e-6) return { x: 0, z: dz > 0 ? 1 : dz < 0 ? -1 : -1 };
  return { x: dx > 0 ? 1 : -1, z: 0 };
}

/** Where a sortie starts on `home`: the start of its runway, which points towards the middle of the room. */
export function launchPoint(home: Territory): { x: number; z: number; yaw: number; dir: { x: number; z: number } } {
  const dir = homeHeading(home);
  const startOffset = WORLD.runwayLength / 2 - 6;
  return { x: home.x - dir.x * startOffset, z: home.z - dir.z * startOffset, yaw: Math.atan2(-dir.x, -dir.z), dir };
}

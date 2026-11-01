import { boundaryDistance } from '../systems/Boundary';
import { AI, WORLD } from '../config';
import type { Point3 } from '../missions/Mission';
import { randRange, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';

/** Platforms count as being under a plane this far beyond their edges, so it keeps clear of their sides too. */
const EDGE_MARGIN = 6;

/** The platform under (x, z), or within `margin` of it, or null over a gap. */
export function platformUnder(territories: readonly Territory[], x: number, z: number, margin = EDGE_MARGIN): Territory | null {
  return territories.find((t) => t.containsXZ(x, z, margin)) ?? null;
}

/**
 * The lowest height to fly at over (x, z): `clearance` above a platform (and a little beyond its
 * edges), and a few metres above platform level over the gaps.
 */
export function floorAt(territories: readonly Territory[], x: number, z: number, clearance: number = AI.clearance): number {
  const t = platformUnder(territories, x, z);
  return t ? t.top + clearance : AI.gapFloor;
}

/**
 * Forward obstacle detection: looks a moment ahead along the flight path for ground it would come
 * too close to. Returns how far below the floor the worst point ahead is (0 when clear).
 */
export function terrainAhead(
  territories: readonly Territory[],
  at: Point3,
  velocity: Point3,
  clearance: number,
  lookAhead: readonly number[] = AI.lookAhead,
): number {
  let worst = Math.max(0, floorAt(territories, at.x, at.z, clearance) - at.y);
  for (const t of lookAhead) {
    const x = at.x + velocity.x * t;
    const y = at.y + velocity.y * t;
    const z = at.z + velocity.z * t;
    worst = Math.max(worst, floorAt(territories, x, z, clearance) - y);
  }
  return worst;
}

/** Yaw and pitch that point from `from` towards `to`, the pitch kept to a comfortable climb or dive. */
export function headingTo(from: Point3, to: Point3, maxPitch = 0.5): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(to.y - from.y, Math.hypot(dx, dz)))) };
}

/**
 * A waypoint route over the given territories, in order: a point near each one's middle (shifted
 * a little so patrols don't all fly the same line) at a cruising height.
 */
export function routeOver(territories: readonly Territory[], ids: readonly string[], rng: Rng, altitude?: number): Point3[] {
  return ids.map((id) => {
    const t = territories.find((x) => x.id === id);
    if (!t) throw new Error(`No territory ${id}`);
    const spread = t.half * 0.45;
    return {
      x: t.x + randRange(rng, -spread, spread),
      y: altitude ?? randRange(rng, AI.patrolAltitude[0], AI.patrolAltitude[1]),
      z: t.z + randRange(rng, -spread, spread),
    };
  });
}

/**
 * A point out beyond the edge of the airspace, out of sight, in the direction of (dx, dz) from the
 * world centre: where aircraft enter and leave the world. With no direction (the middle
 * territory), the far side of the map, where the enemy comes from.
 */
export function edgePoint(dx: number, dz: number, altitude: number): Point3 {
  if (Math.hypot(dx, dz) < 1e-6) dx = dz = 1;
  // Out past the square boundary along the direction: scale until the larger coordinate reaches it.
  const len = Math.max(Math.abs(dx), Math.abs(dz));
  const r = WORLD.boundaryRadius + AI.exitMargin;
  return { x: (dx / len) * r, y: altitude, z: (dz / len) * r };
}

/** Has (x, z) left the airspace far enough to be out of the world? */
export function beyondEdge(x: number, z: number, margin = AI.exitMargin * 0.7): boolean {
  return boundaryDistance(x, z) > WORLD.boundaryRadius + margin;
}

/** Neighbouring territories (sharing an edge of the grid) of `t`. */
export function neighbours(territories: readonly Territory[], t: Territory): Territory[] {
  const spacing = WORLD.territorySize + WORLD.gap;
  return territories.filter((o) => o !== t && Math.abs(o.x - t.x) + Math.abs(o.z - t.z) < spacing * 1.1);
}

/** Length of a route through `points`, starting at `from`. */
export function routeLength(from: Point3, points: readonly Point3[]): number {
  let length = 0;
  let at = from;
  for (const p of points) {
    length += Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z);
    at = p;
  }
  return length;
}

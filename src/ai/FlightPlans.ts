import { AI, AIRCRAFT, type AiRole, type Difficulty, type Side } from '../config';
import type { Point3, TargetZone } from '../missions/Mission';
import { randRange, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import type { AiOrders, AiPurpose, Strike } from './AiAircraft';
import { edgePoint, routeLength, routeOver } from './Navigation';

/** Raiders take their time: the player gets a fair chance to get airborne and meet them. */
const RAID_SPEED: Record<Difficulty, number> = { easy: 13, medium: 14, hard: 15 };

/** A loop round a territory's edges at a height: bombers forming up, patrols circling. */
export function orbit(t: Territory, altitude: number, rng: Rng, radius = t.half * 0.8): Point3[] {
  const start = rng() * Math.PI * 2;
  const dir = rng() < 0.5 ? 1 : -1;
  return [0, 1, 2, 3].map((k) => {
    const a = start + (dir * k * Math.PI) / 2;
    return { x: t.x + Math.cos(a) * radius, y: altitude, z: t.z + Math.sin(a) * radius };
  });
}

/**
 * A bombing raid on T1's paper store: the bomber comes in from beyond `origin`, circles over it to
 * form up (time for the defender to react), crosses the map and lines up for a straight run at the
 * store, then heads back the way it came. With `escort`, a fighter flies on its wing.
 */
export function raidPlan(origin: Territory, store: Strike, skill: Difficulty, id: string, rng: Rng, escort = false, purpose: AiPurpose = 'raid'): AiOrders[] {
  const spawn = edgePoint(origin.x, origin.z, 30);
  const formUp = orbit(origin, 28, rng);
  const last = formUp[formUp.length - 1];
  const mid = { x: (last.x + store.x) / 2, y: 24, z: (last.z + store.z) / 2 };
  const dx = store.x - mid.x;
  const dz = store.z - mid.z;
  const len = Math.hypot(dx, dz) || 1;
  const runIn = { x: store.x - (dx / len) * AI.runIn, y: store.y + AI.bombingAltitude + 2, z: store.z - (dz / len) * AI.runIn };
  const bomber: AiOrders = {
    id, side: 'enemy', role: 'bomber', skill, purpose,
    route: [spawn, ...formUp, mid, runIn],
    loop: false,
    exit: edgePoint(origin.x, origin.z, 32),
    strike: store,
    speed: RAID_SPEED[skill],
  };
  if (!escort) return [bomber];
  const wing: AiOrders = {
    id: `${id}-escort`, side: 'enemy', role: 'fighter', skill, purpose,
    route: [{ x: spawn.x + 12, y: spawn.y + 4, z: spawn.z - 12 }, ...formUp],
    loop: false,
    exit: bomber.exit,
    escort: id,
  };
  return [bomber, wing];
}

/** Seconds a plan's aircraft takes to fly its whole route (to its bombing run, for a raid). */
export function flightTime(orders: AiOrders): number {
  const route = orders.strike ? [...orders.route.slice(1), orders.strike] : orders.route.slice(1);
  return routeLength(orders.route[0], route) / (orders.speed ?? AIRCRAFT[orders.aircraft ?? AI.roles[orders.role]].flight.cruiseSpeed);
}

/**
 * A patrol over `zone` (territory ids, flown in order and round again; a single territory is
 * circled), entering from beyond the first one. Fighters guard the middle of the zone.
 */
export function patrolPlan(territories: readonly Territory[], zone: readonly string[], role: AiRole, skill: Difficulty, id: string, rng: Rng, purpose: AiPurpose, side: Side = 'enemy'): AiOrders {
  const only = zone.length === 1 ? territories.find((t) => t.id === zone[0])! : null;
  const route = only ? orbit(only, randRange(rng, AI.patrolAltitude[0], AI.patrolAltitude[1]), rng) : routeOver(territories, zone, rng);
  const first = territories.find((t) => t.id === zone[0])!;
  const last = territories.find((t) => t.id === zone[zone.length - 1])!;
  const spawn = edgePoint(first.x, first.z, route[0].y);
  const centre = { x: route.reduce((s, p) => s + p.x, 0) / route.length, z: route.reduce((s, p) => s + p.z, 0) / route.length };
  return {
    id, side, role, skill, purpose,
    route: [spawn, ...route],
    loop: true,
    exit: edgePoint(last.x, last.z, route[0].y),
    guard: role === 'fighter' ? centre : undefined,
  };
}

/**
 * A reconnaissance flight: in from beyond the first territory, over each of `path` (circling each
 * one if it `lingers` to take a good look), then out of the world beyond the last one, its
 * checkpoint. Once it has spotted trouble it runs for that exit.
 */
export function scoutPlan(territories: readonly Territory[], path: readonly string[], skill: Difficulty, id: string, rng: Rng, purpose: AiPurpose, linger = false): AiOrders {
  const over = path.map((p) => territories.find((t) => t.id === p)!);
  const altitude = randRange(rng, AI.patrolAltitude[0], AI.patrolAltitude[1]);
  const route = linger ? over.flatMap((t) => orbit(t, altitude, rng, t.half * 0.6)) : routeOver(territories, path, rng, altitude);
  const first = over[0];
  const last = over[over.length - 1];
  // In from the side away from where it is going, out on the far side of where it has been.
  const before = over[1] ?? { x: 0, z: 0 };
  const after = over[over.length - 2] ?? { x: 0, z: 0 };
  return {
    id, side: 'enemy', role: 'scout', skill, purpose,
    route: [edgePoint(first.x - before.x, first.z - before.z, altitude), ...route],
    loop: false,
    exit: edgePoint(last.x - after.x, last.z - after.z, altitude),
  };
}

/** A fighter sent out from beyond `from` after aircraft `prey`. */
export function interceptorPlan(from: Territory, prey: string, skill: Difficulty, id: string, rng: Rng, purpose: AiPurpose): AiOrders {
  const altitude = randRange(rng, AI.patrolAltitude[0], AI.patrolAltitude[1]);
  return {
    id, side: 'enemy', role: 'fighter', skill, purpose,
    route: [edgePoint(from.x, from.z, altitude), { x: from.x, y: altitude, z: from.z }],
    loop: true,
    exit: edgePoint(from.x, from.z, altitude),
    prey,
  };
}

/**
 * The player's own bomber on an escort mission: it comes in from behind home, passes over it, and
 * flies to `target`, where it bombs `zone`; then it heads home and out of the world behind it.
 */
export function friendlyBomberPlan(home: Territory, target: Territory, zone: TargetZone, skill: Difficulty, id: string): AiOrders {
  const spawn = edgePoint(home.x, home.z, 24);
  const dx = zone.x - home.x;
  const dz = zone.z - home.z;
  const len = Math.hypot(dx, dz) || 1;
  const runIn = { x: zone.x - (dx / len) * AI.runIn, y: zone.top + AI.bombingAltitude + 2, z: zone.z - (dz / len) * AI.runIn };
  return {
    id, side: 'player', role: 'bomber', skill, purpose: 'mission',
    route: [spawn, { x: home.x, y: 24, z: home.z }, runIn],
    loop: false,
    exit: edgePoint(home.x, home.z, 26),
    strike: { territoryId: target.id, x: zone.x, y: zone.top, z: zone.z, radius: zone.radius },
    speed: 15,
  };
}

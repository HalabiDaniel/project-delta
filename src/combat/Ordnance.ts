import { DEFENSES, type Side } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import { segmentHit, sweepMoving, type Collider } from './Collision';

export { sweepMoving } from './Collision';

/** A round or rocket leaving a weapon: an installation's, or an AI aircraft's guns. */
export interface ShotOrder {
  kind: 'ink' | 'rocket';
  /** The installation or aircraft that fired it. */
  source: string;
  /** Whose side fired it: it can only hit aircraft of the other side. */
  side: Side;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** The aircraft it was aimed at. A rocket homes on it; for ink it is only bookkeeping. */
  target?: string | null;
  /** An aircraft gun's numbers; installations' ink uses the ink turret's. */
  damage?: number;
  travel?: number;
  radius?: number;
}

/** A round of ink or a paper rocket in flight. */
export interface Shot {
  id: number;
  kind: 'ink' | 'rocket';
  source: string;
  side: Side;
  target: string | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Position at the start of the last step. */
  px: number;
  py: number;
  pz: number;
  age: number;
  travelled: number;
  /** Ink dries up after this far. */
  travel: number;
  damage: number;
  radius: number;
  active: boolean;
}

/**
 * An aircraft, as rounds and rockets see it: where it is now and a step ago, how big a target it
 * is, and whose side it is on.
 */
export interface AircraftTarget {
  id: string;
  side: Side;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  radius: number;
  /** Rockets lose track of it: the player's plane over home. */
  shielded?: boolean;
}

export type FireEvent =
  /** A round struck an aircraft, or a rocket burst next to one. */
  | { type: 'hit'; shot: Shot; target: string; x: number; y: number; z: number }
  /** It came down on a platform. */
  | { type: 'ground'; shot: Shot; territoryId: string; x: number; y: number; z: number }
  /** A round dried up or a rocket ran out of fuel. */
  | { type: 'spent'; shot: Shot; x: number; y: number; z: number };

const ROCKET_PREFIX = 'rocket-';

/**
 * Every round and rocket in flight except the player's own ink: the defenses' (enemy territories'
 * and T1's) and the AI aircraft's guns. Ink flies straight and dries up after its travel; rockets
 * accelerate off the rails and chase the aircraft they were fired at, but can only turn so fast,
 * so a hard turn at the right moment makes them overshoot. A shot only hits aircraft of the other
 * side, swept against each one's own movement every step, so fast planes and fast rounds can't
 * pass through each other. Rockets can be shot down.
 */
export class Ordnance {
  shots: Shot[] = [];
  private nextId = 1;

  spawn(order: ShotOrder): Shot {
    const ink = order.kind === 'ink';
    const turret = DEFENSES.turret.shot;
    const rocket = DEFENSES.launcher.rocket;
    const shot: Shot = {
      id: this.nextId++,
      kind: order.kind,
      source: order.source,
      side: order.side,
      target: order.target ?? null,
      x: order.x, y: order.y, z: order.z,
      vx: order.vx, vy: order.vy, vz: order.vz,
      px: order.x, py: order.y, pz: order.z,
      age: 0,
      travelled: 0,
      travel: order.travel ?? turret.travel,
      damage: order.damage ?? (ink ? turret.damage : rocket.damage),
      radius: order.radius ?? (ink ? turret.radius : rocket.radius),
      active: true,
    };
    this.shots.push(shot);
    return shot;
  }

  /** Moves everything one step. `aircraft` are everything in the air that can be hit. */
  update(dt: number, aircraft: readonly AircraftTarget[], territories: readonly Territory[]): FireEvent[] {
    const events: FireEvent[] = [];
    const rocket = DEFENSES.launcher.rocket;
    for (const s of this.shots) {
      if (!s.active) continue;
      s.px = s.x;
      s.py = s.y;
      s.pz = s.z;
      if (s.kind === 'rocket') {
        const target = aircraft.find((a) => a.id === s.target && !a.shielded) ?? null;
        steerRocket(s, target, dt);
      } else {
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
      }
      s.travelled += Math.hypot(s.x - s.px, s.y - s.py, s.z - s.pz);

      if (s.kind === 'ink' || s.age >= rocket.armTime) {
        let hit: { id: string; t: number } | null = null;
        for (const a of aircraft) {
          if (a.side === s.side || a.id === s.source) continue;
          const reach = s.kind === 'ink' ? s.radius + a.radius : rocket.fuse + a.radius;
          const t = sweepMoving({ x: s.px, y: s.py, z: s.pz }, s, { x: a.px, y: a.py, z: a.pz }, a, reach);
          if (t !== null && (!hit || t < hit.t)) hit = { id: a.id, t };
        }
        if (hit) {
          s.active = false;
          events.push({ type: 'hit', shot: s, target: hit.id, ...along(s, hit.t) });
          continue;
        }
      }
      let ground: { id: string; t: number } | null = null;
      for (const territory of territories) {
        const t = segmentHit({ x: s.px, y: s.py, z: s.pz }, s, s.radius, territory.shape);
        if (t !== null && (!ground || t < ground.t)) ground = { id: territory.id, t };
      }
      if (ground) {
        s.active = false;
        events.push({ type: 'ground', shot: s, territoryId: ground.id, ...along(s, ground.t) });
        continue;
      }
      const spent = s.kind === 'ink' ? s.travelled >= s.travel : s.age >= rocket.life;
      if (spent) {
        s.active = false;
        events.push({ type: 'spent', shot: s, x: s.x, y: s.y, z: s.z });
      }
    }
    this.shots = this.shots.filter((s) => s.active);
    return events;
  }

  /** Spheres around the rockets in flight, so the player's ink can shoot them down. */
  rocketColliders(): Collider[] {
    const r = DEFENSES.launcher.rocket.hitRadius;
    return this.shots
      .filter((s) => s.kind === 'rocket')
      .map((s) => ({ id: `${ROCKET_PREFIX}${s.id}`, shapes: [{ kind: 'sphere', x: s.x, y: s.y, z: s.z, r }] }));
  }

  /** Removes a rocket hit by the player's ink. Returns it, or null if `colliderId` isn't a live rocket. */
  shootDown(colliderId: string): Shot | null {
    if (!colliderId.startsWith(ROCKET_PREFIX)) return null;
    const id = Number(colliderId.slice(ROCKET_PREFIX.length));
    const shot = this.shots.find((s) => s.id === id && s.active) ?? null;
    if (!shot) return null;
    shot.active = false;
    this.shots = this.shots.filter((s) => s.active);
    return shot;
  }

  clear(): void {
    this.shots = [];
  }
}

/** Is `id` one of the rockets' collider ids? */
export function isRocket(id: string): boolean {
  return id.startsWith(ROCKET_PREFIX);
}

/**
 * One step of a paper rocket: it speeds up to cruise, then turns its velocity towards the target,
 * by no more than its turn rate allows. Plain pursuit, with no lead: easy to understand, and easy
 * to make overshoot with a hard turn. With no target it flies straight on until its fuel runs out.
 */
export function steerRocket(s: Shot, target: Point3 | null, dt: number): void {
  const c = DEFENSES.launcher.rocket;
  s.age += dt;
  let speed = Math.hypot(s.vx, s.vy, s.vz);
  let dx = s.vx / (speed || 1);
  let dy = s.vy / (speed || 1);
  let dz = s.vz / (speed || 1);
  speed = Math.min(c.speed, speed + c.accel * dt);
  if (target) {
    let wx = target.x - s.x;
    let wy = target.y - s.y;
    let wz = target.z - s.z;
    const len = Math.hypot(wx, wy, wz);
    if (len > 1e-6) {
      wx /= len;
      wy /= len;
      wz /= len;
      const angle = Math.acos(Math.max(-1, Math.min(1, dx * wx + dy * wy + dz * wz)));
      if (angle > 1e-6) {
        // Turn along the great circle towards the target, at most turnRate × dt.
        const k = Math.min(1, (c.turnRate * dt) / angle);
        const sin = Math.sin(angle);
        const a = Math.sin((1 - k) * angle) / sin;
        const b = Math.sin(k * angle) / sin;
        dx = dx * a + wx * b;
        dy = dy * a + wy * b;
        dz = dz * a + wz * b;
        const n = Math.hypot(dx, dy, dz) || 1;
        dx /= n;
        dy /= n;
        dz /= n;
      }
    }
  }
  s.vx = dx * speed;
  s.vy = dy * speed;
  s.vz = dz * speed;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
}

function along(s: Shot, t: number): { x: number; y: number; z: number } {
  return { x: s.px + (s.x - s.px) * t, y: s.py + (s.y - s.py) * t, z: s.pz + (s.z - s.pz) * t };
}

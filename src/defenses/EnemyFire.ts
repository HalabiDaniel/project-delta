import { segmentHit, type Collider } from '../combat/Collision';
import { DEFENSES } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import type { ShotOrder } from './Installation';

/** A round of enemy ink or a paper rocket in flight. */
export interface EnemyShot {
  id: number;
  kind: 'ink' | 'rocket';
  /** The installation that fired it. */
  source: string;
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
  damage: number;
  radius: number;
  active: boolean;
}

/** The plane, as enemy fire sees it: where it is now, where it was a step ago, and how big a target it is. */
export interface PlaneTarget {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  radius: number;
}

export type FireEvent =
  /** A round struck the plane, or a rocket burst next to it. */
  | { type: 'hit'; shot: EnemyShot; x: number; y: number; z: number }
  /** It came down on a platform. */
  | { type: 'ground'; shot: EnemyShot; territoryId: string; x: number; y: number; z: number }
  /** A round dried up or a rocket ran out of fuel. */
  | { type: 'spent'; shot: EnemyShot; x: number; y: number; z: number };

const ROCKET_PREFIX = 'rocket-';

/**
 * The defenses' rounds and rockets in flight. Ink flies straight and dries up after its travel;
 * rockets accelerate off the rails and chase the plane, but can only turn so fast, so a hard turn
 * at the right moment makes them overshoot. Hits are swept against the plane's own movement each
 * step, so fast planes and fast rounds can't pass through each other. Rockets can be shot down.
 */
export class EnemyFire {
  shots: EnemyShot[] = [];
  private nextId = 1;

  spawn(order: ShotOrder): EnemyShot {
    const ink = order.kind === 'ink';
    const shot: EnemyShot = {
      id: this.nextId++,
      kind: order.kind,
      source: order.source,
      x: order.x, y: order.y, z: order.z,
      vx: order.vx, vy: order.vy, vz: order.vz,
      px: order.x, py: order.y, pz: order.z,
      age: 0,
      travelled: 0,
      damage: ink ? DEFENSES.turret.shot.damage : DEFENSES.launcher.rocket.damage,
      radius: ink ? DEFENSES.turret.shot.radius : DEFENSES.launcher.rocket.radius,
      active: true,
    };
    this.shots.push(shot);
    return shot;
  }

  /**
   * Moves everything one step. `plane` is null when there is nothing to hit (landed, crashed);
   * `homing` false makes rockets fly straight on (the plane is over home).
   */
  update(dt: number, plane: PlaneTarget | null, homing: boolean, territories: readonly Territory[]): FireEvent[] {
    const events: FireEvent[] = [];
    const rocket = DEFENSES.launcher.rocket;
    for (const s of this.shots) {
      if (!s.active) continue;
      s.px = s.x;
      s.py = s.y;
      s.pz = s.z;
      if (s.kind === 'rocket') steerRocket(s, plane && homing ? plane : null, dt);
      else {
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
      }
      s.travelled += Math.hypot(s.x - s.px, s.y - s.py, s.z - s.pz);

      if (plane && (s.kind === 'ink' || s.age >= rocket.armTime)) {
        const reach = s.kind === 'ink' ? s.radius + plane.radius : rocket.fuse + plane.radius;
        const t = sweepMoving({ x: s.px, y: s.py, z: s.pz }, s, { x: plane.px, y: plane.py, z: plane.pz }, plane, reach);
        if (t !== null) {
          s.active = false;
          events.push({ type: 'hit', shot: s, ...along(s, t) });
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
      const spent = s.kind === 'ink' ? s.travelled >= DEFENSES.turret.shot.travel : s.age >= rocket.life;
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
  shootDown(colliderId: string): EnemyShot | null {
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
export function steerRocket(s: EnemyShot, target: Point3 | null, dt: number): void {
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

/**
 * Two points each moving in a straight line over one step (a0 → a1 and b0 → b1): the first
 * fraction of the step at which they come within `radius` of each other, or null. Worked out in
 * b's frame, where it is a ball standing still and a moves along a segment.
 */
export function sweepMoving(a0: Point3, a1: Point3, b0: Point3, b1: Point3, radius: number): number | null {
  return segmentHit(
    { x: a0.x - b0.x, y: a0.y - b0.y, z: a0.z - b0.z },
    { x: a1.x - b1.x, y: a1.y - b1.y, z: a1.z - b1.z },
    0,
    { kind: 'sphere', x: 0, y: 0, z: 0, r: radius },
  );
}

function along(s: EnemyShot, t: number): { x: number; y: number; z: number } {
  return { x: s.px + (s.x - s.px) * t, y: s.py + (s.y - s.py) * t, z: s.pz + (s.z - s.pz) * t };
}

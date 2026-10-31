import { AI, type PilotSkill } from '../config';
import { leadTime } from '../defenses/Installation';
import type { Point3 } from '../missions/Mission';
import type { Rng } from '../systems/Random';

/** What a pilot can see of another aircraft: where it is and how it is moving. */
export interface Moving extends Point3 {
  id: string;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * A pilot's picture of the aircraft it is shooting at. Its idea of the target's velocity catches up
 * with the real one gradually, so a change of course throws its aim off for a moment; it also
 * notices how hard the target is turning, and how long it has been following it.
 */
export class TargetTrack {
  targetId: string | null = null;
  /** The velocity it believes in. */
  readonly velocity = { x: 0, y: 0, z: 0 };
  /** How fast the target's direction of flight is changing (rad/s), smoothed. */
  turnRate = 0;
  /** Seconds spent following this target. */
  time = 0;
  private readonly last = { x: 0, y: 0, z: 0 };
  private fresh = true;

  update(dt: number, target: Moving, lag: number): void {
    if (target.id !== this.targetId) {
      this.targetId = target.id;
      this.velocity.x = this.velocity.y = this.velocity.z = 0;
      this.turnRate = 0;
      this.time = 0;
      this.fresh = true;
    }
    this.time += dt;
    const k = 1 - Math.exp(-dt / lag);
    this.velocity.x += (target.vx - this.velocity.x) * k;
    this.velocity.y += (target.vy - this.velocity.y) * k;
    this.velocity.z += (target.vz - this.velocity.z) * k;
    const speed = Math.hypot(target.vx, target.vy, target.vz);
    if (!this.fresh && speed > 1e-6 && dt > 0) {
      const lastSpeed = Math.hypot(this.last.x, this.last.y, this.last.z) || 1;
      const cos = (target.vx * this.last.x + target.vy * this.last.y + target.vz * this.last.z) / (speed * lastSpeed);
      const rate = Math.acos(Math.max(-1, Math.min(1, cos))) / dt;
      this.turnRate += (rate - this.turnRate) * (1 - Math.exp(-dt / 0.4));
    }
    this.fresh = false;
    this.last.x = target.vx;
    this.last.y = target.vy;
    this.last.z = target.vz;
  }

  reset(): void {
    this.targetId = null;
    this.time = 0;
    this.turnRate = 0;
    this.fresh = true;
  }
}

/**
 * How far either way a pilot's rounds scatter (radians): its skill, made worse the further away the
 * target is, the more their speeds differ and the harder the target turns, and better the longer it
 * has been tracking it. Nobody gets perfect aim.
 */
export function aimSpread(skill: PilotSkill, distance: number, relativeSpeed: number, turnRate: number, trackTime: number): number {
  const a = AI.accuracy;
  return (
    skill.aimError *
    (1 + (a.distance * distance) / 10) *
    (1 + (a.speed * relativeSpeed) / 10) *
    (1 + a.manoeuvre * turnRate) *
    (1 + a.unsettled * Math.exp(-trackTime / a.settle))
  );
}

/**
 * Where to point the guns to hit a target: rounds leave at `shotSpeed` along the nose plus the
 * shooter's own velocity, so the lead is worked out from the target's motion relative to the
 * shooter, using the pilot's (lagging) estimate of it and leading by `skill` (0–1) of it.
 */
export function leadPoint(from: Point3, shooterVelocity: Point3, target: Point3, estimate: Point3, shotSpeed: number, skill: number): Point3 {
  const rel = { x: estimate.x - shooterVelocity.x, y: estimate.y - shooterVelocity.y, z: estimate.z - shooterVelocity.z };
  const t = leadTime(from, target, rel, shotSpeed, skill);
  return { x: target.x + rel.x * t * skill, y: target.y + rel.y * t * skill, z: target.z + rel.z * t * skill };
}

/** A direction turned by a random amount, up to `spread` either way in yaw and in pitch. */
export function scatter(dir: Point3, spread: number, rng: Rng): Point3 {
  const yaw = Math.atan2(-dir.x, -dir.z) + (rng() + rng() - 1) * spread;
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) + (rng() + rng() - 1) * spread;
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Angle between two directions (need not be unit length). */
export function angleBetween(a: Point3, b: Point3): number {
  const la = Math.hypot(a.x, a.y, a.z) || 1;
  const lb = Math.hypot(b.x, b.y, b.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb))));
}

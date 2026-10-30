import { DAMAGE, LANDING } from '../config';
import type { TouchdownState } from '../aircraft/Landing';

/**
 * impact     – flew into a platform, a prop or a pencil stand.
 * landing    – touched down at home outside the landing limits.
 * projectile – hit by ink (nothing shoots back yet; ready for other players).
 * blast      – caught in a bomb blast.
 */
export type DamageSource = 'impact' | 'landing' | 'projectile' | 'blast';

/** Health for anything that can be damaged: aircraft, practice targets, props. */
export class Durability {
  health: number;

  constructor(readonly max: number) {
    this.health = max;
  }

  get fraction(): number {
    return this.health / this.max;
  }

  get destroyed(): boolean {
    return this.health <= 0;
  }

  /** Takes up to `amount` off; returns how much was actually lost. */
  damage(amount: number): number {
    if (amount <= 0 || this.destroyed) return 0;
    const dealt = Math.min(this.health, amount);
    this.health -= dealt;
    return dealt;
  }

  repair(): void {
    this.health = this.max;
  }
}

/**
 * Damage from hitting something with a closing speed (the speed straight into the surface).
 * Gentle contacts are free, so scraping a platform or brushing a prop costs nothing; above the safe
 * speed it grows quickly, and a head-on hit at cruise wrecks any plane.
 */
export function impactDamage(closingSpeed: number): number {
  return Math.round(Math.max(0, closingSpeed - DAMAGE.safeImpactSpeed) * DAMAGE.impactDamage);
}

/**
 * A touchdown at home outside the landing limits. A slightly-too-fast arrival bounces with a
 * scratch; a steep, fast or banked one costs a lot more. Never less than flying into the runway.
 */
export function roughLandingDamage(s: TouchdownState): number {
  const r = DAMAGE.roughLanding;
  const rollDeg = (Math.abs(s.roll) * 180) / Math.PI;
  const maxRollDeg = (LANDING.maxRoll * 180) / Math.PI;
  const rough =
    r.base +
    Math.max(0, s.speed - LANDING.maxSpeed) * r.perSpeed +
    Math.max(0, s.sink - LANDING.maxSink) * r.perSink +
    Math.max(0, rollDeg - maxRollDeg) * r.perRollDeg;
  return Math.max(Math.round(rough), impactDamage(s.sink));
}

/** Share of normal turn and roll response left at a given health fraction. */
export function handlingFactor(healthFraction: number): number {
  const t = Math.min(1, Math.max(0, healthFraction / DAMAGE.handlingThreshold));
  return DAMAGE.handlingFloor + (1 - DAMAGE.handlingFloor) * t;
}

/** How much the wings wobble (radians) at a given health fraction. */
export function wobbleAmount(healthFraction: number): number {
  const t = Math.min(1, Math.max(0, healthFraction / DAMAGE.handlingThreshold));
  return DAMAGE.wobble * (1 - t);
}

/** Blast damage at `distance` from a bomb's impact: full at the centre, 30% at the edge, none beyond. */
export function blastDamage(damage: number, blastRadius: number, distance: number): number {
  if (distance > blastRadius) return 0;
  return Math.round(damage * (1 - 0.7 * (distance / blastRadius)));
}

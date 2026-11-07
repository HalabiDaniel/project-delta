import { STEALTH, type AircraftSpec } from '../config';

/** Why a plane's signature rose for a moment: it fired, opened its bomb bay, or boosted. */
export type Reveal = keyof typeof STEALTH.reveal;

/**
 * v0.0.18: a plane's radar signature right now (plan v0.0.18 §8.A). The design's `signature`, times
 * STEALTH.quiet for a stealth design while it is quiet; firing, bombing or boosting adds a reveal
 * that fades over STEALTH.revealTime, so attacking gives the attacker away. Never zero: a plane is
 * spotted closer, never not at all.
 */
export class RadarSignature {
  /** The strongest reveal still fading, and how long it has left. */
  private amount = 0;
  private left = 0;

  reveal(kind: Reveal): void {
    const add = STEALTH.reveal[kind];
    // The stronger of the fading reveal and the new one, at full strength again.
    const now = this.current;
    this.amount = Math.max(now, add);
    this.left = STEALTH.revealTime;
  }

  update(dt: number): void {
    this.left = Math.max(0, this.left - dt);
    if (this.left === 0) this.amount = 0;
  }

  /** The reveal still added now. */
  get current(): number {
    return this.left > 0 ? (this.amount * this.left) / STEALTH.revealTime : 0;
  }

  /** The plane is giving itself away right now (it fired, bombed or boosted lately). */
  get revealed(): boolean {
    return this.left > 0;
  }

  reset(): void {
    this.amount = 0;
    this.left = 0;
  }

  /** The signature `spec` has right now. */
  valueFor(spec: Pick<AircraftSpec, 'signature' | 'traits'>): number {
    const quiet = spec.traits?.stealth && !this.revealed ? STEALTH.quiet : 1;
    return spec.signature * quiet + this.current;
  }
}

/** How much longer a rocket lock takes on a plane of this signature: 1 at 1 or above, at most STEALTH.maxLock. */
export function lockFactor(signature: number): number {
  return signature >= 1 ? 1 : Math.min(STEALTH.maxLock, 1 / Math.max(0.01, signature));
}

/** hidden – nothing hostile is following it. detected – something is. locked – a launcher is locking on or firing. */
export type DetectionState = 'hidden' | 'detected' | 'locked';

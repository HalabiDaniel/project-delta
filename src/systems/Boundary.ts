import { WORLD } from '../config';

/**
 * inside    – within the airspace.
 * warning   – past the boundary; the countdown is running and the player can still turn back.
 * autopilot – the countdown ran out; the autopilot is flying the plane back towards home.
 */
/**
 * How far out (x, z) is, in the boundary's own measure: the classroom's airspace is a square
 * centred on the world, so this is the larger of |x| and |z| (compare it with WORLD.boundaryRadius).
 */
export function boundaryDistance(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z));
}

export type BoundaryState = 'inside' | 'warning' | 'autopilot';

/**
 * Keeps the plane near the play area. Crossing the boundary (a square around the world centre)
 * starts a countdown. Turning back in time cancels it; otherwise the autopilot takes over and
 * returns control once the plane is comfortably back inside.
 */
export class Boundary {
  state: BoundaryState = 'inside';
  /** Seconds left before the autopilot takes over (meaningful while warning). */
  countdown: number;

  constructor(
    readonly radius: number = WORLD.boundaryRadius,
    readonly countdownTime: number = WORLD.boundaryCountdown,
    readonly returnMargin: number = WORLD.boundaryReturnMargin,
  ) {
    this.countdown = countdownTime;
  }

  update(dt: number, x: number, z: number): BoundaryState {
    const distance = boundaryDistance(x, z);
    switch (this.state) {
      case 'inside':
        if (distance > this.radius) {
          this.state = 'warning';
          this.countdown = this.countdownTime;
        }
        break;
      case 'warning':
        if (distance <= this.radius) {
          this.state = 'inside';
        } else {
          this.countdown -= dt;
          if (this.countdown <= 0) {
            this.countdown = 0;
            this.state = 'autopilot';
          }
        }
        break;
      case 'autopilot':
        if (distance <= this.radius - this.returnMargin) this.state = 'inside';
        break;
    }
    return this.state;
  }

  reset(): void {
    this.state = 'inside';
    this.countdown = this.countdownTime;
  }
}

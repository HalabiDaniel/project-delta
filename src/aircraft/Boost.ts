/**
 * ready    – Shift will boost.
 * active   – boosting: lasts while Shift is held, up to `duration`.
 * cooldown – recharging after a burst.
 */
export type BoostState = 'ready' | 'active' | 'cooldown';

/** The Shift boost's timing. Holding Shift boosts whenever the boost is ready. Each design has its own. */
export class Boost {
  state: BoostState = 'ready';
  private timeLeft = 0;

  constructor(
    public duration: number,
    public cooldown: number,
  ) {}

  get active(): boolean {
    return this.state === 'active';
  }

  /** Meter level for the HUD: full when ready, draining while active, refilling during cooldown. */
  get level(): number {
    switch (this.state) {
      case 'ready': return 1;
      case 'active': return this.timeLeft / this.duration;
      case 'cooldown': return 1 - this.timeLeft / this.cooldown;
    }
  }

  update(dt: number, held: boolean): void {
    switch (this.state) {
      case 'ready':
        if (held) {
          this.state = 'active';
          this.timeLeft = this.duration;
        }
        break;
      case 'active':
        this.timeLeft -= dt;
        if (!held || this.timeLeft <= 0) {
          this.state = 'cooldown';
          this.timeLeft = this.cooldown;
        }
        break;
      case 'cooldown':
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.state = 'ready';
          this.timeLeft = 0;
        }
        break;
    }
  }

  reset(): void {
    this.state = 'ready';
    this.timeLeft = 0;
  }
}

import { ECONOMY } from '../config';
import type { ResourceManager } from './ResourceManager';

/**
 * The home territory's paper production: a small trickle that keeps a broke player from getting
 * stuck. It pauses while the player holds `cap` paper or more, so it is a safety net rather than
 * a way to get rich by waiting.
 */
export class HomeIncome {
  private timer = 0;

  constructor(
    readonly amount: number = ECONOMY.incomeAmount,
    readonly interval: number = ECONOMY.incomeInterval,
    readonly cap: number = ECONOMY.incomeCap,
  ) {}

  isProducing(paper: number): boolean {
    return paper < this.cap;
  }

  /** 0 → 1 progress towards the next payout. */
  get progress(): number {
    return this.timer / this.interval;
  }

  /** Pays out any income due this frame. Returns the amount paid. */
  update(dt: number, resources: ResourceManager): number {
    if (!this.isProducing(resources.paper)) {
      this.timer = 0;
      return 0;
    }
    this.timer += dt;
    let paid = 0;
    while (this.timer >= this.interval && this.isProducing(resources.paper)) {
      this.timer -= this.interval;
      resources.earn(this.amount, 'income');
      paid += this.amount;
    }
    return paid;
  }

  /** Seconds until income alone brings `paper` up to `cost`, or null if the cap stops it short. */
  timeToAfford(paper: number, cost: number): number | null {
    if (paper >= cost) return 0;
    if (cost > this.cap) return null;
    const payouts = Math.ceil((cost - paper) / this.amount);
    return Math.max(0, payouts * this.interval - this.timer);
  }

  reset(): void {
    this.timer = 0;
  }
}

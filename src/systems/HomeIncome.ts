import { ECONOMY } from '../config';
import type { ResourceManager } from './ResourceManager';

/** producing – full rate. slowed – the home store is filling up: half rate. full – paused. */
export type IncomeState = 'producing' | 'slowed' | 'full';

/**
 * The home territory's paper production: a small trickle that keeps a broke player from getting
 * stuck. It slows to half rate once the player holds `taper` paper and pauses at `cap` (the home
 * store is full), so it is a safety net rather than a way to get rich by waiting. It only runs
 * while the game does: nothing accrues while the page is closed, paused or in a background tab.
 */
export class HomeIncome {
  private timer = 0;

  constructor(
    readonly amount: number = ECONOMY.incomeAmount,
    readonly interval: number = ECONOMY.incomeInterval,
    readonly cap: number = ECONOMY.incomeCap,
    readonly taper: number = ECONOMY.incomeTaper,
  ) {}

  stateFor(paper: number): IncomeState {
    return paper >= this.cap ? 'full' : paper >= this.taper ? 'slowed' : 'producing';
  }

  isProducing(paper: number): boolean {
    return paper < this.cap;
  }

  /** Seconds per payout at this balance. */
  intervalFor(paper: number): number {
    return this.stateFor(paper) === 'slowed' ? this.interval * 2 : this.interval;
  }

  /** 0 → 1 progress towards the next payout. */
  progressFor(paper: number): number {
    return Math.min(1, this.timer / this.intervalFor(paper));
  }

  /** Progress at the full rate (kept for callers that don't know the balance). */
  get progress(): number {
    return Math.min(1, this.timer / this.interval);
  }

  /** Pays out any income due this frame. Returns the amount paid. */
  update(dt: number, resources: ResourceManager): number {
    if (!this.isProducing(resources.paper)) {
      this.timer = 0;
      return 0;
    }
    this.timer += dt;
    let paid = 0;
    while (this.isProducing(resources.paper) && this.timer >= this.intervalFor(resources.paper)) {
      this.timer -= this.intervalFor(resources.paper);
      resources.earn(this.amount, 'income', 'Home production');
      paid += this.amount;
    }
    return paid;
  }

  /** Seconds until income alone brings `paper` up to `cost`, or null if the cap stops it short. */
  timeToAfford(paper: number, cost: number): number | null {
    if (paper >= cost) return 0;
    if (cost > this.cap) return null;
    let seconds = -this.timer;
    for (let p = paper; p < cost; p += this.amount) seconds += this.intervalFor(p);
    return Math.max(0, seconds);
  }

  /** Paper produced per minute at this balance. */
  ratePerMinute(paper: number): number {
    return this.isProducing(paper) ? (60 / this.intervalFor(paper)) * this.amount : 0;
  }

  reset(): void {
    this.timer = 0;
  }
}

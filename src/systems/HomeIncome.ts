import { BASE, ECONOMY } from '../config';
import type { ResourceManager } from './ResourceManager';

/**
 * producing – paper comes in at the normal rate.
 * boosted   – the balance is below the protected reserve: the crew scavenges scraps, faster.
 * full      – the store is at capacity: nothing more comes in until paper is spent.
 */
export type IncomeState = 'producing' | 'boosted' | 'full';

export interface IncomeOptions {
  /** Paper per minute (base production plus workshops). */
  perMinute?: number;
  /** Production stops at this balance. */
  capacity?: number;
  /** Below this balance production runs `boost` times faster. */
  reserve?: number;
  boost?: number;
}

/**
 * T1's paper production: base production plus whatever the workshops add, up to the store's
 * capacity. While the balance is below the protected reserve it runs faster, so a broke player is
 * never stuck for long. The base sets the rate and capacity as buildings go up, get damaged or
 * are repaired. It only runs while the game does: nothing accrues while the page is closed,
 * paused or in a background tab.
 */
export class HomeIncome {
  perMinute: number;
  capacity: number;
  reserve: number;
  boost: number;
  /** Fraction of the next paper, 0 → 1. */
  private carry = 0;
  /** Paper paid out by the last update. */
  lastPaid = 0;

  constructor(options: IncomeOptions = {}) {
    this.perMinute = options.perMinute ?? BASE.production;
    this.capacity = options.capacity ?? BASE.capacity;
    this.reserve = options.reserve ?? ECONOMY.protectedPaper;
    this.boost = options.boost ?? BASE.lowBoost;
  }

  stateFor(paper: number): IncomeState {
    return paper >= this.capacity ? 'full' : paper < this.reserve && this.boost > 1 ? 'boosted' : 'producing';
  }

  isProducing(paper: number): boolean {
    return this.ratePerMinute(paper) > 0;
  }

  /** Paper per minute at this balance. */
  ratePerMinute(paper: number): number {
    const state = this.stateFor(paper);
    if (state === 'full') return 0;
    return state === 'boosted' ? this.perMinute * this.boost : this.perMinute;
  }

  /** 0 → 1 progress towards the next paper. */
  progressFor(paper: number): number {
    return this.isProducing(paper) ? Math.min(1, this.carry) : 0;
  }

  get progress(): number {
    return Math.min(1, this.carry);
  }

  /** Pays out any income due this frame. Returns the amount paid. */
  update(dt: number, resources: ResourceManager): number {
    this.lastPaid = 0;
    if (!this.isProducing(resources.paper)) {
      this.carry = 0;
      return 0;
    }
    this.carry += (this.ratePerMinute(resources.paper) * dt) / 60;
    while (this.carry >= 1 && this.isProducing(resources.paper)) {
      this.carry -= 1;
      this.lastPaid += resources.earn(1, 'income', 'Home production');
    }
    if (!this.isProducing(resources.paper)) this.carry = 0;
    return this.lastPaid;
  }

  /** Seconds until income alone brings `paper` up to `cost`, or null if it never will. */
  timeToAfford(paper: number, cost: number): number | null {
    if (paper >= cost) return 0;
    if (cost > this.capacity) return null;
    let seconds = 0;
    for (let p = paper; p < cost; p++) {
      const rate = this.ratePerMinute(p);
      if (rate <= 0) return null;
      seconds += (60 / rate) * (p === paper ? 1 - Math.min(1, this.carry) : 1);
    }
    return Math.max(0, seconds);
  }

  reset(): void {
    this.carry = 0;
  }
}

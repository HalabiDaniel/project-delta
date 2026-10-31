import { ECONOMY } from '../config';

/**
 * Why the balance changed: a purchase, a mission reward, a bonus (operations, streaks, optional
 * objectives, bounties), home income, a successful enemy raid, the dev reset, or a saved game
 * being restored.
 */
export type PaperSource = 'spend' | 'reward' | 'bonus' | 'income' | 'raid' | 'reset' | 'restore';

/** `label` says what it was for, for the paper log: "Folded Falcon", "Mission completed". */
export type PaperListener = (paper: number, delta: number, source: PaperSource, label: string) => void;

/**
 * Owns the player's paper. All costs and rewards go through here, so the total can never become
 * negative: a purchase the player cannot afford is refused and leaves the balance untouched.
 */
export class ResourceManager {
  private _paper: number;
  private readonly listeners: PaperListener[] = [];

  constructor(private readonly startingPaper: number = ECONOMY.startingPaper) {
    assertAmount(startingPaper);
    this._paper = startingPaper;
  }

  get paper(): number {
    return this._paper;
  }

  canAfford(cost: number): boolean {
    assertAmount(cost);
    return this._paper >= cost;
  }

  /** Deducts `cost` and returns true, or returns false and changes nothing if unaffordable. */
  spend(cost: number, label = 'Spent'): boolean {
    if (!this.canAfford(cost)) return false;
    this.set(this._paper - cost, 'spend', label);
    return true;
  }

  earn(amount: number, source: PaperSource = 'reward', label = source === 'income' ? 'Home production' : 'Mission completed'): void {
    assertAmount(amount);
    this.set(this._paper + amount, source, label);
  }

  /**
   * Takes up to `amount` away (an enemy raid got through), but never below `floor`: a protected
   * minimum is always left. Returns how much was actually lost.
   */
  lose(amount: number, floor: number, label = 'Raid on the paper store'): number {
    assertAmount(amount);
    assertAmount(floor);
    const lost = Math.min(amount, Math.max(0, this._paper - floor));
    if (lost > 0) this.set(this._paper - lost, 'raid', label);
    return lost;
  }

  /** Development reset: restores the starting balance. */
  reset(): void {
    this.set(this.startingPaper, 'reset', 'Paper reset');
  }

  /** A saved game's balance, put back on launch. Not a transaction. */
  restore(paper: number): void {
    assertAmount(paper);
    this.set(paper, 'restore', 'Saved game restored');
  }

  onChange(listener: PaperListener): void {
    this.listeners.push(listener);
  }

  private set(value: number, source: PaperSource, label: string): void {
    const delta = value - this._paper;
    this._paper = value;
    if (delta !== 0) for (const listener of this.listeners) listener(value, delta, source, label);
  }
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`Paper amounts must be non-negative integers, got ${amount}`);
  }
}

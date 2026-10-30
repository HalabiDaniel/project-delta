import { ECONOMY } from '../config';

export type PaperListener = (paper: number, delta: number) => void;

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
  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.set(this._paper - cost);
    return true;
  }

  earn(amount: number): void {
    assertAmount(amount);
    this.set(this._paper + amount);
  }

  /** Development reset: restores the starting balance. */
  reset(): void {
    this.set(this.startingPaper);
  }

  onChange(listener: PaperListener): void {
    this.listeners.push(listener);
  }

  private set(value: number): void {
    const delta = value - this._paper;
    this._paper = value;
    if (delta !== 0) for (const listener of this.listeners) listener(value, delta);
  }
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`Paper amounts must be non-negative integers, got ${amount}`);
  }
}

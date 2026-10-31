import { ECONOMY } from '../config';

/**
 * Why the balance changed: a purchase (planes, buildings, upgrades, repairs), a mission reward, a
 * bonus (operations, streaks, optional objectives, bounties), home income, a refund for a removed
 * building, a successful enemy raid, the dev reset, or a saved game being restored.
 */
export type PaperSource = 'spend' | 'reward' | 'bonus' | 'income' | 'refund' | 'raid' | 'reset' | 'restore';

/** Paper that didn't fit: the store was at capacity. */
export type OverflowListener = (lost: number, source: PaperSource, label: string) => void;

/** `label` says what it was for, for the paper log: "Folded Falcon", "Mission completed". */
export type PaperListener = (paper: number, delta: number, source: PaperSource, label: string) => void;

/**
 * Owns the player's paper. All costs and rewards go through here, so the total can never become
 * negative: a purchase the player cannot afford is refused and leaves the balance untouched. The
 * home store holds at most `capacity`: earnings beyond it are lost (storage boxes raise it). A
 * balance already above capacity (an old save) is kept, but nothing more is added until it drops.
 */
export class ResourceManager {
  private _paper: number;
  /** The most paper the store holds. Infinity: no limit (the economy simulation, most tests). */
  capacity = Infinity;
  private readonly listeners: PaperListener[] = [];
  private readonly overflowListeners: OverflowListener[] = [];

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

  /** Adds up to `amount`, as much as fits under the capacity. Returns what was actually added. */
  earn(amount: number, source: PaperSource = 'reward', label = source === 'income' ? 'Home production' : 'Mission completed'): number {
    assertAmount(amount);
    const added = Math.min(amount, Math.max(0, this.capacity - this._paper));
    if (added > 0) this.set(this._paper + added, source, label);
    if (added < amount) for (const listener of this.overflowListeners) listener(amount - added, source, label);
    return added;
  }

  /** Room left under the capacity. */
  get room(): number {
    return Math.max(0, this.capacity - this._paper);
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

  /** Called with what was lost whenever earnings don't fit under the capacity. */
  onOverflow(listener: OverflowListener): void {
    this.overflowListeners.push(listener);
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

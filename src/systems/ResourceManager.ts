import { ECONOMY } from '../config';

/**
 * v0.0.18: the three territory resources (GDD §4.2). Paper builds things; ink loads guns and
 * reloads turrets; rubber balls are bomb payloads. Paper stays the dominant one: anything a
 * recovering player needs is reachable with paper alone, and an empty ink or rubber store never
 * grounds anyone (GameState arms with a free minimum load).
 */
export type Resource = 'paper' | 'ink' | 'rubber';
export const RESOURCES: readonly Resource[] = ['paper', 'ink', 'rubber'];

/** An amount of each resource (missing: none). A cost, a reward, a loss. */
export type Bundle = Partial<Record<Resource, number>>;

/**
 * Why a balance changed: a purchase (planes, buildings, upgrades, repairs), a mission reward, a
 * bonus (operations, streaks, optional objectives, bounties), home income, a refund for a removed
 * building, a successful enemy raid, the dev reset, or a saved game being restored. v0.0.18 adds
 * `arm` (ink and rubber balls loaded onto a plane), `supply` (a defense reloading from the
 * territory's stores) and `upkeep` (high-level buildings, paid from production).
 */
export type PaperSource = 'spend' | 'reward' | 'bonus' | 'income' | 'refund' | 'raid' | 'reset' | 'restore' | 'arm' | 'supply' | 'upkeep';

/** Paper that didn't fit: the store was at capacity. */
export type OverflowListener = (lost: number, source: PaperSource, label: string) => void;

/** `label` says what it was for, for the paper log: "Folded Falcon", "Mission completed". */
export type PaperListener = (paper: number, delta: number, source: PaperSource, label: string) => void;

/** Any resource changed. */
export type ResourceListener = (resource: Resource, value: number, delta: number, source: PaperSource, label: string) => void;

/** Any resource didn't fit under its capacity. */
export type ResourceOverflowListener = (resource: Resource, lost: number, source: PaperSource, label: string) => void;

/** Display names, for logs and refusals. */
export const RESOURCE_NAMES: Record<Resource, string> = { paper: 'paper', ink: 'ink', rubber: 'rubber balls' };

/**
 * Owns the player's paper, ink and rubber balls. All costs and rewards go through here, so no
 * total can ever become negative: a purchase the player cannot afford is refused and leaves every
 * balance untouched (a bundle is all or nothing). Each store holds at most its capacity: earnings
 * beyond it are lost (storage boxes raise it). A balance already above capacity (an old save) is
 * kept, but nothing more is added until it drops.
 *
 * The paper-only methods (`paper`, `spend`, `earn`, `lose`, `onChange`) are the original API and
 * stay as they were; the `…Of` methods take the resource.
 */
export class ResourceManager {
  private readonly amounts: Record<Resource, number>;
  /** The most each store holds. Infinity: no limit (the economy simulation, most tests). */
  readonly capacities: Record<Resource, number> = { paper: Infinity, ink: Infinity, rubber: Infinity };
  private readonly listeners: PaperListener[] = [];
  private readonly overflowListeners: OverflowListener[] = [];
  private readonly anyListeners: ResourceListener[] = [];
  private readonly anyOverflowListeners: ResourceOverflowListener[] = [];
  private readonly starting: Record<Resource, number>;

  constructor(startingPaper: number = ECONOMY.startingPaper, extra: { ink?: number; rubber?: number } = {}) {
    this.starting = { paper: startingPaper, ink: extra.ink ?? ECONOMY.startingInk, rubber: extra.rubber ?? ECONOMY.startingRubber };
    for (const r of RESOURCES) assertAmount(this.starting[r]);
    this.amounts = { ...this.starting };
  }

  get paper(): number {
    return this.amounts.paper;
  }

  get ink(): number {
    return this.amounts.ink;
  }

  get rubber(): number {
    return this.amounts.rubber;
  }

  /** The paper store's capacity (the original single-resource API). */
  get capacity(): number {
    return this.capacities.paper;
  }

  set capacity(value: number) {
    this.capacities.paper = value;
  }

  amount(resource: Resource): number {
    return this.amounts[resource];
  }

  /** Every balance, as a bundle. */
  get all(): Record<Resource, number> {
    return { ...this.amounts };
  }

  canAfford(cost: number): boolean {
    return this.canAffordOf('paper', cost);
  }

  canAffordOf(resource: Resource, cost: number): boolean {
    assertAmount(cost);
    return this.amounts[resource] >= cost;
  }

  /** Every part of the bundle is affordable. */
  canAffordAll(cost: Bundle): boolean {
    return RESOURCES.every((r) => this.canAffordOf(r, cost[r] ?? 0));
  }

  /** What is missing to afford the bundle (empty: affordable). */
  shortfall(cost: Bundle): Bundle {
    const out: Bundle = {};
    for (const r of RESOURCES) {
      const short = (cost[r] ?? 0) - this.amounts[r];
      if (short > 0) out[r] = short;
    }
    return out;
  }

  /** Deducts `cost` and returns true, or returns false and changes nothing if unaffordable. */
  spend(cost: number, label = 'Spent'): boolean {
    return this.spendOf('paper', cost, label);
  }

  spendOf(resource: Resource, cost: number, label = 'Spent', source: PaperSource = 'spend'): boolean {
    if (!this.canAffordOf(resource, cost)) return false;
    this.set(resource, this.amounts[resource] - cost, source, label);
    return true;
  }

  /** Deducts the whole bundle, or nothing at all. */
  spendAll(cost: Bundle, label = 'Spent', source: PaperSource = 'spend'): boolean {
    if (!this.canAffordAll(cost)) return false;
    for (const r of RESOURCES) {
      const c = cost[r] ?? 0;
      if (c > 0) this.set(r, this.amounts[r] - c, source, label);
    }
    return true;
  }

  /** Takes up to `amount` (never more than there is). Returns what was taken. */
  draw(resource: Resource, amount: number, label: string, source: PaperSource = 'arm'): number {
    assertAmount(amount);
    const taken = Math.min(amount, this.amounts[resource]);
    if (taken > 0) this.set(resource, this.amounts[resource] - taken, source, label);
    return taken;
  }

  /** Adds up to `amount`, as much as fits under the capacity. Returns what was actually added. */
  earn(amount: number, source: PaperSource = 'reward', label = source === 'income' ? 'Home production' : 'Mission completed'): number {
    return this.earnOf('paper', amount, source, label);
  }

  earnOf(resource: Resource, amount: number, source: PaperSource = 'reward', label = source === 'income' ? 'Home production' : 'Mission completed'): number {
    assertAmount(amount);
    const added = Math.min(amount, Math.max(0, this.capacities[resource] - this.amounts[resource]));
    if (added > 0) this.set(resource, this.amounts[resource] + added, source, label);
    if (added < amount) {
      if (resource === 'paper') for (const listener of this.overflowListeners) listener(amount - added, source, label);
      for (const listener of this.anyOverflowListeners) listener(resource, amount - added, source, label);
    }
    return added;
  }

  /** Earns every part of a bundle. Returns what was actually added of each. */
  earnAll(amounts: Bundle, source: PaperSource = 'reward', label?: string): Bundle {
    const out: Bundle = {};
    for (const r of RESOURCES) {
      const a = amounts[r] ?? 0;
      if (a > 0) out[r] = this.earnOf(r, a, source, label);
    }
    return out;
  }

  /** Room left under the paper capacity. */
  get room(): number {
    return this.roomOf('paper');
  }

  roomOf(resource: Resource): number {
    return Math.max(0, this.capacities[resource] - this.amounts[resource]);
  }

  /**
   * Takes up to `amount` away (an enemy raid got through), but never below `floor`: a protected
   * minimum is always left. Returns how much was actually lost.
   */
  lose(amount: number, floor: number, label = 'Raid on the paper store'): number {
    return this.loseOf('paper', amount, floor, label);
  }

  loseOf(resource: Resource, amount: number, floor: number, label = `Raid on the ${RESOURCE_NAMES[resource]} store`): number {
    assertAmount(amount);
    assertAmount(floor);
    const lost = Math.min(amount, Math.max(0, this.amounts[resource] - floor));
    if (lost > 0) this.set(resource, this.amounts[resource] - lost, 'raid', label);
    return lost;
  }

  /** Development reset: restores the starting balances. */
  reset(): void {
    for (const r of RESOURCES) this.set(r, this.starting[r], 'reset', r === 'paper' ? 'Paper reset' : 'Resources reset');
  }

  /** A saved game's balance, put back on launch. Not a transaction. */
  restore(paper: number): void {
    this.restoreOf('paper', paper);
  }

  restoreOf(resource: Resource, value: number): void {
    assertAmount(value);
    this.set(resource, value, 'restore', 'Saved game restored');
  }

  onChange(listener: PaperListener): void {
    this.listeners.push(listener);
  }

  /** Called with what was lost whenever paper earnings don't fit under the capacity. */
  onOverflow(listener: OverflowListener): void {
    this.overflowListeners.push(listener);
  }

  /** Every change to any resource (paper included). */
  onAnyChange(listener: ResourceListener): void {
    this.anyListeners.push(listener);
  }

  onAnyOverflow(listener: ResourceOverflowListener): void {
    this.anyOverflowListeners.push(listener);
  }

  private set(resource: Resource, value: number, source: PaperSource, label: string): void {
    const delta = value - this.amounts[resource];
    this.amounts[resource] = value;
    if (delta === 0) return;
    if (resource === 'paper') for (const listener of this.listeners) listener(value, delta, source, label);
    for (const listener of this.anyListeners) listener(resource, value, delta, source, label);
  }
}

/** A bundle with only its non-zero parts, rounded to whole units. */
export function cleanBundle(b: Bundle): Bundle {
  const out: Bundle = {};
  for (const r of RESOURCES) {
    const v = Math.round(b[r] ?? 0);
    if (v > 0) out[r] = v;
  }
  return out;
}

/** "40 paper · 6 ink · 2 rubber balls". */
export function describeBundle(b: Bundle, names: Record<string, string> = RESOURCE_NAMES, nothing = 'nothing'): string {
  return RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `${b[r]} ${names[r]}`).join(' · ') || nothing;
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`Resource amounts must be non-negative integers, got ${amount}`);
  }
}

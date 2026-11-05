import type { PaperSource, ResourceManager } from '../../src/systems/ResourceManager';

/** One change to a player's paper, as it goes to the ledger. */
export interface PaperChange {
  /** The idempotency key: the same key twice is the same change, applied once. */
  key: string;
  kind: PaperSource | 'production';
  /** Positive: paper in. Negative: paper out. */
  amount: number;
  reason: string;
}

/** How long production may pile up before it goes to the ledger (s). */
export const PRODUCTION_EVERY = 60;

/**
 * A player's paper changes, written down as they happen, for the room to send to the ledger in
 * order. The rules (`ResourceManager`, `GameState`, `Base`) decide every change in the world
 * synchronously; this journal turns each into a ledger entry with a key built from its cause.
 *
 * - `keyFor` names causes that must never pay twice even across restarts ("mission:<id>",
 *   "raid:<id>:loss"); everything else is keyed by the stint (one placement of the base) and a
 *   serial number, so a retried write is still applied once.
 * - Production is gathered and credited at most once a minute (`prod:<stint>:<n>`), and always
 *   before a spend, so the ledger never sees a debit of paper it hasn't been credited yet.
 * - A balance put back from the store (`restore`) is not a change.
 */
export class PaperJournal {
  private readonly pending: PaperChange[] = [];
  private income = 0;
  private incomeAge = 0;
  private serial = 0;
  private productions = 0;

  constructor(
    readonly stint: string,
    resources: ResourceManager,
    private readonly keyFor: (source: PaperSource, label: string) => string | null = () => null,
  ) {
    resources.onChange((_paper, delta, source, label) => this.record(delta, source, label));
  }

  private record(delta: number, source: PaperSource, label: string): void {
    if (source === 'restore' || delta === 0) return;
    if (source === 'income') {
      this.income += delta;
      return;
    }
    // Paper produced so far is credited before anything is taken.
    if (delta < 0) this.flushProduction();
    const key = this.keyFor(source, label) ?? `${source}:${this.stint}:${++this.serial}`;
    this.pending.push({ key, kind: source, amount: delta, reason: label });
  }

  /** Time passed (s): production is credited once it has waited PRODUCTION_EVERY. */
  tick(dt: number): void {
    if (this.income <= 0) return;
    this.incomeAge += dt;
    if (this.incomeAge >= PRODUCTION_EVERY) this.flushProduction();
  }

  /** Production gathered so far goes to the ledger now (the player is leaving, or is about to spend). */
  flushProduction(): void {
    if (this.income > 0) this.pending.push({ key: `prod:${this.stint}:${++this.productions}`, kind: 'production', amount: this.income, reason: 'Home production' });
    this.income = 0;
    this.incomeAge = 0;
  }

  /** The changes written since the last call, oldest first. */
  take(): PaperChange[] {
    return this.pending.splice(0);
  }

  /** Paper produced but not yet in the ledger. */
  get unflushed(): number {
    return this.income;
  }
}

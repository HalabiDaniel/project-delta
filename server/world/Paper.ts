import type { PaperSource, Resource, ResourceManager } from '../../src/systems/ResourceManager';
import { RESOURCES } from '../../src/systems/ResourceManager';

/** One change to a player's paper, ink or rubber balls, as it goes to the ledger. */
export interface PaperChange {
  /** The idempotency key: the same key twice is the same change, applied once. */
  key: string;
  kind: PaperSource | 'production';
  /** Positive: in. Negative: out. */
  amount: number;
  reason: string;
  /** v0.0.18: which balance (paper when absent). */
  resource?: Resource;
}

/** How long production may pile up before it goes to the ledger (s). */
export const PRODUCTION_EVERY = 60;

/**
 * A player's resource changes, written down as they happen, for the room to send to the ledger in
 * order. The rules (`ResourceManager`, `GameState`, `Base`) decide every change in the world
 * synchronously; this journal turns each into a ledger entry with a key built from its cause.
 *
 * - `keyFor` names causes that must never pay twice even across restarts ("mission:<id>",
 *   "raid:<id>:loss"); everything else is keyed by the stint (one placement of the base) and a
 *   serial number, so a retried write is still applied once. Ink and rubber-ball changes add the
 *   resource to the key ("mission:<id>:ink"), so one cause can touch several balances.
 * - Production is gathered per resource and credited at most once a minute (`prod:<stint>:<n>`),
 *   and always before a spend, so the ledger never sees a debit it hasn't been credited for yet.
 * - A balance put back from the store (`restore`) is not a change.
 */
export class PaperJournal {
  private readonly pending: PaperChange[] = [];
  private readonly income: Record<Resource, number> = { paper: 0, ink: 0, rubber: 0 };
  private incomeAge = 0;
  private serial = 0;
  private productions = 0;

  constructor(
    readonly stint: string,
    resources: ResourceManager,
    private readonly keyFor: (source: PaperSource, label: string, resource: Resource) => string | null = () => null,
  ) {
    resources.onAnyChange((resource, _value, delta, source, label) => this.record(resource, delta, source, label));
  }

  private record(resource: Resource, delta: number, source: PaperSource, label: string): void {
    if (source === 'restore' || delta === 0) return;
    if (source === 'income') {
      this.income[resource] += delta;
      return;
    }
    // What was produced so far is credited before anything is taken.
    if (delta < 0) this.flushProduction();
    const cause = this.keyFor(source, label, resource);
    const base = cause ?? `${source}:${this.stint}:${++this.serial}`;
    const key = resource === 'paper' ? base : `${base}:${resource}`;
    const change: PaperChange = { key, kind: source, amount: delta, reason: label };
    if (resource !== 'paper') change.resource = resource;
    this.pending.push(change);
  }

  /** Time passed (s): production is credited once it has waited PRODUCTION_EVERY. */
  tick(dt: number): void {
    if (!RESOURCES.some((r) => this.income[r] > 0)) return;
    this.incomeAge += dt;
    if (this.incomeAge >= PRODUCTION_EVERY) this.flushProduction();
  }

  /** Production gathered so far goes to the ledger now (the player is leaving, or is about to spend). */
  flushProduction(): void {
    const any = RESOURCES.some((r) => this.income[r] > 0);
    if (any) {
      const n = ++this.productions;
      for (const r of RESOURCES) {
        if (this.income[r] <= 0) continue;
        const change: PaperChange = { key: r === 'paper' ? `prod:${this.stint}:${n}` : `prod:${this.stint}:${n}:${r}`, kind: 'production', amount: this.income[r], reason: r === 'paper' ? 'Home production' : r === 'ink' ? 'Ink production' : 'Rubber balls scavenged' };
        if (r !== 'paper') change.resource = r;
        this.pending.push(change);
        this.income[r] = 0;
      }
    }
    this.incomeAge = 0;
  }

  /** The changes written since the last call, oldest first. */
  take(): PaperChange[] {
    return this.pending.splice(0);
  }

  /** Paper produced but not yet in the ledger. */
  get unflushed(): number {
    return this.income.paper;
  }

  /** Any resource produced but not yet in the ledger. */
  unflushedOf(resource: Resource): number {
    return this.income[resource];
  }
}

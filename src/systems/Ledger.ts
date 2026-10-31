import { AIRCRAFT_ORDER, ECONOMY, type AircraftId } from '../config';
import type { MissionType } from '../missions/Mission';
import type { PaperSource, ResourceManager } from './ResourceManager';

/** One line of the paper log: "Folded Falcon −25", "Mission completed +80". */
export interface Transaction {
  /** When it happened (ms since the epoch). */
  at: number;
  delta: number;
  /** The balance right after it. */
  balance: number;
  source: Exclude<PaperSource, 'restore'>;
  label: string;
  /** Home production is gathered into one line per stretch: how many payouts it holds. */
  count: number;
}

/** Paper put into and taken out of one bucket (an aircraft design or a mission type). */
export interface Efficiency {
  sorties: number;
  successes: number;
  /** Planes lost. */
  lost: number;
  /** Paper spent on folding and refitting. */
  spent: number;
  /** Paper earned from missions (and their bonuses). */
  earned: number;
}

/** Where paper came from and went, overall. */
export interface EconomyTotals {
  earned: number;
  spent: number;
  income: number;
  bonuses: number;
  raids: number;
}

/** What one sortie cost and earned, for the efficiency statistics. */
export interface SortieEconomy {
  aircraft: AircraftId;
  type: MissionType | null;
  spent: number;
  earned: number;
  success: boolean;
  lost: boolean;
}

export const emptyEfficiency = (): Efficiency => ({ sorties: 0, successes: 0, lost: 0, spent: 0, earned: 0 });

/**
 * The economic log: every change to the paper balance with what it was for, plus running totals
 * and, per aircraft and per mission type, how much paper went in and came out. That shows the
 * player where paper comes from, and shows the designer which planes or missions pay too much.
 */
export class Ledger {
  readonly entries: Transaction[] = [];
  readonly totals: EconomyTotals = { earned: 0, spent: 0, income: 0, bonuses: 0, raids: 0 };
  readonly byAircraft = new Map<AircraftId, Efficiency>();
  readonly byType = new Map<MissionType, Efficiency>();

  constructor(
    private readonly size: number = ECONOMY.ledgerSize,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records every change to `resources` from now on. */
  watch(resources: ResourceManager): void {
    resources.onChange((paper, delta, source, label) => this.record(delta, paper, source, label));
  }

  record(delta: number, balance: number, source: PaperSource, label: string): void {
    if (source === 'restore' || delta === 0) return;
    if (source === 'income') this.totals.income += delta;
    else if (source === 'bonus') this.totals.bonuses += delta;
    else if (source === 'raid') this.totals.raids -= delta;
    if (delta > 0) this.totals.earned += delta;
    else if (source === 'spend') this.totals.spent -= delta;
    const last = this.entries[this.entries.length - 1];
    if (source === 'income' && last?.source === 'income') {
      last.delta += delta;
      last.balance = balance;
      last.count++;
      last.at = this.now();
      return;
    }
    this.entries.push({ at: this.now(), delta, balance, source, label, count: 1 });
    if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
  }

  /** The newest entries first. */
  recent(count: number): Transaction[] {
    return this.entries.slice(-count).reverse();
  }

  /** A sortie is over: what it cost and earned goes to its aircraft and mission type. */
  recordSortie(s: SortieEconomy): void {
    const buckets = [bucket(this.byAircraft, s.aircraft), ...(s.type ? [bucket(this.byType, s.type)] : [])];
    for (const b of buckets) {
      b.sorties++;
      if (s.success) b.successes++;
      if (s.lost) b.lost++;
      b.spent += s.spent;
      b.earned += s.earned;
    }
  }

  /** Paper earned per paper spent, for each aircraft that has flown. */
  aircraftReturns(): Array<{ id: AircraftId; ratio: number | null } & Efficiency> {
    return AIRCRAFT_ORDER.filter((id) => this.byAircraft.has(id)).map((id) => {
      const e = this.byAircraft.get(id)!;
      return { id, ...e, ratio: e.spent > 0 ? e.earned / e.spent : null };
    });
  }

  /** Brings back a saved log. */
  load(entries: readonly Transaction[], totals: EconomyTotals, byAircraft: ReadonlyMap<AircraftId, Efficiency>, byType: ReadonlyMap<MissionType, Efficiency>): void {
    this.entries.length = 0;
    this.entries.push(...entries.slice(-this.size));
    Object.assign(this.totals, totals);
    this.byAircraft.clear();
    for (const [k, v] of byAircraft) this.byAircraft.set(k, { ...v });
    this.byType.clear();
    for (const [k, v] of byType) this.byType.set(k, { ...v });
  }
}

function bucket<K>(map: Map<K, Efficiency>, key: K): Efficiency {
  let b = map.get(key);
  if (!b) map.set(key, (b = emptyEfficiency()));
  return b;
}

import { DEFAULT_PREFS, activeEffects, cleanPrefs, encodeRank, isTierPromotion, progressFor, rankFor, type RankPrefs, type RankStep } from '../../src/ranks/Ranks';
import type { RankDTO } from '../../src/net/protocol';
import type { Store } from '../store/Store';
import { backfillAward, type MeritEvent } from './Merit';

/** One player's rank as the room keeps it while they are in the session. */
export interface RankEntry {
  accountId: string;
  merit: number;
  prefs: RankPrefs;
  step: RankStep;
}

/** A promotion, for the room to tell the player (and, for a new rank name, the session). */
export interface Promotion {
  id: string;
  from: RankStep;
  to: RankStep;
}

type Queue = <T>(playerId: string, work: (store: Store) => Promise<T>) => Promise<T>;

/**
 * v0.0.17: the ranks of a session's players. Merit goes to the ledger through the room's write
 * queue (one player's writes in order); the total that comes back decides the rank, never a number
 * the room keeps on its own. The highest step a player has held is saved with their prefs, so a
 * retuned curve never takes a rank away; equipped titles, cards and effects are checked against
 * what the rank has unlocked, so a modified client can't show anything it hasn't earned.
 */
export class RankKeeper {
  private readonly players = new Map<string, RankEntry>();

  constructor(private readonly queue: Queue) {}

  get(id: string): RankEntry | null {
    return this.players.get(id) ?? null;
  }

  forget(id: string): void {
    this.players.delete(id);
  }

  /**
   * Loads a joining player's Merit and prefs. `stats`: their saved lifetime statistics, for the
   * one-off backfill (awarded once, whatever happens: its key never changes).
   */
  async load(id: string, accountId: string, stats: Record<string, number> | null): Promise<RankEntry> {
    const backfill = backfillAward(stats);
    const [merit, raw] = await this.queue(accountId, async (store) => {
      if (backfill) await store.awardMerit({ playerId: accountId, ...backfill });
      return Promise.all([store.merit(accountId), store.rankPrefs(accountId)]);
    });
    const peak = cleanPrefs(raw, rankFor(0)).peak;
    const step = rankFor(merit, peak);
    const entry: RankEntry = { accountId, merit, step, prefs: { ...cleanPrefs(raw, step), peak: step.index } };
    this.players.set(id, entry);
    if (entry.prefs.peak !== peak) void this.savePrefs(entry);
    return entry;
  }

  /** Sends one award to the ledger; resolves with the promotion it brought, if any. */
  async award(e: MeritEvent, accountId: string): Promise<Promotion | null> {
    const result = await this.queue(accountId, (store) => store.awardMerit({ playerId: accountId, key: e.key, source: e.source, amount: e.amount, reason: e.reason }));
    const entry = this.players.get(e.player);
    if (!entry || entry.accountId !== accountId) return null;
    entry.merit = Math.max(entry.merit, result.total);
    const to = rankFor(entry.merit, entry.prefs.peak);
    if (to.index <= entry.step.index) return null;
    const from = entry.step;
    entry.step = to;
    entry.prefs.peak = to.index;
    void this.savePrefs(entry);
    return { id: e.player, from, to };
  }

  /** The player asks to equip a title, a card or effects: only what they have unlocked is kept. */
  setPrefs(id: string, raw: unknown): RankEntry | null {
    const entry = this.players.get(id);
    if (!entry || !raw || typeof raw !== 'object') return null;
    const clean = cleanPrefs(raw, entry.step);
    entry.prefs = { ...clean, peak: entry.prefs.peak };
    void this.savePrefs(entry);
    return entry;
  }

  private savePrefs(entry: RankEntry): Promise<void> {
    const prefs = { ...entry.prefs } as unknown as Record<string, unknown>;
    return this.queue(entry.accountId, (store) => store.setRankPrefs(entry.accountId, prefs)).catch(() => undefined);
  }

  /** What other players see (the schema's `rank` field). */
  publicRank(id: string): string {
    const e = this.players.get(id);
    return e ? encodeRank(e.step, activeEffects(e.step, e.prefs)) : '';
  }

  /** What the player sees of their own rank. */
  dto(id: string): RankDTO | null {
    const e = this.players.get(id);
    if (!e) return null;
    const p = progressFor(e.merit, e.step);
    return { merit: e.merit, index: e.step.index, into: p.into, needed: p.needed, title: e.prefs.title, card: e.prefs.card, off: [...e.prefs.off] };
  }
}

export { isTierPromotion, DEFAULT_PREFS };

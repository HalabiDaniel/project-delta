import { RIVALRY, type ReputationKind } from '../../src/config';
import type { PvpKind } from '../store/Store';
import type { SocialData } from './SocialData';

/** One thing that happened between two players, as rivalries see it. */
export interface Encounter {
  id: string;
  kind: PvpKind;
  /** The player who did it (raided, shot down, defended, helped, contributed) and the one it was done to (or for). */
  attacker: string;
  victim: string;
  success: boolean;
  /** World time. */
  at: number;
}

/** Between one player and another, from the first's side. */
export interface PairRecord {
  other: string;
  /** Times the first beat the second (kills, raids that got through, challenges won, defenses), and the other way round. */
  wins: number;
  losses: number;
  /** Times they helped each other (cooperation, assists on the same target, bounties shared are not here). */
  helps: number;
  /** World times of the last win and the last loss. */
  lastWin: number;
  lastLoss: number;
  encounters: number;
}

/** Kinds where `attacker` beat `victim` (when successful). */
const BEATS: ReadonlySet<PvpKind> = new Set<PvpKind>(['kill', 'raid', 'challenge', 'defend']);

/**
 * Who fought whom (plan v0.0.19 §5, GDD §12.3): kills, assists, raids, defenses, challenges and
 * cooperation between specific players, remembered for RIVALRY.memory. Built from the pvp_records
 * the store keeps (read back when a player joins) and from what happens in the session, so it
 * survives restarts. Rivalries only steer which card the director offers and what it says; they
 * never change combat, and never override a protection.
 */
export class RivalryBook {
  private readonly encounters: Encounter[] = [];
  private readonly ids = new Set<string>();

  /** Something happened (or is remembered from before, by id: never counted twice). */
  record(e: Encounter): void {
    if (this.ids.has(e.id) || e.attacker === e.victim) return;
    this.ids.add(e.id);
    let i = this.encounters.length;
    while (i > 0 && this.encounters[i - 1].at > e.at) i--;
    this.encounters.splice(i, 0, { ...e });
  }

  /** Forgets what is older than RIVALRY.memory (world time `now`). */
  prune(now: number): void {
    while (this.encounters.length > 0 && now - this.encounters[0].at > RIVALRY.memory) {
      this.ids.delete(this.encounters[0].id);
      this.encounters.shift();
    }
  }

  /** Everyone `id` has a history with, from `id`'s side, most encounters first. */
  rivals(id: string): PairRecord[] {
    const by = new Map<string, PairRecord>();
    const get = (other: string) => {
      let r = by.get(other);
      if (!r) {
        r = { other, wins: 0, losses: 0, helps: 0, lastWin: -Infinity, lastLoss: -Infinity, encounters: 0 };
        by.set(other, r);
      }
      return r;
    };
    for (const e of this.encounters) {
      if (e.attacker !== id && e.victim !== id) continue;
      const other = e.attacker === id ? e.victim : e.attacker;
      const r = get(other);
      r.encounters++;
      if (e.kind === 'coop' || e.kind === 'assist') {
        if (e.kind === 'coop') r.helps++;
        continue;
      }
      if (!BEATS.has(e.kind) || !e.success) continue;
      if (e.attacker === id) {
        r.wins++;
        r.lastWin = Math.max(r.lastWin, e.at);
      } else {
        r.losses++;
        r.lastLoss = Math.max(r.lastLoss, e.at);
      }
    }
    return [...by.values()].sort((a, b) => b.encounters - a.encounters || a.other.localeCompare(b.other));
  }

  between(a: string, b: string): PairRecord | undefined {
    return this.rivals(a).find((r) => r.other === b);
  }

  /** The player who has beaten `id` most often (at least RIVALRY.nemesisMin times), the most recent breaking a tie. */
  nemesisOf(id: string): PairRecord | null {
    let best: PairRecord | null = null;
    for (const r of this.rivals(id)) {
      if (r.losses < RIVALRY.nemesisMin) continue;
      if (!best || r.losses > best.losses || (r.losses === best.losses && r.lastLoss > best.lastLoss)) best = r;
    }
    return best;
  }

  /** Did `by` raid `victim` (whatever came of it) within `window` seconds of `now`? */
  raidedRecently(by: string, victim: string, now: number, window: number): boolean {
    return this.encounters.some((e) => (e.kind === 'raid' || e.kind === 'challenge') && e.attacker === by && e.victim === victim && now - e.at <= window);
  }
}

/** What a player is known for, from their lifetime counts (null: nothing yet). Never changes combat. */
export function reputationOf(s: SocialData): ReputationKind | null {
  const counts: Array<[ReputationKind, number]> = [
    ['raider', s.reputation.raids],
    ['defender', s.reputation.defends],
    ['ace', s.reputation.kills],
    ['helper', s.reputation.helps],
  ];
  const [kind, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n >= RIVALRY.reputationMin ? kind : null;
}

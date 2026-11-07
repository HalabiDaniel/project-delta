import { randomUUID } from 'node:crypto';
import { MERIT } from '../../src/config';

/** What earned an award (the ledger's `source`). */
export type MeritSource = 'mission' | 'kill' | 'assist' | 'ai-kill' | 'raid' | 'defend' | 'active' | 'placement' | 'daily' | 'backfill' | 'medal' | 'achievement';

/** One award as the world decides it: the player by public id, keyed by its cause. */
export interface MeritEvent {
  player: string;
  key: string;
  source: MeritSource;
  amount: number;
  reason: string;
}

/**
 * v0.0.17: the Merit a session's play earns, decided from the world's own records (never from what
 * a client says). Every award is keyed by its cause, so the ledger applies it once whatever happens
 * on the way: kills by the kill's id, raids by the raid's, missions by the card's. Session-local
 * sources (AI planes, active time) are keyed by this book's own id.
 *
 * The anti-farming rules live here:
 * - shooting down the same player again in a session pays less each time (MERIT.repeatKill), and
 *   raids between the same two players likewise (MERIT.repeatRaid);
 * - a player under new-player protection is worth a share of a shoot-down;
 * - AI planes and active time are capped per session; only time flying counts (an idle plane on
 *   the pad earns nothing).
 */
export class MeritBook {
  private readonly out: MeritEvent[] = [];
  private readonly kills = new Map<string, number>();
  private readonly assists = new Map<string, number>();
  private readonly raids = new Map<string, number>();
  private readonly aiKills = new Map<string, number>();
  private readonly flown = new Map<string, { time: number; awards: number }>();

  constructor(readonly id: string = randomUUID()) {}

  private add(player: string, key: string, source: MeritSource, amount: number, reason: string): void {
    const n = Math.round(amount);
    if (n > 0) this.out.push({ player, key, source, amount: n, reason });
  }

  private repeat(book: Map<string, number>, pair: string, table: readonly number[]): number {
    const n = book.get(pair) ?? 0;
    book.set(pair, n + 1);
    return table[Math.min(n, table.length - 1)];
  }

  /** `killer` shot down `victim` (kill `killId`). */
  kill(killer: string, victim: string, killId: string, victimName: string, victimProtected: boolean): void {
    const share = this.repeat(this.kills, `${killer}>${victim}`, MERIT.repeatKill) * (victimProtected ? MERIT.protectedShare : 1);
    this.add(killer, `kill:${killId}`, 'kill', MERIT.playerKill * share, `Shot down ${victimName}`);
  }

  /** `helper` helped shoot down `victim` (kill `killId`). */
  assist(helper: string, victim: string, killId: string, victimName: string, victimProtected: boolean): void {
    const share = this.repeat(this.assists, `${helper}>${victim}`, MERIT.repeatKill) * (victimProtected ? MERIT.protectedShare : 1);
    this.add(helper, `assist:${killId}:${helper}`, 'assist', MERIT.playerAssist * share, `Assist on ${victimName}`);
  }

  /** `player` shot down an AI plane (capped per session). */
  aiKill(player: string, aircraftId: string, label: string): void {
    const n = this.aiKills.get(player) ?? 0;
    if (n * MERIT.aiKill >= MERIT.aiKillCap) return;
    this.aiKills.set(player, n + 1);
    this.add(player, `ai:${this.id}:${aircraftId}`, 'ai-kill', MERIT.aiKill, `Shot down ${label}`);
  }

  /** `player` completed mission `missionId` (its card's id) of tier `tier`. */
  mission(player: string, missionId: string, tier: number, title: string): void {
    const value = MERIT.mission[Math.max(0, Math.min(MERIT.mission.length - 1, Math.round(tier) - 1))];
    this.add(player, `mission:${missionId}`, 'mission', value, title);
  }

  /** v0.0.18: a medal for mission `missionId` (its card's id): once per mission. */
  medal(player: string, missionId: string, medal: 'bronze' | 'silver' | 'gold', title: string): void {
    this.add(player, `medal:${missionId}`, 'medal', MERIT.medal[medal], `${medal[0].toUpperCase()}${medal.slice(1)} medal: ${title}`);
  }

  /** v0.0.18: an achievement unlocked: once ever (the key is the achievement's). */
  achievement(player: string, id: string, title: string): void {
    this.add(player, `achievement:${id}`, 'achievement', MERIT.achievement, `Achievement: ${title}`);
  }

  /** `attacker`'s raid `raidId` on `victim` got through. */
  raid(attacker: string, victim: string, raidId: string, victimName: string): void {
    const share = this.repeat(this.raids, [attacker, victim].sort().join('|'), MERIT.repeatRaid);
    this.add(attacker, `raid:${raidId}`, 'raid', MERIT.raid * share, `Raided ${victimName}`);
  }

  /** `defender` repelled `attacker`'s raid `raidId` themselves. */
  defend(defender: string, attacker: string, raidId: string, attackerName: string): void {
    const share = this.repeat(this.raids, [attacker, defender].sort().join('|'), MERIT.repeatRaid);
    this.add(defender, `defend:${raidId}`, 'defend', MERIT.defend * share, `Defended against ${attackerName}`);
  }

  /** `player` flew for `dt` seconds (only time in the air counts, capped per session). */
  fly(player: string, dt: number): void {
    const f = this.flown.get(player) ?? { time: 0, awards: 0 };
    this.flown.set(player, f);
    if (f.awards * MERIT.active.amount >= MERIT.active.cap) return;
    f.time += dt;
    if (f.time < MERIT.active.every) return;
    f.time -= MERIT.active.every;
    f.awards++;
    this.add(player, `active:${this.id}:${player}:${f.awards}`, 'active', MERIT.active.amount, 'Time in the air');
  }

  /** Where `player` finished session `sessionId` (1st, 2nd, 3rd get a bonus). */
  placement(player: string, sessionId: string, placing: number): void {
    const value = MERIT.placement[placing - 1];
    if (value) this.add(player, `place:${sessionId}`, 'placement', value, `Finished ${ordinal(placing)}`);
  }

  /** Awards decided since the last call, oldest first. */
  take(): MeritEvent[] {
    return this.out.splice(0);
  }
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

/** The one award for a player's first multiplayer session of the day (UTC): keyed by the date. */
export function dailyAward(now = new Date()): Omit<MeritEvent, 'player'> {
  return { key: `daily:${now.toISOString().slice(0, 10)}`, source: 'daily', amount: MERIT.firstOfDay, reason: 'First session of the day' };
}

/**
 * The one-off backfill for players from before v0.0.17: Merit for the sorties, missions and kills
 * already in their saved statistics, capped. Its key never changes, so it is awarded once however
 * often it runs; null when there is nothing to award.
 */
export function backfillAward(stats: Record<string, number> | null | undefined): Omit<MeritEvent, 'player'> | null {
  if (!stats) return null;
  const n = (k: string) => (Number.isFinite(stats[k]) && stats[k] > 0 ? Math.floor(stats[k]) : 0);
  const sorties = n('planesRecovered') + n('planesLost');
  const amount = Math.min(MERIT.backfill.cap, sorties * MERIT.backfill.sortie + n('successes') * MERIT.backfill.mission + n('kills') * MERIT.backfill.kill);
  return amount > 0 ? { key: 'backfill:v1', source: 'backfill', amount, reason: 'Played before ranks arrived' } : null;
}

import { raidLoss } from '../../src/base/Raids';
import { PVP } from '../../src/config';
import type { RaidTarget } from './PvpMissions';

/** What the rules need to know about a player to decide whether their base may be raided. */
export interface Raidable {
  id: string;
  territory: string | null;
  connected: boolean;
  /** World times until which they are protected: new-player protection, the shield after a raid. */
  protectUntil: number;
  shieldUntil: number;
}

/**
 * Why a raid can't be offered:
 * self       – your own base.
 * no-base    – they (or you) haven't claimed a territory.
 * offline    – they are disconnected: nobody has to defend while away.
 * new-player – they joined recently.
 * shield     – they were raided recently.
 * cooldown   – you raided them recently.
 * busy       – someone is raiding them right now.
 * attacking  – you are already on a raid.
 */
export type RaidRefusal = 'self' | 'no-base' | 'offline' | 'new-player' | 'shield' | 'cooldown' | 'busy' | 'attacking';

/** A raid in progress, from launch until it succeeds, fails or is abandoned. */
export interface Attack {
  id: number;
  attacker: string;
  victim: string;
  territoryId: string;
  started: number;
  target: RaidTarget;
  /** The defender's radar (or weapons) have seen the attacker. */
  detected: boolean;
  /** The defender's structures the attacker's bombs damaged, and whether they were wrecked. */
  structures: Array<{ name: string; destroyed: boolean }>;
  /** The defender (personally) put shots into the attacker's plane. */
  defended: boolean;
}

export interface RaidRecord {
  attacker: string;
  victim: string;
  at: number;
  success: boolean;
}

/**
 * The rules for raids between players (GDD §8.7, plan §6): who may be raided, what a raid pays,
 * what the defender loses, and the protections against ruin and farming.
 *
 * - New players can't be raided for PVP.newPlayerProtection after claiming (it ends early if they raid).
 * - A base that was raided successfully is shielded for PVP.raidShield.
 * - The same attacker waits PVP.pairCooldown before raiding the same base again, and repeated
 *   raids on one base within PVP.farmWindow pay less and less (PVP.repeat), down to nothing.
 * - Offline players' bases can't be raided at all.
 * - Only one raid on a base at a time, and one raid per attacker at a time.
 * - A successful raid destroys a capped share of the defender's vulnerable paper (the same rule
 *   as AI raids: RAIDS.loss); the protected reserve (ECONOMY.protectedPaper plus storage boxes) is
 *   never touched, and the attacker's reward is paid by the game, not taken from the defender.
 */
export class AttackBook {
  readonly active: Attack[] = [];
  readonly history: RaidRecord[] = [];
  private nextId = 1;

  refusal(attacker: Raidable, victim: Raidable, now: number): RaidRefusal | null {
    if (attacker.id === victim.id) return 'self';
    if (!attacker.territory || !victim.territory) return 'no-base';
    if (!victim.connected) return 'offline';
    if (now < victim.protectUntil) return 'new-player';
    if (now < victim.shieldUntil) return 'shield';
    const last = this.lastRaid(attacker.id, victim.id);
    if (last && now - last.at < PVP.pairCooldown) return 'cooldown';
    if (this.on(victim.id)) return 'busy';
    if (this.by(attacker.id)) return 'attacking';
    return null;
  }

  /** The share of the reward a new raid by `attacker` on `victim` would pay (repeat raids pay less). */
  repeatFactor(attacker: string, victim: string, now: number): number {
    const recent = this.history.filter((r) => r.attacker === attacker && r.victim === victim && r.success && now - r.at < PVP.farmWindow).length;
    return PVP.repeat[Math.min(recent, PVP.repeat.length - 1)];
  }

  /** What a raid pays: more for a better defended base, less for a poor or a repeated one. Rounded to 5. */
  reward(weapons: number, vulnerable: number, factor: number): number {
    const base = PVP.raidReward + PVP.raidPerWeapon * weapons;
    const poor = vulnerable < PVP.poorTarget ? PVP.poorFactor : 1;
    return Math.round((base * poor * factor) / 5) * 5;
  }

  /** Paper a successful raid destroys: a capped share of what isn't protected. */
  loss(vulnerable: number, onStore: boolean): number {
    return raidLoss(vulnerable, onStore);
  }

  start(attacker: string, victim: string, territoryId: string, target: RaidTarget, now: number): Attack {
    const attack: Attack = { id: this.nextId++, attacker, victim, territoryId, started: now, target, detected: false, structures: [], defended: false };
    this.active.push(attack);
    return attack;
  }

  /** The raid ended. Successful ones count towards the cooldowns and the repeat rule. */
  finish(attack: Attack, success: boolean, now: number): void {
    const i = this.active.indexOf(attack);
    if (i >= 0) this.active.splice(i, 1);
    this.history.push({ attacker: attack.attacker, victim: attack.victim, at: now, success });
    // Only what the rules still look at is kept.
    const horizon = Math.max(PVP.farmWindow, PVP.pairCooldown);
    while (this.history.length > 0 && now - this.history[0].at > horizon) this.history.shift();
  }

  /** The raid on `victim`'s base under way, if any. */
  on(victim: string): Attack | undefined {
    return this.active.find((a) => a.victim === victim);
  }

  /** The raid `attacker` is flying, if any. */
  by(attacker: string): Attack | undefined {
    return this.active.find((a) => a.attacker === attacker);
  }

  private lastRaid(attacker: string, victim: string): RaidRecord | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const r = this.history[i];
      if (r.attacker === attacker && r.victim === victim) return r;
    }
    return undefined;
  }
}

/** One hit on a player's plane, for kill and assist credit. */
export interface DamageEntry {
  by: string;
  amount: number;
  at: number;
}

/**
 * Who gets the kill and the assists when a player's plane goes down: the last player who hurt it
 * (within PVP.assistWindow) gets the kill, everyone else who dealt at least PVP.assistMin of the
 * recent damage gets an assist.
 */
export function creditFor(log: readonly DamageEntry[], now: number): { killer: string | null; assists: string[] } {
  const recent = log.filter((e) => now - e.at <= PVP.assistWindow);
  if (recent.length === 0) return { killer: null, assists: [] };
  const killer = recent[recent.length - 1].by;
  const total = recent.reduce((sum, e) => sum + e.amount, 0);
  const by = new Map<string, number>();
  for (const e of recent) by.set(e.by, (by.get(e.by) ?? 0) + e.amount);
  const assists = [...by].filter(([id, amount]) => id !== killer && amount >= total * PVP.assistMin).map(([id]) => id);
  return { killer, assists };
}

/**
 * Bounties for shooting down players: by what the plane cost, nothing for a free emergency plane,
 * and less each time the same player is shot down by the same hunter within PVP.killWindow.
 */
export class KillBook {
  private readonly kills: Array<{ killer: string; victim: string; at: number }> = [];

  /** Records the kill and returns the bounty it pays. */
  record(killer: string, victim: string, planeCost: number, emergency: boolean, now: number): number {
    while (this.kills.length > 0 && now - this.kills[0].at > PVP.killWindow) this.kills.shift();
    const before = this.kills.filter((k) => k.killer === killer && k.victim === victim).length;
    this.kills.push({ killer, victim, at: now });
    if (emergency) return 0;
    const factor = PVP.killRepeat[Math.min(before, PVP.killRepeat.length - 1)];
    return Math.round((PVP.killBase + PVP.killShare * planeCost) * factor);
  }
}

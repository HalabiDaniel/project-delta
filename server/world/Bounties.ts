import { randomUUID } from 'node:crypto';
import { BOUNTIES, type BountyKind } from '../../src/config';

/**
 * A bounty: a fair objective on one player, placed by the director because of what that player
 * did (plan v0.0.19 §2C, GDD §11.6):
 *
 *   bomber        – destroy their bomber: a high-threat player is raiding someone in a bomber.
 *   raid          – prevent their raid: they keep raiding; the defender and helpers bring them down.
 *   installation  – damage their exposed installation: a dominant, aggressive player's forward defenses.
 *   ace           – intercept them: a streak of kills on weaker players.
 */
export interface Bounty {
  /** Unique in the session (card keys), and for good (ledger keys: "bounty:<uid>:<player>"). */
  id: number;
  uid: string;
  kind: BountyKind;
  /** The player it is on (public id), and their name when it was placed. */
  target: string;
  targetName: string;
  /** For an installation bounty: the installation, its name and where it stands. */
  installation?: { id: string; name: string; territoryId: string; x: number; z: number };
  /** For a "prevent a raid" bounty: the player being raided, who keeps priority on the pot. */
  defender?: string;
  /** Paper shared among the contributors. */
  pot: number;
  /** World times. */
  placedAt: number;
  expires: number;
  /** Why it was placed, in words for the card ("3 kills on weaker players"). */
  reason: string;
  /** Damage dealt towards it by each player (installation bounties; plane bounties use the damage log). */
  readonly damage: Map<string, number>;
  /** v0.0.19: Specter pilots flying its card who had its target in their reveal, and when they last did. */
  readonly spotted: Map<string, number>;
  status: 'open' | 'paid' | 'expired' | 'cancelled';
}

/** What a settled bounty pays each contributor. */
export interface BountyShare {
  player: string;
  amount: number;
}

/**
 * The bounties open in a session and the rules for placing and paying them. Who may be a target,
 * what triggers each kind and who is offered the card are decided by the world (it knows the
 * players); this class keeps the books and splits the pot.
 */
export class BountyBoard {
  readonly open: Bounty[] = [];
  /** When each player's last bounty ended (world time), for BOUNTIES.targetCooldown. */
  private readonly ended = new Map<string, number>();
  private nextId = 1;

  /** Why a bounty of any kind can't be placed on `target` now, or null. */
  refusal(target: string, now: number): 'open' | 'cooldown' | 'full' | null {
    if (this.on(target)) return 'open';
    const last = this.ended.get(target);
    if (last !== undefined && now - last < BOUNTIES.targetCooldown) return 'cooldown';
    if (this.open.length >= BOUNTIES.maxOpen) return 'full';
    return null;
  }

  /** The pot for a bounty of `kind` on a player with `threat`. */
  static pot(kind: BountyKind, threat: number): number {
    return Math.min(BOUNTIES.maxPot, Math.round((BOUNTIES.pot[kind] + BOUNTIES.perThreat * Math.max(0, threat)) / 5) * 5);
  }

  place(kind: BountyKind, target: string, targetName: string, threat: number, reason: string, now: number, extra: Pick<Bounty, 'installation' | 'defender'> = {}): Bounty | null {
    if (this.refusal(target, now)) return null;
    const bounty: Bounty = {
      id: this.nextId++, uid: randomUUID(), kind, target, targetName, pot: BountyBoard.pot(kind, threat), placedAt: now, expires: now + BOUNTIES.duration,
      reason, damage: new Map(), spotted: new Map(), status: 'open', ...extra,
    };
    this.open.push(bounty);
    return bounty;
  }

  /** The open bounty on `target`, if any. */
  on(target: string): Bounty | undefined {
    return this.open.find((b) => b.target === target);
  }

  get(id: number): Bounty | undefined {
    return this.open.find((b) => b.id === id);
  }

  /** The open bounty on installation `id`, if any. */
  onInstallation(id: string): Bounty | undefined {
    return this.open.find((b) => b.installation?.id === id);
  }

  /** Damage towards an installation bounty. */
  contribute(bounty: Bounty, player: string, amount: number): void {
    if (amount <= 0 || player === bounty.target) return;
    bounty.damage.set(player, (bounty.damage.get(player) ?? 0) + amount);
  }

  /** The bounty is over: paid, expired or cancelled. Its target's cooldown starts now. */
  close(bounty: Bounty, status: Exclude<Bounty['status'], 'open'>, now: number): void {
    const i = this.open.indexOf(bounty);
    if (i < 0) return;
    this.open.splice(i, 1);
    bounty.status = status;
    this.ended.set(bounty.target, now);
  }

  /** Bounties past their time, for the world to close. */
  expired(now: number): Bounty[] {
    return this.open.filter((b) => now >= b.expires);
  }

  /**
   * Splits the pot by contribution (`damage`: what each player dealt). `excluded` get nothing: the
   * target, their allies and anyone the anti-farming rules hold back. Shares below BOUNTIES.minShare
   * are dropped (no tagging for a cut); a "prevent a raid" defender who contributed keeps at least
   * BOUNTIES.defenderShare. `factor(player)` scales each share (decaying rewards between a pair).
   * Paid once: the world closes the bounty as it pays.
   */
  static split(bounty: Pick<Bounty, 'pot' | 'target' | 'defender'>, damage: ReadonlyMap<string, number>, excluded: ReadonlySet<string> = new Set(), factor: (player: string) => number = () => 1): BountyShare[] {
    const entries = [...damage].filter(([p, n]) => p !== bounty.target && !excluded.has(p) && n > 0);
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    if (total <= 0) return [];
    let kept = entries.filter(([, n]) => n / total >= BOUNTIES.minShare);
    const keptTotal = kept.reduce((sum, [, n]) => sum + n, 0);
    const shares = new Map(kept.map(([p, n]) => [p, n / keptTotal]));
    const d = bounty.defender;
    if (d && shares.has(d) && shares.size > 1 && shares.get(d)! < BOUNTIES.defenderShare) {
      const rest = 1 - shares.get(d)!;
      const scale = (1 - BOUNTIES.defenderShare) / rest;
      for (const [p, s] of shares) shares.set(p, p === d ? BOUNTIES.defenderShare : s * scale);
    }
    kept = [...shares].map(([p, s]) => [p, s]);
    return kept
      .map(([player, share]) => ({ player, amount: Math.floor(bounty.pot * share * Math.max(0, Math.min(1, factor(player)))) }))
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.player.localeCompare(b.player));
  }
}

import { randomUUID } from 'node:crypto';
import { EVENTS } from '../../src/config';
import { randRange, type Rng } from '../../src/systems/Random';

/**
 * v0.0.18: the world events of a multiplayer session (plan v0.0.18 §4).
 *
 * high-value  – a shipment arrives at an AI desk's supply depot: destroy it.
 * convoy      – an enemy supply Widewing crosses the classroom: shoot it down.
 * supply-drop – a crate of ink or rubber balls lands on a free desk: the first to fly low over it takes it.
 * ink-storm   – for a while, missions pay double ink.
 *
 * Events only ever happen on desks the AI holds or nobody holds, so they never touch a player's
 * base, online or not. Shipment and convoy bounties are split by each player's share of the damage
 * (`split`): paid once, never duplicated.
 */
export type SessionEventKind = 'high-value' | 'convoy' | 'supply-drop' | 'ink-storm';
export const SESSION_EVENT_KINDS: readonly SessionEventKind[] = ['high-value', 'convoy', 'supply-drop', 'ink-storm'];

export interface SessionEvent {
  /** Unique for good: ledger keys ("event:<uid>:<player>"). */
  uid: string;
  kind: SessionEventKind;
  territoryId: string | null;
  title: string;
  /** World time it goes away by itself (null: when it is settled). */
  until: number | null;
  /** The supply depot or aircraft it is about. */
  target: string | null;
  /** A supply drop's crate and what is in it. */
  drop?: { x: number; z: number; top: number; resource: 'ink' | 'rubber'; amount: number };
  status: 'active' | 'resolved' | 'expired' | 'failed';
}

/** One player's part of a split reward. */
export interface Share {
  player: string;
  amount: number;
}

export class SessionEvents {
  readonly events: SessionEvent[] = [];
  /** Seconds until the next event may start. */
  cooldown: number;
  /** Damage dealt to each event target, by player. */
  private readonly damage = new Map<string, Map<string, number>>();

  constructor(private readonly rng: Rng) {
    this.cooldown = randRange(rng, EVENTS.session.first[0], EVENTS.session.first[1]);
  }

  get active(): SessionEvent[] {
    return this.events.filter((e) => e.status === 'active');
  }

  /** At most one event at a time, two in a crowded session. */
  static maxActive(players: number): number {
    return players > EVENTS.session.crowd ? 2 : 1;
  }

  /** How fast the clock to the next event runs: 1 with two players, faster (up to 16) with more. */
  static pace(players: number): number {
    const p = Math.min(16, Math.max(EVENTS.session.pacePlayers, players));
    return Math.sqrt(p / EVENTS.session.pacePlayers);
  }

  /**
   * One step of the scheduler: with `players` connected (none: nothing happens), when the cooldown
   * runs out and there is room, picks a kind by weight and asks `start` to make it (null: that kind
   * can't happen right now, so another is tried). Returns the event started, if any.
   */
  tick(dt: number, players: number, start: (kind: SessionEventKind, uid: string) => SessionEvent | null): SessionEvent | null {
    if (players <= 0) return null;
    if (this.active.length >= SessionEvents.maxActive(players)) return null;
    this.cooldown -= dt * SessionEvents.pace(players);
    if (this.cooldown > 0) return null;
    const kinds = SESSION_EVENT_KINDS.filter((k) => !(k === 'ink-storm' && this.active.some((e) => e.kind === 'ink-storm')));
    while (kinds.length > 0) {
      const total = kinds.reduce((t, k) => t + (EVENTS.session.weights[k] ?? 0), 0);
      let roll = this.rng() * total;
      const kind = kinds.find((k) => (roll -= EVENTS.session.weights[k] ?? 0) <= 0) ?? kinds[kinds.length - 1];
      kinds.splice(kinds.indexOf(kind), 1);
      const e = start(kind, randomUUID());
      if (!e) continue;
      this.events.push(e);
      this.cooldown = randRange(this.rng, EVENTS.session.cooldown[0], EVENTS.session.cooldown[1]);
      return e;
    }
    // Nothing could start: try again a little later.
    this.cooldown = 20;
    return null;
  }

  /** Events whose time ran out (marked expired). */
  expire(now: number): SessionEvent[] {
    const out: SessionEvent[] = [];
    for (const e of this.active) {
      if (e.until !== null && now >= e.until) {
        e.status = 'expired';
        out.push(e);
      }
    }
    return out;
  }

  /** The active event about depot or aircraft `target`, if any. */
  about(target: string): SessionEvent | undefined {
    return this.active.find((e) => e.target === target);
  }

  /** Damage a player dealt to something; counted only if an event is about it. */
  contribute(target: string, player: string, amount: number): void {
    if (amount <= 0 || !this.about(target)) return;
    const by = this.damage.get(target) ?? new Map<string, number>();
    by.set(player, (by.get(player) ?? 0) + amount);
    this.damage.set(target, by);
  }

  /**
   * Splits `total` among the players who damaged `target`, by their share of the damage: those under
   * EVENTS.session.shareMin get nothing, and `exclude` (players paid by the event's own card) are left
   * out; their part goes to the others. Whole numbers that never add up to more than `total`.
   */
  split(target: string, total: number, exclude: ReadonlySet<string> = new Set()): Share[] {
    const by = this.damage.get(target);
    this.damage.delete(target);
    if (!by) return [];
    const all = [...by.values()].reduce((t, v) => t + v, 0);
    const counted = [...by].filter(([p, v]) => v >= all * EVENTS.session.shareMin && !exclude.has(p));
    const sum = counted.reduce((t, [, v]) => t + v, 0);
    if (sum <= 0) return [];
    const raw = counted.map(([player, v]) => ({ player, exact: (total * v) / sum }));
    const shares = raw.map((r) => ({ player: r.player, amount: Math.floor(r.exact) }));
    // Largest remainders get the leftover units.
    let left = total - shares.reduce((t, s) => t + s.amount, 0);
    const order = raw.map((r, i) => ({ i, rem: r.exact - Math.floor(r.exact) })).sort((a, b) => b.rem - a.rem);
    for (const o of order) {
      if (left <= 0) break;
      shares[o.i].amount++;
      left--;
    }
    return shares.filter((s) => s.amount > 0);
  }

  /** An ink storm is on. */
  get storm(): boolean {
    return this.active.some((e) => e.kind === 'ink-storm');
  }
}

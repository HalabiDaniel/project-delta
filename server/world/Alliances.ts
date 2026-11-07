import { ALLIANCES } from '../../src/config';

/**
 * Why an alliance offer can't be made or accepted:
 * self      – yourself.
 * allied    – already allies.
 * full      – one side's alliance is at the size cap (ALLIANCES.maxSize, or the session's share).
 * cooldown  – you left an alliance with them a moment ago.
 * busy      – they are in another alliance (merging alliances isn't allowed).
 * pending   – an offer between you is already waiting.
 * rate      – too many offers lately.
 * none      – no offer from them to accept.
 */
export type AllianceRefusal = 'self' | 'allied' | 'full' | 'cooldown' | 'busy' | 'pending' | 'rate' | 'none';

export interface Alliance {
  /** Small number, unique in the session (shown on the scoreboard). */
  id: number;
  members: string[];
}

/**
 * Alliances that last for the current session only (plan v0.0.19 "Also B"). Nothing here is
 * persisted: the session ending ends every alliance. Two or more players, capped, formed by an
 * offer and an acceptance, left by either side at any time; former allies keep the peace for
 * ALLIANCES.leaveCooldown after leaving.
 */
export class AllianceBook {
  readonly alliances: Alliance[] = [];
  /** Offers waiting: "from>to" → world time sent. */
  private readonly offers = new Map<string, number>();
  /** Offers sent per player (world times), for the rate limit. */
  private readonly sent = new Map<string, number[]>();
  /** "a|b" (sorted) → world time they stopped being allies. */
  private readonly parted = new Map<string, number>();
  private nextId = 1;

  of(id: string): Alliance | undefined {
    return this.alliances.find((a) => a.members.includes(id));
  }

  /** The players `id` is allied with (not themself). */
  allies(id: string): string[] {
    return this.of(id)?.members.filter((m) => m !== id) ?? [];
  }

  allied(a: string, b: string): boolean {
    return a !== b && (this.of(a)?.members.includes(b) ?? false);
  }

  /** Allies, or former allies still inside the leave cooldown: they can't attack each other. */
  peaceful(a: string, b: string, now: number): boolean {
    if (this.allied(a, b)) return true;
    const left = this.parted.get(pair(a, b));
    return left !== undefined && now - left < ALLIANCES.leaveCooldown;
  }

  /** The size cap with `online` players in the session. */
  static cap(online: number): number {
    return Math.max(2, Math.min(ALLIANCES.maxSize, Math.floor(online * ALLIANCES.sessionShare)));
  }

  offerRefusal(from: string, to: string, now: number, online: number): AllianceRefusal | null {
    if (from === to) return 'self';
    if (this.allied(from, to)) return 'allied';
    const mine = this.of(from);
    const theirs = this.of(to);
    if (mine && theirs) return 'busy';
    const size = (mine?.members.length ?? 1) + (theirs?.members.length ?? 1);
    if (size > AllianceBook.cap(online)) return 'full';
    const left = this.parted.get(pair(from, to));
    if (left !== undefined && now - left < ALLIANCES.leaveCooldown) return 'cooldown';
    this.prune(now);
    if (this.offers.has(`${from}>${to}`) || this.offers.has(`${to}>${from}`)) return 'pending';
    const recent = (this.sent.get(from) ?? []).filter((t) => now - t < 60);
    if (recent.length >= ALLIANCES.offersPerMinute) return 'rate';
    return null;
  }

  /** Sends an offer. Returns why not, or null. */
  offer(from: string, to: string, now: number, online: number): AllianceRefusal | null {
    const refusal = this.offerRefusal(from, to, now, online);
    if (refusal) return refusal;
    this.offers.set(`${from}>${to}`, now);
    this.sent.set(from, [...(this.sent.get(from) ?? []).filter((t) => now - t < 60), now]);
    return null;
  }

  /** Players with an offer waiting for `to`'s answer. */
  pendingFor(to: string, now: number): string[] {
    this.prune(now);
    return [...this.offers.keys()].filter((k) => k.endsWith(`>${to}`)).map((k) => k.split('>')[0]);
  }

  /** Players `from` has offered an alliance to, still waiting. */
  pendingFrom(from: string, now: number): string[] {
    this.prune(now);
    return [...this.offers.keys()].filter((k) => k.startsWith(`${from}>`)).map((k) => k.split('>')[1]);
  }

  /** `to` accepts `from`'s offer. Returns the alliance, or why not. */
  accept(to: string, from: string, now: number, online: number): Alliance | AllianceRefusal {
    this.prune(now);
    if (!this.offers.has(`${from}>${to}`)) return 'none';
    this.offers.delete(`${from}>${to}`);
    const mine = this.of(to);
    const theirs = this.of(from);
    if (mine && theirs) return mine === theirs ? 'allied' : 'busy';
    const size = (mine?.members.length ?? 1) + (theirs?.members.length ?? 1);
    if (size > AllianceBook.cap(online)) return 'full';
    const alliance = mine ?? theirs;
    if (alliance) {
      alliance.members.push(alliance === mine ? from : to);
      return alliance;
    }
    const made: Alliance = { id: this.nextId++, members: [from, to] };
    this.alliances.push(made);
    return made;
  }

  decline(to: string, from: string): boolean {
    return this.offers.delete(`${from}>${to}`);
  }

  /** `id` leaves their alliance (or the session): an alliance left with one member is over. Returns who they left. */
  leave(id: string, now: number): string[] {
    for (const k of [...this.offers.keys()]) if (k.startsWith(`${id}>`) || k.endsWith(`>${id}`)) this.offers.delete(k);
    const a = this.of(id);
    if (!a) return [];
    const others = a.members.filter((m) => m !== id);
    for (const o of others) this.parted.set(pair(id, o), now);
    a.members = others;
    if (a.members.length < 2) this.alliances.splice(this.alliances.indexOf(a), 1);
    return others;
  }

  private prune(now: number): void {
    for (const [k, t] of this.offers) if (now - t > ALLIANCES.offerTime) this.offers.delete(k);
  }
}

function pair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

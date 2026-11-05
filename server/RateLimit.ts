/**
 * Token buckets by key (a player's public id, or an address): `rate` actions a second on average,
 * bursts of up to `burst`. Used for joins, quick joins, commands, emotes, transfer codes and
 * usernames (v0.0.13). Keys left alone for a minute are forgotten, so the map can't grow forever.
 */
export class RateLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private sweptAt = 0;

  constructor(
    readonly rate: number,
    readonly burst: number,
    private readonly now: () => number = () => performance.now() / 1000,
  ) {}

  /** Takes one action for `key`: true if it is allowed now. */
  take(key: string, cost = 1): boolean {
    const now = this.now();
    if (now - this.sweptAt > 60) this.sweep(now);
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.rate);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  private sweep(now: number): void {
    this.sweptAt = now;
    for (const [k, b] of this.buckets) if (now - b.at > 60) this.buckets.delete(k);
  }
}

/** The limits (v0.0.13): generous for people, tight for scripts. */
export const LIMITS = {
  /** Joins per address: a classroom behind one address can all join at once, then 60 a minute. */
  joinsPerAddress: () => new RateLimit(1, 40),
  /** Quick-join requests per address (each can open a session). */
  quickPerAddress: () => new RateLimit(1, 40),
  /** Transfer codes per address, on top of the per-player cooldown. */
  transfersPerAddress: () => new RateLimit(6 / 60, 3),
};

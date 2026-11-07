import { FARMING } from '../config';

/** What a reward between two players was for. */
export type FarmKind = 'kill' | 'assist' | 'raid' | 'bounty' | 'escort' | 'coop' | 'challenge' | 'mischief';

/** One reward one player earned because of another (shot them down, raided them, helped them, ...). */
export interface Flow {
  earner: string;
  from: string;
  kind: FarmKind;
  amount: number;
  /** World time. */
  at: number;
  /** Kills: what the lost plane cost. Raids: whether the defender did anything about it. */
  cost?: number;
  defended?: boolean;
}

/** A pattern that looked like farming, between two players. */
export interface FarmFlag {
  a: string;
  b: string;
  reason: 'kills' | 'losses' | 'undefended' | 'bounties' | 'flow';
  /** In words, for the developer's log. */
  detail: string;
  at: number;
}

/**
 * Anti-farming (plan v0.0.19 §7, GDD §8.7, §13.6), shared by the server and the long-run simulator.
 * It watches every reward that flows between a pair of players, in both directions together, so
 * two cooperating accounts can't trade kills, raids, bounties or escorts for unlimited resources:
 *
 * - Decaying rewards: each new flow between the pair within FARMING.window pays FARMING.decay[n] of
 *   itself, across every source (on top of each source's own repeat rule).
 * - Detection: kills traded too often, expensive planes repeatedly lost to the same opponent, raids
 *   nobody defends, bounties on each other, or simply too much paper flowing between them.
 * - Response: rewards between a flagged pair pause for FARMING.pause and the flag is logged for the
 *   developer. Never an automatic ban.
 */
export class FarmWatch {
  private readonly flows: Flow[] = [];
  private readonly paused = new Map<string, number>();
  private readonly fresh: FarmFlag[] = [];

  /** The share of a new reward `earner` gets because of `from` that is paid now (0: paused). */
  factor(earner: string, from: string, now: number): number {
    if (earner === from) return 1;
    if (this.isPaused(earner, from, now)) return 0;
    const n = this.between(earner, from, now).filter((f) => f.earner === earner).length;
    return FARMING.decay[Math.min(n, FARMING.decay.length - 1)];
  }

  isPaused(a: string, b: string, now: number): boolean {
    const until = this.paused.get(pair(a, b));
    return until !== undefined && now < until;
  }

  /** A reward was paid. Returns the flag it raised, if this made the pair look like farming. */
  record(f: Flow): FarmFlag | null {
    if (f.earner === f.from) return null;
    this.flows.push({ ...f });
    while (this.flows.length > 0 && f.at - this.flows[0].at > FARMING.window) this.flows.shift();
    if (this.isPaused(f.earner, f.from, f.at)) return null;
    const flag = this.check(f.earner, f.from, f.at);
    if (!flag) return null;
    this.paused.set(pair(f.earner, f.from), f.at + FARMING.pause);
    this.fresh.push(flag);
    return flag;
  }

  /** Flags raised since the last call (for the developer's log and the store). */
  takeFlags(): FarmFlag[] {
    return this.fresh.splice(0);
  }

  private between(a: string, b: string, now: number): Flow[] {
    return this.flows.filter((f) => now - f.at <= FARMING.window && ((f.earner === a && f.from === b) || (f.earner === b && f.from === a)));
  }

  private check(a: string, b: string, now: number): FarmFlag | null {
    const flows = this.between(a, b, now);
    const flag = (reason: FarmFlag['reason'], detail: string): FarmFlag => ({ a, b, reason, detail, at: now });
    const kills = flows.filter((f) => f.kind === 'kill');
    const oneWay = Math.max(kills.filter((f) => f.earner === a).length, kills.filter((f) => f.earner === b).length);
    if (kills.length >= FARMING.kills && oneWay >= kills.length * FARMING.oneSided) return flag('kills', `${oneWay} of ${kills.length} kills between them went one way in ${Math.round(FARMING.window / 60)} min`);
    if (kills.length >= FARMING.traded) return flag('kills', `${kills.length} kills traded between them in ${Math.round(FARMING.window / 60)} min`);
    for (const [loser, winner] of [[a, b], [b, a]]) {
      const lost = kills.filter((f) => f.from === loser && f.earner === winner && (f.cost ?? 0) >= FARMING.expensive).length;
      if (lost >= FARMING.losses) return flag('losses', `${lost} expensive planes lost by one to the other`);
    }
    const undefended = flows.filter((f) => f.kind === 'raid' && f.defended === false).length;
    if (undefended >= FARMING.undefended) return flag('undefended', `${undefended} raids between them that nobody defended`);
    const bounties = flows.filter((f) => f.kind === 'bounty').length;
    if (bounties >= FARMING.bounties) return flag('bounties', `${bounties} bounty shares claimed on each other`);
    for (const [earner, from] of [[a, b], [b, a]]) {
      const total = flows.filter((f) => f.earner === earner && f.from === from).reduce((sum, f) => sum + f.amount, 0);
      if (total >= FARMING.flowCap) return flag('flow', `${total} paper earned by one from the other`);
    }
    return null;
  }
}

function pair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

import type { AiOrders } from '../../src/ai/AiAircraft';
import { AI, ESCORTS, ESCORT_ORDER, type EscortKind, type EscortOrder, type Side } from '../../src/config';
import type { Point3 } from '../../src/missions/Mission';
import type { Bundle } from '../../src/systems/ResourceManager';

/**
 * Why escorts can't be bought:
 * cap      – more than ESCORTS.perSortie on one sortie.
 * session  – the session already has ESCORTS.perSession escorts in the air.
 * unknown  – not an escort on the roster.
 */
export type EscortRefusal = 'cap' | 'session' | 'unknown';

/** One escort in the air: whose it is, what it is, and its AI aircraft's id. */
export interface Escort {
  id: string;
  owner: string;
  kind: EscortKind;
}

/** The plane an escort's orders are worked out from: its owner's, as a point with its horizontal heading. */
export interface Leader extends Point3 {
  plane: string;
  side: Side;
  /** Unit vector of where it is heading, on the ground plane. */
  fx: number;
  fz: number;
}

/** A contact the orders may pick a target from. */
export interface Candidate extends Point3 {
  id: string;
  side: Side;
  shielded: boolean;
}

/**
 * The AI escorts players buy for one sortie (plan v0.0.19 §1, GDD §10). This class only keeps the
 * books: what each player chose at the desk, what is in the air and whose it is, and what their
 * orders mean. The world puts the aircraft in the air (AirTraffic, flown by the same AI pilots as
 * everyone else's), charges for them, and takes them away when the sortie ends.
 *
 * - Bought at launch, single-use: removed at the end of the sortie, even if they survived, never
 *   refunded (GDD §10.2).
 * - At most ESCORTS.perSortie per sortie and ESCORTS.perSession in the air in one session.
 * - Weaker than human pilots: rookie or regular pilots, ESCORTS.health and ESCORTS.gunFactor.
 * - They can't complete objectives: the world never lets an escort's round finish a target its
 *   owner's mission needs (`ServerWorld.escortMayFinish`), and they drop no bombs and scout nothing.
 * - They never enter an offline player's territory (`keepOut`) and never start raids.
 */
export class EscortBook {
  /** What each player has chosen for their next sortie. */
  private readonly plans = new Map<string, EscortKind[]>();
  /** Escorts in the air, by AI aircraft id. */
  readonly active = new Map<string, Escort>();
  /** Each player's current order to their escorts. */
  private readonly orders = new Map<string, EscortOrder>();
  private serial = 0;

  /** Chooses the escorts for the next sortie (empty: none). Returns why not, or null. */
  choose(owner: string, kinds: readonly EscortKind[]): EscortRefusal | null {
    if (kinds.some((k) => !ESCORT_ORDER.includes(k))) return 'unknown';
    if (kinds.length > ESCORTS.perSortie) return 'cap';
    this.plans.set(owner, [...kinds]);
    return null;
  }

  /** The escorts chosen for the next sortie. */
  plan(owner: string): EscortKind[] {
    return this.plans.get(owner) ?? [];
  }

  /** What the chosen escorts cost together. */
  static cost(kinds: readonly EscortKind[]): Bundle {
    const total: Bundle = {};
    for (const k of kinds) {
      const c = ESCORTS.roster[k].cost;
      total.paper = (total.paper ?? 0) + c.paper;
      if (c.ink) total.ink = (total.ink ?? 0) + c.ink;
      if (c.rubber) total.rubber = (total.rubber ?? 0) + c.rubber;
    }
    return total;
  }

  /** How many of the chosen escorts may go up now (the session's cap counts everyone's). */
  room(owner: string): number {
    const mine = this.of(owner).length;
    return Math.max(0, Math.min(ESCORTS.perSortie - mine, ESCORTS.perSession - this.active.size));
  }

  /**
   * The AI orders for `owner`'s escort of `kind`, taking off with its leader: a little behind it, on
   * the wing given by its place in the formation. `keepOut`: territories it must never enter.
   */
  launch(owner: string, kind: EscortKind, leader: Leader, keepOut: ReadonlyArray<{ x: number; z: number; half: number }>): AiOrders {
    const spec = ESCORTS.roster[kind];
    const wing: 1 | -1 = this.of(owner).length % 2 === 0 ? 1 : -1;
    const id = `esc:${owner}:${++this.serial}`;
    const { fx, fz } = leader;
    const [right, up, back] = AI.formation;
    const behind = { x: leader.x - fx * back * 1.5 - fz * right * wing, y: leader.y + up, z: leader.z - fz * back * 1.5 + fx * right * wing };
    const ahead = { x: leader.x + fx * 60, y: leader.y + up, z: leader.z + fz * 60 };
    this.active.set(id, { id, owner, kind });
    return {
      id, side: leader.side, role: spec.role, skill: spec.skill, aircraft: spec.aircraft,
      route: [behind, ahead], loop: true, exit: ahead, escort: leader.plane, purpose: 'escort',
      health: ESCORTS.health, gunFactor: ESCORTS.gunFactor, wing, signature: ESCORTS.minSignature, keepOut: [...keepOut],
    };
  }

  /** `owner`'s escorts in the air. */
  of(owner: string): Escort[] {
    return [...this.active.values()].filter((e) => e.owner === owner);
  }

  /** The escort with this AI id, if it is one. */
  get(id: string): Escort | undefined {
    return this.active.get(id);
  }

  /** The escort went down or was taken away. */
  forget(id: string): void {
    this.active.delete(id);
  }

  /** Every one of `owner`'s escorts is taken away (the sortie is over): their ids. */
  release(owner: string): string[] {
    const ids = this.of(owner).map((e) => e.id);
    for (const id of ids) this.active.delete(id);
    this.orders.delete(owner);
    return ids;
  }

  /** The player left the session: their plan goes with them. */
  remove(owner: string): string[] {
    this.plans.delete(owner);
    return this.release(owner);
  }

  order(owner: string): EscortOrder {
    return this.orders.get(owner) ?? 'follow';
  }

  setOrder(owner: string, order: EscortOrder): void {
    this.orders.set(owner, order);
  }

  /**
   * What an order means for one escort's AI orders, given its leader and the hostile aircraft
   * around: who to fly with (`escort`) and who to go after (`prey`). `bomber`: the plane "protect the
   * bomber" protects (the leader's own if it flies a bomber, else the bomber it escorts, if any).
   */
  static apply(orders: AiOrders, order: EscortOrder, leader: Leader, hostiles: readonly Candidate[], bomber: string | null, current: string | null): void {
    switch (order) {
      case 'follow':
        orders.escort = leader.plane;
        orders.prey = undefined;
        break;
      case 'attack':
        orders.escort = leader.plane;
        orders.prey = current && hostiles.some((h) => h.id === current) ? current : (EscortBook.ahead(leader, hostiles)?.id ?? undefined);
        break;
      case 'protect':
        orders.escort = bomber ?? leader.plane;
        orders.prey = undefined;
        break;
      case 'cover':
        orders.escort = leader.plane;
        orders.prey = EscortBook.behind(leader, hostiles)?.id ?? undefined;
        break;
    }
  }

  /** The hostile nearest the leader's nose, within ESCORTS.attackRange and the attack cone. */
  static ahead(leader: Leader, hostiles: readonly Candidate[]): Candidate | null {
    const { fx, fz } = leader;
    let best: Candidate | null = null;
    let bestD = Infinity;
    for (const h of hostiles) {
      if (h.shielded) continue;
      const dx = h.x - leader.x;
      const dz = h.z - leader.z;
      const d = Math.hypot(dx, h.y - leader.y, dz);
      if (d > ESCORTS.attackRange || d < 0.01) continue;
      if ((dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz)) < ESCORTS.attackCone) continue;
      if (d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }

  /** The hostile nearest the leader's tail, within ESCORTS.coverRange. */
  static behind(leader: Leader, hostiles: readonly Candidate[]): Candidate | null {
    const { fx, fz } = leader;
    let best: Candidate | null = null;
    let bestD = Infinity;
    for (const h of hostiles) {
      if (h.shielded) continue;
      const dx = h.x - leader.x;
      const dz = h.z - leader.z;
      const d = Math.hypot(dx, h.y - leader.y, dz);
      if (d > ESCORTS.coverRange) continue;
      if (dx * fx + dz * fz > 0) continue;
      if (d < bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  }
}

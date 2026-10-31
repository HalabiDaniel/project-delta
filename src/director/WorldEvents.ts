import type { AiOrders, Strike } from '../ai/AiAircraft';
import type { Raid } from '../ai/AirTraffic';
import { interceptorPlan, raidPlan, scoutPlan } from '../ai/FlightPlans';
import { neighbours } from '../ai/Navigation';
import { AI, EVENTS, type Difficulty, type TerritoryState, type ThreatLevel } from '../config';
import { Mission } from '../missions/Mission';
import { convoyMission, raidDefenseMission, shipmentMission, supplyRunMission, threatOf, type MissionContext } from '../missions/MissionGenerator';
import { randRange, shuffled, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import type { Payout } from './Operations';

/**
 * raid       – an enemy bomber heading for T1's paper store (AirTraffic sends it; this keeps it in turn).
 * high-value – a paper shipment stacked on a territory for a few minutes.
 * convoy     – an enemy supply Widewing crossing the map.
 * supply-run – a friendly Widewing bringing paper home, with enemy fighters after it.
 */
export type EventKind = 'raid' | 'high-value' | 'convoy' | 'supply-run';

export const EVENT_LABELS: Record<EventKind, string> = {
  raid: 'Enemy raid',
  'high-value': 'High-value target',
  convoy: 'Enemy convoy',
  'supply-run': 'Supply run',
};

export interface WorldEvent {
  id: string;
  kind: EventKind;
  /** Where it is: the raid's origin, the shipment's territory, the middle of the convoy's route, where the supplies come from. */
  territoryId: string;
  title: string;
  detail: string;
  status: 'active' | 'resolved' | 'failed' | 'expired';
  /** Seconds left before it goes away by itself, or null. */
  timeLeft: number | null;
  /** The aircraft it involves: its subject first (the raider, the convoy, the supply plane), then the rest. */
  aircraft: string[];
  /** The crates holding a shipment. */
  target?: string;
  /** The optional card it puts on the board. */
  mission: Mission | null;
  /** The raid it follows. */
  raidId?: number;
  outcome?: string;
}

/** Something the player should hear about: a banner. */
export interface EventNote {
  title: string;
  detail: string;
  tone: 'good' | 'bad' | 'info';
  event?: WorldEvent;
}

/** What the events need from the game. */
export interface EventHooks {
  context(): MissionContext;
  /** T1's paper store: what raiders aim for and where supply runs drop their load. */
  store: Strike;
  /** How many more aircraft that must fly can go up. */
  room(): number;
  spawn(orders: AiOrders): void;
  /** Sends an aircraft home (an event's leftovers, once it is over). */
  leave(id: string): void;
  /** Is the target-range prop `id` standing? */
  standing(id: string): boolean;
}

interface StateEntry {
  state: Exclude<TerritoryState, 'peaceful'>;
  /** Seconds of world time it lasts until; null while something holds it (a raid, an operation). */
  until: number | null;
  reason: string;
}

let serial = 0;

/**
 * The world's own happenings: raids, shipments, convoys and supply runs, never more than
 * EVENTS.maxActive at once and with a cooldown between them, each with an optional card on the
 * board and nothing lost for ignoring it (beyond a raid's capped toll). Also the territories'
 * states: on alert after the player strikes them, disabled with every weapon down, under attack
 * while a raid is coming. Their wrecks stay down while the state lasts; everything resets when
 * the state ends.
 */
export class WorldEvents {
  time = 0;
  readonly events: WorldEvent[] = [];
  /** Seconds until the next event may start. */
  cooldown: number;
  private readonly states = new Map<string, StateEntry>();
  private readonly wrecks = new Map<string, Set<string>>();
  /** Territories an operation is working on: on alert until it ends. */
  private readonly holds = new Set<string>();
  private readonly pending: Array<{ at: number; orders: AiOrders; event: string }> = [];
  private readonly notes: EventNote[] = [];
  private readonly payouts: Payout[] = [];
  /** The event whose card the player is flying: it doesn't expire under them. */
  bound: string | null = null;

  constructor(
    private readonly hooks: EventHooks,
    private readonly rng: Rng = Math.random,
  ) {
    this.cooldown = randRange(rng, EVENTS.first[0], EVENTS.first[1]);
  }

  /** Events still going on. */
  get active(): WorldEvent[] {
    return this.events.filter((e) => e.status === 'active');
  }

  get(id: string | undefined): WorldEvent | undefined {
    return id ? this.events.find((e) => e.id === id) : undefined;
  }

  /** The event about aircraft or target `id`, while it lasts. */
  about(id: string): WorldEvent | undefined {
    return this.active.find((e) => e.aircraft.includes(id) || e.target === id);
  }

  /** May AirTraffic send a raid now? Only when the player has flown and no other event is on. */
  raidsAllowed(sorties: number): boolean {
    return sorties >= EVENTS.afterSorties && this.active.length < EVENTS.maxActive;
  }

  /** One step of world time. `sorties` flown so far this visit: nothing happens before the first. */
  update(dt: number, sorties: number): void {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.time < p.at) continue;
      this.pending.splice(i, 1);
      if (this.get(p.event)?.status === 'active') this.hooks.spawn(p.orders);
    }
    for (const [id, s] of [...this.states]) {
      if (s.until !== null && this.time >= s.until && !this.holds.has(id)) this.endState(id);
    }
    for (const e of this.active) {
      if (e.timeLeft === null) continue;
      e.timeLeft = Math.max(0, e.timeLeft - dt);
      if (e.timeLeft === 0 && this.bound !== e.id) this.finish(e, 'expired', 'Moved on before anyone got to it.');
    }
    if (this.active.length > 0 || sorties < EVENTS.afterSorties) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    // Nothing could start (no room in the sky, no target): try again shortly.
    if (!this.start()) this.cooldown = 10;
  }

  /**
   * Starts an event now: `kind`, or one picked by EVENTS.weights among those the world can host.
   * Returns it, or null if none fits. (The developer panel calls this to force one.)
   */
  start(kind?: Exclude<EventKind, 'raid'>): WorldEvent | null {
    const kinds = kind ? [kind] : weightedOrder(this.rng, Object.entries(EVENTS.weights) as Array<[Exclude<EventKind, 'raid'>, number]>);
    for (const k of kinds) {
      const e = k === 'high-value' ? this.shipment() : k === 'convoy' ? this.convoy() : this.supplyRun();
      if (!e) continue;
      this.events.push(e);
      if (this.events.length > 12) this.events.splice(0, this.events.length - 12);
      this.notes.push({ title: e.title, detail: e.detail, tone: 'info', event: e });
      return e;
    }
    return null;
  }

  // ---- Raids (sent by AirTraffic) --------------------------------------------------------------

  /** A raid on T1 set out: home is under attack, and an emergency defense card goes on the board. */
  raidStarted(raid: Raid): WorldEvent {
    const ctx = this.hooks.context();
    const origin = ctx.territories.find((t) => t.id === raid.origin)!;
    const home = ctx.territories.find((t) => t.id === ctx.homeId)!;
    const e: WorldEvent = {
      id: `ev-${++serial}`,
      kind: 'raid',
      territoryId: raid.origin,
      title: `${home.id} under attack`,
      detail: `An enemy Widewing${raid.escorts.length ? ' with an escort' : ''} is heading for your paper store from ${raid.origin}.`,
      status: 'active',
      timeLeft: null,
      aircraft: [raid.bomber, ...raid.escorts],
      raidId: raid.id,
      mission: raid.mission ? null : new Mission(raidDefenseMission(raid.bomber, origin, raid.skill, raid.escorts.length > 0, ctx, this.rng)),
    };
    this.events.push(e);
    this.states.set(home.id, { state: 'under-attack', until: null, reason: 'Enemy raid inbound' });
    return e;
  }

  /** The raid is settled: home is safe again, and the next event waits its turn. */
  raidEnded(raid: Raid): void {
    const e = this.events.find((x) => x.kind === 'raid' && x.raidId === raid.id && x.status === 'active');
    const ctx = this.hooks.context();
    this.endState(ctx.homeId);
    if (!e) return;
    const won = raid.outcome === 'intercepted' || raid.outcome === 'driven-off' || raid.outcome === 'missed';
    this.finish(e, won ? 'resolved' : 'failed', raid.outcome ?? '');
  }

  // ---- What happened out there ------------------------------------------------------------------

  /**
   * An aircraft went down; `credit` when the player shot it down or helped. A convoy downed by the
   * player off its own card earns a bounty; a supply plane lost ends its run.
   */
  aircraftDown(id: string, credit: boolean, onMission: boolean): void {
    const e = this.about(id);
    if (!e || e.aircraft[0] !== id) return;
    if (e.kind === 'convoy') {
      if (credit && !onMission) this.payouts.push({ amount: EVENTS.bounty.convoy, label: 'Convoy bounty' });
      this.finish(e, credit ? 'resolved' : 'failed', credit ? 'Shot down.' : 'Went down by itself.');
      if (credit && !onMission) this.notes.push({ title: 'Convoy destroyed!', detail: `Bounty +${EVENTS.bounty.convoy} paper.`, tone: 'good' });
    } else if (e.kind === 'supply-run') {
      this.finish(e, 'failed', 'The supply plane was shot down.');
      this.notes.push({ title: 'Supply plane lost', detail: 'Enemy fighters got to it. No supplies this time.', tone: 'bad' });
    }
  }

  /**
   * An event's aircraft left the world. A convoy that gets away is gone, at no cost to the player;
   * a supply plane that turns back (too badly hurt) brings nothing.
   */
  aircraftEscaped(id: string): void {
    const e = this.about(id);
    if (!e || e.aircraft[0] !== id) return;
    if (e.kind === 'convoy') this.finish(e, 'failed', 'It got away.');
    if (e.kind === 'supply-run') {
      this.finish(e, 'failed', 'The supply plane turned back.');
      this.notes.push({ title: 'Supply run turned back', detail: 'Too badly hurt to make it. No supplies this time.', tone: 'bad' });
    }
  }

  /** A range prop was destroyed: if it was a shipment, the event is over (with a bounty if it was the player, off its own card). */
  targetDestroyed(id: string, byPlayer: boolean, onMission: boolean): void {
    const e = this.about(id);
    if (!e || e.kind !== 'high-value') return;
    if (byPlayer && !onMission) {
      this.payouts.push({ amount: EVENTS.bounty['high-value'], label: 'Shipment bounty' });
      this.notes.push({ title: 'Shipment destroyed!', detail: `Bounty +${EVENTS.bounty['high-value']} paper.`, tone: 'good' });
    }
    this.finish(e, 'resolved', 'Destroyed.');
  }

  /** A supply plane dropped its load on T1's store (`hit`) or beside it. */
  supplyDropped(id: string, hit: boolean): void {
    const e = this.about(id);
    if (!e || e.kind !== 'supply-run') return;
    if (!hit) return;
    this.payouts.push({ amount: EVENTS.supplies, label: 'Supplies delivered' });
    this.notes.push({ title: 'Supplies delivered!', detail: `+${EVENTS.supplies} paper landed on your store.`, tone: 'good' });
    this.finish(e, 'resolved', 'Delivered.');
  }

  // ---- Territory states --------------------------------------------------------------------------

  /**
   * The player destroyed installation `id` on `territoryId`: the territory goes on alert (its
   * wrecks stay down a while), or is disabled once `weaponsLeft` is 0.
   */
  recordDestroyed(id: string, territoryId: string, weaponsLeft: number): void {
    const ctx = this.hooks.context();
    if (territoryId === ctx.homeId) return;
    let set = this.wrecks.get(territoryId);
    if (!set) this.wrecks.set(territoryId, (set = new Set()));
    set.add(id);
    const current = this.states.get(territoryId);
    if (weaponsLeft === 0) {
      if (current?.state !== 'disabled') this.notes.push({ title: `${territoryId}'s defenses are down`, detail: 'They stay down for a few minutes: missions there are safer for now.', tone: 'good' });
      this.states.set(territoryId, { state: 'disabled', until: this.time + EVENTS.disabledTime, reason: 'Every weapon destroyed' });
    } else if (current?.state !== 'disabled') {
      this.states.set(territoryId, { state: 'alert', until: this.time + EVENTS.alertTime, reason: 'You struck it' });
    }
  }

  /** An operation is working on `territoryId` (or none): it stays on alert until the operation ends. */
  hold(territoryId: string | null): void {
    for (const id of [...this.holds]) {
      if (id === territoryId) continue;
      this.holds.delete(id);
      const s = this.states.get(id);
      if (s && s.until === null && s.state === 'alert') this.endState(id);
    }
    if (!territoryId) return;
    this.holds.add(territoryId);
    if (!this.states.has(territoryId)) this.states.set(territoryId, { state: 'alert', until: null, reason: 'Operation under way' });
  }

  stateOf(territoryId: string): TerritoryState {
    return this.states.get(territoryId)?.state ?? 'peaceful';
  }

  /** Every territory not at peace, for missions and markers. */
  get territoryStates(): ReadonlyMap<string, TerritoryState> {
    const out = new Map<string, TerritoryState>();
    for (const [id, s] of this.states) out.set(id, s.state);
    return out;
  }

  /** Seconds a territory's state still lasts (null: until its cause ends). */
  stateTimeLeft(territoryId: string): number | null {
    const s = this.states.get(territoryId);
    return s && s.until !== null ? Math.max(0, s.until - this.time) : null;
  }

  stateReason(territoryId: string): string {
    return this.states.get(territoryId)?.reason ?? '';
  }

  /** Territories whose defenders are on alert. */
  get alarmed(): Set<string> {
    return new Set([...this.states].filter(([, s]) => s.state === 'alert').map(([id]) => id));
  }

  /** Wrecks that stay down when the sortie ends: on territories on alert or disabled. */
  get persistentWrecks(): Set<string> {
    const keep = new Set<string>();
    for (const [id, set] of this.wrecks) if (this.states.has(id)) for (const w of set) keep.add(w);
    return keep;
  }

  takeNotes(): EventNote[] {
    return this.notes.splice(0);
  }

  takePayouts(): Payout[] {
    return this.payouts.splice(0);
  }

  // ---- Making events -----------------------------------------------------------------------------

  private shipment(): WorldEvent | null {
    const ctx = this.hooks.context();
    const options = shuffled(this.rng, ctx.territories.filter((t) => t.id !== ctx.homeId && this.stateOf(t.id) !== 'disabled' && this.hooks.standing(`${t.id}-crates`)));
    // Shipments sit on defended ground more often than not: high value, some risk.
    options.sort((a, b) => Number(b.threat > 0) - Number(a.threat > 0));
    const t = options[0];
    if (!t) return null;
    const target = `${t.id}-crates`;
    const minutes = Math.round(EVENTS.shipmentTime / 60);
    const mission = new Mission(shipmentMission(t, target, skillFor(threatOf(t, ctx)), ctx, this.rng, minutes));
    return {
      id: `ev-${++serial}`,
      kind: 'high-value',
      territoryId: t.id,
      title: `Paper shipment on ${t.id}`,
      detail: `A large shipment is stacked on ${t.id} for about ${minutes} minutes. Destroy it: card ${mission.reward} paper, or a ${EVENTS.bounty['high-value']} bounty on any sortie.`,
      status: 'active',
      timeLeft: EVENTS.shipmentTime,
      aircraft: [],
      target,
      mission,
    };
  }

  private convoy(): WorldEvent | null {
    const room = this.hooks.room();
    if (room < 1) return null;
    const ctx = this.hooks.context();
    const zone = ctx.territories.filter((t) => t.id !== ctx.homeId && t.threat >= 1);
    const start = shuffled(this.rng, zone)[0];
    if (!start) return null;
    const path: Territory[] = [start];
    for (let n = 0; n < 2; n++) {
      const next = shuffled(this.rng, neighbours(ctx.territories, path[path.length - 1])).find((t) => t.id !== ctx.homeId && !path.includes(t));
      if (next) path.push(next);
    }
    const skill = pickSkill(this.rng);
    const escorted = room >= 2 && this.rng() < 0.35;
    const id = `convoy-${++serial}`;
    const orders: AiOrders = { ...scoutPlan(ctx.territories, path.map((t) => t.id), skill, id, this.rng, 'event'), role: 'bomber', speed: 13 };
    this.hooks.spawn(orders);
    const aircraft = [id];
    if (escorted) {
      const s = orders.route[0];
      const wing: AiOrders = { id: `${id}-escort`, side: 'enemy', role: 'fighter', skill, purpose: 'event', route: [{ x: s.x + 10, y: s.y + 4, z: s.z - 10 }, ...orders.route.slice(1)], loop: false, exit: orders.exit, escort: id };
      this.hooks.spawn(wing);
      aircraft.push(wing.id);
    }
    const mission = new Mission(convoyMission(id, path, skill, escorted, ctx, this.rng));
    return {
      id: `ev-${++serial}`,
      kind: 'convoy',
      territoryId: path[Math.floor(path.length / 2)].id,
      title: 'Enemy convoy spotted',
      detail: `A supply Widewing${escorted ? ' with an escort' : ''} is crossing ${path.map((t) => t.id).join(' → ')}. Shoot it down: card ${mission.reward} paper, or a ${EVENTS.bounty.convoy} bounty on any sortie.`,
      status: 'active',
      timeLeft: null,
      aircraft,
      mission,
    };
  }

  private supplyRun(): WorldEvent | null {
    const room = this.hooks.room();
    if (room < 2) return null;
    const ctx = this.hooks.context();
    const home = ctx.territories.find((t) => t.id === ctx.homeId)!;
    // Supplies come in over home's own side of the map, past unprotected ground: the danger is
    // the fighters sent after them, which the player can do something about, not the guns.
    const origins = neighbours(ctx.territories, home).filter((t) => threatOf(t, ctx) === 0);
    const origin = shuffled(this.rng, origins)[0];
    if (!origin) return null;
    const id = `supply-${++serial}`;
    const [plan] = raidPlan(origin, this.hooks.store, 'hard', id, this.rng, false, 'event');
    // It circles twice to form up (time for the player to fold a fighter and take off), then swings
    // out past home's own corner of the map, clear of every territory, and runs in at the store.
    const formUp = plan.route.slice(1, 5);
    const store = this.hooks.store;
    const approach = { x: home.x + (Math.sign(home.x) || -1) * 55, y: 24, z: home.z + (Math.sign(home.z) || -1) * 55 };
    const dx = approach.x - store.x;
    const dz = approach.z - store.z;
    const len = Math.hypot(dx, dz) || 1;
    // Half way in: far enough from the turn at `approach` to be lined up, with room left to line up the drop.
    const runInDistance = Math.min(AI.runIn, len * 0.5);
    const runIn = { x: store.x + (dx / len) * runInDistance, y: store.y + AI.bombingAltitude + 2, z: store.z + (dz / len) * runInDistance };
    const bomber: AiOrders = { ...plan, side: 'player', route: [plan.route[0], ...formUp, ...formUp.map((p) => ({ ...p })), approach, runIn] };
    this.hooks.spawn(bomber);
    const skill: Difficulty = this.rng() < 0.5 ? 'easy' : 'medium';
    const fighters = room >= 3 && this.rng() < 0.3 ? 2 : 1;
    // The hunters come from the nearest enemy-held territory.
    const from = ctx.territories
      .filter((t) => t.id !== ctx.homeId && t.threat >= 1)
      .reduce((best, t) => (Math.hypot(t.x - origin.x, t.z - origin.z) < Math.hypot(best.x - origin.x, best.z - origin.z) ? t : best));
    const event = `ev-${++serial}`;
    const aircraft = [id];
    for (let i = 0; i < fighters; i++) {
      const orders = interceptorPlan(from, id, skill, `${id}-hunter${i + 1}`, this.rng, 'event');
      // They come after it once it has formed up, so there is time to get there first.
      this.pending.push({ at: this.time + 20 + i * 6, orders, event });
      aircraft.push(orders.id);
    }
    const mission = new Mission(supplyRunMission(id, origin, skill, fighters, this.hooks.store, ctx, this.rng));
    return {
      id: event,
      kind: 'supply-run',
      territoryId: origin.id,
      title: 'Supply run inbound',
      detail: `A friendly Widewing is bringing ${EVENTS.supplies} paper from ${origin.id}, with ${fighters === 1 ? 'an enemy fighter' : 'enemy fighters'} after it. Escort it for ${mission.reward} more.`,
      status: 'active',
      timeLeft: null,
      aircraft,
      mission,
    };
  }

  /** Ends an event; the next one waits a cooldown. */
  private finish(e: WorldEvent, status: WorldEvent['status'], outcome: string): void {
    if (e.status !== 'active') return;
    e.status = status;
    e.outcome = outcome;
    e.timeLeft = null;
    // Whatever it sent up heads home: hunters with nothing left to hunt, a convoy's escort. (Raids settle their own.)
    if (e.kind !== 'raid') for (const id of e.aircraft) this.hooks.leave(id);
    if (status === 'expired') this.notes.push({ title: `${EVENT_LABELS[e.kind]} gone`, detail: `${e.title}: ${outcome}`, tone: 'info', event: e });
    this.cooldown = Math.max(this.cooldown, randRange(this.rng, EVENTS.cooldown[0], EVENTS.cooldown[1]));
  }

  private endState(territoryId: string): void {
    if (!this.states.delete(territoryId)) return;
    this.wrecks.delete(territoryId);
  }
}

/** Pilots of a world event: mostly regulars. */
function pickSkill(rng: Rng): Difficulty {
  const r = rng();
  return r < 0.35 ? 'easy' : r < 0.85 ? 'medium' : 'hard';
}

/** The content difficulty of a mission on ground of this threat. */
function skillFor(threat: ThreatLevel): Difficulty {
  return threat <= 1 ? 'easy' : threat === 2 ? 'medium' : 'hard';
}

function weightedOrder<T>(rng: Rng, options: ReadonlyArray<readonly [T, number]>): T[] {
  const left = [...options];
  const out: T[] = [];
  while (left.length > 0) {
    let roll = rng() * left.reduce((s, [, w]) => s + w, 0);
    const i = Math.max(0, left.findIndex(([, w]) => (roll -= w) <= 0));
    out.push(left[i][0]);
    left.splice(i, 1);
  }
  return out;
}

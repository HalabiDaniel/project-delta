import type { Collider } from '../combat/Collision';
import { impactDamage } from '../combat/Damage';
import type { ShotOrder } from '../combat/Ordnance';
import { AI, DEFENSES, RAIDS, type AiRole, type Difficulty } from '../config';
import type { Point3 } from '../missions/Mission';
import { randRange, shuffled, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import { AiAircraft, type AiOrders, type BombOrder, type Contact, type Strike } from './AiAircraft';
import { flightTime, patrolPlan, raidPlan, scoutPlan } from './FlightPlans';
import { edgePoint, neighbours, routeLength } from './Navigation';

/** An AI aircraft a mission puts in the air, and when. */
export interface AirSpawn {
  orders: AiOrders;
  /** Seconds after launch it appears (0: at once)… */
  delay?: number;
  /** …or once the mission's patrol objective is this far along (0–1). */
  afterPatrol?: number;
  /** A raid on T1 (bomber interception): announced and settled like any other raid. */
  raid?: boolean;
}

/**
 * inbound  – the bomber is on its way to T1.
 * released – its bomb is falling.
 * over     – settled: see the outcome.
 */
export type RaidStage = 'inbound' | 'released' | 'over';

/**
 * intercepted – shot down before it released.
 * driven-off  – turned back, too badly damaged to carry on.
 * bombed      – its bomb hit the paper store.
 * missed      – its bomb missed.
 * cancelled   – the world was reset under it.
 */
export type RaidOutcome = 'intercepted' | 'driven-off' | 'bombed' | 'missed' | 'cancelled';

export interface Raid {
  id: number;
  /** The bomber's aircraft id, and its escorts'. */
  bomber: string;
  escorts: string[];
  origin: string;
  skill: Difficulty;
  /** Sent by a bomber-interception mission rather than by the world. */
  mission: boolean;
  stage: RaidStage;
  outcome: RaidOutcome | null;
  /** Seconds until the bomber reaches the store, while inbound. */
  eta: number;
  /** The player damaged the bomber: the defense was theirs, not just the guns'. */
  participated: boolean;
}

export type AirEvent =
  | { type: 'spawned'; aircraft: AiAircraft }
  /** Shot down, or crashed into something. `by` is the shooter (aircraft or installation id), if any. */
  | { type: 'destroyed'; aircraft: AiAircraft; by: string | null; byPlayer: boolean; cause: 'shot' | 'crash' }
  /** Flew into something and survived. */
  | { type: 'collision'; aircraft: AiAircraft; damage: number; at: Point3 }
  /** Left the world (or was cleared away out of sight). */
  | { type: 'gone'; aircraft: AiAircraft }
  /** A mission's aircraft left the world while its mission was still on: it got away. */
  | { type: 'escaped'; aircraft: AiAircraft }
  /** A fighter has turned on someone. */
  | { type: 'engaging'; aircraft: AiAircraft; target: string }
  | { type: 'released'; aircraft: AiAircraft; bomb: BombOrder }
  /** A raid started, changed stage or ended. */
  | { type: 'raid'; raid: Raid };

/** What the air traffic needs to know each step. */
export interface AirInput {
  territories: readonly Territory[];
  obstacles: readonly Collider[];
  /** The player's plane, while it is in the air. */
  player: Contact | null;
  /** Can the camera see this point? Aircraft only appear and vanish where it can't. */
  visible: (p: Point3) => boolean;
  /** The world may send raids now (the game is running, and the player has flown a sortie). */
  raids: boolean;
  /** How far along (0–1) the active mission's patrol objective is, for intruders that wait for it. */
  patrol: number;
}

/** Ambient pilots are mostly regulars. */
const AMBIENT_SKILL: Array<[Difficulty, number]> = [['easy', 0.35], ['medium', 0.5], ['hard', 0.15]];
/** Gone from the world once this far past its edge, seen or not. */
const FAR_GONE = 140;

/**
 * Every AI aircraft in the world: what missions send up, raids on T1, and ambient patrols over
 * enemy country that make the world feel inhabited. It decides what flies when (within
 * AI.maxActive, missions and raids first), steps every pilot, gathers their shots and bombs, keeps
 * score of raids, and clears aircraft away once they have left the world out of sight. Like the
 * defense network it only sees the player's plane as a Contact, so another player's could take its place.
 */
export class AirTraffic {
  readonly aircraft: AiAircraft[] = [];
  readonly raids: Raid[] = [];
  private readonly pending: AirSpawn[] = [];
  private readonly events: AirEvent[] = [];
  private missionTime = 0;
  private missionOn = false;
  private ambientTimer: number = AI.ambient.firstDelay;
  private raidTimer: number;
  private raidCount = 0;
  private serial = 0;

  constructor(
    private readonly territories: readonly Territory[],
    private readonly home: Territory,
    /** What raiders bomb: the paper store on T1. */
    private readonly store: Strike,
    private readonly rng: Rng = Math.random,
    /** Ambient patrols at all (tests turn them off). */
    private readonly ambient = true,
  ) {
    this.raidTimer = randRange(rng, RAIDS.first[0], RAIDS.first[1]);
  }

  get(id: string): AiAircraft | undefined {
    return this.aircraft.find((a) => a.id === id);
  }

  /** The raid currently under way (not yet settled), if any. */
  get activeRaid(): Raid | null {
    return this.raids.find((r) => r.stage !== 'over') ?? null;
  }

  /** Puts an aircraft in the air now. */
  spawn(orders: AiOrders): AiAircraft {
    const a = new AiAircraft(orders, this.rng);
    this.aircraft.push(a);
    this.events.push({ type: 'spawned', aircraft: a });
    this.makeRoom();
    return a;
  }

  /** A mission was launched: its aircraft go up now or when their moment comes. */
  startMission(spawns: readonly AirSpawn[]): void {
    this.missionOn = true;
    this.missionTime = 0;
    this.pending.length = 0;
    this.pending.push(...spawns);
  }

  /** The mission is over (done, failed or abandoned): its aircraft head home. Raids carry on. */
  endMission(): void {
    this.missionOn = false;
    this.pending.length = 0;
    for (const a of this.aircraft) if (a.purpose === 'mission') a.leave();
  }

  /**
   * The world resets for a new sortie (the view jumps back to the desk, so nobody sees it): the
   * mission's aircraft are cleared away. Ambient patrols and a raid on its way carry on.
   */
  reset(): void {
    this.endMission();
    for (const a of [...this.aircraft]) if (a.purpose === 'mission') this.remove(a);
    this.events.length = 0;
  }

  /**
   * Sends a raid at T1 now, from `origin` (or a far enemy territory out of sight). Returns it, or
   * null if one is already under way.
   */
  startRaid(skill: Difficulty, escort = false, origin?: string, visible: (p: Point3) => boolean = () => false, mission = false, id?: string): Raid | null {
    if (this.activeRaid) return null;
    const from = origin
      ? this.territories.find((t) => t.id === origin)!
      : (shuffled(this.rng, RAIDS.origins.map((o) => this.territories.find((t) => t.id === o)!)).find((t) => !visible(edgePoint(t.x, t.z, 30))) ??
        this.territories.find((t) => t.id === RAIDS.origins[0])!);
    const plan = raidPlan(from, this.store, skill, id ?? `raider-${++this.serial}`, this.rng, escort);
    return this.launchRaid(plan, from.id, skill, mission);
  }

  /**
   * Damage to an AI aircraft from `by` (an aircraft or installation id). The player's damage is
   * remembered, for kill credit and raid participation.
   */
  damage(id: string, amount: number, by: string | null, byPlayer: boolean): { dealt: number; destroyed: boolean; aircraft: AiAircraft | null } {
    const a = this.get(id);
    if (!a || !a.alive) return { dealt: 0, destroyed: false, aircraft: null };
    const { dealt, destroyed } = a.damage(amount, by, byPlayer);
    const raid = this.raidOf(a);
    if (raid && byPlayer && dealt > 0 && raid.bomber === a.id) raid.participated = true;
    if (destroyed) this.destroy(a, by, byPlayer, 'shot');
    return { dealt, destroyed, aircraft: a };
  }

  /** A bomb from bomber `id` has landed, on its target or not. */
  bombLanded(id: string, hit: boolean): void {
    this.get(id)?.bombLanded(hit);
    const raid = this.raids.find((r) => r.bomber === id && r.stage === 'released');
    if (raid) this.settle(raid, hit ? 'bombed' : 'missed');
  }

  /** One step for everything in the air. */
  update(dt: number, input: AirInput): { shots: ShotOrder[]; bombs: BombOrder[]; events: AirEvent[] } {
    const shots: ShotOrder[] = [];
    const bombs: BombOrder[] = [];
    this.schedule(dt, input);

    const contacts: Contact[] = input.player ? [input.player] : [];
    for (const a of this.aircraft) if (a.alive) contacts.push(a.contact());
    const world = { territories: input.territories, obstacles: input.obstacles, contacts, home: this.home, rng: this.rng };

    for (const a of [...this.aircraft]) {
      if (!a.alive) continue;
      const before = a.state;
      const step = a.update(dt, world);
      shots.push(...step.shots);
      if (before !== 'attack' && a.state === 'attack' && a.targetId) this.events.push({ type: 'engaging', aircraft: a, target: a.targetId });
      if (step.bomb) {
        bombs.push(step.bomb);
        this.events.push({ type: 'released', aircraft: a, bomb: step.bomb });
        const raid = this.raidOf(a);
        if (raid && raid.bomber === a.id && raid.stage === 'inbound') {
          raid.stage = 'released';
          raid.eta = 0;
          this.events.push({ type: 'raid', raid });
        }
      }
      for (const c of step.collisions) {
        const hardness = c.kind === 'object' ? DEFENSES.hardness.barrier : 1;
        const amount = Math.round(impactDamage(c.closing) * hardness);
        if (amount <= 0) continue;
        const { dealt, destroyed } = a.damage(amount, null, false);
        if (destroyed) this.destroy(a, null, false, 'crash');
        else if (dealt > 0) this.events.push({ type: 'collision', aircraft: a, damage: dealt, at: { x: a.position.x, y: a.position.y, z: a.position.z } });
        if (destroyed) break;
      }
      if (step.void && a.alive) {
        a.durability.health = 0;
        this.destroy(a, null, false, 'crash');
      }
    }

    // Raiders that turned back are settled; the rest get a fresh ETA.
    for (const raid of this.raids) {
      if (raid.stage !== 'inbound') continue;
      const bomber = this.get(raid.bomber);
      if (!bomber) continue;
      if (bomber.leaving && !bomber.released) this.settle(raid, 'driven-off');
      else raid.eta = this.eta(bomber);
    }

    // Aircraft that have left the world, out of sight, are cleared away.
    for (const a of [...this.aircraft]) {
      if (!a.gone) continue;
      const far = Math.hypot(a.position.x, a.position.z) > 190 + FAR_GONE;
      if (input.visible(a.position) && !far) continue;
      const escaped = a.purpose === 'mission' && this.missionOn;
      this.remove(a);
      this.events.push({ type: escaped ? 'escaped' : 'gone', aircraft: a });
    }
    const events = this.events.splice(0);
    return { shots, bombs, events };
  }

  // ---- What flies when ------------------------------------------------------------------------

  private schedule(dt: number, input: AirInput): void {
    this.missionTime += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      const due = s.afterPatrol !== undefined ? input.patrol >= s.afterPatrol : this.missionTime >= (s.delay ?? 0);
      if (!due) continue;
      this.pending.splice(i, 1);
      if (s.raid && s.orders.role === 'bomber') {
        const escorts = this.pending.filter((e) => e.orders.escort === s.orders.id);
        for (const e of escorts) this.pending.splice(this.pending.indexOf(e), 1);
        const origin = this.territories.reduce((best, t) => (Math.hypot(t.x - s.orders.route[0].x, t.z - s.orders.route[0].z) < Math.hypot(best.x - s.orders.route[0].x, best.z - s.orders.route[0].z) ? t : best));
        this.launchRaid([s.orders, ...escorts.map((e) => e.orders)], origin.id, s.orders.skill, true);
        i = this.pending.length;
      } else {
        this.spawn(s.orders);
      }
    }

    // Raids: only while the world may send them, one at a time, and only with room in the air.
    if (input.raids && !this.activeRaid) {
      this.raidTimer -= dt;
      if (this.raidTimer <= 0) {
        if (this.reserved() + 1 <= AI.maxActive) {
          this.raidCount++;
          const skill: Difficulty = this.raidCount === 1 ? 'easy' : this.rng() < 0.3 ? 'hard' : 'medium';
          const escort = this.raidCount > RAIDS.escortAfter && this.rng() < RAIDS.escortChance && this.reserved() + 2 <= AI.maxActive;
          this.startRaid(skill, escort, undefined, input.visible);
          this.raidTimer = randRange(this.rng, RAIDS.interval[0], RAIDS.interval[1]);
        } else {
          this.raidTimer = 15;
        }
      }
    }

    // Ambient patrols fill whatever room is left.
    if (!this.ambient) return;
    this.ambientTimer -= dt;
    const ambient = this.aircraft.filter((a) => a.purpose === 'ambient' && !a.leaving).length;
    if (this.ambientTimer > 0 || ambient >= AI.ambient.count || this.aircraft.length >= AI.maxActive || this.pending.length > 0) return;
    this.ambientTimer = this.spawnAmbient(input) ? randRange(this.rng, AI.ambient.respawn[0], AI.ambient.respawn[1]) : 3;
  }

  /** Aircraft that must fly: mission and raid ones (ambient ones make way for them). */
  private reserved(): number {
    return this.aircraft.filter((a) => a.purpose !== 'ambient').length + this.pending.length;
  }

  /** Over the limit: ambient patrols head home, the longest-flying first. */
  private makeRoom(): void {
    let over = this.aircraft.filter((a) => !a.leaving).length - AI.maxActive;
    for (const a of [...this.aircraft].sort((p, q) => q.age - p.age)) {
      if (over <= 0) break;
      if (a.purpose !== 'ambient' || a.leaving) continue;
      a.leave();
      over--;
    }
  }

  /**
   * A patrol over enemy country, entering out of sight: a scout or a fighter circling two or three
   * neighbouring territories, or a bomber crossing between them.
   */
  private spawnAmbient(input: AirInput): boolean {
    const zone = this.territories.filter((t) => t.threat >= AI.ambient.minThreat);
    if (zone.length === 0) return false;
    const role = weighted(this.rng, Object.entries(AI.ambient.weights) as Array<[AiRole, number]>);
    const skill = weighted(this.rng, AMBIENT_SKILL);
    for (const start of shuffled(this.rng, zone)) {
      const path = [start];
      for (let n = 0; n < 2; n++) {
        const next = shuffled(this.rng, neighbours(this.territories, path[path.length - 1])).find((t) => t.threat >= AI.ambient.minThreat && !path.includes(t));
        if (next) path.push(next);
      }
      const ids = path.map((t) => t.id);
      const id = `${role}-${++this.serial}`;
      // Scouts and fighters circle the zone; a bomber crosses it once and flies on out.
      const orders =
        role === 'bomber'
          ? { ...scoutPlan(this.territories, ids, skill, id, this.rng, 'ambient'), role }
          : patrolPlan(this.territories, ids, role, skill, id, this.rng, 'ambient');
      if (input.visible(orders.route[0])) continue;
      this.spawn({ ...orders, lifetime: randRange(this.rng, AI.ambient.lifetime[0], AI.ambient.lifetime[1]) });
      return true;
    }
    return false;
  }

  private launchRaid(plan: AiOrders[], origin: string, skill: Difficulty, mission: boolean): Raid {
    const [bomber, ...escorts] = plan.map((o) => this.spawn(o));
    const raid: Raid = {
      id: this.raids.length + 1,
      bomber: bomber.id,
      escorts: escorts.map((e) => e.id),
      origin,
      skill,
      mission,
      stage: 'inbound',
      outcome: null,
      eta: flightTime(bomber.orders),
      participated: false,
    };
    this.raids.push(raid);
    this.events.push({ type: 'raid', raid });
    return raid;
  }

  /** Seconds until a bomber gets to its release point, along what is left of its route. */
  private eta(a: AiAircraft): number {
    const rest = a.state === 'bomb-run' ? [] : a.route.slice(a.waypoint);
    const strike = a.orders.strike;
    const points = strike ? [...rest, strike] : rest;
    return routeLength(a.position, points) / (a.orders.speed ?? a.spec.flight.cruiseSpeed);
  }

  private raidOf(a: AiAircraft): Raid | undefined {
    return this.raids.find((r) => r.stage !== 'over' && (r.bomber === a.id || r.escorts.includes(a.id)));
  }

  private settle(raid: Raid, outcome: RaidOutcome): void {
    if (raid.stage === 'over') return;
    raid.stage = 'over';
    raid.outcome = outcome;
    raid.eta = 0;
    // With the bomber gone, its escort turns for home.
    for (const id of raid.escorts) this.get(id)?.leave();
    this.events.push({ type: 'raid', raid });
  }

  private destroy(a: AiAircraft, by: string | null, byPlayer: boolean, cause: 'shot' | 'crash'): void {
    const raid = this.raidOf(a);
    if (raid && raid.bomber === a.id && raid.stage === 'inbound') this.settle(raid, 'intercepted');
    this.remove(a);
    this.events.push({ type: 'destroyed', aircraft: a, by, byPlayer, cause });
  }

  private remove(a: AiAircraft): void {
    const i = this.aircraft.indexOf(a);
    if (i >= 0) this.aircraft.splice(i, 1);
    const raid = this.raidOf(a);
    if (raid && raid.bomber === a.id && raid.stage === 'inbound' && a.alive) this.settle(raid, 'cancelled');
  }
}

function weighted<T>(rng: Rng, options: ReadonlyArray<readonly [T, number]>): T {
  let roll = rng() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of options) if ((roll -= w) <= 0) return value;
  return options[options.length - 1][0];
}


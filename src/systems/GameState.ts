import { assessSuitability, bombLoad, type Suitability } from '../aircraft/Aircraft';
import { Durability, type DamageSource } from '../combat/Damage';
import { Gun } from '../combat/Gun';
import { AIRCRAFT, AIRCRAFT_ORDER, BOMB, ECONOMY, PLANE, RAIDS, STARTER_AIRCRAFT, type AircraftId, type AircraftSpec, type AiRole } from '../config';
import type { Mission, MissionFailure, Objective, Point3 } from '../missions/Mission';
import { HomeIncome } from './HomeIncome';
import type { ResourceManager } from './ResourceManager';

/**
 * desk     – at home on T1, choosing a mission and an aircraft. Recovered or stowed planes wait in the hangar.
 * building – a plane is being folded, refitted or rolled out onto the launch pad.
 * ready    – the plane is on the pad. Switching aircraft now stows it in the hangar.
 * flying   – the sortie is under way.
 * landed   – the plane touched down safely on T1. It can rearm, take off again, or end the sortie.
 * debrief  – the sortie ended with the plane recovered; the report is up.
 * crashed  – the plane was destroyed; the report is up.
 */
export type GamePhase = 'desk' | 'building' | 'ready' | 'flying' | 'landed' | 'debrief' | 'crashed';

/** fold – a new plane from a sheet. refit – re-crease and repair a recovered one. rollout – a stowed one, ready to go. */
export type BuildKind = 'fold' | 'refit' | 'rollout';

/**
 * The fold pose while building. A new plane goes from a flat sheet to finished; a refit re-creases
 * a recovered plane: wings up, then back down. A stowed plane just rolls out finished. Shared by
 * the player's own plane, the server's view of every plane and remote planes in multiplayer.
 */
export function foldPose(progress: number, kind: BuildKind): number {
  if (kind === 'fold') return progress;
  if (kind === 'rollout') return 1;
  return progress < 0.35 ? 1 - (progress / 0.35) * 0.5 : 0.5 + ((progress - 0.35) / 0.65) * 0.5;
}


export type CrashCause = 'void' | 'impact' | 'hard-landing' | 'shot-down';

/** A plane waiting at home. Recovered planes need a refit; stowed ones were never flown. */
export interface HangarPlane {
  condition: 'ready' | 'recovered';
  health: number;
  /** Paper already put into a stowed plane, charged to the sortie it eventually flies. */
  invested: number;
}

/** Everything the sortie report shows, gathered from the first fold to the end of the sortie. */
export interface SortieLog {
  aircraft: AircraftId;
  kind: BuildKind;
  paperSpent: number;
  paperEarned: number;
  damageDealt: number;
  damageTaken: number;
  bombsDropped: number;
  bombHits: number;
  shotsFired: number;
  shotsHit: number;
  targetsDestroyed: number;
  /** Turrets, launchers, radars and depots destroyed (also counted in targetsDestroyed). */
  defensesDestroyed: number;
  /** Ink turrets among them. */
  turretsDestroyed: number;
  /** Enemy rounds and rockets fired at the plane, and how many of them hit it. */
  enemyShots: number;
  enemyHits: number;
  /** What destroyed the plane, when enemy fire did ("Ink turret on T8"). */
  killedBy: string | null;
  /** Enemy aircraft the player shot down (or helped to), and how many of them were bombers. */
  aircraftDestroyed: number;
  bombersIntercepted: number;
  /** Raids on T1 beaten off with the player's help, and friendly bombers seen safely to their target. */
  objectivesProtected: number;
  /** Paper taken by enemy raids that got through. */
  paperLost: number;
  /** Paper earned that didn't fit in the store (it was full). */
  paperOverflow: number;
  rearms: number;
  /** Metres flown, over every take-off of the sortie. */
  distanceFlown: number;
  /** Safe touchdowns on T1 during the sortie. */
  landings: number;
  /** Flown in the free emergency plane. */
  emergency: boolean;
  outcome: 'flying' | 'recovered' | 'lost';
}

/**
 * The free emergency plane, folded from scrap when the player can afford no plane at all: the
 * starter's pattern (the Swift since v0.0.11, the Dart before) with half the ink, no bomb, a
 * shorter range, and it falls apart after the sortie (it is never kept).
 */
export function emergencyPlane(): AircraftSpec {
  const base = AIRCRAFT[STARTER_AIRCRAFT];
  return {
    ...base,
    name: `Emergency ${base.name}`,
    roleLabel: 'Emergency',
    cost: 0,
    refitCost: 0,
    tagline: 'Scrap paper, free, for one sortie: half the ink, no bomb, shorter range.',
    range: ECONOMY.emergency.range,
    gun: { ...base.gun, ammo: ECONOMY.emergency.ammo },
    gunLabel: `${base.gunLabel} (half full)`,
    bombs: { capacity: 0, kind: base.bombs.kind },
  };
}

export type GameEvent =
  | { type: 'aircraft-selected'; aircraft: AircraftId }
  | { type: 'stowed'; aircraft: AircraftId }
  | { type: 'built'; cost: number; kind: BuildKind; aircraft: AircraftId }
  | { type: 'build-refused'; cost: number; reason: 'paper' | 'incompatible'; detail: string }
  | { type: 'ready' }
  | { type: 'mission-selected'; index: number }
  | { type: 'launch-refused'; detail: string }
  | { type: 'launched' }
  | { type: 'fired'; barrel: number; ammo: number }
  | { type: 'out-of-ammo' }
  | { type: 'bomb-dropped'; remaining: number }
  /** `tooHigh`: it landed on target, but wasn't released on a clean low-level approach. */
  | { type: 'bomb-missed'; remaining: number; tooHigh: boolean }
  /** The plane climbed too high inside a low-level approach zone. */
  | { type: 'approach-blown'; index: number }
  | { type: 'objective-complete'; index: number; objective: Objective }
  | { type: 'mission-succeeded'; reward: number }
  | { type: 'mission-failed'; reason: MissionFailure }
  | { type: 'damaged'; amount: number; source: DamageSource; health: number }
  | { type: 'target-destroyed'; id: string; defense: boolean }
  | { type: 'range-exhausted' }
  | { type: 'crashed'; cause: CrashCause }
  | { type: 'landed' }
  | { type: 'rearm-started' }
  | { type: 'rearmed' }
  | { type: 'took-off' }
  | { type: 'sortie-ended' }
  | { type: 'returned' }
  | { type: 'paper-reset' }
  /** An enemy aircraft went down; `credit` when the player shot it down or helped to. */
  | { type: 'aircraft-destroyed'; id: string; role: AiRole; credit: boolean }
  /** A raid on T1 was beaten off. Paid (outside missions) only when the player took part. */
  | { type: 'raid-defended'; reward: number; participated: boolean }
  /** A raider's bomb hit T1. */
  | { type: 'raid-hit'; lost: number };

export interface GameStats {
  planesBuilt: number;
  planesRecovered: number;
  planesLost: number;
  successes: number;
  failures: number;
  targetsDestroyed: number;
  defensesDestroyed: number;
  aircraftDestroyed: number;
  bombersIntercepted: number;
}

const CRASH_CAUSE: Record<DamageSource, CrashCause> = {
  impact: 'impact',
  landing: 'hard-landing',
  projectile: 'shot-down',
  blast: 'shot-down',
};

/**
 * The game's rules, with no rendering or input. It moves between the phases above, keeps the
 * garage (which design is chosen, what waits in the hangar), charges for planes, tracks the
 * plane's health, ink, bombs and range, feeds flight progress to the mission and pays rewards.
 * Aircraft physics live elsewhere; this class only decides which transitions are allowed and what
 * they cost.
 */
export class GameState {
  phase: GamePhase = 'desk';
  readonly stats: GameStats = {
    planesBuilt: 0, planesRecovered: 0, planesLost: 0, successes: 0, failures: 0,
    targetsDestroyed: 0, defensesDestroyed: 0, aircraftDestroyed: 0, bombersIntercepted: 0,
  };
  /** Mission cards on offer at home. */
  offers: Mission[];
  selected = 0;
  /** The mission flown on the current (or just finished) sortie. */
  mission: Mission | null = null;
  /** The design chosen in the garage. It stays chosen from one sortie to the next. */
  aircraft: AircraftId = STARTER_AIRCRAFT;
  readonly hangar = new Map<AircraftId, HangarPlane>();
  /** The plane on the pad, in the air or just landed; null at the desk. */
  plane: AircraftSpec | null = null;
  durability: Durability | null = null;
  gun: Gun | null = null;
  /** 0 → 1 while building. */
  buildProgress = 0;
  buildKind: BuildKind = 'fold';
  bombsLoaded = 0;
  bombsFalling = 0;
  /** Seconds until the next bomb can be dropped. */
  bombCooldown = 0;
  /** Metres left before the plane can only glide. */
  rangeLeft = 0;
  /** 0 → 1 while the ground crew rearms after a landing; null otherwise. */
  rearmProgress: number | null = null;
  /** The current (or just finished) sortie, from the moment its plane was paid for. */
  sortie: SortieLog | null = null;
  /** The plane on the pad or in the air is the free emergency plane. */
  emergency = false;

  private buildDuration: number = PLANE.buildTime;
  private readonly listeners: Array<(event: GameEvent) => void> = [];

  constructor(
    readonly resources: ResourceManager,
    private readonly makeOffers: () => Mission[],
    readonly income: HomeIncome = new HomeIncome(),
    readonly catalog: Record<AircraftId, AircraftSpec> = AIRCRAFT,
  ) {
    this.offers = makeOffers();
  }

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  get selectedMission(): Mission {
    return this.offers[this.selected];
  }

  /** The design chosen in the garage. */
  get chosen(): AircraftSpec {
    return this.catalog[this.aircraft];
  }

  /** Fold a new one, refit a recovered one, or roll out a stowed one. */
  buildKindFor(id: AircraftId): BuildKind {
    const waiting = this.hangar.get(id);
    return !waiting ? 'fold' : waiting.condition === 'ready' ? 'rollout' : 'refit';
  }

  buildCostFor(id: AircraftId): number {
    const kind = this.buildKindFor(id);
    return kind === 'rollout' ? 0 : kind === 'refit' ? this.catalog[id].refitCost : this.catalog[id].cost;
  }

  get buildCost(): number {
    return this.buildCostFor(this.aircraft);
  }

  /** How well design `id` suits mission `mission` (the selected card by default). */
  suitability(id: AircraftId = this.aircraft, mission: Mission = this.selectedMission): Suitability {
    return assessSuitability(this.catalog[id], mission.spec);
  }

  canBuild(): boolean {
    return this.phase === 'desk' && this.resources.canAfford(this.buildCost) && this.suitability().level !== 'unsuitable';
  }

  /**
   * The free emergency plane is on offer: at the desk, with no plane in the hangar to roll out and
   * not enough paper to fold or refit any design.
   */
  emergencyAvailable(): boolean {
    if (this.phase !== 'desk') return false;
    return AIRCRAFT_ORDER.every((id) => !this.resources.canAfford(this.buildCostFor(id)));
  }

  /** desk → building, with the free emergency plane. Refused if the mission needs a bomb (it carries none). */
  buildEmergency(): boolean {
    if (!this.emergencyAvailable()) return false;
    const spec = emergencyPlane();
    const fit = assessSuitability(spec, this.selectedMission.spec);
    if (fit.level === 'unsuitable') {
      this.emit({ type: 'build-refused', cost: 0, reason: 'incompatible', detail: fit.reason });
      return false;
    }
    this.plane = spec;
    this.emergency = true;
    this.buildKind = 'fold';
    this.durability = new Durability(spec.maxHealth);
    this.sortie = newSortie(spec.id, 'fold', 0);
    this.sortie.emergency = true;
    this.phase = 'building';
    this.buildProgress = 0;
    this.buildDuration = PLANE.buildTime;
    this.emit({ type: 'built', cost: 0, kind: 'fold', aircraft: spec.id });
    return true;
  }

  /**
   * Replaces the cards on offer (the director dealt a new one, or one went stale). Only before
   * launch; the selection stays on the same card if it is still there.
   */
  updateOffers(offers: Mission[]): boolean {
    if (this.phase !== 'desk' && this.phase !== 'building' && this.phase !== 'ready') return false;
    const current = this.offers[this.selected];
    this.offers = offers;
    const keep = offers.indexOf(current);
    this.selected = keep >= 0 ? keep : Math.min(this.selected, Math.max(0, offers.length - 1));
    return true;
  }

  /** A bonus on top of a reward (a streak, an operation, an optional objective, a bounty). */
  payBonus(amount: number, label: string): void {
    if (amount <= 0) return;
    const added = this.resources.earn(Math.round(amount), 'bonus', label);
    if (this.sortie) {
      this.sortie.paperEarned += added;
      this.sortie.paperOverflow += Math.round(amount) - added;
    }
  }

  /** Missions can be chosen any time before launch. */
  select(index: number): boolean {
    if (this.phase !== 'desk' && this.phase !== 'building' && this.phase !== 'ready') return false;
    if (index < 0 || index >= this.offers.length || index === this.selected) return false;
    this.selected = index;
    this.emit({ type: 'mission-selected', index });
    return true;
  }

  /**
   * Chooses a design in the garage. At the desk it just changes the choice; with a plane waiting on
   * the pad, that plane is stowed in the hangar first (free, ready to roll out later). Not while folding.
   */
  selectAircraft(id: AircraftId): boolean {
    if (!(id in this.catalog) || (id === this.aircraft && !this.emergency)) return false;
    if (this.phase === 'ready') this.stow();
    if (this.phase !== 'desk') return false;
    this.aircraft = id;
    this.emit({ type: 'aircraft-selected', aircraft: id });
    return true;
  }

  /** ready → desk: the plane on the pad goes into the hangar, ready to fly, with what was paid for it. */
  stow(): boolean {
    if (this.phase !== 'ready' || !this.plane) return false;
    const id = this.plane.id;
    // Scrap paper isn't worth keeping: an emergency plane taken off the pad is simply gone.
    if (!this.emergency) this.hangar.set(id, { condition: 'ready', health: this.durability?.health ?? this.plane.maxHealth, invested: this.sortie?.paperSpent ?? 0 });
    this.clearPlane();
    this.phase = 'desk';
    this.emit({ type: 'stowed', aircraft: id });
    return true;
  }

  /**
   * desk → building. Paid up front; refused (with no charge) if the player can't afford it, or if
   * the chosen plane can't fly the chosen mission at all.
   */
  build(): boolean {
    if (this.phase !== 'desk') return false;
    const cost = this.buildCost;
    const fit = this.suitability();
    if (fit.level === 'unsuitable') {
      this.emit({ type: 'build-refused', cost, reason: 'incompatible', detail: fit.reason });
      return false;
    }
    const spec = this.chosen;
    const kind = this.buildKindFor(spec.id);
    const label = kind === 'refit' ? `Refitted ${spec.name}` : `Folded ${spec.name}`;
    if (!this.resources.spend(cost, label)) {
      this.emit({ type: 'build-refused', cost, reason: 'paper', detail: '' });
      return false;
    }
    const waiting = this.hangar.get(spec.id);
    this.hangar.delete(spec.id);
    this.plane = spec;
    this.emergency = false;
    this.buildKind = kind;
    this.durability = new Durability(spec.maxHealth);
    this.sortie = newSortie(spec.id, kind, cost + (kind === 'rollout' ? (waiting?.invested ?? 0) : 0));
    this.phase = 'building';
    this.buildProgress = 0;
    this.buildDuration = kind === 'fold' ? PLANE.buildTime : kind === 'refit' ? PLANE.refitTime : PLANE.rolloutTime;
    if (kind === 'fold') this.stats.planesBuilt++;
    this.emit({ type: 'built', cost, kind, aircraft: spec.id });
    return true;
  }

  /** Advances everything that runs on a clock: income, folding, guns, bombs, rearming and the mission timer. */
  tick(dt: number): void {
    this.income.update(dt, this.resources);
    if (this.phase === 'building') {
      this.buildProgress = Math.min(1, this.buildProgress + dt / this.buildDuration);
      if (this.buildProgress >= 1) {
        this.phase = 'ready';
        this.emit({ type: 'ready' });
      }
    } else if (this.phase === 'flying' || this.phase === 'landed') {
      this.bombCooldown = Math.max(0, this.bombCooldown - dt);
      this.gun?.update(dt);
      if (this.rearmProgress !== null) {
        this.rearmProgress = Math.min(1, this.rearmProgress + dt / PLANE.rearmTime);
        if (this.rearmProgress >= 1) this.finishRearm();
      }
      if (this.mission?.tick(dt)) this.failMission('out-of-time');
    }
  }

  /** ready → flying. The selected mission starts and the plane is armed for it. */
  launch(): boolean {
    if (this.phase !== 'ready' || !this.plane) return false;
    const fit = assessSuitability(this.plane, this.selectedMission.spec);
    if (fit.level === 'unsuitable') {
      this.emit({ type: 'launch-refused', detail: fit.reason });
      return false;
    }
    this.phase = 'flying';
    this.mission = this.selectedMission;
    this.mission.start();
    this.bombsLoaded = bombLoad(this.plane, this.mission.spec);
    this.bombsFalling = 0;
    this.bombCooldown = 0;
    this.gun = new Gun(this.plane.gun);
    this.rangeLeft = this.plane.range;
    this.emit({ type: 'launched' });
    return true;
  }

  canFire(): boolean {
    return this.phase === 'flying' && !!this.gun?.canFire();
  }

  /** Fires the ink guns if a round is ready. Returns the barrel it left from, or null. */
  fire(): number | null {
    if (!this.canFire()) return null;
    const barrel = this.gun!.fire()!;
    this.sortie!.shotsFired++;
    this.emit({ type: 'fired', barrel, ammo: this.gun!.ammo });
    if (this.gun!.empty) this.emit({ type: 'out-of-ammo' });
    return barrel;
  }

  canDropBomb(): boolean {
    return this.phase === 'flying' && this.bombsLoaded > 0 && this.bombCooldown <= 0;
  }

  dropBomb(): boolean {
    if (!this.canDropBomb()) return false;
    this.bombsLoaded--;
    this.bombsFalling++;
    this.bombCooldown = BOMB.dropCooldown;
    this.sortie!.bombsDropped++;
    this.emit({ type: 'bomb-dropped', remaining: this.bombsLoaded });
    return true;
  }

  /** Would a bomb released now count for a low-level strike? (True when no objective asks for one.) */
  get releaseClean(): boolean {
    return this.mission?.releaseClean ?? true;
  }

  /**
   * A released bomb has landed, on objective `objective`'s target or (null) anywhere else.
   * `struck` says whether its blast damaged a prop, target or installation, which also counts as a
   * hit for accuracy; `clean` whether it was released on a clean low-level approach. Only a bomb
   * that lands while the mission is still active can complete an objective. Once every bomb is
   * gone with a target still standing, the mission fails.
   */
  resolveBomb(objective: number | null, struck = false, clean = true): void {
    this.bombsFalling = Math.max(0, this.bombsFalling - 1);
    const mission = this.mission;
    // A bomb released just before touchdown can still land while the plane rolls out.
    const live = (this.phase === 'flying' || this.phase === 'landed') && !!mission?.isActive;
    const scored = live && objective !== null && mission!.completeBomb(objective, clean);
    if ((scored || struck) && this.sortie) this.sortie.bombHits++;
    if (!live || !mission) return;
    if (scored) this.objectiveComplete(objective!);
    else this.emit({ type: 'bomb-missed', remaining: this.bombsLoaded, tooHigh: objective !== null && !clean });
    if (mission.isActive && mission.hasUnfinishedBombs() && this.bombsLoaded === 0 && this.bombsFalling === 0) {
      this.failMission('missed');
    }
  }

  /** An ink round struck something. */
  recordShotHit(): void {
    if (this.sortie) this.sortie.shotsHit++;
  }

  /**
   * The player dealt `dealt` damage to a prop, practice target or (`defense`) installation;
   * `destroyed` names it if that finished it off. Destroyed targets count towards destroy objectives.
   */
  recordDamage(dealt: number, destroyed: string | null, defense = false, turret = false): void {
    if (this.sortie) this.sortie.damageDealt += dealt;
    if (!destroyed) return;
    if (this.sortie) this.sortie.targetsDestroyed++;
    this.stats.targetsDestroyed++;
    if (defense) {
      if (this.sortie) this.sortie.defensesDestroyed++;
      if (this.sortie && turret) this.sortie.turretsDestroyed++;
      this.stats.defensesDestroyed++;
    }
    this.emit({ type: 'target-destroyed', id: destroyed, defense });
    if (this.phase !== 'flying' && this.phase !== 'landed') return;
    for (const index of this.mission?.completeDestroy(destroyed) ?? []) this.objectiveComplete(index);
  }

  /**
   * AI aircraft `id` went down. `credit`: the player shot it down or helped to, which is what the
   * report and career count. It counts for the mission whoever finished it (T1's guns included);
   * an escorted bomber going down loses the mission.
   */
  aircraftDestroyed(id: string, role: AiRole, credit: boolean): void {
    if (credit) {
      this.stats.aircraftDestroyed++;
      if (this.sortie) this.sortie.aircraftDestroyed++;
      if (role === 'bomber') {
        this.stats.bombersIntercepted++;
        if (this.sortie) this.sortie.bombersIntercepted++;
      }
    }
    this.emit({ type: 'aircraft-destroyed', id, role, credit });
    const mission = this.mission;
    if (!mission?.isActive) return;
    if (mission.escorting(id)) {
      this.failMission('escort-lost');
      return;
    }
    for (const index of mission.completeDestroy(id)) this.objectiveComplete(index);
  }

  /** AI aircraft `id` got away out of the world. A mission that had to stop it is lost. */
  aircraftEscaped(id: string): void {
    if (this.mission?.lostTo(id, 'escape')) this.failMission('target-escaped');
  }

  /** AI bomber `id` released its bomb. A mission that had to stop it first is lost. */
  bombReleased(id: string): void {
    if (this.mission?.lostTo(id, 'release')) this.failMission('target-bombed');
  }

  /** The friendly bomber `id` dropped a bomb; `hit` if it landed on its target. */
  escortStrike(id: string, hit: boolean): void {
    if (!hit || !this.mission?.isActive) return;
    const index = this.mission.completeEscort(id);
    if (index < 0) return;
    if (this.sortie) this.sortie.objectivesProtected++;
    this.objectiveComplete(index);
  }

  /**
   * A raid on T1 was beaten off (shot down or turned back). The defense reward only goes to a
   * player who took part, not to T1's guns alone; a raid a mission sent pays through the mission.
   */
  raidDefended(participated: boolean, mission = false): void {
    const reward = participated && !mission ? RAIDS.reward : 0;
    const added = reward > 0 ? this.resources.earn(reward, 'reward', 'Raid beaten off') : 0;
    if (participated && this.sortie) {
      this.sortie.paperEarned += added;
      this.sortie.paperOverflow += reward - added;
      this.sortie.objectivesProtected++;
    }
    this.emit({ type: 'raid-defended', reward, participated });
  }

  /**
   * A raider's bomb hit T1: `amount` paper is destroyed, never below `floor` (the protected
   * reserve). Returns what was actually lost.
   */
  raidHit(amount: number, floor: number, label = 'Raid on T1'): number {
    const lost = this.resources.lose(Math.max(0, Math.round(amount)), floor, label);
    if (this.sortie && (this.phase === 'flying' || this.phase === 'landed')) this.sortie.paperLost += lost;
    this.emit({ type: 'raid-hit', lost });
    return lost;
  }

  /** An enemy round or rocket was fired at the plane. */
  recordIncoming(): void {
    if (this.phase === 'flying' && this.sortie) this.sortie.enemyShots++;
  }

  /**
   * The plane takes damage. At zero health it is destroyed, and the cause depends on what did it.
   * `by` names the enemy weapon behind ink and rocket hits, for the report.
   */
  damageAircraft(amount: number, source: DamageSource, by: string | null = null): { dealt: number; destroyed: boolean } {
    if (this.phase !== 'flying' || !this.durability) return { dealt: 0, destroyed: false };
    const enemy = source === 'projectile' || source === 'blast';
    if (enemy && by) this.sortie!.enemyHits++;
    const dealt = this.durability.damage(Math.round(amount));
    if (dealt <= 0) return { dealt: 0, destroyed: false };
    this.sortie!.damageTaken += dealt;
    this.emit({ type: 'damaged', amount: dealt, source, health: this.durability.health });
    if (this.durability.destroyed) {
      if (enemy) this.sortie!.killedBy = by;
      this.crash(CRASH_CAUSE[source]);
    }
    return { dealt, destroyed: this.durability.destroyed };
  }

  /** Out of range, the plane can only glide. */
  get outOfRange(): boolean {
    return this.rangeLeft <= 0;
  }

  /** One step of flight from `prev` to `pos`: range used, recon time, deliveries and rings. */
  updateFlight(prev: Point3, pos: Point3, dt: number): void {
    if (this.phase !== 'flying') return;
    const step = Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z);
    if (this.sortie) this.sortie.distanceFlown += step;
    if (this.rangeLeft > 0) {
      this.rangeLeft = Math.max(0, this.rangeLeft - step);
      if (this.rangeLeft === 0) this.emit({ type: 'range-exhausted' });
    }
    const mission = this.mission;
    if (!mission) return;
    const approaches = mission.objectives.map((_, i) => mission.approachState(i));
    for (const index of mission.updateFlight(prev, pos, dt, this.plane?.traits?.reconRate ?? 1)) this.objectiveComplete(index);
    approaches.forEach((before, index) => {
      if (before !== 'blown' && mission.approachState(index) === 'blown' && mission.isActive) this.emit({ type: 'approach-blown', index });
    });
  }

  /** flying → landed. The sortie goes on: the plane can rearm and take off again. A landing objective completes. */
  land(territoryId: string): boolean {
    if (this.phase !== 'flying') return false;
    this.phase = 'landed';
    this.rearmProgress = null;
    if (this.sortie) this.sortie.landings++;
    const mission = this.mission;
    if (mission?.completeLanding(territoryId)) {
      this.objectiveComplete(mission.objectives.findIndex((o) => o.kind === 'land'));
    }
    this.emit({ type: 'landed' });
    return true;
  }

  /** On the ground at home, with ink or range to top up. */
  canRearm(): boolean {
    if (this.phase !== 'landed' || this.rearmProgress !== null || !this.plane) return false;
    return (this.gun?.ammo ?? 0) < this.plane.gun.ammo || this.rangeLeft < this.plane.range;
  }

  /** Starts the free rearm: ink and range are restored after a short wait. Bombs come with the mission. */
  rearm(): boolean {
    if (!this.canRearm()) return false;
    this.rearmProgress = 0;
    this.emit({ type: 'rearm-started' });
    return true;
  }

  /** landed → flying, from wherever the plane stopped. */
  takeOff(): boolean {
    if (this.phase !== 'landed' || this.rearmProgress !== null) return false;
    this.phase = 'flying';
    this.emit({ type: 'took-off' });
    return true;
  }

  /**
   * landed → debrief. The plane goes into the hangar and only needs a refit next time. An
   * unfinished mission is abandoned.
   */
  endSortie(): boolean {
    if (this.phase !== 'landed' || !this.plane) return false;
    this.phase = 'debrief';
    this.rearmProgress = null;
    this.failMission('abandoned');
    if (!this.emergency) this.hangar.set(this.plane.id, { condition: 'recovered', health: this.durability?.health ?? 0, invested: 0 });
    this.bombsLoaded = 0;
    this.stats.planesRecovered++;
    if (this.sortie) this.sortie.outcome = 'recovered';
    this.emit({ type: 'sortie-ended' });
    return true;
  }

  /** The plane is destroyed. An unresolved mission fails; a completed one keeps its reward. */
  crash(cause: CrashCause): void {
    if (this.phase !== 'flying') return;
    this.phase = 'crashed';
    this.bombsLoaded = 0;
    this.stats.planesLost++;
    if (this.durability) this.durability.health = 0;
    if (this.sortie) this.sortie.outcome = 'lost';
    this.failMission('aircraft-lost');
    this.emit({ type: 'crashed', cause });
  }

  /** debrief | crashed → desk, with a fresh set of mission cards. */
  continueToDesk(): boolean {
    if (this.phase !== 'debrief' && this.phase !== 'crashed') return false;
    this.phase = 'desk';
    this.mission = null;
    this.clearPlane();
    this.bombsFalling = 0;
    this.offers = this.makeOffers();
    this.selected = 0;
    this.emit({ type: 'returned' });
    return true;
  }

  /** Development option (console: `paperwars.state.resetPaper()`): restore the starting paper. */
  resetPaper(): void {
    this.resources.reset();
    this.emit({ type: 'paper-reset' });
  }

  private finishRearm(): void {
    this.rearmProgress = null;
    this.gun?.refill();
    if (this.plane) this.rangeLeft = this.plane.range;
    if (this.sortie) this.sortie.rearms++;
    this.emit({ type: 'rearmed' });
  }

  private clearPlane(): void {
    this.plane = null;
    this.emergency = false;
    this.durability = null;
    this.gun = null;
    this.sortie = null;
    this.bombsLoaded = 0;
    this.rearmProgress = null;
    this.rangeLeft = 0;
  }

  private objectiveComplete(index: number): void {
    const mission = this.mission!;
    this.emit({ type: 'objective-complete', index, objective: mission.objectives[index] });
    // Finishing one may open the next, whose targets may already be down.
    for (const next of mission.settle()) this.objectiveComplete(next);
    if (mission.allDone && mission.succeed()) {
      const added = this.resources.earn(mission.reward, 'reward', `Mission completed: ${mission.title}`);
      if (this.sortie) {
        this.sortie.paperEarned += added;
        this.sortie.paperOverflow += mission.reward - added;
      }
      this.stats.successes++;
      this.emit({ type: 'mission-succeeded', reward: mission.reward });
    }
  }

  private failMission(reason: MissionFailure): void {
    if (this.mission?.fail(reason)) {
      this.stats.failures++;
      this.emit({ type: 'mission-failed', reason });
    }
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function newSortie(aircraft: AircraftId, kind: BuildKind, paperSpent: number): SortieLog {
  return {
    aircraft, kind, paperSpent, paperEarned: 0, damageDealt: 0, damageTaken: 0,
    bombsDropped: 0, bombHits: 0, shotsFired: 0, shotsHit: 0, targetsDestroyed: 0, defensesDestroyed: 0, turretsDestroyed: 0,
    enemyShots: 0, enemyHits: 0, killedBy: null, aircraftDestroyed: 0, bombersIntercepted: 0, objectivesProtected: 0, paperLost: 0, paperOverflow: 0,
    rearms: 0, distanceFlown: 0, landings: 0, emergency: false, outcome: 'flying',
  };
}

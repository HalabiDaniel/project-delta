import type { AirSpawn } from '../ai/AirTraffic';
import type { AiRole, Difficulty, ThreatLevel, Tier } from '../config';

export type MissionType =
  | 'bombing'
  | 'precision'
  | 'recon'
  | 'delivery'
  | 'return'
  | 'multi-bomb'
  | 'rings'
  | 'practice'
  | 'suppression'
  | 'danger-recon'
  | 'fortified'
  | 'multi-stage'
  | 'survival'
  | 'low-attack'
  | 'dogfight'
  | 'scout-intercept'
  | 'bomber-intercept'
  | 'escort'
  | 'patrol'
  | 'combined'
  /** World events: a high-value shipment to destroy, an enemy convoy to intercept, a friendly supply run to escort. */
  | 'shipment'
  | 'convoy'
  | 'supply-run';

/**
 * What the director put on top of a mission. Escalations make a hard mission very hard (a second
 * fighter, an escort for the bomber, an extra target, a mandatory return, a stricter clock);
 * situational modifiers come from the world (a high-value target, a territory on alert) or the
 * player's situation (a recovery mission, an emergency).
 */
export type Escalation = 'wingman' | 'escorted' | 'extra-target' | 'return' | 'tight-clock';
export type Situational = 'high-value' | 'alert' | 'recovery' | 'emergency';
export type ModifierId = Escalation | Situational;

/** reward = B × D × M, rounded to 5. */
export interface RewardParts {
  /** The mission type's base reward plus the distance, threat and air bonuses. */
  base: number;
  /** The tier's difficulty multiplier. */
  difficulty: number;
  /** The product of the modifiers' multipliers. */
  modifier: number;
  /** A floor that applies (recovery missions pay enough for a new plane), or null. */
  floor: number | null;
}

export type MissionStatus = 'available' | 'active' | 'succeeded' | 'failed';

/** A completed mission's performance rating. */
export type Medal = 'bronze' | 'silver' | 'gold';

/**
 * missed         – every bomb is gone and a target is still standing.
 * out-of-time    – the mission clock ran out.
 * aircraft-lost  – the plane crashed before the mission was done.
 * abandoned      – the plane landed back home before the mission was done.
 * target-escaped – an enemy aircraft the mission was after got away.
 * target-bombed  – the bomber to intercept released its bomb.
 * escort-lost    – the friendly bomber to protect was shot down.
 */
export type MissionFailure = 'missed' | 'out-of-time' | 'aircraft-lost' | 'abandoned' | 'target-escaped' | 'target-bombed' | 'escort-lost';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A marked circle standing on a territory. Only a bomb that comes down inside it is a hit. */
export interface TargetZone {
  x: number;
  z: number;
  radius: number;
  /** Height of the marker's top face. */
  top: number;
}

/** The column of air over a territory, from the platform up to `ceiling`. */
export interface Airspace {
  x: number;
  z: number;
  half: number;
  ceiling: number;
}

/** A vertical paper hoop. `yaw` is the heading that flies straight through it. */
export interface RingGate {
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
}

/**
 * A low-level approach: within `radius` of (x, z) the plane must stay at or below `ceiling`, or
 * the run is blown until it leaves the zone and comes in again.
 */
export interface LowApproach {
  x: number;
  z: number;
  radius: number;
  ceiling: number;
}

/** outside – not in the approach zone. clean – in it, low the whole way. blown – in it, but went too high. */
export type ApproachState = 'outside' | 'clean' | 'blown';

/** What a destroy objective is after: practice planes, weapons, a radar station or a supply depot. */
export type DestroyKind = 'practice' | 'defense' | 'radar' | 'supply' | 'shipment';

export type Objective =
  | { kind: 'bomb'; territoryId: string; zone: TargetZone; precision: boolean; approach?: LowApproach }
  | { kind: 'recon'; territoryId: string; airspace: Airspace; duration: number }
  | { kind: 'reach'; territoryId: string; airspace: Airspace }
  | { kind: 'ring'; gate: RingGate; number: number }
  | { kind: 'land'; territoryId: string }
  /** Shoot down (or bomb) `count` of the targets `targets` on a territory. */
  | { kind: 'destroy'; territoryId: string; targets: string[]; count: number; what?: DestroyKind }
  /** Spend `duration` seconds in total inside a defended territory's airspace. */
  | { kind: 'survive'; territoryId: string; airspace: Airspace; duration: number }
  /** Get at least `distance` (horizontally) away from (x, z): clear of a territory's weapons. */
  | { kind: 'escape'; territoryId: string; x: number; z: number; distance: number }
  /**
   * Shoot down `count` of the AI aircraft `targets` the mission sends up, wherever they fly
   * (`territoryId` is where the fight is expected). With `before`, it fails if one of them gets
   * away ('escape') or releases its bomb ('release') first.
   */
  | { kind: 'intercept'; territoryId: string; targets: string[]; count: number; what: AiRole | 'aircraft' | 'convoy'; before?: 'escape' | 'release' }
  /** Keep friendly bomber `escort` flying until its bomb hits `zone` on `territoryId`. */
  | { kind: 'escort'; territoryId: string; escort: string; zone: TargetZone }
  /** Spend `duration` seconds in total inside a patrol area. */
  | { kind: 'patrol'; territoryId: string; airspace: Airspace; duration: number };

/** The danger a mission leads into, as the mission card shows it. */
export interface MissionThreat {
  /** The highest threat level among the territories below. */
  level: ThreatLevel;
  /** Defended territories the mission goes into (or, for a ring course, passes within reach of). */
  territories: string[];
  turrets: number;
  launchers: number;
  radars: number;
  /** Enemy aircraft the mission sends up, and how good their pilots are. */
  air?: { fighters: number; scouts: number; bombers: number; skill: Difficulty };
}

export interface MissionSpec {
  type: MissionType;
  /** The content difficulty: pilots' skill, threat window, bullseye sizes and the like. */
  difficulty: Difficulty;
  /** How hard the card is as offered (a very hard card is hard content with escalations). Defaults to `difficulty`. */
  tier?: Tier;
  /** What the director added on top. */
  modifiers?: ModifierId[];
  /** How the reward was worked out, for the card and the developer panel. */
  rewardParts?: RewardParts;
  /** Seconds a good run takes, for the bronze / silver / gold rating. */
  par?: number;
  title: string;
  description: string;
  reward: number;
  /** Bombs offered for this mission; a plane carries as many as its rack holds. Missions without bombing objectives offer none. */
  bombs: number;
  /** Seconds from launch, or null for no time limit. */
  timeLimit: number | null;
  /** Ordered objectives must be done one after another; otherwise in any order. */
  ordered: boolean;
  objectives: Objective[];
  /** Known defenses along the way. */
  threat?: MissionThreat;
  /** "Operation Paper Storm". */
  codename?: string;
  /** AI aircraft the mission puts in the air once launched: enemies to fight, a bomber to escort. */
  aircraft?: AirSpawn[];
}

/**
 * One mission and its progress. It knows nothing about the aircraft or the scene: the game reports
 * what happened (a bomb hit objective 2, the plane moved from A to B, the plane landed on T1) and
 * the mission tracks which objectives are done. `succeed` and `fail` only act on an active
 * mission, which is what guarantees the reward is paid at most once per sortie.
 */
export class Mission {
  status: MissionStatus = 'available';
  failure: MissionFailure | null = null;
  /** Seconds since launch. */
  elapsed = 0;
  /** Progress per objective, 0 to 1. An objective is done at 1. */
  readonly progress: number[];
  /**
   * Everything destroyed since launch. A destroy objective counts each target once, and a target
   * destroyed before its objective opened still counts when it does: wrecks stay down all sortie.
   */
  private readonly destroyed = new Set<string>();
  /** Low-level approaches, per bomb objective that has one. */
  private readonly approaches = new Map<number, ApproachState>();

  constructor(readonly spec: MissionSpec) {
    this.progress = spec.objectives.map(() => 0);
  }

  get title(): string {
    return this.spec.title;
  }

  get reward(): number {
    return this.spec.reward;
  }

  get objectives(): readonly Objective[] {
    return this.spec.objectives;
  }

  get isActive(): boolean {
    return this.status === 'active';
  }

  get timeLeft(): number | null {
    return this.spec.timeLimit === null ? null : Math.max(0, this.spec.timeLimit - this.elapsed);
  }

  isDone(index: number): boolean {
    return this.progress[index] >= 1;
  }

  get allDone(): boolean {
    return this.progress.every((p) => p >= 1);
  }

  get tier(): Tier {
    return this.spec.tier ?? this.spec.difficulty;
  }

  /**
   * Can objective `index` be completed right now? In an ordered mission only the first unfinished
   * one can, and a landing is always last: it only counts once everything else is done.
   */
  isOpen(index: number): boolean {
    if (this.isDone(index)) return false;
    if (this.objectives[index]?.kind === 'land' && this.objectives.some((o, i) => o.kind !== 'land' && !this.isDone(i))) return false;
    if (!this.spec.ordered) return true;
    for (let i = 0; i < index; i++) if (!this.isDone(i)) return false;
    return true;
  }

  /** Indices of the objectives that can be completed right now. */
  openObjectives(): number[] {
    return this.objectives.map((_, i) => i).filter((i) => this.isOpen(i));
  }

  /** Bombing objectives not yet hit, open or not. While any remain, running out of bombs fails the mission. */
  hasUnfinishedBombs(): boolean {
    return this.objectives.some((o, i) => o.kind === 'bomb' && !this.isDone(i));
  }

  /** available → active. */
  start(): boolean {
    if (this.status !== 'available') return false;
    this.status = 'active';
    this.failure = null;
    this.elapsed = 0;
    return true;
  }

  /** active → succeeded. Returns true only on the transition, so callers pay the reward once. */
  succeed(): boolean {
    if (this.status !== 'active') return false;
    this.status = 'succeeded';
    return true;
  }

  /** active → failed. */
  fail(reason: MissionFailure): boolean {
    if (this.status !== 'active') return false;
    this.status = 'failed';
    this.failure = reason;
    return true;
  }

  /** Advances the mission clock. Returns true on the step the time limit runs out. */
  tick(dt: number): boolean {
    if (!this.isActive) return false;
    this.elapsed += dt;
    return this.spec.timeLimit !== null && this.elapsed >= this.spec.timeLimit;
  }

  /**
   * A bomb came down inside objective `index`'s zone. `clean` says whether it was released on a
   * clean low-level approach; objectives that demand one ignore bombs that weren't.
   */
  completeBomb(index: number, clean = true): boolean {
    const objective = this.objectives[index];
    if (!this.isActive || objective?.kind !== 'bomb' || !this.isOpen(index)) return false;
    if (objective.approach && !clean) return false;
    this.progress[index] = 1;
    return true;
  }

  /** How the low-level approach for bomb objective `index` is going ('outside' if it has none). */
  approachState(index: number): ApproachState {
    return this.approaches.get(index) ?? 'outside';
  }

  /** Is a bomb released now on a clean approach? True when no open objective asks for one. */
  get releaseClean(): boolean {
    let needed = false;
    for (const i of this.openObjectives()) {
      const o = this.objectives[i];
      if (o.kind !== 'bomb' || !o.approach) continue;
      needed = true;
      if (this.approachState(i) === 'clean') return true;
    }
    return !needed;
  }

  /**
   * Advances the flying objectives for one step of flight from `prev` to `pos`: time spent in a
   * recon airspace, reaching a delivery airspace, flying through the next ring. Returns the
   * indices of objectives completed by this step. `reconRate` speeds up reconnaissance dwell
   * time (the Dart's recon bonus).
   */
  updateFlight(prev: Point3, pos: Point3, dt: number, reconRate = 1): number[] {
    const completed: number[] = [];
    if (!this.isActive) return completed;
    this.objectives.forEach((objective, i) => {
      if (!this.isOpen(i)) return;
      switch (objective.kind) {
        case 'recon':
        case 'survive':
        case 'patrol':
          if (insideAirspace(objective.airspace, pos)) {
            const rate = objective.kind === 'recon' ? reconRate : 1;
            this.progress[i] = Math.min(1, this.progress[i] + (dt * rate) / objective.duration);
          }
          break;
        case 'reach':
          if (insideAirspace(objective.airspace, pos)) this.progress[i] = 1;
          break;
        case 'ring':
          if (crossesRing(objective.gate, prev, pos)) this.progress[i] = 1;
          break;
        case 'escape':
          if (Math.hypot(pos.x - objective.x, pos.z - objective.z) >= objective.distance) this.progress[i] = 1;
          break;
        case 'bomb':
          if (objective.approach) this.approaches.set(i, nextApproach(objective.approach, this.approachState(i), pos));
          return;
        default:
          return;
      }
      if (this.isDone(i)) completed.push(i);
    });
    return completed;
  }

  /**
   * Target `targetId` was destroyed. Each target counts once, even if it folds itself back up and
   * is shot down again. Returns the indices of objectives completed.
   */
  completeDestroy(targetId: string): number[] {
    if (!this.isActive) return [];
    this.destroyed.add(targetId);
    return this.settle();
  }

  /**
   * Brings open destroy and intercept objectives up to date with everything destroyed so far, and
   * completes those now satisfied. Call it after any objective completes: in an ordered mission that may open
   * one whose targets are already down. Returns the indices completed.
   */
  settle(): number[] {
    const completed: number[] = [];
    if (!this.isActive) return completed;
    this.objectives.forEach((o, i) => {
      if ((o.kind !== 'destroy' && o.kind !== 'intercept') || !this.isOpen(i)) return;
      this.progress[i] = Math.min(1, this.destroyedTargets(i).size / o.count);
      if (this.isDone(i)) completed.push(i);
    });
    return completed;
  }

  /** Targets of objective `index` already destroyed. */
  destroyedTargets(index: number): ReadonlySet<string> {
    const o = this.objectives[index];
    return new Set(o?.kind === 'destroy' || o?.kind === 'intercept' ? o.targets.filter((id) => this.destroyed.has(id)) : []);
  }

  /**
   * Aircraft `id` got away (`escape`) or released its bomb (`release`). True if that loses the
   * mission: an unfinished intercept objective was after it, and it is still flying.
   */
  lostTo(id: string, how: 'escape' | 'release'): boolean {
    if (!this.isActive || this.destroyed.has(id)) return false;
    return this.objectives.some((o, i) => o.kind === 'intercept' && o.before === how && o.targets.includes(id) && !this.isDone(i));
  }

  /** Is aircraft `id` the friendly bomber an unfinished escort objective protects? */
  escorting(id: string): boolean {
    return this.isActive && this.objectives.some((o, i) => o.kind === 'escort' && o.escort === id && !this.isDone(i));
  }

  /** The escorted bomber `id` hit its target. Returns the index of the escort objective completed, or -1. */
  completeEscort(id: string): number {
    if (!this.isActive) return -1;
    const index = this.objectives.findIndex((o, i) => o.kind === 'escort' && o.escort === id && this.isOpen(i));
    if (index >= 0) this.progress[index] = 1;
    return index;
  }

  /** Progress of the patrol objective, if there is one (0 otherwise). */
  get patrolProgress(): number {
    const i = this.objectives.findIndex((o) => o.kind === 'patrol');
    return i >= 0 ? this.progress[i] : 0;
  }

  /** The plane landed on `territoryId`. Returns true if that completed a landing objective. */
  completeLanding(territoryId: string): boolean {
    if (!this.isActive) return false;
    const index = this.objectives.findIndex(
      (o, i) => o.kind === 'land' && o.territoryId === territoryId && this.isOpen(i),
    );
    if (index < 0) return false;
    this.progress[index] = 1;
    return true;
  }
}

/** One step of a low-level approach: entering low is clean, climbing too high inside blows it. */
export function nextApproach(a: LowApproach, state: ApproachState, p: Point3): ApproachState {
  if (Math.hypot(p.x - a.x, p.z - a.z) > a.radius) return 'outside';
  if (p.y > a.ceiling) return 'blown';
  return state === 'outside' ? 'clean' : state;
}

/** Is `p` over the airspace's square and no higher than its ceiling? */
export function insideAirspace(a: Airspace, p: Point3): boolean {
  return Math.abs(p.x - a.x) <= a.half && Math.abs(p.z - a.z) <= a.half && p.y <= a.ceiling;
}

/** Does the step from `prev` to `next` pass through the ring's disc, in either direction? */
export function crossesRing(gate: RingGate, prev: Point3, next: Point3): boolean {
  // The ring faces along its yaw: normal = forward at that heading (yaw 0 faces -Z).
  const nx = -Math.sin(gate.yaw);
  const nz = -Math.cos(gate.yaw);
  const d0 = (prev.x - gate.x) * nx + (prev.z - gate.z) * nz;
  const d1 = (next.x - gate.x) * nx + (next.z - gate.z) * nz;
  // A step lying in the ring's plane never passes through it.
  if (Math.abs(d0 - d1) < 1e-6 || (d0 > 0 && d1 > 0) || (d0 < 0 && d1 < 0)) return false;
  const t = d0 / (d0 - d1);
  const x = prev.x + (next.x - prev.x) * t - gate.x;
  const y = prev.y + (next.y - prev.y) * t - gate.y;
  const z = prev.z + (next.z - prev.z) * t - gate.z;
  return Math.hypot(x, y, z) <= gate.radius;
}

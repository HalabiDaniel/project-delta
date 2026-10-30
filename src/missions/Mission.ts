import type { Difficulty } from '../config';

export type MissionType = 'bombing' | 'precision' | 'recon' | 'delivery' | 'return' | 'multi-bomb' | 'rings';

export type MissionStatus = 'available' | 'active' | 'succeeded' | 'failed';

/**
 * missed         – every bomb is gone and a target is still standing.
 * out-of-time    – the mission clock ran out.
 * aircraft-lost  – the plane crashed before the mission was done.
 * abandoned      – the plane landed back home before the mission was done.
 */
export type MissionFailure = 'missed' | 'out-of-time' | 'aircraft-lost' | 'abandoned';

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

export type Objective =
  | { kind: 'bomb'; territoryId: string; zone: TargetZone; precision: boolean }
  | { kind: 'recon'; territoryId: string; airspace: Airspace; duration: number }
  | { kind: 'reach'; territoryId: string; airspace: Airspace }
  | { kind: 'ring'; gate: RingGate; number: number }
  | { kind: 'land'; territoryId: string };

export interface MissionSpec {
  type: MissionType;
  difficulty: Difficulty;
  title: string;
  description: string;
  reward: number;
  /** Bombs loaded for this mission. Missions without bombing objectives carry none. */
  bombs: number;
  /** Seconds from launch, or null for no time limit. */
  timeLimit: number | null;
  /** Ordered objectives must be done one after another; otherwise in any order. */
  ordered: boolean;
  objectives: Objective[];
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

  /** Can objective `index` be completed right now? In an ordered mission only the first unfinished one can. */
  isOpen(index: number): boolean {
    if (this.isDone(index)) return false;
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

  /** A bomb came down inside objective `index`'s zone. */
  completeBomb(index: number): boolean {
    const objective = this.objectives[index];
    if (!this.isActive || objective?.kind !== 'bomb' || !this.isOpen(index)) return false;
    this.progress[index] = 1;
    return true;
  }

  /**
   * Advances the flying objectives for one step of flight from `prev` to `pos`: time spent in a
   * recon airspace, reaching a delivery airspace, flying through the next ring. Returns the
   * indices of objectives completed by this step.
   */
  updateFlight(prev: Point3, pos: Point3, dt: number): number[] {
    const completed: number[] = [];
    if (!this.isActive) return completed;
    this.objectives.forEach((objective, i) => {
      if (!this.isOpen(i)) return;
      switch (objective.kind) {
        case 'recon':
          if (insideAirspace(objective.airspace, pos)) {
            this.progress[i] = Math.min(1, this.progress[i] + dt / objective.duration);
          }
          break;
        case 'reach':
          if (insideAirspace(objective.airspace, pos)) this.progress[i] = 1;
          break;
        case 'ring':
          if (crossesRing(objective.gate, prev, pos)) this.progress[i] = 1;
          break;
        default:
          return;
      }
      if (this.isDone(i)) completed.push(i);
    });
    return completed;
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

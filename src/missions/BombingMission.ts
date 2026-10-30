import { ECONOMY, WORLD } from '../config';

export type MissionStatus = 'available' | 'active' | 'succeeded' | 'failed';

export type MissionFailure = 'missed' | 'aircraft-lost' | 'returned';

/**
 * Mission state only: it knows nothing about the aircraft. A mission is offered while the player
 * is at home, becomes active on launch, and is resolved once by a bomb impact or by the sortie
 * ending (crash or return). `succeed` and `fail` only act on an active mission, which is what
 * guarantees the reward can be paid out exactly once per sortie.
 */
export class BombingMission {
  status: MissionStatus = 'available';
  failure: MissionFailure | null = null;

  constructor(
    readonly targetId: string = WORLD.targetId,
    readonly reward: number = ECONOMY.missionReward,
  ) {}

  get title(): string {
    return `Bomb Territory ${this.targetId}`;
  }

  get isActive(): boolean {
    return this.status === 'active';
  }

  /** available → active. */
  start(): boolean {
    if (this.status !== 'available') return false;
    this.status = 'active';
    this.failure = null;
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

  /** Offers the mission again for the next sortie. */
  reset(): void {
    this.status = 'available';
    this.failure = null;
  }
}

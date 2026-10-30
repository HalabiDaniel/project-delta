import { ECONOMY } from '../config';
import type { BombingMission, MissionFailure } from '../missions/BombingMission';
import type { ResourceManager } from './ResourceManager';

/**
 * desk    – at home on T1 with no plane folded.
 * ready   – a plane is folded and parked on the launch pad.
 * flying  – the sortie is under way.
 * crashed – the plane was lost; waiting for the player to return home.
 */
export type GamePhase = 'desk' | 'ready' | 'flying' | 'crashed';

export type CrashCause = 'void' | 'impact';

export type GameEvent =
  | { type: 'folded'; cost: number }
  | { type: 'fold-refused' }
  | { type: 'launched' }
  | { type: 'mission-succeeded'; reward: number }
  | { type: 'mission-failed'; reason: MissionFailure }
  | { type: 'crashed'; cause: CrashCause }
  | { type: 'returned' }
  | { type: 'paper-reset' };

export interface GameStats {
  planesBuilt: number;
  successes: number;
  failures: number;
}

/**
 * The game's rules, with no rendering or input. It moves between the phases above, charges for
 * planes, and pays mission rewards. Aircraft physics and mission bookkeeping live in their own
 * objects; this class only decides which transitions are allowed and what they cost.
 */
export class GameState {
  phase: GamePhase = 'desk';
  readonly stats: GameStats = { planesBuilt: 0, successes: 0, failures: 0 };
  private readonly listeners: Array<(event: GameEvent) => void> = [];

  constructor(
    readonly resources: ResourceManager,
    readonly mission: BombingMission,
    readonly planeCost: number = ECONOMY.planeCost,
  ) {}

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Planes can only be folded at home, one at a time, and only if the player can pay. */
  canFold(): boolean {
    return this.phase === 'desk' && this.resources.canAfford(this.planeCost);
  }

  foldPlane(): boolean {
    if (this.phase !== 'desk') return false;
    if (!this.resources.spend(this.planeCost)) {
      this.emit({ type: 'fold-refused' });
      return false;
    }
    this.phase = 'ready';
    this.stats.planesBuilt++;
    this.emit({ type: 'folded', cost: this.planeCost });
    return true;
  }

  /** Launching starts the mission. */
  launch(): boolean {
    if (this.phase !== 'ready') return false;
    this.phase = 'flying';
    this.mission.start();
    this.emit({ type: 'launched' });
    return true;
  }

  /** A released bomb has landed. Only a bomb from the current, still-active mission counts. */
  resolveBomb(hitTarget: boolean): void {
    if (this.phase !== 'flying' || !this.mission.isActive) return;
    if (hitTarget) {
      if (this.mission.succeed()) {
        this.resources.earn(this.mission.reward);
        this.stats.successes++;
        this.emit({ type: 'mission-succeeded', reward: this.mission.reward });
      }
    } else {
      this.failMission('missed');
    }
  }

  /** The plane is destroyed. An unresolved mission fails; a completed one keeps its reward. */
  crash(cause: CrashCause): void {
    if (this.phase !== 'flying') return;
    this.phase = 'crashed';
    this.failMission('aircraft-lost');
    this.emit({ type: 'crashed', cause });
  }

  /**
   * Ends the sortie and puts the player back at the desk on T1. Returning before the mission is
   * resolved counts as a failure. The plane is used up either way; a new one must be folded.
   */
  returnHome(): boolean {
    if (this.phase !== 'flying' && this.phase !== 'crashed') return false;
    this.failMission('returned');
    this.phase = 'desk';
    this.mission.reset();
    this.emit({ type: 'returned' });
    return true;
  }

  /** Development option: restore the starting paper. */
  resetPaper(): void {
    this.resources.reset();
    this.emit({ type: 'paper-reset' });
  }

  private failMission(reason: MissionFailure): void {
    if (this.mission.fail(reason)) {
      this.stats.failures++;
      this.emit({ type: 'mission-failed', reason });
    }
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

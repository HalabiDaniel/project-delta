import { BOMB, ECONOMY, PLANE } from '../config';
import type { Mission, MissionFailure, Objective, Point3 } from '../missions/Mission';
import { HomeIncome } from './HomeIncome';
import type { ResourceManager } from './ResourceManager';

/**
 * desk     – at home on T1, choosing a mission. A recovered plane may be waiting in the hangar.
 * building – a plane is being folded (or a recovered one refitted) on the launch pad.
 * ready    – the plane is on the pad, armed for the selected mission.
 * flying   – the sortie is under way.
 * landed   – the plane touched down safely on T1 and is recovered; the sortie is over.
 * crashed  – the plane was lost; the sortie is over.
 */
export type GamePhase = 'desk' | 'building' | 'ready' | 'flying' | 'landed' | 'crashed';

export type CrashCause = 'void' | 'impact' | 'hard-landing';

export type GameEvent =
  | { type: 'built'; cost: number; refit: boolean }
  | { type: 'build-refused'; cost: number }
  | { type: 'ready' }
  | { type: 'mission-selected'; index: number }
  | { type: 'launched' }
  | { type: 'bomb-dropped'; remaining: number }
  | { type: 'bomb-missed'; remaining: number }
  | { type: 'objective-complete'; index: number; objective: Objective }
  | { type: 'mission-succeeded'; reward: number }
  | { type: 'mission-failed'; reason: MissionFailure }
  | { type: 'crashed'; cause: CrashCause }
  | { type: 'landed' }
  | { type: 'returned' }
  | { type: 'paper-reset' };

export interface GameStats {
  planesBuilt: number;
  planesRecovered: number;
  successes: number;
  failures: number;
}

/**
 * The game's rules, with no rendering or input. It moves between the phases above, charges for
 * folding and refitting planes, tracks the bomb load, feeds flight progress to the mission and
 * pays rewards. Aircraft physics live elsewhere; this class only decides which transitions are
 * allowed and what they cost.
 */
export class GameState {
  phase: GamePhase = 'desk';
  readonly stats: GameStats = { planesBuilt: 0, planesRecovered: 0, successes: 0, failures: 0 };
  /** Mission cards on offer at home. */
  offers: Mission[];
  selected = 0;
  /** The mission flown on the current (or just finished) sortie. */
  mission: Mission | null = null;
  /** A plane that landed safely is waiting at home and only needs a refit. */
  hangarPlane = false;
  /** 0 → 1 while building. */
  buildProgress = 0;
  /** Whether the current build is a refit of a recovered plane. */
  refitting = false;
  bombsLoaded = 0;
  bombsFalling = 0;
  /** Seconds until the next bomb can be dropped. */
  bombCooldown = 0;

  private buildDuration: number = PLANE.buildTime;
  private readonly listeners: Array<(event: GameEvent) => void> = [];

  constructor(
    readonly resources: ResourceManager,
    private readonly makeOffers: () => Mission[],
    readonly income: HomeIncome = new HomeIncome(),
    readonly planeCost: number = ECONOMY.planeCost,
    readonly refitCost: number = ECONOMY.refitCost,
  ) {
    this.offers = makeOffers();
  }

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  get selectedMission(): Mission {
    return this.offers[this.selected];
  }

  /** Folding a new plane, or refitting the recovered one if there is one. */
  get buildCost(): number {
    return this.hangarPlane ? this.refitCost : this.planeCost;
  }

  canBuild(): boolean {
    return this.phase === 'desk' && this.resources.canAfford(this.buildCost);
  }

  /** Missions can be chosen any time before launch. */
  select(index: number): boolean {
    if (this.phase !== 'desk' && this.phase !== 'building' && this.phase !== 'ready') return false;
    if (index < 0 || index >= this.offers.length || index === this.selected) return false;
    this.selected = index;
    this.emit({ type: 'mission-selected', index });
    return true;
  }

  /** desk → building. Paid up front; refused (with no charge) if the player can't afford it. */
  build(): boolean {
    if (this.phase !== 'desk') return false;
    const cost = this.buildCost;
    if (!this.resources.spend(cost)) {
      this.emit({ type: 'build-refused', cost });
      return false;
    }
    this.refitting = this.hangarPlane;
    this.hangarPlane = false;
    this.phase = 'building';
    this.buildProgress = 0;
    this.buildDuration = this.refitting ? PLANE.refitTime : PLANE.buildTime;
    if (!this.refitting) this.stats.planesBuilt++;
    this.emit({ type: 'built', cost, refit: this.refitting });
    return true;
  }

  /** Advances everything that runs on a clock: income, folding, the bomb rack and the mission timer. */
  tick(dt: number): void {
    this.income.update(dt, this.resources);
    if (this.phase === 'building') {
      this.buildProgress = Math.min(1, this.buildProgress + dt / this.buildDuration);
      if (this.buildProgress >= 1) {
        this.phase = 'ready';
        this.emit({ type: 'ready' });
      }
    } else if (this.phase === 'flying') {
      this.bombCooldown = Math.max(0, this.bombCooldown - dt);
      if (this.mission?.tick(dt)) this.failMission('out-of-time');
    }
  }

  /** ready → flying. The selected mission starts and the plane is armed for it. */
  launch(): boolean {
    if (this.phase !== 'ready') return false;
    this.phase = 'flying';
    this.mission = this.selectedMission;
    this.mission.start();
    this.bombsLoaded = this.mission.spec.bombs;
    this.bombsFalling = 0;
    this.bombCooldown = 0;
    this.emit({ type: 'launched' });
    return true;
  }

  canDropBomb(): boolean {
    return this.phase === 'flying' && this.bombsLoaded > 0 && this.bombCooldown <= 0;
  }

  dropBomb(): boolean {
    if (!this.canDropBomb()) return false;
    this.bombsLoaded--;
    this.bombsFalling++;
    this.bombCooldown = BOMB.dropCooldown;
    this.emit({ type: 'bomb-dropped', remaining: this.bombsLoaded });
    return true;
  }

  /**
   * A released bomb has landed, on objective `objective`'s target or (null) anywhere else. Only a
   * bomb that lands while the mission is still active counts. Once every bomb is gone with a
   * target still standing, the mission fails.
   */
  resolveBomb(objective: number | null): void {
    this.bombsFalling = Math.max(0, this.bombsFalling - 1);
    const mission = this.mission;
    if (this.phase !== 'flying' || !mission?.isActive) return;
    if (objective !== null && mission.completeBomb(objective)) {
      this.objectiveComplete(objective);
    } else {
      this.emit({ type: 'bomb-missed', remaining: this.bombsLoaded });
    }
    if (mission.isActive && mission.hasUnfinishedBombs() && this.bombsLoaded === 0 && this.bombsFalling === 0) {
      this.failMission('missed');
    }
  }

  /** One step of flight from `prev` to `pos`: recon time, deliveries and rings. */
  updateFlight(prev: Point3, pos: Point3, dt: number): void {
    if (this.phase !== 'flying' || !this.mission) return;
    for (const index of this.mission.updateFlight(prev, pos, dt)) this.objectiveComplete(index);
  }

  /**
   * flying → landed. The plane is recovered and waits in the hangar for a cheap refit. Landing
   * ends the sortie, so an unfinished mission fails, unless landing was its last objective.
   */
  land(territoryId: string): boolean {
    if (this.phase !== 'flying') return false;
    this.phase = 'landed';
    const mission = this.mission;
    if (mission?.completeLanding(territoryId)) {
      this.objectiveComplete(mission.objectives.findIndex((o) => o.kind === 'land'));
    }
    this.failMission('abandoned');
    this.hangarPlane = true;
    this.bombsLoaded = 0;
    this.stats.planesRecovered++;
    this.emit({ type: 'landed' });
    return true;
  }

  /** The plane is destroyed. An unresolved mission fails; a completed one keeps its reward. */
  crash(cause: CrashCause): void {
    if (this.phase !== 'flying') return;
    this.phase = 'crashed';
    this.hangarPlane = false;
    this.bombsLoaded = 0;
    this.failMission('aircraft-lost');
    this.emit({ type: 'crashed', cause });
  }

  /** landed | crashed → desk, with a fresh set of mission cards. */
  continueToDesk(): boolean {
    if (this.phase !== 'landed' && this.phase !== 'crashed') return false;
    this.phase = 'desk';
    this.mission = null;
    this.bombsLoaded = 0;
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

  private objectiveComplete(index: number): void {
    const mission = this.mission!;
    this.emit({ type: 'objective-complete', index, objective: mission.objectives[index] });
    if (mission.allDone && mission.succeed()) {
      this.resources.earn(mission.reward, 'reward');
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

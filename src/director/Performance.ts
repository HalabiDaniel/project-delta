import { DIRECTOR, TIERS, type AircraftId, type Tier } from '../config';
import type { Medal, MissionFailure, MissionType } from '../missions/Mission';

/** One finished mission, as the performance rating sees it. */
export interface MissionRecord {
  type: MissionType;
  tier: Tier;
  success: boolean;
  failure: MissionFailure | null;
  /** The plane was lost on the sortie. */
  lost: boolean;
  /** The plane was brought home: the sortie ended on the ground at T1. */
  landed: boolean;
  damageDealt: number;
  /** Damage taken, as a share of the plane's health (0–1). */
  damageTaken: number;
  /** Seconds the mission ran, and its par time. */
  time: number;
  par: number;
  shotsFired: number;
  shotsHit: number;
  aircraft: AircraftId;
  reward: number;
  medal: Medal | null;
}

export type Indicator = keyof typeof DIRECTOR.weights;

export const INDICATOR_LABELS: Record<Indicator, string> = {
  success: 'Success rate',
  survival: 'Planes kept',
  damage: 'Damage avoided',
  speed: 'Completion speed',
  accuracy: 'Gun accuracy',
  landings: 'Safe landings',
  hard: 'Hard missions done',
};

export interface PerformanceBreakdown {
  /** 0–1. */
  rating: number;
  /** Each indicator 0–1, or null without the data for it (no ink fired, no success yet…). */
  indicators: Record<Indicator, number | null>;
  /** Missions the rating looked at. */
  missions: number;
}

/** How much a success at each tier says about the player's ability to do difficult missions. */
const TIER_VALUE: Record<Tier, number> = { easy: 0.25, medium: 0.5, hard: 0.8, veryhard: 1 };

/**
 * A rolling rating from the last DIRECTOR.window missions, the newest counting most: success
 * rate, planes kept, damage avoided, speed against par, gun accuracy, safe landings and whether
 * hard missions get done. It is used for recommendations, never to lock content away.
 */
export function performanceRating(records: readonly MissionRecord[]): PerformanceBreakdown {
  const recent = records.slice(-DIRECTOR.window);
  const weight = (i: number) => DIRECTOR.recency ** (recent.length - 1 - i);
  const mean = (pick: (r: MissionRecord) => number | null): number | null => {
    let sum = 0;
    let total = 0;
    recent.forEach((r, i) => {
      const v = pick(r);
      if (v === null) return;
      sum += v * weight(i);
      total += weight(i);
    });
    return total > 0 ? sum / total : null;
  };
  const indicators: Record<Indicator, number | null> = {
    success: mean((r) => (r.success ? 1 : 0)),
    survival: mean((r) => (r.lost ? 0 : 1)),
    damage: mean((r) => 1 - clamp01(r.damageTaken)),
    speed: mean((r) => (r.success && r.par > 0 && r.time > 0 ? Math.min(1, r.par / r.time) : null)),
    accuracy: mean((r) => (r.shotsFired >= 10 ? Math.min(1, r.shotsHit / r.shotsFired / 0.35) : null)),
    landings: mean((r) => (r.landed ? 1 : 0)),
    hard: mean((r) => (r.success ? TIER_VALUE[r.tier] : 0)),
  };
  let sum = 0;
  let total = 0;
  for (const key of Object.keys(indicators) as Indicator[]) {
    const v = indicators[key];
    if (v === null) continue;
    sum += v * DIRECTOR.weights[key];
    total += DIRECTOR.weights[key];
  }
  return { rating: total > 0 ? sum / total : 0, indicators, missions: recent.length };
}

/** The skill a rating points at: DIRECTOR.skill.floor maps to 0, `ceiling` to 1. */
export function skillTarget(rating: number): number {
  const { floor, ceiling } = DIRECTOR.skill;
  return clamp01((rating - floor) / (ceiling - floor));
}

/**
 * One step of skill after a mission: nothing moves until the player has settled in, then it
 * follows the rating a share at a time and never by more than DIRECTOR.skill.maxStep. One great
 * (or terrible) sortie never changes the cards much.
 */
export function nextSkill(skill: number, records: readonly MissionRecord[]): number {
  if (records.length < DIRECTOR.skill.settle) return skill;
  const target = skillTarget(performanceRating(records).rating);
  const step = Math.max(-DIRECTOR.skill.maxStep, Math.min(DIRECTOR.skill.maxStep, (target - skill) * DIRECTOR.skill.gain));
  return clamp01(skill + step);
}

/** Losing planes or failing over and over: time for missions that rebuild rather than risk. */
export function isStruggling(records: readonly MissionRecord[]): boolean {
  const s = DIRECTOR.struggle;
  const losses = records.slice(-s.lossWindow).filter((r) => r.lost).length;
  const failures = records.slice(-s.failWindow).filter((r) => !r.success).length;
  return losses >= s.losses || failures >= s.failures;
}

/** "Rookie", "Regular", "Skilled", "Ace": how the developer panel names a skill. */
export function skillBand(skill: number): string {
  return skill < 0.3 ? 'Rookie' : skill < 0.55 ? 'Regular' : skill < 0.8 ? 'Skilled' : 'Ace';
}

/** The player's record and skill, kept across sessions. */
export class PerformanceTracker {
  readonly records: MissionRecord[] = [];
  skill: number = DIRECTOR.skill.start;

  record(r: MissionRecord): void {
    this.records.push(r);
    if (this.records.length > DIRECTOR.window * 2) this.records.splice(0, this.records.length - DIRECTOR.window * 2);
    this.skill = nextSkill(this.skill, this.records);
  }

  get breakdown(): PerformanceBreakdown {
    return performanceRating(this.records);
  }

  get struggling(): boolean {
    return isStruggling(this.records);
  }

  get newcomer(): boolean {
    return this.records.length < DIRECTOR.skill.settle;
  }

  /** The tier the director thinks fits best right now: what the balanced card aims at. */
  get recommendedTier(): Tier {
    const [lo, hi] = DIRECTOR.slots.balanced;
    const index = Math.round(lo + (hi - lo) * this.skill);
    return (Object.keys(TIERS) as Tier[]).find((t) => TIERS[t].index === Math.min(3, Math.max(0, index)))!;
  }

  load(records: readonly MissionRecord[], skill: number): void {
    this.records.length = 0;
    this.records.push(...records.slice(-DIRECTOR.window * 2));
    this.skill = clamp01(skill);
  }
}

// ---- Simulated performance profiles (developer tools) ------------------------------------------

export type ProfileId = 'new' | 'struggling' | 'average' | 'successful' | 'veteran';

export interface PerformanceProfile {
  id: ProfileId;
  label: string;
  /** Paper the profile holds. */
  paper: number;
  /** Planes waiting in the hangar. */
  hangar: Array<{ id: AircraftId; condition: 'ready' | 'recovered' }>;
  /** Chance of success at each tier, and of losing the plane on a failure: what the economy simulation rolls. */
  success: Record<Tier, number>;
  lossOnFailure: number;
  /** Which card it tends to pick. */
  picks: { safe: number; balanced: number; risky: number };
  /** Its recent missions. */
  records: MissionRecord[];
  skill: number;
}

const PROFILE_SHAPES: Record<ProfileId, Omit<PerformanceProfile, 'records' | 'skill' | 'id'> & { history: number }> = {
  new: {
    label: 'New player', paper: 100, hangar: [], history: 0,
    success: { easy: 0.7, medium: 0.45, hard: 0.25, veryhard: 0.1 }, lossOnFailure: 0.6,
    picks: { safe: 0.5, balanced: 0.4, risky: 0.1 },
  },
  struggling: {
    label: 'Struggling player', paper: 12, hangar: [], history: 8,
    success: { easy: 0.55, medium: 0.3, hard: 0.15, veryhard: 0.05 }, lossOnFailure: 0.75,
    picks: { safe: 0.45, balanced: 0.4, risky: 0.15 },
  },
  average: {
    label: 'Average player', paper: 90, hangar: [{ id: 'falcon', condition: 'recovered' }], history: 10,
    success: { easy: 0.85, medium: 0.65, hard: 0.45, veryhard: 0.3 }, lossOnFailure: 0.5,
    picks: { safe: 0.25, balanced: 0.55, risky: 0.2 },
  },
  successful: {
    label: 'Successful player', paper: 160, hangar: [{ id: 'falcon', condition: 'ready' }, { id: 'swift', condition: 'recovered' }], history: 12,
    success: { easy: 0.95, medium: 0.85, hard: 0.7, veryhard: 0.55 }, lossOnFailure: 0.35,
    picks: { safe: 0.1, balanced: 0.5, risky: 0.4 },
  },
  veteran: {
    label: 'Wealthy veteran', paper: 600, hangar: [{ id: 'falcon', condition: 'ready' }, { id: 'swift', condition: 'ready' }, { id: 'widewing', condition: 'recovered' }], history: 16,
    success: { easy: 0.98, medium: 0.92, hard: 0.82, veryhard: 0.7 }, lossOnFailure: 0.25,
    picks: { safe: 0.05, balanced: 0.4, risky: 0.55 },
  },
};

export const PROFILE_IDS = Object.keys(PROFILE_SHAPES) as ProfileId[];

/**
 * A test profile with a believable recent history, so mission selection can be checked without
 * flying dozens of missions. Deterministic: the same profile always gets the same history.
 */
export function simulatedProfile(id: ProfileId): PerformanceProfile {
  const shape = PROFILE_SHAPES[id];
  const records: MissionRecord[] = [];
  const tracker = new PerformanceTracker();
  for (let i = 0; i < shape.history; i++) {
    // A fixed pattern rather than dice: tiers cycle by what the profile likes to pick.
    const slot = ((i * 7) % 10) / 10;
    const strong = id === 'successful' || id === 'veteran';
    const tier: Tier = slot < shape.picks.safe ? 'easy' : slot < shape.picks.safe + shape.picks.balanced ? (strong ? 'hard' : 'medium') : strong ? 'veryhard' : 'hard';
    const p = shape.success[tier];
    const success = ((i * 37) % 100) / 100 < p;
    const lost = !success && ((i * 53) % 100) / 100 < shape.lossOnFailure;
    const r: MissionRecord = {
      type: (['bombing', 'recon', 'dogfight', 'suppression', 'escort'] as MissionType[])[i % 5],
      tier,
      success,
      failure: success ? null : lost ? 'aircraft-lost' : 'missed',
      lost,
      landed: !lost && (success || i % 2 === 0),
      damageDealt: success ? 80 : 30,
      damageTaken: lost ? 1 : success ? 0.6 - p * 0.5 : 0.7,
      time: success ? 60 / (0.4 + p) : 90,
      par: 55,
      shotsFired: 60,
      shotsHit: Math.round(60 * (0.08 + p * 0.3)),
      aircraft: (['falcon', 'dart', 'widewing', 'swift'] as AircraftId[])[i % 4],
      reward: success ? 60 : 0,
      medal: success ? (p > 0.8 ? 'gold' : p > 0.6 ? 'silver' : 'bronze') : null,
    };
    records.push(r);
    tracker.record(r);
  }
  // A long history settles skill where the rating points.
  let skill = tracker.skill;
  for (let k = 0; k < 20 && records.length >= DIRECTOR.skill.settle; k++) skill = nextSkill(skill, records);
  return { ...shape, id, records, skill };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

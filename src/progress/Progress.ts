import { AIRCRAFT_ORDER, PROGRESS, type AircraftId } from '../config';
import { categoryOf, type Category } from '../director/Templates';
import type { Medal, Mission } from '../missions/Mission';
import type { SortieLog } from '../systems/GameState';

export const MEDAL_LABELS: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const MEDAL_RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

/** What each medal asks for, by kind of mission, for the report and the logbook. */
export function medalCriteria(mission: Mission): Record<Medal, string> {
  const efficiency = efficiencyRule(mission);
  return {
    bronze: 'Complete the main objective',
    silver: `Take at most ${Math.round(PROGRESS.silverDamage * 100)}% damage, and ${efficiency.label}`,
    gold: `Silver, within par time (${mission.spec.par ?? '—'} s), and bring the plane home`,
  };
}

/** How a completed mission went, for its medal. */
export interface RatingInput {
  mission: Mission;
  sortie: Pick<SortieLog, 'bombsDropped' | 'shotsFired' | 'shotsHit' | 'damageTaken'>;
  maxHealth: number;
  /** The plane came home (the sortie ended on the ground at T1). */
  recovered: boolean;
}

/**
 * Bronze for completing the main objective; silver for doing it efficiently with limited damage;
 * gold for silver within par time with the plane brought home. Efficiency depends on the mission:
 * few bombs wasted on a bombing run, decent accuracy in a gunfight, a timely flight otherwise.
 */
export function rateMission(r: RatingInput): Medal | null {
  if (r.mission.status !== 'succeeded') return null;
  const lightDamage = r.sortie.damageTaken <= r.maxHealth * PROGRESS.silverDamage;
  if (!lightDamage || !efficiencyRule(r.mission).met(r)) return 'bronze';
  const par = r.mission.spec.par ?? Infinity;
  return r.mission.elapsed <= par && r.recovered ? 'gold' : 'silver';
}

function efficiencyRule(mission: Mission): { label: string; met: (r: RatingInput) => boolean } {
  const bombs = mission.objectives.filter((o) => o.kind === 'bomb').length;
  if (bombs > 0) return { label: `drop no more than ${bombs + 1} bombs`, met: (r) => r.sortie.bombsDropped <= bombs + 1 };
  const gunfight = mission.objectives.some((o) => o.kind === 'intercept' || o.kind === 'escort' || (o.kind === 'destroy' && o.what === 'practice'));
  if (gunfight) {
    return {
      label: `hit with at least ${Math.round(PROGRESS.silverAccuracy * 100)}% of your ink`,
      met: (r) => r.sortie.shotsFired === 0 || r.sortie.shotsHit / r.sortie.shotsFired >= PROGRESS.silverAccuracy,
    };
  }
  const par = mission.spec.par ?? Infinity;
  return { label: 'finish within 1.5× par time', met: () => mission.elapsed <= par * 1.5 };
}

// ---- Records, streaks, mastery, achievements -------------------------------------------------

export interface PersonalBests {
  fastestBombing: { time: number; title: string } | null;
  bestBombAccuracy: { accuracy: number; bombs: number; title: string } | null;
  longestFlight: { distance: number; aircraft: AircraftId } | null;
  mostKills: { count: number; title: string } | null;
  /** Most missions in a row completed without losing a plane. */
  cleanRun: number;
}

export const BEST_LABELS: Record<keyof PersonalBests, string> = {
  fastestBombing: 'Fastest bombing run',
  bestBombAccuracy: 'Most accurate bombing mission',
  longestFlight: 'Longest successful flight',
  mostKills: 'Most aircraft downed in one sortie',
  cleanRun: 'Most missions in a row without losing a plane',
};

/** One design's record: statistics only, nothing unlocks. */
export interface Mastery {
  flights: number;
  missions: number;
  lost: number;
  bombsDropped: number;
  bombHits: number;
  shotsFired: number;
  shotsHit: number;
  kills: number;
  distance: number;
  /** Missions completed, by category. */
  byCategory: Partial<Record<Category, number>>;
}

export const emptyMastery = (): Mastery => ({ flights: 0, missions: 0, lost: 0, bombsDropped: 0, bombHits: 0, shotsFired: 0, shotsHit: 0, kills: 0, distance: 0, byCategory: {} });

export interface Achievement {
  id: string;
  title: string;
  detail: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-bombing', title: 'Bombs away', detail: 'Complete your first bombing mission' },
  { id: 'first-kill', title: 'First blood (ink)', detail: 'Shoot down an enemy aircraft' },
  { id: 'five-landings', title: 'Smooth operator', detail: 'Land safely on T1 five times' },
  { id: 'three-turrets', title: 'Turret buster', detail: 'Destroy three ink turrets in one sortie' },
  { id: 'flawless', title: 'Not a crease', detail: 'Complete a mission without taking damage' },
  { id: 'gold', title: 'Gold star', detail: 'Earn a gold rating' },
  { id: 'very-hard', title: 'Glutton for punishment', detail: 'Complete a very hard mission' },
  { id: 'operation', title: 'Operation complete', detail: 'Finish every stage of an operation' },
  { id: 'streak-5', title: 'On a roll', detail: 'Complete five missions in a row' },
  { id: 'defender', title: 'Home guard', detail: 'Beat off a raid or see a friendly bomber home' },
  { id: 'world-event', title: 'Opportunist', detail: 'Win a world event: a shipment, a convoy or a supply run' },
  { id: 'all-planes', title: 'Hangar regular', detail: 'Complete a mission in every design' },
  { id: 'emergency', title: 'Scrap paper hero', detail: 'Complete a mission in the free emergency plane' },
  { id: 'ace', title: 'Paper ace', detail: 'Shoot down five enemy aircraft' },
];

/** This visit, for the session summary. */
export interface SessionSummary {
  startedAt: number;
  /** Seconds of play (the game running, not paused). */
  seconds: number;
  sorties: number;
  missionsCompleted: number;
  missionsFailed: number;
  paperEarned: number;
  paperSpent: number;
  aircraftLost: number;
  /** Enemy aircraft shot down and defenses destroyed. */
  enemiesDestroyed: number;
  bestMedal: Medal | null;
  bestReward: { amount: number; title: string } | null;
  bestStreak: number;
  achievements: string[];
}

export const emptySession = (startedAt: number): SessionSummary => ({
  startedAt, seconds: 0, sorties: 0, missionsCompleted: 0, missionsFailed: 0, paperEarned: 0, paperSpent: 0, aircraftLost: 0, enemiesDestroyed: 0,
  bestMedal: null, bestReward: null, bestStreak: 0, achievements: [],
});

export interface ProgressData {
  bests: PersonalBests;
  streak: { current: number; best: number };
  /** Missions completed in a row without losing a plane. */
  clean: number;
  mastery: Partial<Record<AircraftId, Mastery>>;
  /** Achievement id → when it was unlocked (ms since the epoch). */
  achievements: Record<string, number>;
  landings: number;
  medals: Record<Medal, number>;
  /** Designs with a mission completed in them. */
  completedIn: AircraftId[];
}

export const emptyProgress = (): ProgressData => ({
  bests: { fastestBombing: null, bestBombAccuracy: null, longestFlight: null, mostKills: null, cleanRun: 0 },
  streak: { current: 0, best: 0 },
  clean: 0,
  mastery: {},
  achievements: {},
  landings: 0,
  medals: { bronze: 0, silver: 0, gold: 0 },
  completedIn: [],
});

/** Everything a finished sortie tells progress. */
export interface SortieInput {
  mission: Mission | null;
  sortie: SortieLog;
  aircraft: AircraftId;
  maxHealth: number;
  recovered: boolean;
  /** An operation was completed by this sortie. */
  operationCompleted: boolean;
}

/** What a sortie changed, for the report. */
export interface SortieProgress {
  medal: Medal | null;
  /** Personal bests broken ("Fastest bombing run: 0:42"). */
  records: string[];
  achievements: Achievement[];
  streak: number;
  /** Paper the streak adds on top of the reward. */
  streakBonus: number;
}

/**
 * Ratings, personal bests, streaks, per-aircraft mastery and achievements, kept in the save, plus
 * the summary of this visit. A streak adds a modest bonus (never so much that one failure
 * hurts), and mastery is statistics only: nothing unlocks better equipment.
 */
export class Progress {
  data: ProgressData = emptyProgress();
  session: SessionSummary;

  constructor(private readonly now: () => number = Date.now) {
    this.session = emptySession(now());
  }

  /** The streak bonus rate for a streak this long. */
  static streakRate(streak: number): number {
    for (const [from, rate] of PROGRESS.streak) if (streak >= from) return rate;
    return 0;
  }

  /** A sortie is over: rate it, update everything, and say what changed. */
  sortieEnded(input: SortieInput): SortieProgress {
    const { mission, sortie, aircraft } = input;
    const d = this.data;
    const m = (d.mastery[aircraft] ??= emptyMastery());
    m.flights++;
    m.bombsDropped += sortie.bombsDropped;
    m.bombHits += sortie.bombHits;
    m.shotsFired += sortie.shotsFired;
    m.shotsHit += sortie.shotsHit;
    m.kills += sortie.aircraftDestroyed;
    m.distance += sortie.distanceFlown;
    if (!input.recovered) m.lost++;
    d.landings += sortie.landings;
    this.session.sorties++;
    if (!input.recovered) this.session.aircraftLost++;
    this.session.enemiesDestroyed += sortie.aircraftDestroyed + sortie.defensesDestroyed;

    const records: string[] = [];
    const unlocked: Achievement[] = [];
    const success = mission?.status === 'succeeded';
    let medal: Medal | null = null;
    let streakBonus = 0;

    if (mission) {
      medal = rateMission({ mission, sortie, maxHealth: input.maxHealth, recovered: input.recovered });
      if (success) {
        d.streak.current++;
        d.streak.best = Math.max(d.streak.best, d.streak.current);
        streakBonus = Math.round(mission.reward * Progress.streakRate(d.streak.current));
        m.missions++;
        const cat = categoryOf(mission.spec.type);
        m.byCategory[cat] = (m.byCategory[cat] ?? 0) + 1;
        if (!d.completedIn.includes(aircraft)) d.completedIn.push(aircraft);
        this.session.missionsCompleted++;
        this.session.bestStreak = Math.max(this.session.bestStreak, d.streak.current);
        if (!this.session.bestReward || mission.reward > this.session.bestReward.amount) this.session.bestReward = { amount: mission.reward, title: mission.title };
      } else {
        d.streak.current = 0;
        this.session.missionsFailed++;
      }
      if (medal) {
        d.medals[medal]++;
        if (!this.session.bestMedal || MEDAL_RANK[medal] > MEDAL_RANK[this.session.bestMedal]) this.session.bestMedal = medal;
      }
    }
    // A lost plane ends the clean run, success or not.
    if (!input.recovered) d.clean = 0;
    else if (success) d.clean++;
    if (d.clean > d.bests.cleanRun) {
      d.bests.cleanRun = d.clean;
      if (d.clean >= 2) records.push(`${BEST_LABELS.cleanRun}: ${d.clean}`);
    }

    if (mission && success) {
      const time = mission.elapsed;
      const bombing = categoryOf(mission.spec.type) === 'bombing';
      if (bombing && (!d.bests.fastestBombing || time < d.bests.fastestBombing.time)) {
        d.bests.fastestBombing = { time, title: mission.title };
        records.push(`${BEST_LABELS.fastestBombing}: ${clock(time)}`);
      }
      if (sortie.bombsDropped >= PROGRESS.accuracyMinBombs) {
        const accuracy = sortie.bombHits / sortie.bombsDropped;
        const b = d.bests.bestBombAccuracy;
        if (!b || accuracy > b.accuracy || (accuracy === b.accuracy && sortie.bombsDropped > b.bombs)) {
          d.bests.bestBombAccuracy = { accuracy, bombs: sortie.bombsDropped, title: mission.title };
          records.push(`${BEST_LABELS.bestBombAccuracy}: ${Math.round(accuracy * 100)}% of ${sortie.bombsDropped}`);
        }
      }
      if (input.recovered && (!d.bests.longestFlight || sortie.distanceFlown > d.bests.longestFlight.distance)) {
        d.bests.longestFlight = { distance: sortie.distanceFlown, aircraft };
        records.push(`${BEST_LABELS.longestFlight}: ${(sortie.distanceFlown / 1000).toFixed(2)} km`);
      }
    }
    if (sortie.aircraftDestroyed > 0 && (!d.bests.mostKills || sortie.aircraftDestroyed > d.bests.mostKills.count)) {
      d.bests.mostKills = { count: sortie.aircraftDestroyed, title: mission?.title ?? 'Free flight' };
      records.push(`${BEST_LABELS.mostKills}: ${sortie.aircraftDestroyed}`);
    }

    const unlock = (id: string, when: boolean) => {
      if (!when || d.achievements[id] !== undefined) return;
      d.achievements[id] = this.now();
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      unlocked.push(a);
      this.session.achievements.push(a.title);
    };
    const kills = Object.values(d.mastery).reduce((s, x) => s + (x?.kills ?? 0), 0);
    unlock('first-bombing', success && !!mission && categoryOf(mission.spec.type) === 'bombing');
    unlock('first-kill', kills > 0);
    unlock('five-landings', d.landings >= 5);
    unlock('three-turrets', sortie.turretsDestroyed >= 3);
    unlock('flawless', success && sortie.damageTaken === 0);
    unlock('gold', medal === 'gold');
    unlock('very-hard', success && mission?.tier === 'veryhard');
    unlock('operation', input.operationCompleted);
    unlock('streak-5', d.streak.current >= 5);
    unlock('defender', sortie.objectivesProtected > 0);
    unlock('world-event', success && !!mission && ['shipment', 'convoy', 'supply-run'].includes(mission.spec.type));
    unlock('all-planes', AIRCRAFT_ORDER.every((id) => d.completedIn.includes(id)));
    unlock('emergency', success && sortie.emergency);
    unlock('ace', kills >= 5);
    return { medal, records, achievements: unlocked, streak: d.streak.current, streakBonus };
  }

  /** Something outside a sortie's own record counts (a world event won off its card, an operation finished at the desk). */
  unlockNow(id: string): Achievement | null {
    if (this.data.achievements[id] !== undefined) return null;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return null;
    this.data.achievements[id] = this.now();
    this.session.achievements.push(a.title);
    return a;
  }

  /** Paper in or out, for the session summary. */
  paper(delta: number, spent: boolean): void {
    if (delta > 0) this.session.paperEarned += delta;
    else if (spent) this.session.paperSpent -= delta;
  }
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

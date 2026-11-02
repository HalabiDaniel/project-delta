import { assessSuitability, type SuitabilityLevel } from '../aircraft/Aircraft';
import { AIRCRAFT, AIRCRAFT_ORDER, BASE, ECONOMY, TIER_ORDER, type AircraftId, type AircraftSpec, type Tier } from '../config';
import type { MissionContext } from '../missions/MissionGenerator';
import { Progress } from '../progress/Progress';
import { emergencyPlane } from '../systems/GameState';
import { HomeIncome } from '../systems/HomeIncome';
import { Ledger } from '../systems/Ledger';
import { ResourceManager } from '../systems/ResourceManager';
import { seededRng } from '../systems/Random';
import { MissionDirector, type Situation } from './MissionDirector';
import { simulatedProfile, type ProfileId } from './Performance';

/** fly – fly missions and try to finish them. abandon – launch and give up at once, every time (an exploit check). */
export type Strategy = 'fly' | 'abandon';

export interface SimulationOptions {
  profile: ProfileId;
  missions: number;
  seed: number;
  ctx: MissionContext;
  strategy?: Strategy;
  /** Seconds at the desk between sorties (home production runs). */
  deskTime?: number;
}

export interface SimulationResult {
  profile: ProfileId;
  strategy: Strategy;
  missions: number;
  successes: number;
  planesLost: number;
  /** Sorties flown in the free emergency plane. */
  emergencies: number;
  paperStart: number;
  paperEnd: number;
  paperMin: number;
  paperMax: number;
  /** Paper after each sortie. */
  trajectory: number[];
  earned: number;
  spent: number;
  income: number;
  /** Mission rewards and bonuses only. */
  rewards: number;
  /** Most sorties in a row the player couldn't afford a Falcon. */
  longestBroke: number;
  /** A card the player could actually fly was always on offer. */
  alwaysFlyable: boolean;
  byTier: Record<Tier, { flown: number; successes: number; earned: number }>;
  ledger: Ledger;
  skillEnd: number;
}

const SUIT_BONUS: Record<SuitabilityLevel, number> = { recommended: 0.06, good: 0, possible: -0.15, unsuitable: -1 };

/**
 * Plays a profile through `missions` sorties with the real director, generator, economy and
 * performance rating: it picks cards the way the profile likes to, folds the best affordable plane
 * for the job (or refits one from the hangar, or takes the emergency plane), rolls success by
 * the profile's odds at that tier, and loses the plane by its odds on a failure. It shows whether
 * paper grows too fast, or whether players get stuck, without flying dozens of missions by hand.
 */
export function simulateEconomy(opts: SimulationOptions): SimulationResult {
  const profile = simulatedProfile(opts.profile);
  const strategy = opts.strategy ?? 'fly';
  const rng = seededRng(opts.seed);
  const resources = new ResourceManager(profile.paper);
  const income = new HomeIncome();
  const ledger = new Ledger(10_000, () => 0);
  ledger.watch(resources);
  const hangar = new Map<AircraftId, 'ready' | 'recovered'>(profile.hangar.map((h) => [h.id, h.condition]));
  const costFor = (id: AircraftId) => {
    const h = hangar.get(id);
    return h === 'ready' ? 0 : h === 'recovered' ? AIRCRAFT[id].refitCost : AIRCRAFT[id].cost;
  };
  const situation = (): Situation => ({
    paper: resources.paper,
    costs: Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, costFor(id)])) as Record<AircraftId, number>,
    airRoom: 4,
    raidActive: false,
  });
  const director = new MissionDirector(() => opts.ctx, situation, rng, () => 0);
  director.performance.load(profile.records, profile.skill);
  director.completedMissions = profile.records.filter((r) => r.success).length;
  director.deal();
  const progress = new Progress(() => 0);
  const byTier = Object.fromEntries(TIER_ORDER.map((t) => [t, { flown: 0, successes: 0, earned: 0 }])) as SimulationResult['byTier'];
  const result: SimulationResult = {
    profile: opts.profile, strategy, missions: 0, successes: 0, planesLost: 0, emergencies: 0,
    paperStart: profile.paper, paperEnd: profile.paper, paperMin: profile.paper, paperMax: profile.paper, trajectory: [],
    earned: 0, spent: 0, income: 0, rewards: 0, longestBroke: 0, alwaysFlyable: true, byTier, ledger, skillEnd: 0,
  };
  let brokeRun = 0;

  for (let n = 0; n < opts.missions; n++) {
    // Time at the desk: home production trickles in.
    for (let t = 0; t < (opts.deskTime ?? 25); t++) income.update(1, resources);
    // Pick a card the way this profile likes to, among those it can fly.
    const roll = rng();
    const order = roll < profile.picks.safe ? [0, 1, 2] : roll < profile.picks.safe + profile.picks.balanced ? [1, 0, 2] : [2, 1, 0];
    let choice: { index: number; plane: AircraftSpec; cost: number; level: SuitabilityLevel; emergency: boolean } | null = null;
    for (const index of order) {
      const mission = director.missions[index];
      const plane = bestPlane(mission.spec, resources.paper, costFor);
      if (plane) {
        choice = { index, ...plane };
        break;
      }
    }
    if (!choice) {
      result.alwaysFlyable = false;
      break;
    }
    const mission = director.missions[choice.index];
    const tier = mission.tier;
    if (choice.emergency) result.emergencies++;
    else if (choice.cost > 0) resources.spend(choice.cost, `${hangar.has(choice.plane.id) ? 'Refitted' : 'Folded'} ${choice.plane.name}`);
    if (!choice.emergency) hangar.delete(choice.plane.id);
    director.accepted(mission);
    mission.start();

    const odds = strategy === 'abandon' ? 0 : Math.max(0, Math.min(0.99, profile.success[tier] + SUIT_BONUS[choice.level]));
    const success = rng() < odds;
    const lost = success ? rng() < 0.08 : strategy === 'abandon' ? false : rng() < profile.lossOnFailure;
    const time = strategy === 'abandon' ? 5 : (mission.spec.par ?? 60) * (0.8 + rng() * 0.8);
    for (let t = 0; t < time; t += 1) income.update(1, resources);
    mission.elapsed = time;
    if (success) {
      mission.objectives.forEach((_, i) => (mission.progress[i] = 1));
      mission.succeed();
      resources.earn(mission.reward, 'reward', `Mission completed: ${mission.title}`);
      result.rewards += mission.reward;
    } else {
      mission.fail(strategy === 'abandon' ? 'abandoned' : lost ? 'aircraft-lost' : 'missed');
    }
    const sortie = {
      aircraft: choice.plane.id, kind: 'fold' as const, paperSpent: choice.cost, paperEarned: success ? mission.reward : 0,
      damageDealt: success ? 60 : 20, damageTaken: lost ? choice.plane.maxHealth : choice.plane.maxHealth * (success ? 0.25 : 0.5),
      bombsDropped: mission.spec.bombs > 0 ? 2 : 0, bombHits: success && mission.spec.bombs > 0 ? 1 : 0, shotsFired: 40, shotsHit: success ? 10 : 4,
      targetsDestroyed: 0, defensesDestroyed: 0, turretsDestroyed: 0, enemyShots: 0, enemyHits: 0, killedBy: null, aircraftDestroyed: 0,
      bombersIntercepted: 0, objectivesProtected: 0, paperLost: 0, paperOverflow: 0, rearms: 0, distanceFlown: 500, landings: lost ? 0 : 1,
      emergency: choice.emergency, outcome: lost ? ('lost' as const) : ('recovered' as const),
    };
    const p = progress.sortieEnded({ mission, sortie, aircraft: choice.plane.id, maxHealth: choice.plane.maxHealth, recovered: !lost, operationCompleted: false });
    if (p.streakBonus > 0) {
      resources.earn(p.streakBonus, 'bonus', 'Streak bonus');
      result.rewards += p.streakBonus;
    }
    director.afterSortie(
      mission,
      {
        type: mission.spec.type, tier, success, failure: mission.failure, lost, landed: !lost, damageDealt: sortie.damageDealt,
        damageTaken: sortie.damageTaken / choice.plane.maxHealth, time, par: mission.spec.par ?? 60, shotsFired: 40, shotsHit: sortie.shotsHit,
        aircraft: choice.plane.id, reward: success ? mission.reward : 0, medal: p.medal,
      },
      { success, recovered: !lost, damageTaken: sortie.damageTaken / choice.plane.maxHealth, time, par: mission.spec.par ?? 60, reward: success ? mission.reward : 0 },
    );
    for (const payout of director.takePayouts()) {
      resources.earn(payout.amount, 'bonus', payout.label);
      result.rewards += payout.amount;
    }
    if (!lost && !choice.emergency) hangar.set(choice.plane.id, 'recovered');
    ledger.recordSortie({ aircraft: choice.plane.id, type: mission.spec.type, spent: choice.cost, earned: success ? mission.reward : 0, success, lost });

    result.missions++;
    if (success) result.successes++;
    if (lost) result.planesLost++;
    byTier[tier].flown++;
    if (success) {
      byTier[tier].successes++;
      byTier[tier].earned += mission.reward;
    }
    result.trajectory.push(resources.paper);
    result.paperMin = Math.min(result.paperMin, resources.paper);
    result.paperMax = Math.max(result.paperMax, resources.paper);
    brokeRun = resources.paper < AIRCRAFT.falcon.cost && costFor('falcon') > resources.paper ? brokeRun + 1 : 0;
    result.longestBroke = Math.max(result.longestBroke, brokeRun);
  }
  result.paperEnd = resources.paper;
  result.earned = ledger.totals.earned;
  result.spent = ledger.totals.spent;
  result.income = ledger.totals.income;
  result.skillEnd = director.performance.skill;
  return result;
}

/**
 * The plane a player would take: the best suited affordable one (a stowed or recovered plane
 * counts at its roll-out or refit price), cheaper on a tie; the emergency plane if nothing is
 * affordable and it can fly the mission.
 */
function bestPlane(spec: Parameters<typeof assessSuitability>[1], paper: number, costFor: (id: AircraftId) => number) {
  const rank: Record<SuitabilityLevel, number> = { recommended: 3, good: 2, possible: 1, unsuitable: 0 };
  let best: { plane: AircraftSpec; cost: number; level: SuitabilityLevel; emergency: boolean } | null = null;
  for (const id of AIRCRAFT_ORDER) {
    const cost = costFor(id);
    if (cost > paper) continue;
    const level = assessSuitability(AIRCRAFT[id], spec).level;
    if (level === 'unsuitable') continue;
    if (!best || rank[level] > rank[best.level] || (rank[level] === rank[best.level] && cost < best.cost)) best = { plane: AIRCRAFT[id], cost, level, emergency: false };
  }
  if (best) return best;
  const nothing = AIRCRAFT_ORDER.every((id) => costFor(id) > paper);
  const plane = emergencyPlane();
  const level = assessSuitability(plane, spec).level;
  return nothing && level !== 'unsuitable' ? { plane, cost: 0, level, emergency: true } : null;
}

/** Runs every profile, for the developer panel. */
export function simulateAll(ctx: MissionContext, missions = 30, seed = 1): SimulationResult[] {
  return (['new', 'struggling', 'average', 'successful', 'veteran'] as ProfileId[]).map((profile) => simulateEconomy({ profile, missions, seed, ctx }));
}

export const SIMULATION_NOTE = `Starting paper ${ECONOMY.startingPaper}; home production ${BASE.production} paper/min; no storage limit in the simulation.`;

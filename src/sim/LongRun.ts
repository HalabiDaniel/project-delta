import { assessSuitability, bombLoad, type SuitabilityLevel } from '../aircraft/Aircraft';
import { STORE, Base } from '../base/Base';
import { raidLosses } from '../base/Raids';
import { AIRCRAFT, AIRCRAFT_ORDER, BASE, MERIT, PVP, TIERS, type AircraftId, type AircraftSpec, type BuildingKind, type Tier } from '../config';
import { MissionDirector, type Situation } from '../director/MissionDirector';
import { simulatedProfile, type ProfileId } from '../director/Performance';
import { DefenseNetwork } from '../defenses/Installation';
import type { MissionContext } from '../missions/MissionGenerator';
import { indexFor } from '../ranks/Ranks';
import { applyBaseEconomy, armingFor, materialsOf, newIncomes, type Incomes } from '../systems/Economy';
import { emergencyPlane } from '../systems/GameState';
import { seededRng, type Rng } from '../systems/Random';
import { RESOURCES, ResourceManager, type Bundle, type PaperSource, type Resource } from '../systems/ResourceManager';
import type { Territory } from '../world/Territory';

/**
 * v0.0.18 §7: the long-run economy simulator. Several simulated players with different habits play
 * sessions over days of game time with the real rule classes: the base (production, storage, upkeep,
 * protected reserves), the incomes, the director and generator, arming, materials, raid losses and
 * the raid reward and repeat rules. It measures balance rather than guessing it: balances over time,
 * the gap between leader and last, recovery after a raid, flows by source and sink, and flags for
 * runaway leaders, dead ends and strategies that beat normal play.
 *
 * Flight is not simulated: a sortie succeeds by the profile's odds at the card's tier, as in
 * director/Simulation.ts (the single-player check this one grew from).
 */

/**
 * newcomer   – short sessions, safe cards, middling odds.
 * steady     – an hour a day, balanced cards, builds its base up.
 * aggressive – raids other players whenever the rules allow, hard cards.
 * idle       – logs in for a few minutes a day.
 * exploiter  – abandons every mission and trades raids with a second account (an exploit check).
 */
export type LongRunProfile = 'newcomer' | 'steady' | 'aggressive' | 'idle' | 'exploiter';
export const LONG_RUN_PROFILES: readonly LongRunProfile[] = ['newcomer', 'steady', 'aggressive', 'idle', 'exploiter'];

interface Habits {
  /** Minutes online per day. */
  minutes: number;
  /** The director's performance profile behind its odds and its card picks. */
  base: ProfileId;
  /** Chance per sortie of raiding another player instead of flying a card. */
  raids: number;
  /** Builds and upgrades when paper allows. */
  builds: boolean;
  abandons: boolean;
}

const HABITS: Record<LongRunProfile, Habits> = {
  newcomer: { minutes: 30, base: 'new', raids: 0, builds: true, abandons: false },
  steady: { minutes: 60, base: 'average', raids: 0.1, builds: true, abandons: false },
  aggressive: { minutes: 60, base: 'successful', raids: 0.5, builds: true, abandons: false },
  idle: { minutes: 8, base: 'struggling', raids: 0, builds: false, abandons: false },
  exploiter: { minutes: 60, base: 'average', raids: 0.6, builds: false, abandons: true },
};

const SUIT: Record<SuitabilityLevel, number> = { recommended: 0.06, good: 0, possible: -0.15, unsuitable: -1 };

/** The order a building player puts things up: an ink well and a box first, then more production. */
const BUILD_PLAN: ReadonlyArray<{ slot: string; kind: BuildingKind }> = [
  { slot: 'E1', kind: 'inkwell' },
  { slot: 'E2', kind: 'storage' },
  { slot: 'U1', kind: 'workshop' },
  { slot: 'R1', kind: 'radar' },
  { slot: 'D2', kind: 'launcher' },
  { slot: 'U2', kind: 'storage' },
];

export interface LongRunOptions {
  /** One entry per simulated player. Two exploiters trade raids with each other. */
  players: readonly LongRunProfile[];
  days: number;
  seed: number;
  ctx: MissionContext;
  /** Territories to put the players' bases on (one each). */
  homes: readonly Territory[];
}

/** One player at the end of a day. */
export interface DaySnapshot {
  day: number;
  paper: number;
  ink: number;
  rubber: number;
  /** Paper plus ink and rubber balls at their paper value (WORTH): one number to compare players by. */
  worth: number;
  merit: number;
  rankIndex: number;
}

export interface PlayerReport {
  id: string;
  profile: LongRunProfile;
  days: DaySnapshot[];
  sorties: number;
  successes: number;
  raidsMade: number;
  raidsSuffered: number;
  /** Seconds online it took to win back what each raid on them cost (null: never did). */
  recoveries: Array<number | null>;
  /** The most sorties in a row with no card they could fly (a dead end). */
  longestStuck: number;
  /** Resource flows by source: what came in and went out of each resource. */
  flows: Record<Resource, Partial<Record<PaperSource | 'production', { in: number; out: number }>>>;
  /** What they gained per hour online (worth, from their starting worth). */
  gainPerHour: number;
  /** Merit per hour online: checks the rank curve (MERIT.curve) against real Merit rates. */
  meritPerHour: number;
  /** Sorties and successes by design (the roster balance check, plan §6). */
  planes: Partial<Record<string, { flown: number; wins: number }>>;
}

export interface LongRunReport {
  options: { players: readonly LongRunProfile[]; days: number; seed: number };
  players: PlayerReport[];
  /** Usage and win rate by design, over every player. */
  planes: Partial<Record<string, { flown: number; wins: number; share: number; winRate: number }>>;
  /** Leader's worth ÷ the median worth of the players who play (not idle), at the end. */
  leaderGap: number;
  flags: { runawayLeader: boolean; deadEnd: boolean; exploitBeatsPlay: boolean; notes: string[] };
}

/** Paper value of a unit of each resource, for comparing players (provisional, like the economy). */
export const WORTH: Record<Resource, number> = { paper: 1, ink: 0.5, rubber: 2 };
/** Leader more than this many times the median: a runaway. */
export const RUNAWAY = 4;
/** This many sorties in a row with no flyable card: a dead end. */
export const STUCK = 5;

interface Sim {
  id: string;
  profile: LongRunProfile;
  habits: Habits;
  resources: ResourceManager;
  base: Base;
  incomes: Incomes;
  director: MissionDirector;
  hangar: Map<AircraftId, 'ready' | 'recovered'>;
  rng: Rng;
  merit: number;
  online: number;
  report: PlayerReport;
  stuck: number;
  shieldUntil: number;
  startWorth: number;
  /** Raids being recovered from: the worth before, and when (online seconds). */
  pending: Array<{ worth: number; at: number; index: number }>;
}

const worthOf = (r: ResourceManager) => RESOURCES.reduce((t, k) => t + r.amount(k) * WORTH[k], 0);

export function simulateLongRun(opts: LongRunOptions): LongRunReport {
  const rng = seededRng(opts.seed);
  const sims: Sim[] = opts.players.map((profile, i) => makeSim(`${profile}-${i + 1}`, profile, opts.homes[i % opts.homes.length], opts.ctx, seededRng(opts.seed * 131 + i * 17)));
  const raidHistory: Array<{ attacker: string; victim: string; at: number }> = [];
  let clock = 0;

  for (let day = 1; day <= opts.days; day++) {
    // Each player's session for the day, interleaved minute by minute so raids find others online.
    const left = new Map(sims.map((s) => [s.id, s.habits.minutes * 60]));
    let nextSortie = new Map(sims.map((s) => [s.id, 25 + rng() * 20]));
    // Each session's arrival grace (PVP.arrivalGrace): nobody raids a base just placed.
    for (const s of sims) s.shieldUntil = Math.max(s.shieldUntil, clock + PVP.arrivalGrace);
    for (let t = 0; left.size > 0 && t < 24 * 3600; t += 1) {
      clock += 1;
      for (const s of sims) {
        const remaining = left.get(s.id);
        if (remaining === undefined) continue;
        if (remaining <= 0) {
          left.delete(s.id);
          continue;
        }
        left.set(s.id, remaining - 1);
        s.online += 1;
        applyBaseEconomy(s.base, s.resources, s.incomes, true);
        for (const r of RESOURCES) s.incomes[r].update(1, s.resources);
        settleRecoveries(s);
        const due = (nextSortie.get(s.id) ?? 0) - 1;
        if (due > 0) {
          nextSortie.set(s.id, due);
          continue;
        }
        const others = sims.filter((o) => o !== s && left.has(o.id));
        const took = sortie(s, others, raidHistory, clock);
        nextSortie.set(s.id, took);
        if (s.habits.builds) build(s);
      }
    }
    nextSortie = new Map();
    for (const s of sims) {
      s.report.days.push({ day, paper: s.resources.paper, ink: s.resources.ink, rubber: s.resources.rubber, worth: Math.round(worthOf(s.resources)), merit: s.merit, rankIndex: indexFor(s.merit) });
    }
  }

  const players = sims.map((s) => {
    const last = s.report.days[s.report.days.length - 1]?.worth ?? 0;
    const hours = s.online / 3600;
    s.report.gainPerHour = hours > 0 ? Math.round(((last - s.startWorth) / hours) * 10) / 10 : 0;
    s.report.meritPerHour = hours > 0 ? Math.round((s.merit / hours) * 10) / 10 : 0;
    return s.report;
  });
  const playing = players.filter((p) => p.profile !== 'idle' && p.profile !== 'exploiter');
  const worths = playing.map((p) => p.days[p.days.length - 1]?.worth ?? 0).sort((a, b) => a - b);
  const median = worths.length > 0 ? worths[Math.floor(worths.length / 2)] : 1;
  const leaderGap = worths.length > 0 ? Math.round((worths[worths.length - 1] / Math.max(1, median)) * 100) / 100 : 1;
  const notes: string[] = [];
  const runawayLeader = leaderGap > RUNAWAY;
  if (runawayLeader) notes.push(`The leader holds ${leaderGap}× the median.`);
  const deadEnd = players.some((p) => p.longestStuck >= STUCK);
  if (deadEnd) notes.push(`${players.filter((p) => p.longestStuck >= STUCK).map((p) => p.id).join(', ')} had no card to fly for ${STUCK}+ sorties.`);
  const steady = players.filter((p) => p.profile === 'steady').map((p) => p.gainPerHour);
  const exploit = players.filter((p) => p.profile === 'exploiter').map((p) => p.gainPerHour);
  const best = (xs: number[]) => (xs.length ? Math.max(...xs) : -Infinity);
  const exploitBeatsPlay = exploit.length > 0 && steady.length > 0 && best(exploit) > Math.min(...steady);
  if (exploitBeatsPlay) notes.push(`Exploiting earns ${best(exploit)}/h against ${Math.min(...steady)}/h for steady play.`);
  const planes: LongRunReport['planes'] = {};
  for (const p of players) {
    for (const [id, u] of Object.entries(p.planes)) {
      const t = (planes[id] ??= { flown: 0, wins: 0, share: 0, winRate: 0 });
      t.flown += u!.flown;
      t.wins += u!.wins;
    }
  }
  const flown = Object.values(planes).reduce((t, u) => t + u!.flown, 0);
  for (const u of Object.values(planes)) {
    u!.share = Math.round((u!.flown / Math.max(1, flown)) * 1000) / 1000;
    u!.winRate = Math.round((u!.wins / Math.max(1, u!.flown)) * 100) / 100;
  }
  return { options: { players: opts.players, days: opts.days, seed: opts.seed }, players, planes, leaderGap, flags: { runawayLeader, deadEnd, exploitBeatsPlay, notes } };
}

function makeSim(id: string, profile: LongRunProfile, home: Territory, ctx: MissionContext, rng: Rng): Sim {
  const habits = HABITS[profile];
  const resources = new ResourceManager();
  const base = new Base(home, new DefenseNetwork([], rng), resources, `p:${id}`);
  base.startFresh();
  const incomes = newIncomes();
  const hangar = new Map<AircraftId, 'ready' | 'recovered'>();
  const costFor = (a: AircraftId) => (hangar.get(a) === 'ready' ? 0 : hangar.get(a) === 'recovered' ? AIRCRAFT[a].refitCost : AIRCRAFT[a].cost);
  const situation = (): Situation => ({
    paper: resources.paper, ink: resources.ink, rubber: resources.rubber,
    costs: Object.fromEntries(AIRCRAFT_ORDER.map((a) => [a, costFor(a)])) as Record<AircraftId, number>, airRoom: 4, raidActive: false,
  });
  const director = new MissionDirector(() => ctx, situation, rng, () => 0);
  const shape = simulatedProfile(habits.base);
  director.performance.load(shape.records, shape.skill);
  director.deal();
  const flows = { paper: {}, ink: {}, rubber: {} } as PlayerReport['flows'];
  resources.onAnyChange((r, _v, delta, source) => {
    if (source === 'restore' || source === 'reset') return;
    const key = source === 'income' ? 'production' : source;
    const f = (flows[r][key] ??= { in: 0, out: 0 });
    if (delta > 0) f.in += delta;
    else f.out -= delta;
  });
  return {
    id, profile, habits, resources, base, incomes, director, hangar, rng, merit: 0, online: 0, stuck: 0, shieldUntil: 0, pending: [], startWorth: worthOf(resources),
    report: { id, profile, days: [], sorties: 0, successes: 0, raidsMade: 0, raidsSuffered: 0, recoveries: [], longestStuck: 0, flows, gainPerHour: 0, meritPerHour: 0, planes: {} },
  };
}

/** One sortie (or raid) for `s`. Returns the seconds it took, desk time included. */
function sortie(s: Sim, others: Sim[], history: Array<{ attacker: string; victim: string; at: number }>, clock: number): number {
  const desk = 25;
  if (others.length > 0 && s.rng() < s.habits.raids) {
    const victim = pickVictim(s, others, history, clock);
    if (victim) return desk + raid(s, victim, history, clock);
  }
  const shape = simulatedProfile(s.habits.base);
  const roll = s.rng();
  const order = roll < shape.picks.safe ? [0, 1, 2] : roll < shape.picks.safe + shape.picks.balanced ? [1, 0, 2] : [2, 1, 0];
  let pick: { index: number; plane: AircraftSpec; level: SuitabilityLevel; emergency: boolean } | null = null;
  for (const index of order) {
    const mission = s.director.missions[index];
    if (!mission) continue;
    const plane = bestPlane(s, mission.spec);
    if (plane) {
      pick = { index, ...plane };
      break;
    }
  }
  if (!pick) {
    s.stuck++;
    s.report.longestStuck = Math.max(s.report.longestStuck, s.stuck);
    return desk + 30;
  }
  s.stuck = 0;
  const mission = s.director.missions[pick.index];
  const plane = pick.plane;
  // Pay the plane: paper (fold or refit) and, for a new one, its materials.
  if (!pick.emergency) {
    const kind = s.hangar.get(plane.id);
    const paper = kind === 'ready' ? 0 : kind === 'recovered' ? plane.refitCost : plane.cost;
    const extra = kind ? {} : materialsOf(plane);
    s.resources.spendAll({ ...extra, paper }, `Folded ${plane.name}`);
    s.hangar.delete(plane.id);
    const arm = armingFor(plane, plane.gun.ammo, 0, bombLoad(plane, mission.spec), s.resources.ink, s.resources.rubber);
    if (arm.ink > 0) s.resources.draw('ink', arm.ink, 'Armed');
    if (arm.rubber > 0) s.resources.draw('rubber', arm.rubber, 'Armed');
  }
  s.director.accepted(mission);
  mission.start();
  const tier = mission.tier;
  const odds = s.habits.abandons ? 0 : Math.max(0, Math.min(0.99, shape.success[tier] + SUIT[pick.level]));
  const success = s.rng() < odds;
  const lost = success ? s.rng() < 0.08 : s.habits.abandons ? false : s.rng() < shape.lossOnFailure;
  const time = s.habits.abandons ? 5 : (mission.spec.par ?? 60) * (0.8 + s.rng() * 0.8);
  mission.elapsed = time;
  if (success) {
    mission.objectives.forEach((_, i) => (mission.progress[i] = 1));
    mission.succeed();
    s.resources.earn(mission.reward, 'reward', 'Mission completed');
    s.resources.earnAll(mission.supplies, 'reward', 'Mission completed');
    if (!pick.emergency) s.merit += MERIT.mission[Math.min(MERIT.mission.length - 1, TIERS[tier].index)];
  } else {
    mission.fail(s.habits.abandons ? 'abandoned' : lost ? 'aircraft-lost' : 'missed');
  }
  s.director.afterSortie(
    mission,
    { type: mission.spec.type, tier, success, failure: mission.failure, lost, landed: !lost, damageDealt: 40, damageTaken: lost ? 1 : 0.3, time, par: mission.spec.par ?? 60, shotsFired: 40, shotsHit: 10, aircraft: plane.id, reward: success ? mission.reward : 0, medal: null },
    { success, recovered: !lost, damageTaken: lost ? 1 : 0.3, time, par: mission.spec.par ?? 60, reward: success ? mission.reward : 0 },
  );
  for (const payout of s.director.takePayouts()) s.resources.earn(payout.amount, 'bonus', payout.label);
  if (!lost && !pick.emergency) s.hangar.set(plane.id, 'recovered');
  s.merit += Math.floor(time / MERIT.active.every) * MERIT.active.amount;
  s.report.sorties++;
  if (success) s.report.successes++;
  const used = (s.report.planes[plane.id] ??= { flown: 0, wins: 0 });
  used.flown++;
  if (success) used.wins++;
  return desk + time;
}

/** The best suited plane the player can afford, paper and materials; the emergency plane if none. */
function bestPlane(s: Sim, spec: Parameters<typeof assessSuitability>[1]): { plane: AircraftSpec; level: SuitabilityLevel; emergency: boolean } | null {
  const rank: Record<SuitabilityLevel, number> = { recommended: 3, good: 2, possible: 1, unsuitable: 0 };
  let best: { plane: AircraftSpec; level: SuitabilityLevel; cost: number } | null = null;
  const priceOf = (id: AircraftId): Bundle => {
    const kind = s.hangar.get(id);
    return kind === 'ready' ? {} : kind === 'recovered' ? { paper: AIRCRAFT[id].refitCost } : { ...materialsOf(AIRCRAFT[id]), paper: AIRCRAFT[id].cost };
  };
  for (const id of AIRCRAFT_ORDER) {
    const price = priceOf(id);
    if (!s.resources.canAffordAll(price)) continue;
    const level = assessSuitability(AIRCRAFT[id], spec).level;
    if (level === 'unsuitable') continue;
    const cost = price.paper ?? 0;
    if (!best || rank[level] > rank[best.level] || (rank[level] === rank[best.level] && cost < best.cost)) best = { plane: AIRCRAFT[id], level, cost };
  }
  if (best) return { plane: best.plane, level: best.level, emergency: false };
  const none = AIRCRAFT_ORDER.every((id) => !s.resources.canAffordAll(priceOf(id)));
  const plane = emergencyPlane();
  const level = assessSuitability(plane, spec).level;
  return none && level !== 'unsuitable' ? { plane, level, emergency: true } : null;
}

/** Someone the rules let `s` raid right now (an exploiter only ever raids the other exploiter). */
function pickVictim(s: Sim, others: Sim[], history: Array<{ attacker: string; victim: string; at: number }>, clock: number): Sim | null {
  const ok = others.filter((v) => {
    if (s.profile === 'exploiter' && v.profile !== 'exploiter') return false;
    if (clock < v.shieldUntil) return false;
    const last = [...history].reverse().find((h) => h.attacker === s.id && h.victim === v.id);
    return !last || clock - last.at >= PVP.pairCooldown;
  });
  return ok.length > 0 ? ok[Math.floor(s.rng() * ok.length)] : null;
}

/** A raid by `s` on `v`: the game pays the attacker, the defender loses a capped share. Returns its seconds. */
function raid(s: Sim, v: Sim, history: Array<{ attacker: string; victim: string; at: number }>, clock: number): number {
  const recent = history.filter((h) => h.attacker === s.id && h.victim === v.id && clock - h.at < PVP.farmWindow).length;
  const factor = PVP.repeat[Math.min(recent, PVP.repeat.length - 1)];
  // An exploiter's partner doesn't defend; a real player sometimes does.
  const success = v.profile === 'exploiter' ? true : s.rng() < 0.6;
  // The attacker flies a cheap plane there and back.
  s.resources.spend(Math.min(s.resources.paper, AIRCRAFT.swift.refitCost), 'Refitted Swift');
  if (success) {
    const before = worthOf(v.resources);
    const { losses, floors } = raidLosses(v.base, s.rng() < 0.5 && v.base.status(STORE) !== 'destroyed');
    for (const r of RESOURCES) v.resources.loseOf(r, losses[r] ?? 0, floors[r] ?? 0, 'Raid');
    const weapons = v.base.readiness.ready;
    const reward = Math.round(((PVP.raidReward + PVP.raidPerWeapon * weapons) * (v.base.vulnerable() < PVP.poorTarget ? PVP.poorFactor : 1) * factor) / 5) * 5;
    if (reward > 0) s.resources.earn(reward, 'reward', 'Raid reward');
    s.merit += Math.round(MERIT.raid * factor);
    v.shieldUntil = clock + PVP.raidShield;
    v.report.raidsSuffered++;
    v.pending.push({ worth: before, at: v.online, index: v.report.recoveries.length });
    v.report.recoveries.push(null);
    history.push({ attacker: s.id, victim: v.id, at: clock });
  }
  s.report.raidsMade++;
  return 120;
}

function settleRecoveries(s: Sim): void {
  if (s.pending.length === 0) return;
  const now = worthOf(s.resources);
  s.pending = s.pending.filter((p) => {
    if (now < p.worth) return true;
    s.report.recoveries[p.index] = s.online - p.at;
    return false;
  });
}

/** Builds the next thing on the plan, or upgrades the cheapest building, while it leaves a buffer. */
function build(s: Sim): void {
  const buffer = AIRCRAFT.falcon.cost + 20;
  for (const step of BUILD_PLAN) {
    if (s.base.at(step.slot)) continue;
    const check = s.base.canBuild(step.slot, step.kind);
    if (check.ok && s.resources.paper - check.cost >= buffer) s.base.build(step.slot, step.kind);
    return;
  }
  const upgradable = [...s.base.buildings.values()].map((b) => ({ slot: b.slot, check: s.base.canUpgrade(b.slot) })).filter((u) => u.check.ok).sort((a, b) => a.check.cost - b.check.cost);
  const next = upgradable[0];
  if (next && s.resources.paper - next.check.cost >= buffer * 2) s.base.upgrade(next.slot);
}

/** The report as CSV: one row per player per day. */
export function longRunCsv(r: LongRunReport): string {
  const rows = ['player,profile,day,paper,ink,rubber,worth,merit,rank_index'];
  for (const p of r.players) for (const d of p.days) rows.push([p.id, p.profile, d.day, d.paper, d.ink, d.rubber, d.worth, d.merit, d.rankIndex].join(','));
  return rows.join('\n') + '\n';
}

/** Base production, for the report's note. */
export const LONG_RUN_NOTE = `Paper ${BASE.production}/min, ink ${BASE.inkProduction}/min, rubber balls ${BASE.rubberProduction}/min with no buildings; production only while online.`;

/** The tier index a card counts as for Merit (1-based, as MERIT.mission). */
export function meritTier(tier: Tier): number {
  return TIERS[tier].index + 1;
}

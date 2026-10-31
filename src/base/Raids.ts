import type { RaidOutcome } from '../ai/AirTraffic';
import type { Strike } from '../ai/AiAircraft';
import { RAIDS } from '../config';
import type { Rng } from '../systems/Random';
import { STORE, type Base } from './Base';

/** What a raid is aimed at: one of T1's structures. */
export interface RaidTarget {
  /** Slot id, or STORE. */
  key: string;
  installationId: string;
  name: string;
  strike: Strike;
}

/**
 * Picks what a raid on T1 goes for, weighted by kind among the structures still standing: the
 * paper store more the more vulnerable paper it holds. With nothing standing, the store's wreck.
 */
export function chooseRaidTarget(base: Base, rng: Rng = Math.random): RaidTarget {
  const options: Array<[string, number]> = [];
  for (const key of [STORE, ...base.buildings.keys()]) {
    if (base.status(key) === 'destroyed') continue;
    const kind = key === STORE ? 'store' : base.buildings.get(key)!.kind;
    let weight = RAIDS.targetWeights[kind] ?? 1;
    if (key === STORE) weight += base.vulnerable() * RAIDS.storePerPaper;
    options.push([key, weight]);
  }
  let key = STORE;
  if (options.length > 0) {
    let roll = rng() * options.reduce((sum, [, w]) => sum + w, 0);
    key = options[options.length - 1][0];
    for (const [k, w] of options) {
      if ((roll -= w) <= 0) {
        key = k;
        break;
      }
    }
  }
  return raidTargetFor(base, key);
}

export function raidTargetFor(base: Base, key: string): RaidTarget {
  const i = base.installation(key) ?? base.store;
  return {
    key,
    installationId: i.id,
    name: base.nameOf(key),
    strike: { territoryId: base.home.id, x: i.spec.x, y: base.home.top, z: i.spec.z, radius: RAIDS.hitRadius },
  };
}

/** Paper a bomb on target destroys: a share of the vulnerable paper, more on the store itself, capped. */
export function raidLoss(vulnerable: number, onStore: boolean): number {
  const rule = onStore ? RAIDS.loss.store : RAIDS.loss.building;
  return Math.min(rule.max, Math.round(Math.max(0, vulnerable) * rule.share));
}

export interface RaidPaceInput {
  /** Paper a raid could take. */
  vulnerable: number;
  /** T1's structures' health together, 0–1. */
  integrity: number;
  /** The player's skill (0–1) and whether they are struggling (MissionDirector). */
  skill: number;
  struggling: boolean;
  /** The player is flying a mission that isn't about T1. */
  onMission: boolean;
}

/**
 * How fast the clock to the next raid runs (1 = RAIDS.interval as set). The mission director
 * keeps raids from piling on: they come slower while T1 is battered, the player is struggling or
 * busy with a mission, or there is little paper to take; a little faster for a skilled player.
 */
export function raidPace(p: RaidPaceInput): number {
  let pace = 0.85 + 0.3 * Math.max(0, Math.min(1, p.skill));
  if (p.vulnerable < 20) pace *= 0.6;
  if (p.integrity < 0.6) pace *= 0.5;
  else if (p.integrity < 0.85) pace *= 0.75;
  if (p.struggling) pace *= 0.5;
  if (p.onMission) pace *= 0.6;
  return Math.max(0.2, Math.min(1.3, pace));
}

/** What happened in one raid on T1, for the defense report. */
export interface RaidReport {
  raidId: number;
  outcome: RaidOutcome;
  /** Beaten off: no bomb on target. */
  repelled: boolean;
  target: string;
  /** Raiders shot down, and by whom. */
  aircraftDestroyed: number;
  byDefenses: number;
  byPlayer: number;
  /** Names of structures damaged (still standing) and wrecked. */
  damaged: string[];
  destroyed: string[];
  paperLost: number;
  /** Paper the raid would have cost had its bomb landed (0 if it did). */
  prevented: number;
  /** Damage dealt to the raiders: by T1's defenses and by the player. */
  defenseDamage: number;
  playerDamage: number;
  /** Paper needed to repair everything now. */
  repairCost: number;
  /** One short line on what decided it. */
  highlight: string;
}

/** Keeps score of a raid while it runs, then writes the report. */
export class RaidTracker {
  private readonly damaged = new Set<string>();
  private readonly destroyed = new Set<string>();
  private aircraft = 0;
  private byDefenses = 0;
  private byPlayer = 0;
  private defenseDamage = 0;
  private playerDamage = 0;
  private paperLost = 0;
  private bombed = false;

  constructor(
    readonly raidId: number,
    /** The raid's aircraft: the bomber and its escorts. */
    readonly aircraftIds: ReadonlySet<string>,
    readonly target: RaidTarget,
    /** What a hit would cost right now, kept up to date until the bomb falls. */
    public potentialLoss: number,
  ) {}

  involves(aircraftId: string): boolean {
    return this.aircraftIds.has(aircraftId);
  }

  raiderHit(amount: number, byPlayer: boolean): void {
    if (byPlayer) this.playerDamage += amount;
    else this.defenseDamage += amount;
  }

  raiderDown(byPlayer: boolean): void {
    this.aircraft++;
    if (byPlayer) this.byPlayer++;
    else this.byDefenses++;
  }

  structureHit(name: string, wrecked: boolean): void {
    if (wrecked) {
      this.destroyed.add(name);
      this.damaged.delete(name);
    } else if (!this.destroyed.has(name)) {
      this.damaged.add(name);
    }
  }

  hit(paperLost: number): void {
    this.bombed = true;
    this.paperLost += paperLost;
  }

  finish(outcome: RaidOutcome, repairCost: number): RaidReport {
    const repelled = outcome === 'intercepted' || outcome === 'driven-off' || outcome === 'missed';
    const report: RaidReport = {
      raidId: this.raidId,
      outcome,
      repelled,
      target: this.target.name,
      aircraftDestroyed: this.aircraft,
      byDefenses: this.byDefenses,
      byPlayer: this.byPlayer,
      damaged: [...this.damaged],
      destroyed: [...this.destroyed],
      paperLost: this.paperLost,
      prevented: this.bombed || outcome === 'cancelled' ? 0 : this.potentialLoss,
      defenseDamage: Math.round(this.defenseDamage),
      playerDamage: Math.round(this.playerDamage),
      repairCost,
      highlight: '',
    };
    report.highlight = highlight(report);
    return report;
  }
}

/** The one line that sums a raid up. */
function highlight(r: RaidReport): string {
  const target = r.target.toLowerCase();
  switch (r.outcome) {
    case 'intercepted':
      if (r.byDefenses > 0 && r.byPlayer === 0) return `Defenses stopped it before the ${target}`;
      if (r.byPlayer > 0 && r.byDefenses === 0) return `You stopped it before the ${target}`;
      return `Stopped before the ${target}`;
    case 'driven-off':
      return 'Too damaged: it turned back';
    case 'missed':
      return `Its bomb missed the ${target}`;
    case 'bombed':
      return r.destroyed.length > 0 ? `${r.destroyed[0]} wrecked` : `Bomb hit the ${target}`;
    case 'cancelled':
      return 'Raid called off';
  }
}

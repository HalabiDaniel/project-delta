import { SITUATION } from '../../src/config';
import type { SocialData } from './SocialData';

/** v0.0.19 (GDD §11.3–11.5): newcomers, intermediate players and advanced players. */
export type StrengthTier = 'newcomer' | 'intermediate' | 'advanced';
export const TIER_ORDER: readonly StrengthTier[] = ['newcomer', 'intermediate', 'advanced'];

/** What a player's strength is worked out from. */
export interface StrengthInputs {
  paper: number;
  ink: number;
  rubber: number;
  /** Planes in the hangar (and on the pad or in the air). */
  planes: number;
  /** Standing weapons on their base. */
  weapons: number;
}

/**
 * The director's picture of one player (plan §2A, GDD §11.2), worked out on the server from what
 * the server already keeps: resources, planes, the director's record of their sorties, their
 * base, their threat and their history with others. Everything it is made from is persisted, so
 * it survives restarts.
 */
export interface PlayerSituation {
  id: string;
  name: string;
  resources: { paper: number; ink: number; rubber: number };
  planes: number;
  /** Of the last missions the director recorded: how many succeeded and failed. */
  recent: { success: number; failure: number };
  /** The mission types they fly most, most first. */
  preferred: string[];
  /** Raids launched and kills on weaker players within BOUNTIES.window, and threat now. */
  raids: number;
  weakKills: number;
  threat: number;
  /** Their base's condition (0–1: share of its structures' health standing). */
  condition: number;
  strength: number;
  /** Strength over the session's median (1: middling). */
  relative: number;
  tier: StrengthTier;
  online: boolean;
  /** Sorties flown in their lifetime. */
  sorties: number;
}

export function strengthOf(i: StrengthInputs): number {
  const w = SITUATION.weights;
  return Math.round(i.paper * w.paper + i.ink * w.ink + i.rubber * w.rubber + i.planes * w.plane + i.weapons * w.weapon);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The tier for a player of `strength` in a session whose median strength is `middle`, who has flown
 * `sorties` sorties. Alone in a session, a player is judged against themself (intermediate unless new).
 */
export function tierOf(strength: number, middle: number, sorties: number): StrengthTier {
  const relative = middle > 0 ? strength / middle : 1;
  if (sorties < SITUATION.newcomerSorties && relative < SITUATION.newcomerStrength) return 'newcomer';
  if (relative >= SITUATION.advancedStrength || (sorties >= SITUATION.advancedSorties && relative > 1)) return 'advanced';
  if (sorties < SITUATION.newcomerSorties && relative <= 1) return 'newcomer';
  return 'intermediate';
}

/** Threat as it stands at clock time `now` (ms): what was saved, halved every SITUATION.halfLife. */
export function threatNow(s: SocialData, now: number): number {
  if (s.threat <= 0) return 0;
  const age = Math.max(0, now - s.threatAt) / 1000;
  return s.threat * Math.pow(0.5, age / SITUATION.halfLife);
}

/** Adds threat at clock time `now` (ms). */
export function addThreat(s: SocialData, amount: number, now: number): void {
  s.threat = Math.round((threatNow(s, now) + amount) * 1000) / 1000;
  s.threatAt = now;
}

/** A kill on a weaker player, at clock time `now` (ms): the streak, and the threat it adds. */
export function weakKill(s: SocialData, now: number, window: number): void {
  s.weakKills = [...s.weakKills.filter((t) => now - t <= window * 1000), now].slice(-32);
  addThreat(s, SITUATION.weakKillThreat, now);
}

export function weakKillsWithin(s: SocialData, now: number, window: number): number {
  return s.weakKills.filter((t) => now - t <= window * 1000).length;
}

/** How many tiers stronger `b` is than `a` (negative: weaker). */
export function tierGap(a: StrengthTier, b: StrengthTier): number {
  return TIER_ORDER.indexOf(b) - TIER_ORDER.indexOf(a);
}

/** One decision the director made, for the developer's debug panel and the server log. */
export interface DirectorDecision {
  /** World time. */
  at: number;
  kind: 'bounty' | 'bounty-paid' | 'bounty-ended' | 'coop' | 'rematch' | 'refused' | 'farming' | 'tier';
  text: string;
  /** Who it was about (public ids). */
  players: string[];
}

/** The last SITUATION.logSize decisions, and the ones not yet handed to the room's log. */
export class DirectorLog {
  readonly entries: DirectorDecision[] = [];
  private readonly fresh: DirectorDecision[] = [];

  add(d: DirectorDecision): void {
    this.entries.push(d);
    this.fresh.push(d);
    if (this.entries.length > SITUATION.logSize) this.entries.splice(0, this.entries.length - SITUATION.logSize);
    if (this.fresh.length > SITUATION.logSize) this.fresh.splice(0, this.fresh.length - SITUATION.logSize);
  }

  /** Decisions since the last call, for the server log. */
  take(): DirectorDecision[] {
    return this.fresh.splice(0);
  }
}

import { AIRCRAFT, BOMB, RATINGS, SUITABILITY, type AircraftSpec } from '../config';
import type { MissionSpec, MissionType } from '../missions/Mission';

export type RatingKey = keyof typeof RATINGS;
export type Ratings = Record<RatingKey, number>;

export const RATING_KEYS: readonly RatingKey[] = ['speed', 'maneuverability', 'durability', 'range', 'payload', 'firepower', 'stealth'];

export const RATING_LABELS: Record<RatingKey, string> = {
  speed: 'Speed',
  maneuverability: 'Agility',
  durability: 'Durability',
  range: 'Range',
  payload: 'Payload',
  firepower: 'Firepower',
  stealth: 'Stealth',
};

/** The raw number behind each rating. */
export function ratingValue(spec: AircraftSpec, key: RatingKey): number {
  const f = spec.flight;
  switch (key) {
    case 'speed': return f.maxSpeed + f.boostSpeed / 2;
    case 'maneuverability': return (f.maxTurnRate / 1.8 + f.rollResponse / 8 + f.maxPitchRate / 1.5) / 3;
    case 'durability': return spec.maxHealth;
    case 'range': return spec.range;
    case 'payload': return spec.bombs.capacity * BOMB.kinds[spec.bombs.kind].weight;
    case 'firepower': return spec.gun.damage / spec.gun.interval;
    case 'stealth': return spec.signature;
  }
}

/** Simple 1–5 ratings for the garage, mapped from the specs over the fixed ranges in RATINGS. */
export function aircraftRatings(spec: AircraftSpec): Ratings {
  const ratings = {} as Ratings;
  for (const key of RATING_KEYS) {
    const [lo, hi] = RATINGS[key];
    const t = (ratingValue(spec, key) - lo) / (hi - lo);
    ratings[key] = Math.min(5, Math.max(1, Math.round(1 + 4 * t)));
  }
  return ratings;
}

/**
 * recommended – the plane this mission was made for.
 * good        – a sensible choice.
 * possible    – it can be done, but the plane works against you.
 * unsuitable  – it can't be done: the plane can't carry enough bombs for every target.
 */
export type SuitabilityLevel = 'recommended' | 'good' | 'possible' | 'unsuitable';

export interface Suitability {
  level: SuitabilityLevel;
  /** Weighted average of the ratings that matter for this mission type (1–5). */
  score: number;
  /** Short explanation for the badge. */
  reason: string;
  /** Bombs this plane would carry on the mission. */
  bombLoad: number;
}

export const SUITABILITY_LABELS: Record<SuitabilityLevel, string> = {
  recommended: 'Recommended',
  good: 'Good fit',
  possible: 'Possible',
  unsuitable: "Can't fly it",
};

/** Bombing targets that each need their own hit. */
export function bombTargets(spec: Pick<MissionSpec, 'objectives'>): number {
  return spec.objectives.filter((o) => o.kind === 'bomb').length;
}

/** A mission offers bombs; a plane carries as many of them as its rack holds. */
export function bombLoad(aircraft: AircraftSpec, spec: Pick<MissionSpec, 'bombs'>): number {
  return Math.min(spec.bombs, aircraft.bombs.capacity);
}

/**
 * How well a plane suits a mission. Only a missing capability makes a combination impossible (a
 * rack too small for one bomb per target); everything else is advice, so unconventional choices
 * stay open.
 */
export function assessSuitability(aircraft: AircraftSpec, spec: Pick<MissionSpec, 'type' | 'bombs' | 'objectives'>): Suitability {
  const load = bombLoad(aircraft, spec);
  const targets = bombTargets(spec);
  const ratings = aircraftRatings(aircraft);
  const weights: Partial<Record<RatingKey, number>> = SUITABILITY.weights[spec.type];
  let sum = 0;
  let total = 0;
  let weakest = 5;
  for (const key of RATING_KEYS) {
    const w = weights[key] ?? 0;
    sum += w * ratings[key];
    total += w;
    if (w > 0) weakest = Math.min(weakest, ratings[key]);
  }
  const balanced = (SUITABILITY.balanced as readonly MissionType[]).includes(spec.type);
  const score = total === 0 ? 3 : balanced ? Math.min(5, weakest + 1) : sum / total;

  if (load < targets) {
    const rack = aircraft.bombs.capacity;
    return {
      level: 'unsuitable',
      score,
      reason: `Carries ${rack} bomb${rack === 1 ? '' : 's'}; ${targets} targets need ${targets}`,
      bombLoad: load,
    };
  }
  const level: SuitabilityLevel = score >= SUITABILITY.recommended ? 'recommended' : score >= SUITABILITY.good ? 'good' : 'possible';
  return { level, score, reason: reasonFor(spec.type, ratings, weights, load, spec.bombs, targets), bombLoad: load };
}

const PHRASES: Record<RatingKey, [high: string, low: string]> = {
  speed: ['Very fast', 'Slow'],
  maneuverability: ['Nimble', 'Turns slowly'],
  durability: ['Tough', 'Fragile'],
  range: ['Long range', 'Short range'],
  payload: ['Big bomb rack', 'Small bomb rack'],
  firepower: ['Heavy guns', 'Light guns'],
  stealth: ['Hard to spot', 'Easy to spot'],
};

/** The bomb load first (when it matters), then the most important rating that stands out. */
function reasonFor(
  type: MissionType,
  ratings: Ratings,
  weights: Partial<Record<RatingKey, number>>,
  load: number,
  offered: number,
  targets: number,
): string {
  const parts: string[] = [];
  if (targets > 0) {
    const spares = load - targets;
    parts.push(load >= offered ? `All ${offered} bombs aboard` : spares > 0 ? `${load} of ${offered} bombs` : `${load} of ${offered} bombs, no spare`);
  }
  const ranked = (Object.keys(weights) as RatingKey[])
    .filter((k) => !(targets > 0 && k === 'payload'))
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  for (const key of ranked) {
    const r = ratings[key];
    if (r >= 4) parts.push(PHRASES[key][0]);
    else if (r <= 2) parts.push(PHRASES[key][1]);
    if (parts.length >= 2) break;
  }
  if (parts.length === 0) parts.push(type === 'practice' ? 'Twin guns, steady handling' : 'Balanced all-rounder');
  return parts.join(' · ');
}

/** Every design's suitability for a mission, in garage order. */
export function suitabilityFor(spec: Pick<MissionSpec, 'type' | 'bombs' | 'objectives'>, catalog: Record<string, AircraftSpec> = AIRCRAFT) {
  return Object.values(catalog).map((aircraft) => ({ aircraft, suitability: assessSuitability(aircraft, spec) }));
}

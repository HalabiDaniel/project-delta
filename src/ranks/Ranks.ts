import { MERIT } from '../config';

/**
 * v0.0.17: player ranks. Every player earns Merit by playing (multiplayer, on the server) and climbs
 * a ladder of 15 ranks with three or four levels each, like soldiers moving up through the ranks,
 * then Honor Roll stars forever after the top. Ranks are purely cosmetic: nothing here is read by
 * any rule of play. Shared by the server (which decides the rank) and the client (which shows it).
 */

/** What a rank's insignia is made of, for its art and its card. */
export type Metal = 'bronze' | 'silver' | 'gold';

/** An effect a rank unlocks for the player's plane or desk. None of them changes play. */
export type EffectId = 'pennant' | 'nameplate' | 'pencil-trail' | 'ink-trail' | 'banner' | 'feather-trail' | 'unfold' | 'sparkle-trail' | 'aura' | 'gold-leaf';

export interface RankDef {
  /** Stable id, also the insignia file name ("paper-dart" → paper-dart-2.png). Never renamed once players hold it. */
  id: string;
  name: string;
  /** 1–15 (tier 16 is the Honor Roll, after the ladder). */
  tier: number;
  /** How many levels the rank has (3 or 4). */
  levels: number;
  metal: Metal;
  /** The insignia family, for the card and alt text. */
  insignia: 'chevrons' | 'rocker' | 'senior' | 'stars' | 'thin-wings' | 'thick-wings' | 'angled-wings';
  /** The soldier rank it stands in for, for the docs. */
  soldier: string;
  /** Titles this rank unlocks (the player picks one to show). */
  titles: readonly string[];
  /** Plane and desk effects this rank unlocks. */
  effects: readonly EffectId[];
}

/** The ladder, lowest first. Tier numbers follow the order. */
export const RANKS: readonly RankDef[] = [
  { id: 'blank-page', name: 'Blank Page', tier: 1, levels: 3, metal: 'bronze', insignia: 'chevrons', soldier: 'Recruit', titles: ['New Sheet'], effects: [] },
  { id: 'scribbler', name: 'Scribbler', tier: 2, levels: 3, metal: 'bronze', insignia: 'rocker', soldier: 'Private', titles: ['Margin Doodler'], effects: [] },
  { id: 'dog-ear', name: 'Dog-Ear', tier: 3, levels: 3, metal: 'bronze', insignia: 'senior', soldier: 'Private First Class', titles: ['Corner Folder'], effects: ['pennant'] },
  { id: 'paper-dart', name: 'Paper Dart', tier: 4, levels: 3, metal: 'silver', insignia: 'chevrons', soldier: 'Corporal', titles: ['Paper Cut'], effects: ['nameplate'] },
  { id: 'glider', name: 'Glider', tier: 5, levels: 3, metal: 'silver', insignia: 'rocker', soldier: 'Sergeant', titles: ['Updraft'], effects: ['pencil-trail'] },
  { id: 'inkslinger', name: 'Inkslinger', tier: 6, levels: 3, metal: 'silver', insignia: 'senior', soldier: 'Staff Sergeant', titles: ['Ink Blot'], effects: ['ink-trail'] },
  { id: 'hall-monitor', name: 'Hall Monitor', tier: 7, levels: 3, metal: 'gold', insignia: 'chevrons', soldier: 'Sergeant Major', titles: ["Teacher's Pet"], effects: ['banner'] },
  { id: 'paper-hawk', name: 'Paper Hawk', tier: 8, levels: 3, metal: 'gold', insignia: 'rocker', soldier: 'Warrant Officer', titles: ['Talon'], effects: ['feather-trail'] },
  { id: 'origami-ace', name: 'Origami Ace', tier: 9, levels: 3, metal: 'gold', insignia: 'senior', soldier: 'Lieutenant', titles: ['The Unfoldable'], effects: ['unfold'] },
  { id: 'sky-scholar', name: 'Sky Scholar', tier: 10, levels: 4, metal: 'bronze', insignia: 'stars', soldier: 'Captain', titles: ['Top Marks'], effects: ['sparkle-trail'] },
  { id: 'hawk-eye', name: 'Hawk Eye', tier: 11, levels: 4, metal: 'silver', insignia: 'stars', soldier: 'Major', titles: ['Eagle Eye'], effects: [] },
  { id: 'high-flyer', name: 'High Flyer', tier: 12, levels: 4, metal: 'gold', insignia: 'stars', soldier: 'Lieutenant Colonel', titles: ['Recess Legend'], effects: [] },
  { id: 'valedictorian', name: 'Valedictorian', tier: 13, levels: 3, metal: 'gold', insignia: 'thin-wings', soldier: 'Colonel', titles: ['Class Speaker'], effects: ['aura'] },
  { id: 'deans-list', name: "Dean's List", tier: 14, levels: 3, metal: 'gold', insignia: 'thick-wings', soldier: 'General', titles: ['Honours'], effects: [] },
  { id: 'head-of-the-class', name: 'Head of the Class', tier: 15, levels: 3, metal: 'gold', insignia: 'angled-wings', soldier: 'Field Marshal', titles: ['Head of the Class'], effects: ['gold-leaf'] },
];

/** The rank past the top: one insignia, and a star for every further promotion. */
export const HONOR_ROLL = { id: 'honor-roll', name: 'Honor Roll', tier: 16 } as const;

const ROMAN = ['I', 'II', 'III', 'IV'];

/** One step on the ladder: a rank and level, or an Honor Roll star count. */
export interface RankStep {
  /** 0-based position on the whole ladder (levels first, then each star): only ever goes up. */
  index: number;
  /** The rank's id, or 'honor-roll'. */
  rank: string;
  tier: number;
  /** 1-based level within the rank (1 for the Honor Roll). */
  level: number;
  /** Honor Roll stars (0 below the top). */
  stars: number;
  /** "Paper Dart II", "Honor Roll ★3". */
  label: string;
  /** Just the rank's name ("Paper Dart"). */
  name: string;
  /** The insignia file's base name ("paper-dart-2", "honor-roll"). */
  insignia: string;
}

/** Every rank level in order (48 of them). */
export const LEVELS: ReadonlyArray<{ rank: RankDef; level: number }> = RANKS.flatMap((rank) => Array.from({ length: rank.levels }, (_, i) => ({ rank, level: i + 1 })));

/**
 * Merit needed to reach each level (`thresholds[i]` for LEVELS[i]; the first is 0). The cost of a
 * step grows by `MERIT.curve.growth` each level: quick to start, months for the last ranks.
 */
export function thresholds(curve: { first: number; growth: number } = MERIT.curve): number[] {
  const out = [0];
  let cost = curve.first;
  for (let i = 1; i < LEVELS.length; i++) {
    out.push(out[i - 1] + Math.round(cost));
    cost *= curve.growth;
  }
  return out;
}

const THRESHOLDS = thresholds();
/** Merit needed for the top level (Head of the Class III). */
export const TOP_MERIT = THRESHOLDS[THRESHOLDS.length - 1];

/** The step at ladder position `index` (never past the end of the levels into nonsense). */
export function stepAt(index: number): RankStep {
  const i = Math.max(0, Math.floor(index));
  if (i < LEVELS.length) {
    const { rank, level } = LEVELS[i];
    return { index: i, rank: rank.id, tier: rank.tier, level, stars: 0, label: `${rank.name} ${ROMAN[level - 1]}`, name: rank.name, insignia: `${rank.id}-${level}` };
  }
  const stars = i - LEVELS.length + 1;
  return { index: i, rank: HONOR_ROLL.id, tier: HONOR_ROLL.tier, level: 1, stars, label: `${HONOR_ROLL.name} ★${stars}`, name: HONOR_ROLL.name, insignia: HONOR_ROLL.id };
}

/** The ladder position that `merit` reaches with the current curve. */
export function indexFor(merit: number): number {
  const m = Math.max(0, Math.floor(merit));
  if (m >= TOP_MERIT + MERIT.honorStar) return LEVELS.length - 1 + Math.floor((m - TOP_MERIT) / MERIT.honorStar);
  let i = 0;
  while (i + 1 < THRESHOLDS.length && THRESHOLDS[i + 1] <= m) i++;
  return i;
}

/**
 * A player's rank: what their Merit reaches, but never below the highest step they have held
 * (`peak`), so retuning the curve never takes a rank away.
 */
export function rankFor(merit: number, peak = 0): RankStep {
  return stepAt(Math.max(indexFor(merit), peak));
}

/** Merit at which ladder step `index` begins. */
export function meritAt(index: number): number {
  if (index < THRESHOLDS.length) return THRESHOLDS[Math.max(0, index)];
  return TOP_MERIT + (index - LEVELS.length + 1) * MERIT.honorStar;
}

/** Progress towards the next step, for the player's own card. */
export function progressFor(merit: number, step: RankStep): { into: number; needed: number; next: RankStep } {
  const next = stepAt(step.index + 1);
  const from = meritAt(step.index);
  const to = meritAt(next.index);
  return { into: Math.max(0, Math.min(to - from, merit - from)), needed: to - from, next };
}

/** The rank definition behind a step (null for the Honor Roll). */
export function rankDef(id: string): RankDef | null {
  return RANKS.find((r) => r.id === id) ?? null;
}

/** Ranks reached by a step (every rank whose first level is at or below it). */
function ranksUpTo(step: RankStep): RankDef[] {
  return RANKS.filter((r) => r.tier <= step.tier);
}

/** Titles a player at `step` may show. */
export function unlockedTitles(step: RankStep): string[] {
  const titles = ranksUpTo(step).flatMap((r) => r.titles);
  if (step.stars >= 1) titles.push('Honor Roll');
  return titles;
}

/** Effects a player at `step` may turn on. */
export function unlockedEffects(step: RankStep): EffectId[] {
  return ranksUpTo(step).flatMap((r) => [...r.effects]);
}

/** Profile cards a player at `step` may choose: one per rank reached, plus Honor Roll cards (a new one every five stars). */
export function unlockedCards(step: RankStep): string[] {
  const cards = ranksUpTo(step).map((r) => r.id);
  if (step.stars >= 1) for (let s = 0; s * 5 < step.stars; s++) cards.push(`honor-roll-${s}`);
  return cards;
}

/** What the player has equipped (titles, card, effects), as saved on their record. */
export interface RankPrefs {
  title: string | null;
  card: string | null;
  /** Effects turned off for their own plane (unlocked effects are on unless listed). */
  off: EffectId[];
  /** The highest ladder step held so far. */
  peak: number;
}

export const DEFAULT_PREFS: RankPrefs = { title: null, card: null, off: [], peak: 0 };

/** A saved or requested set of prefs, checked: unknown or unearned choices are dropped. */
export function cleanPrefs(raw: unknown, step: RankStep): RankPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const titles = unlockedTitles(step);
  const cards = unlockedCards(step);
  const effects = new Set<string>(ALL_EFFECTS);
  return {
    title: typeof r.title === 'string' && titles.includes(r.title) ? r.title : null,
    card: typeof r.card === 'string' && cards.includes(r.card) ? r.card : null,
    off: Array.isArray(r.off) ? [...new Set(r.off.filter((e): e is EffectId => typeof e === 'string' && effects.has(e)))] : [],
    peak: typeof r.peak === 'number' && Number.isFinite(r.peak) ? Math.max(0, Math.min(10_000, Math.floor(r.peak))) : 0,
  };
}

export const ALL_EFFECTS: readonly EffectId[] = RANKS.flatMap((r) => [...r.effects]);

/** The effects shown on a player's plane: unlocked and not turned off. */
export function activeEffects(step: RankStep, prefs: Pick<RankPrefs, 'off'>): EffectId[] {
  return unlockedEffects(step).filter((e) => !prefs.off.includes(e));
}

/** The trail a plane draws behind its maneuvers and boosts: the best one unlocked and on. */
export function trailFor(effects: readonly EffectId[]): 'pencil' | 'ink' | 'feather' | 'sparkle' | null {
  if (effects.includes('sparkle-trail')) return 'sparkle';
  if (effects.includes('feather-trail')) return 'feather';
  if (effects.includes('ink-trail')) return 'ink';
  if (effects.includes('pencil-trail')) return 'pencil';
  return null;
}

/**
 * The compact form other players' clients get (the schema's `rank` field): "<index>" or
 * "<index>:<effect>,<effect>" with the plane's active effects. A few bytes, sent on join and change.
 */
export function encodeRank(step: RankStep, effects: readonly EffectId[]): string {
  return effects.length > 0 ? `${step.index}:${effects.join(',')}` : `${step.index}`;
}

export function decodeRank(raw: string): { step: RankStep; effects: EffectId[] } | null {
  const m = /^(\d{1,5})(?::([a-z,-]*))?$/.exec(raw);
  if (!m) return null;
  const effects = new Set<string>(ALL_EFFECTS);
  return { step: stepAt(Number(m[1])), effects: (m[2] ?? '').split(',').filter((e): e is EffectId => effects.has(e)) };
}

/** Did going from `from` to `to` reach a new rank name (not just a level)? */
export function isTierPromotion(from: RankStep, to: RankStep): boolean {
  return to.tier > from.tier;
}

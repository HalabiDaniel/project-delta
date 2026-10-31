import { OPERATIONS, TIER_ORDER, TIERS, type Tier } from '../config';
import type { Escalation, MissionType } from '../missions/Mission';
import { codename, threatOf, type MissionContext } from '../missions/MissionGenerator';
import { shuffled, type Rng } from '../systems/Random';

/**
 * strike – recon, then the radar, then the supply depot and home (guarded or fortified ground).
 * light  – scout it, silence its guns, then bomb it and come home (lightly defended ground).
 * air    – intercept its scout, win the dogfight over it, then escort a bomber there.
 */
export type OperationTemplate = 'strike' | 'light' | 'air';

/** no-loss – bring the plane home. light-damage – take under a quarter damage. fast – finish within par. */
export type OptionalKind = 'no-loss' | 'light-damage' | 'fast';

export const OPTIONAL_LABELS: Record<OptionalKind, string> = {
  'no-loss': 'Bring the plane home',
  'light-damage': `Take under ${Math.round(OPERATIONS.lightDamage * 100)}% damage`,
  fast: 'Finish within par time',
};

/** How to make a stage's mission: always against the operation's territory. */
export interface StageRecipe {
  type: MissionType;
  tier: Tier;
  target: string;
  escalations?: Escalation[];
  focus?: 'radar' | 'supply';
}

export interface OperationStage {
  label: string;
  recipe: StageRecipe;
  status: 'locked' | 'open' | 'done';
  /** Paper the stage's mission paid (0 if its target was already down when the stage opened). */
  earned: number;
  /** What the stage was expected to pay when the operation was planned. */
  estimate: number;
  attempts: number;
  /** An optional extra for this stage, and whether it was met (null until the stage is done). */
  optional: { kind: OptionalKind; bonus: number; met: boolean | null };
  /** It opened with its target already destroyed: nothing left to do. */
  skipped?: boolean;
}

export interface Operation {
  id: string;
  codename: string;
  territoryId: string;
  template: OperationTemplate;
  tier: Tier;
  stages: OperationStage[];
  /** offered – on a card, not started. active – stage 1 was flown. */
  status: 'offered' | 'active' | 'completed' | 'abandoned';
  /** Paid on completing every stage; forfeited by abandoning. */
  bonus: number;
  /** Paid so far: stage rewards and optional bonuses. */
  earned: number;
}

interface StagePlan {
  label: (t: string) => string;
  type: MissionType;
  /** Tier steps below the operation's own. */
  easier: number;
  escalations?: Escalation[];
  focus?: 'radar' | 'supply';
  optional: OptionalKind;
}

const PLANS: Record<OperationTemplate, StagePlan[]> = {
  strike: [
    { label: (t) => `Reconnoitre ${t}`, type: 'danger-recon', easier: 1, optional: 'fast' },
    { label: (t) => `Destroy ${t}'s radar`, type: 'fortified', focus: 'radar', easier: 0, optional: 'light-damage' },
    { label: (t) => `Bomb ${t}'s supply depot, then land on T1`, type: 'fortified', focus: 'supply', escalations: ['return'], easier: 0, optional: 'no-loss' },
  ],
  light: [
    { label: (t) => `Scout ${t}`, type: 'recon', easier: 1, optional: 'fast' },
    { label: (t) => `Silence ${t}'s guns`, type: 'suppression', easier: 0, optional: 'light-damage' },
    { label: (t) => `Bomb ${t}, then land on T1`, type: 'bombing', escalations: ['return'], easier: 0, optional: 'no-loss' },
  ],
  air: [
    { label: (t) => `Catch the scout over ${t}`, type: 'scout-intercept', easier: 1, optional: 'light-damage' },
    { label: (t) => `Win the dogfight over ${t}`, type: 'dogfight', easier: 0, optional: 'light-damage' },
    { label: (t) => `Escort a bomber to ${t}`, type: 'escort', easier: 0, optional: 'no-loss' },
  ],
};

let serial = 0;

/**
 * Plans an operation at about `tier` (very hard counts as hard: the stages bring their own
 * escalations). Picks a template the world can host and a territory for it; `estimate` makes a
 * stage's mission and returns its reward (or null if it can't be made), which sets the bonus.
 */
export function planOperation(ctx: MissionContext, tier: Tier, rng: Rng, estimate: (recipe: StageRecipe) => number | null): Operation | null {
  const top: Tier = tier === 'veryhard' ? 'hard' : tier;
  const alive = (t: string, kind: string) => (ctx.installations ?? []).some((i) => i.territoryId === t && i.kind === kind && i.side !== 'player');
  const fits: Record<OperationTemplate, (id: string) => boolean> = {
    strike: (id) => top !== 'easy' && alive(id, 'radar') && alive(id, 'supply'),
    light: (id) => {
      const t = ctx.territories.find((x) => x.id === id)!;
      return threatOf(t, ctx) === 1 && alive(id, 'turret');
    },
    air: (id) => {
      const t = ctx.territories.find((x) => x.id === id)!;
      return threatOf(t, ctx) <= 2;
    },
  };
  for (const template of shuffled(rng, ['strike', 'light', 'air'] as OperationTemplate[])) {
    for (const t of shuffled(rng, ctx.territories.filter((x) => x.id !== ctx.homeId && ctx.states?.get(x.id) !== 'disabled'))) {
      if (!fits[template](t.id)) continue;
      const stages: OperationStage[] = [];
      for (const plan of PLANS[template]) {
        const stageTier = TIER_ORDER[Math.max(0, TIERS[top].index - plan.easier)];
        const recipe: StageRecipe = { type: plan.type, tier: stageTier, target: t.id, escalations: plan.escalations, focus: plan.focus };
        const reward = estimate(recipe);
        if (reward === null) break;
        stages.push({
          label: plan.label(t.id),
          recipe,
          status: stages.length === 0 ? 'open' : 'locked',
          earned: 0,
          estimate: reward,
          attempts: 0,
          optional: { kind: plan.optional, bonus: OPERATIONS.optionalBonus[stageTier], met: null },
        });
      }
      if (stages.length !== PLANS[template].length) continue;
      const total = stages.reduce((sum, s) => sum + s.estimate, 0);
      return {
        id: `op-${++serial}-${Math.floor(rng() * 1e6)}`,
        codename: codename(rng),
        territoryId: t.id,
        template,
        tier: top,
        stages,
        status: 'offered',
        bonus: Math.max(OPERATIONS.minBonus, Math.round((total * OPERATIONS.bonusShare) / 5) * 5),
        earned: 0,
      };
    }
  }
  return null;
}

/** The stage to fly next, or null once every stage is done. */
export function openStage(op: Operation): number | null {
  const i = op.stages.findIndex((s) => s.status === 'open');
  return i >= 0 ? i : null;
}

/** What a stage's sortie went like, for its optional objective. */
export interface StageResult {
  success: boolean;
  recovered: boolean;
  /** Share of the plane's health lost. */
  damageTaken: number;
  time: number;
  par: number;
  reward: number;
}

/** Was the optional objective met? */
export function optionalMet(kind: OptionalKind, r: StageResult): boolean {
  if (!r.success) return false;
  switch (kind) {
    case 'no-loss': return r.recovered;
    case 'light-damage': return r.damageTaken < OPERATIONS.lightDamage;
    case 'fast': return r.par > 0 && r.time <= r.par;
  }
}

export interface Payout {
  amount: number;
  label: string;
}

/**
 * A stage's sortie is over. On success the stage is done (its reward was paid by the mission),
 * its optional bonus is paid if met and the next stage opens; after the last, the operation is
 * complete and pays its bonus. A failed stage stays open to try again. Returns what to pay.
 */
export function finishStage(op: Operation, index: number, r: StageResult): Payout[] {
  const stage = op.stages[index];
  if (!stage || stage.status !== 'open' || (op.status !== 'active' && op.status !== 'offered')) return [];
  op.status = 'active';
  stage.attempts++;
  if (!r.success) return [];
  const payouts: Payout[] = [];
  stage.status = 'done';
  stage.earned = r.reward;
  op.earned += r.reward;
  stage.optional.met = optionalMet(stage.optional.kind, r);
  if (stage.optional.met) {
    payouts.push({ amount: stage.optional.bonus, label: `${op.codename}: ${OPTIONAL_LABELS[stage.optional.kind].toLowerCase()}` });
    op.earned += stage.optional.bonus;
  }
  payouts.push(...advance(op));
  return payouts;
}

/** Opens the next stage, or completes the operation (with its bonus). */
export function advance(op: Operation): Payout[] {
  const next = op.stages.find((s) => s.status === 'locked');
  if (next) {
    next.status = 'open';
    return [];
  }
  op.status = 'completed';
  op.earned += op.bonus;
  return [{ amount: op.bonus, label: `${op.codename} complete: operation bonus` }];
}

/** Marks the open stage done without a sortie: its target was already destroyed. */
export function skipStage(op: Operation, index: number): Payout[] {
  const stage = op.stages[index];
  if (!stage || stage.status !== 'open') return [];
  stage.status = 'done';
  stage.skipped = true;
  stage.optional.met = null;
  return advance(op);
}

/** Abandoning keeps everything earned so far but forfeits the completion bonus. */
export function abandon(op: Operation): void {
  if (op.status === 'completed') return;
  op.status = 'abandoned';
}

/** Paper still to be had: open and locked stages' estimates, their optional bonuses, and the completion bonus. */
export function remainingRewards(op: Operation): number {
  if (op.status === 'completed' || op.status === 'abandoned') return 0;
  return op.stages.filter((s) => s.status !== 'done').reduce((sum, s) => sum + s.estimate + s.optional.bonus, 0) + op.bonus;
}

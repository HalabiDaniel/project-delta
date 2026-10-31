import { assessSuitability } from '../aircraft/Aircraft';
import { AIRCRAFT, AIRCRAFT_ORDER, DIRECTOR, OPERATIONS, TIER_ORDER, TIERS, type AircraftId, type Tier } from '../config';
import { Mission, type Escalation, type MissionSpec, type MissionType, type Situational } from '../missions/Mission';
import { escalationsFor, EVENT_TYPES, generateMission, MISSION_TYPES, supports, threatOf, type MissionContext } from '../missions/MissionGenerator';
import { emergencyDart } from '../systems/GameState';
import { seededRng, shuffled, type Rng } from '../systems/Random';
import { abandon, finishStage, openStage, planOperation, skipStage, type Operation, type Payout, type StageRecipe, type StageResult } from './Operations';
import { PerformanceTracker, type MissionRecord } from './Performance';
import { CATEGORY_LABELS, categoryOf, RECOVERY_TYPES, TEMPLATES } from './Templates';

/** The three regular cards: a relatively safe one, a balanced one and a high-risk, high-reward one. */
export type Slot = 'safe' | 'balanced' | 'risky';
export const SLOTS: readonly Slot[] = ['safe', 'balanced', 'risky'];

export const SLOT_LABELS: Record<Slot | 'event', string> = { safe: 'Safe', balanced: 'Balanced', risky: 'High risk', event: 'World event' };

/** director – a regular card. recovery – cheap, low-risk work after losses. operation – a stage of one. event – a world event's. forced – the developer's. */
export type OfferSource = 'director' | 'recovery' | 'operation' | 'event' | 'forced';

/** How to make a card again: saves keep these rather than whole missions. */
export interface Recipe {
  type: MissionType;
  tier: Tier;
  seed: number;
  target?: string;
  escalations?: Escalation[];
  modifiers?: Situational[];
  focus?: 'radar' | 'supply';
  count?: number;
}

export interface Offer {
  slot: Slot | 'event';
  source: OfferSource;
  mission: Mission;
  /** Null for event cards, which are about aircraft and targets already out there. */
  recipe: Recipe | null;
  /** Why the director chose it, for the developer panel. */
  reasons: string[];
  eventId?: string;
  operationId?: string;
  stage?: number;
}

/** What the director needs to know about the player and the sky right now. */
export interface Situation {
  paper: number;
  /** Paper needed to get each design onto the pad (fold, refit, or 0 to roll out a stowed one). */
  costs: Record<AircraftId, number>;
  /** Mission aircraft that can still go up (AI.maxActive minus raids and events in the air). */
  airRoom: number;
  /** A raid on T1 is under way. */
  raidActive: boolean;
}

export type HistoryKind = 'offered' | 'accepted' | 'completed' | 'failed' | 'swapped' | 'invalid' | 'expired' | 'abandoned';

export interface HistoryEntry {
  at: number;
  kind: HistoryKind;
  type: MissionType;
  tier: Tier;
  title: string;
  slot: Offer['slot'];
  source: OfferSource;
  detail?: string;
}

/** One mission type the director weighed for a slot, and why it was left out (null: it was eligible). */
export interface Candidate {
  type: MissionType;
  weight: number;
  reason: string | null;
}

/** How a slot's card was chosen, for the developer panel. */
export interface SlotAnalysis {
  slot: Slot;
  tier: Tier;
  /** "Medium (skill 0.42: 36% chance of Hard)". */
  tierNote: string;
  candidates: Candidate[];
  picked: MissionType | null;
}

/** Everything the director keeps between sessions. */
export interface DirectorState {
  offers: Array<{ slot: Slot; source: OfferSource; recipe: Recipe | null }>;
  swaps: number;
  recent: Array<{ type: MissionType; target: string | null }>;
  history: HistoryEntry[];
  records: MissionRecord[];
  skill: number;
  operation: Operation | null;
  completedMissions: number;
  sinceOperation: number;
}

/**
 * Deals and manages the mission cards from explicit rules: templates (the mission types), the
 * player's situation (paper, planes, recent performance), the world (targets standing, aircraft
 * in the sky, territory states) and weighted random choice. It keeps three cards (safe, balanced,
 * risky), an operation card when one is on, and an event card while a world event lasts; replaces
 * only the card that was flown, checks every card can actually be done, varies what it offers,
 * and logs everything it does.
 */
export class MissionDirector {
  readonly performance = new PerformanceTracker();
  offers: Offer[] = [];
  event: Offer | null = null;
  operation: Operation | null = null;
  /** The last finished operation, for the report. */
  lastOperation: Operation | null = null;
  swaps: number = DIRECTOR.swaps.start;
  /** Missions flown lately (type and main target): the variety memory. */
  readonly recent: Array<{ type: MissionType; target: string | null }> = [];
  readonly history: HistoryEntry[] = [];
  readonly analysis = new Map<Slot, SlotAnalysis>();
  /** The mission in the air, once launched. */
  active: Mission | null = null;
  completedMissions = 0;
  /** Missions finished since the last operation ended (operations have a cooldown). */
  sinceOperation: number = OPERATIONS.cooldown;
  private readonly payouts: Payout[] = [];

  constructor(
    private readonly context: () => MissionContext,
    private readonly situation: () => Situation,
    private readonly rng: Rng = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cards in order: safe, balanced (or the operation), risky, then the event card if any. */
  get missions(): Mission[] {
    return [...this.offers.map((o) => o.mission), ...(this.event ? [this.event.mission] : [])];
  }

  offerFor(mission: Mission | null): Offer | undefined {
    if (!mission) return undefined;
    return this.event?.mission === mission ? this.event : this.offers.find((o) => o.mission === mission);
  }

  /** A fresh hand: three cards. */
  deal(): Mission[] {
    this.offers = [];
    for (const slot of SLOTS) this.offers.push(this.make(slot));
    return this.missions;
  }

  /** The player launched `mission`. An offered operation starts with its first stage. */
  accepted(mission: Mission): void {
    const offer = this.offerFor(mission);
    if (!offer) return;
    this.active = mission;
    this.log('accepted', offer);
    if (offer.operationId && this.operation?.id === offer.operationId && this.operation.status === 'offered') this.operation.status = 'active';
  }

  /**
   * A sortie is over. The mission's record feeds the performance rating and the variety memory,
   * an operation stage advances, the flown card is replaced (the others stay unless they went
   * stale) and a swap comes back. Bonuses to pay wait in `takePayouts()`.
   */
  afterSortie(mission: Mission, record: MissionRecord, result: StageResult): void {
    this.active = null;
    this.performance.record(record);
    this.recent.push({ type: mission.spec.type, target: mainTarget(mission.spec) });
    if (this.recent.length > DIRECTOR.variety.window * 2) this.recent.splice(0, this.recent.length - DIRECTOR.variety.window * 2);
    if (record.success) {
      this.completedMissions++;
      this.sinceOperation++;
    }
    const offer = this.offerFor(mission);
    if (offer) this.log(record.success ? 'completed' : 'failed', offer, record.success ? `+${mission.reward}` : (record.failure ?? undefined));
    if (offer?.operationId && this.operation?.id === offer.operationId && offer.stage !== undefined) {
      this.payouts.push(...finishStage(this.operation, offer.stage, result));
      this.settleOperation();
    }
    if (offer === this.event) this.event = null;
    else if (offer) {
      const i = this.offers.indexOf(offer);
      this.offers[i] = this.make(offer.slot as Slot);
    }
    this.swaps = Math.min(DIRECTOR.swaps.max, this.swaps + DIRECTOR.swaps.perSortie);
    this.validate();
  }

  /** Bonuses earned (operation stages, operation completion) waiting to be paid. */
  takePayouts(): Payout[] {
    return this.payouts.splice(0);
  }

  /** Can card `index` be swapped for another? Not event cards, and not an operation under way. */
  canSwap(index: number): boolean {
    const offer = this.offers[index];
    if (!offer || this.swaps <= 0) return false;
    return !(offer.source === 'operation' && this.operation?.status === 'active');
  }

  /** Swaps card `index` for a new one in the same slot (not of the same type). Uses up a swap. */
  swap(index: number): Mission | null {
    if (!this.canSwap(index)) return null;
    const old = this.offers[index];
    this.log('swapped', old);
    if (old.source === 'operation') {
      // An operation nobody has started yet is simply set aside.
      this.operation = null;
      this.sinceOperation = 0;
    }
    this.swaps--;
    this.offers[index] = this.make(old.slot as Slot, new Set([old.mission.spec.type]), old.source === 'operation');
    return this.offers[index].mission;
  }

  /** Gives up the operation under way: what it paid is kept, the completion bonus is not. */
  abandonOperation(): boolean {
    const op = this.operation;
    if (!op || op.status !== 'active') return false;
    abandon(op);
    const offer = this.offers.find((o) => o.operationId === op.id);
    if (offer) this.log('abandoned', offer, op.codename);
    this.lastOperation = op;
    this.operation = null;
    this.sinceOperation = 0;
    if (offer) this.offers[this.offers.indexOf(offer)] = this.make(offer.slot as Slot, undefined, true);
    return true;
  }

  /** A world event's card (or none). */
  setEvent(offer: Offer | null): void {
    if (this.event && this.event !== offer && this.event.mission !== this.active) this.log('expired', this.event);
    this.event = offer;
    if (offer) this.log('offered', offer);
  }

  /**
   * Replaces cards that can no longer be done: a target destroyed or gone, a raid interception
   * while a raid is already on, aircraft that can't go up. Returns true if any card changed.
   */
  validate(): boolean {
    const ctx = this.context();
    const sit = this.situation();
    let changed = false;
    this.offers.forEach((offer, i) => {
      const problem = this.stale(offer.mission.spec, ctx, sit);
      if (!problem) return;
      this.log('invalid', offer, problem);
      this.offers[i] = this.make(offer.slot as Slot);
      changed = true;
    });
    return changed;
  }

  /** Developer tool: puts a mission made from `recipe` in slot `index`. */
  force(index: number, recipe: Omit<Recipe, 'seed'>): Mission | null {
    const slot = SLOTS[index];
    if (!slot) return null;
    const base: Recipe = { ...recipe, seed: this.seed() };
    // A very hard card is only very hard with an escalation on top, forced or not.
    const made = base.tier === 'veryhard' && !base.escalations?.length ? this.escalated(base, this.performance.skill) : this.made(base);
    if (!made) return null;
    const { mission, recipe: full } = made;
    this.offers[index] = { slot, source: 'forced', mission, recipe: full, reasons: ['Forced from the developer panel'] };
    this.log('offered', this.offers[index]);
    return mission;
  }

  // ---- Saving -------------------------------------------------------------------------------

  save(): DirectorState {
    return {
      offers: this.offers.map((o) => ({ slot: o.slot as Slot, source: o.source, recipe: o.source === 'operation' ? null : o.recipe })),
      swaps: this.swaps,
      recent: this.recent.map((r) => ({ ...r })),
      history: this.history.slice(-DIRECTOR.historySize),
      records: [...this.performance.records],
      skill: this.performance.skill,
      operation: this.operation,
      completedMissions: this.completedMissions,
      sinceOperation: this.sinceOperation,
    };
  }

  /**
   * Restores a saved director. Cards are made again from their recipes; any that can no longer be
   * made (or done) are dealt afresh. Returns the cards.
   */
  load(s: DirectorState): Mission[] {
    this.performance.load(s.records, s.skill);
    this.swaps = Math.max(0, Math.min(DIRECTOR.swaps.max, s.swaps));
    this.recent.length = 0;
    this.recent.push(...s.recent);
    this.history.length = 0;
    this.history.push(...s.history);
    this.operation = s.operation && (s.operation.status === 'offered' || s.operation.status === 'active') ? s.operation : null;
    this.completedMissions = s.completedMissions;
    this.sinceOperation = s.sinceOperation;
    const ctx = this.context();
    const sit = this.situation();
    this.offers = SLOTS.map((slot) => {
      const saved = s.offers.find((o) => o.slot === slot);
      if (saved?.recipe && saved.source !== 'operation' && !(slot === 'balanced' && this.operation)) {
        const mission = this.generate(saved.recipe);
        if (mission && !this.stale(mission.spec, ctx, sit)) return { slot, source: saved.source, mission, recipe: saved.recipe, reasons: ['Restored from the saved game'] };
      }
      return this.make(slot);
    });
    return this.missions;
  }

  // ---- Making cards ---------------------------------------------------------------------------

  /**
   * A card for `slot`. The balanced slot carries the operation when one is on (or, now and then,
   * offers a new one); otherwise the slot's tier comes from the player's skill, and the type from
   * the templates by weight, variety and eligibility.
   */
  private make(slot: Slot, exclude: ReadonlySet<MissionType> = new Set(), noOperation = false): Offer {
    if (slot === 'balanced' && !noOperation) {
      const op = this.operationCard();
      if (op) return op;
    }
    const sit = this.situation();
    const recovery = this.recoveryReasons(sit);
    if (slot === 'safe' && recovery.length > 0) {
      const offer = this.recoveryCard(recovery, exclude);
      if (offer) return offer;
    }
    return this.regularCard(slot, exclude, recovery);
  }

  private regularCard(slot: Slot, exclude: ReadonlySet<MissionType>, recovery: string[]): Offer {
    const ctx = this.context();
    const sit = this.situation();
    const skill = this.performance.skill;
    const [a, b] = DIRECTOR.slots[slot];
    let x = a + (b - a) * skill;
    if (recovery.length > 0 && slot === 'balanced') x = Math.min(x, 1);
    const lo = Math.min(3, Math.floor(x));
    const up = lo < 3 ? x - lo : 0;
    const tier = TIER_ORDER[Math.min(3, lo + (this.rng() < up ? 1 : 0))];
    const tierNote = `${TIERS[tier].label} (skill ${skill.toFixed(2)}${up > 0 ? `: ${Math.round(up * 100)}% chance of ${TIERS[TIER_ORDER[lo + 1]].label}` : ''})`;
    const content = TIERS[tier].content;
    const others = this.offers.filter((o) => o.slot !== slot);
    const otherCategories = new Set(others.map((o) => categoryOf(o.mission.spec.type)));
    const otherTypes = new Set(others.map((o) => o.mission.spec.type));

    const candidates: Candidate[] = MISSION_TYPES.filter((t) => !EVENT_TYPES.includes(t)).map((type) => {
      let reason: string | null = null;
      if (exclude.has(type)) reason = 'just swapped away';
      else if (otherTypes.has(type)) reason = 'already on the board';
      else if (!supports(type, content, ctx)) reason = 'no fitting target';
      else if (tier === 'veryhard' && escalationsFor(type).length === 0) reason = 'cannot be escalated';
      else if (type === 'bomber-intercept' && sit.raidActive) reason = 'a raid is already under way';
      const weight = TEMPLATES[type].weight * this.variety(type) * (1 + DIRECTOR.variety.noise * (this.rng() * 2 - 1));
      return { type, weight, reason };
    });
    // One card per category where possible: the board should offer different kinds of work.
    const fresh = candidates.filter((c) => !c.reason && !otherCategories.has(categoryOf(c.type)));
    const pool = fresh.length > 0 ? fresh : candidates.filter((c) => !c.reason);
    for (const c of candidates) if (!c.reason && !fresh.includes(c) && fresh.length > 0) c.reason = `${CATEGORY_LABELS[categoryOf(c.type)]} already on the board`;

    const reasons = [`${SLOT_LABELS[slot]} slot → ${tierNote}`, ...recovery.map((r) => `Recovery: ${r}`)];
    const remaining = [...pool];
    while (remaining.length > 0) {
      const c = weightedPick(this.rng, remaining);
      remaining.splice(remaining.indexOf(c), 1);
      const base: Recipe = { type: c.type, tier, seed: this.seed() };
      const made = tier === 'veryhard' ? this.escalated(base, skill) : this.made(base);
      if (!made) {
        c.reason = tier === 'veryhard' ? 'no escalation fits' : 'could not be made';
        continue;
      }
      const { mission, recipe } = made;
      const problem = this.ineligible(mission.spec, ctx, sit);
      if (problem) {
        c.reason = problem;
        continue;
      }
      const total = pool.reduce((s, x) => s + x.weight, 0);
      reasons.push(`Picked ${c.type} (${CATEGORY_LABELS[categoryOf(c.type)]}): weight ${c.weight.toFixed(2)} of ${total.toFixed(2)} among ${pool.length} eligible`);
      const seen = this.recent.slice(-DIRECTOR.variety.window).filter((r) => categoryOf(r.type) === categoryOf(c.type)).length;
      if (seen > 0) reasons.push(`Variety: ${seen} recent ${CATEGORY_LABELS[categoryOf(c.type)].toLowerCase()} mission${seen === 1 ? '' : 's'} lowered its weight`);
      if (mission.spec.modifiers?.length) reasons.push(`Modifiers: ${mission.spec.modifiers.join(', ')}`);
      this.analysis.set(slot, { slot, tier, tierNote, candidates, picked: c.type });
      const offer: Offer = { slot, source: 'director', mission, recipe, reasons };
      this.log('offered', offer);
      return offer;
    }
    this.analysis.set(slot, { slot, tier, tierNote, candidates, picked: null });
    // Nothing fits at this tier (an unusual world or situation): fall back to an easy recon.
    return this.fallback(slot, reasons);
  }

  private made(recipe: Recipe): { mission: Mission; recipe: Recipe } | null {
    const mission = this.generate(recipe);
    return mission ? { mission, recipe } : null;
  }

  /** A very hard card: hard content with one or two escalations that fit. */
  private escalated(base: Recipe, skill: number): { mission: Mission; recipe: Recipe } | null {
    const options = shuffled(this.rng, escalationsFor(base.type));
    const second = this.rng() < (skill - DIRECTOR.secondEscalation.from) * DIRECTOR.secondEscalation.chance;
    for (let i = 0; i < options.length; i++) {
      const picks = second && options.length > i + 1 ? [options[i], options[i + 1]] : [options[i]];
      const recipe: Recipe = { ...base, escalations: picks };
      const mission = this.generate(recipe);
      if (mission && mission.spec.modifiers?.some((m) => picks.includes(m as Escalation))) return { mission, recipe };
    }
    return null;
  }

  /** Cheap, low-risk work on unprotected ground that pays enough for a new plane. */
  private recoveryCard(why: string[], exclude: ReadonlySet<MissionType>): Offer | null {
    const ctx = this.context();
    const sit = this.situation();
    const safe = ctx.territories.filter((t) => t.id !== ctx.homeId && threatOf(t, ctx) === 0);
    const types = [...RECOVERY_TYPES].filter((t) => !exclude.has(t));
    while (types.length > 0) {
      const c = weightedPick(this.rng, types.map((type) => ({ type, weight: TEMPLATES[type].weight * this.variety(type) })));
      types.splice(types.indexOf(c.type), 1);
      for (const t of needsTarget(c.type) ? shuffled(this.rng, safe) : [null]) {
        const recipe: Recipe = { type: c.type, tier: 'easy', seed: this.seed(), target: t?.id, modifiers: ['recovery'], count: c.type === 'practice' ? 1 : undefined };
        const mission = this.generate(recipe);
        if (!mission || this.ineligible(mission.spec, ctx, sit)) continue;
        const offer: Offer = {
          slot: 'safe',
          source: 'recovery',
          mission,
          recipe,
          reasons: ['Safe slot → recovery mission', ...why.map((w) => `Recovery: ${w}`), `Pays at least ${DIRECTOR.recoveryReward}: enough for a new plane`],
        };
        this.log('offered', offer);
        return offer;
      }
    }
    return null;
  }

  private fallback(slot: Slot, reasons: string[]): Offer {
    const recipe: Recipe = { type: 'recon', tier: 'easy', seed: this.seed() };
    const mission = this.generate(recipe) ?? new Mission(generateMission('rings', 'easy', this.context(), seededRng(recipe.seed)));
    const offer: Offer = { slot, source: 'director', mission, recipe, reasons: [...reasons, 'Nothing else fits right now: an easy fallback'] };
    this.log('offered', offer);
    return offer;
  }

  /** The operation's card: its open stage, or a newly planned operation now and then. */
  private operationCard(): Offer | null {
    const ctx = this.context();
    if (!this.operation) {
      if (this.completedMissions < OPERATIONS.afterMissions || this.sinceOperation < OPERATIONS.cooldown || this.rng() >= OPERATIONS.chance) return null;
      const tier = this.performance.recommendedTier;
      const op = planOperation(ctx, tier, this.rng, (r) => this.generate({ ...r, seed: this.seed() })?.reward ?? null);
      if (!op) return null;
      this.operation = op;
    }
    const op = this.operation;
    for (let guard = 0; guard < op.stages.length + 1; guard++) {
      const index = openStage(op);
      if (index === null) return null;
      const stage = op.stages[index];
      const recipe: Recipe = { ...stage.recipe, seed: this.seed() };
      const mission = this.generate(recipe);
      if (mission && !this.stale(mission.spec, ctx, this.situation())) {
        mission.spec.codename = op.codename;
        const offer: Offer = {
          slot: 'balanced',
          source: 'operation',
          mission,
          recipe,
          operationId: op.id,
          stage: index,
          reasons: [`Operation ${op.codename} (${op.template}) against ${op.territoryId}`, `Stage ${index + 1} of ${op.stages.length}: ${stage.label}`, `Completion bonus +${op.bonus}`],
        };
        this.log('offered', offer);
        return offer;
      }
      // Its target is already down (the player got there first): the stage is done.
      this.payouts.push(...skipStage(op, index));
      if (this.settleOperation()) return null;
    }
    return null;
  }

  /** Once an operation is over, it leaves the board. True if it ended. */
  private settleOperation(): boolean {
    const op = this.operation;
    if (!op || (op.status !== 'completed' && op.status !== 'abandoned')) return false;
    this.lastOperation = op;
    this.operation = null;
    this.sinceOperation = 0;
    return true;
  }

  // ---- Rules ----------------------------------------------------------------------------------

  /** Why the safe card should be a recovery mission, if it should. */
  private recoveryReasons(sit: Situation): string[] {
    const why: string[] = [];
    if (this.performance.struggling) why.push('several planes lost or missions failed lately');
    const affordable = AIRCRAFT_ORDER.filter((id) => sit.costs[id] <= sit.paper);
    if (affordable.every((id) => id === 'dart')) why.push(affordable.length ? 'only a Dart is affordable' : 'no plane is affordable');
    return why;
  }

  /** How much the variety memory wants this type: less for categories and types flown lately. */
  private variety(type: MissionType): number {
    const window = this.recent.slice(-DIRECTOR.variety.window);
    const category = categoryOf(type);
    const sameCategory = window.filter((r) => categoryOf(r.type) === category).length;
    const sameType = window.filter((r) => r.type === type).length;
    return DIRECTOR.variety.category ** sameCategory * DIRECTOR.variety.type ** sameType;
  }

  /** Why a freshly made mission can't be offered, or null. */
  private ineligible(spec: MissionSpec, ctx: MissionContext, sit: Situation): string | null {
    const stale = this.stale(spec, ctx, sit);
    if (stale) return stale;
    const aircraft = spec.aircraft?.length ?? 0;
    if (aircraft > sit.airRoom) return `needs ${aircraft} aircraft, only ${sit.airRoom} can go up`;
    if (!flyable(spec, sit)) return 'no affordable plane can fly it';
    const target = mainTarget(spec);
    if (this.recent.slice(-DIRECTOR.variety.repeat).some((r) => r.type === spec.type && r.target === target)) return 'just flown';
    return null;
  }

  /** Why a card on the board can no longer be done, or null. */
  private stale(spec: MissionSpec, ctx: MissionContext, sit: Situation): string | null {
    if (spec.type === 'bomber-intercept' && sit.raidActive && !spec.modifiers?.includes('emergency')) return 'a raid is already under way';
    const standing = new Set([...(ctx.installations ?? []).map((i) => i.id), ...(ctx.dummies ?? []).map((d) => d.id)]);
    for (const o of spec.objectives) {
      if (o.kind === 'destroy' && o.what !== 'shipment' && o.targets.filter((id) => standing.has(id)).length < o.count) return `its target on ${o.territoryId} is destroyed`;
    }
    return null;
  }

  private generate(recipe: Recipe): Mission | null {
    try {
      const mission = new Mission(
        generateMission(recipe.type, TIERS[recipe.tier].content, this.context(), seededRng(recipe.seed), {
          tier: recipe.tier,
          target: recipe.target,
          escalations: recipe.escalations,
          modifiers: recipe.modifiers,
          focus: recipe.focus,
          count: recipe.count,
        }),
      );
      return mission;
    } catch {
      return null;
    }
  }

  private seed(): number {
    return Math.floor(this.rng() * 2 ** 31);
  }

  private log(kind: HistoryKind, offer: Offer, detail?: string): void {
    const spec = offer.mission.spec;
    this.history.push({ at: this.now(), kind, type: spec.type, tier: offer.mission.tier, title: spec.title, slot: offer.slot, source: offer.source, detail });
    if (this.history.length > DIRECTOR.historySize) this.history.splice(0, this.history.length - DIRECTOR.historySize);
  }
}

/** The territory a mission is mainly about (its first objective away from home), or null. */
export function mainTarget(spec: Pick<MissionSpec, 'objectives'>): string | null {
  for (const o of spec.objectives) if (o.kind !== 'land' && o.kind !== 'ring') return o.territoryId;
  return null;
}

/** Can the player get a plane onto the pad (with what they have) that can fly this mission? */
export function flyable(spec: Pick<MissionSpec, 'type' | 'bombs' | 'objectives'>, sit: Pick<Situation, 'paper' | 'costs'>): boolean {
  const planes = AIRCRAFT_ORDER.filter((id) => sit.costs[id] <= sit.paper).map((id) => AIRCRAFT[id]);
  // With nothing affordable, the free emergency Dart is what there is.
  if (planes.length === 0) planes.push(emergencyDart());
  return planes.some((p) => assessSuitability(p, spec).level !== 'unsuitable');
}

function needsTarget(type: MissionType): boolean {
  return type !== 'rings';
}

function weightedPick<T extends { weight: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  let roll = rng() * total;
  for (const item of items) if ((roll -= Math.max(0, item.weight)) <= 0) return item;
  return items[items.length - 1];
}

export type { Payout, StageRecipe };

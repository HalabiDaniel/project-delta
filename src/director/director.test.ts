import { describe, expect, it } from 'vitest';
import { assessSuitability } from '../aircraft/Aircraft';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT, AIRCRAFT_ORDER, DIRECTOR, OPERATIONS, TIERS, type AircraftId } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import { threatOf, type MissionContext } from '../missions/MissionGenerator';
import { emergencyDart } from '../systems/GameState';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { flyable, mainTarget, MissionDirector, SLOTS, type Situation } from './MissionDirector';
import { abandon, finishStage, openStage, planOperation, remainingRewards, type StageResult } from './Operations';
import { isStruggling, nextSkill, performanceRating, PerformanceTracker, PROFILE_IDS, simulatedProfile, type MissionRecord } from './Performance';
import { categoryOf } from './Templates';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const baseCtx: MissionContext = {
  territories,
  homeId: home.id,
  launch: { x: home.x + 8, z: home.z + 8 },
  dummies: range.filter((s) => s.kind === 'dummy'),
  obstacles: [],
  installations: layout.installations,
};

const costs = (over: Partial<Record<AircraftId, number>> = {}) =>
  Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, over[id] ?? AIRCRAFT[id].cost])) as Record<AircraftId, number>;

function director(seed = 1, sit: Partial<Situation> = {}, ctx: () => MissionContext = () => baseCtx) {
  const situation: Situation = { paper: 100, costs: costs(), airRoom: 4, raidActive: false, ...sit };
  return { d: new MissionDirector(ctx, () => situation, seededRng(seed), () => 0), situation };
}

const record = (over: Partial<MissionRecord> = {}): MissionRecord => ({
  type: 'bombing', tier: 'medium', success: true, failure: null, lost: false, landed: true, damageDealt: 50, damageTaken: 0.2,
  time: 40, par: 50, shotsFired: 40, shotsHit: 12, aircraft: 'falcon', reward: 60, medal: 'silver', ...over,
});

const result = (over: Partial<StageResult> = {}): StageResult => ({ success: true, recovered: true, damageTaken: 0.1, time: 30, par: 60, reward: 50, ...over });

describe('MissionDirector: the deal', () => {
  it('deals a safe, a balanced and a risky card of different categories, all flyable', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { d, situation } = director(seed);
      const cards = d.deal();
      expect(cards).toHaveLength(3);
      expect(d.offers.map((o) => o.slot)).toEqual(['safe', 'balanced', 'risky']);
      expect(new Set(cards.map((m) => categoryOf(m.spec.type))).size).toBe(3);
      for (const m of cards) expect(flyable(m.spec, situation)).toBe(true);
      expect(cards[0].tier).toBe('easy');
    }
  });

  it('the safe card stays easy even for an ace; harder cards come with skill', () => {
    const average = (skill: number, slot: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const { d } = director(seed);
        d.performance.skill = skill;
        sum += TIERS[d.deal()[slot].tier].index;
      }
      return sum / 40;
    };
    expect(average(1, 0)).toBe(0);
    expect(average(0, 1)).toBeLessThan(average(1, 1));
    expect(average(0, 2)).toBeLessThan(average(1, 2));
    expect(average(1, 2)).toBeGreaterThan(2.5);
    expect(average(0, 2)).toBeLessThan(2);
  });

  it('a very hard card is hard content with at least one escalation, paid at 2.5×', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { d } = director(seed);
      d.performance.skill = 1;
      for (const m of d.deal()) {
        if (m.tier !== 'veryhard') continue;
        seen++;
        expect(m.spec.difficulty).toBe('hard');
        expect(m.spec.modifiers?.some((x) => ['wingman', 'escorted', 'extra-target', 'return', 'tight-clock'].includes(x))).toBe(true);
        expect(m.spec.rewardParts?.difficulty).toBe(2.5);
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it('explains every card and records the offers', () => {
    const { d } = director(3);
    d.deal();
    for (const o of d.offers) expect(o.reasons.length).toBeGreaterThan(1);
    expect(d.history.filter((h) => h.kind === 'offered')).toHaveLength(3);
    expect(d.analysis.get('balanced')!.candidates.length).toBeGreaterThan(10);
  });
});

describe('MissionDirector: eligibility', () => {
  it('never offers aircraft that cannot go up, or a raid interception while a raid is on', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { d } = director(seed, { airRoom: 1, raidActive: true });
      for (const m of d.deal()) {
        expect(m.spec.aircraft?.length ?? 0).toBeLessThanOrEqual(1);
        expect(m.spec.type).not.toBe('bomber-intercept');
      }
    }
  });

  it('a broke player only gets missions the free emergency Dart can fly (no bombs needed)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { d } = director(seed, { paper: 4 });
      for (const m of d.deal()) expect(assessSuitability(emergencyDart(), m.spec).level).not.toBe('unsuitable');
    }
  });

  it('never asks for more bombs than an affordable plane carries', () => {
    for (let seed = 1; seed <= 30; seed++) {
      // Only the Dart (one mini bomb) is affordable.
      const { d } = director(seed, { paper: 12 });
      for (const m of d.deal()) expect(m.objectives.filter((o) => o.kind === 'bomb').length).toBeLessThanOrEqual(1);
    }
  });

  it('cards whose target is destroyed are replaced; the rest stay', () => {
    let installations = layout.installations;
    const ctx = () => ({ ...baseCtx, installations });
    for (let seed = 1; seed <= 60; seed++) {
      const { d } = director(seed, {}, ctx);
      installations = layout.installations;
      d.performance.skill = 0.6;
      const cards = d.deal();
      const victim = cards.findIndex((m) => m.objectives.some((o) => o.kind === 'destroy' && o.what !== 'practice'));
      if (victim < 0) continue;
      const o = cards[victim].objectives.find((x) => x.kind === 'destroy')!;
      if (o.kind !== 'destroy') continue;
      installations = layout.installations.filter((i) => !o.targets.includes(i.id));
      expect(d.validate()).toBe(true);
      expect(d.missions[victim]).not.toBe(cards[victim]);
      cards.forEach((m, i) => i !== victim && expect(d.missions[i]).toBe(m));
      expect(d.history.some((h) => h.kind === 'invalid')).toBe(true);
      return;
    }
    throw new Error('no destroy mission dealt');
  });
});

describe('MissionDirector: recovery and variety', () => {
  it('after losses, the safe card is a recovery mission on unprotected ground that pays for a plane', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { d } = director(seed);
      for (let i = 0; i < 3; i++) d.performance.record(record({ success: false, lost: true, landed: false, failure: 'aircraft-lost' }));
      const safe = d.deal()[0];
      expect(d.offers[0].source).toBe('recovery');
      expect(safe.spec.modifiers).toContain('recovery');
      expect(safe.reward).toBeGreaterThanOrEqual(DIRECTOR.recoveryReward);
      expect(safe.spec.aircraft?.length ?? 0).toBe(0);
      for (const o of safe.objectives) if ('territoryId' in o && o.kind !== 'land') expect(threatOf(territories.find((t) => t.id === o.territoryId)!, baseCtx)).toBe(0);
      if (safe.spec.type === 'practice') expect(safe.objectives[0].kind === 'destroy' && safe.objectives[0].count).toBe(1);
      // The balanced card is capped at medium while recovering.
      expect(TIERS[d.missions[1].tier].index).toBeLessThanOrEqual(1);
    }
  });

  it('a run of bombing missions makes other categories more likely', () => {
    const share = (recent: boolean) => {
      let bombing = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const { d } = director(seed);
        if (recent) for (let i = 0; i < 3; i++) d.recent.push({ type: 'bombing', target: `T${i + 5}` });
        for (const m of d.deal()) {
          total++;
          if (categoryOf(m.spec.type) === 'bombing') bombing++;
        }
      }
      return bombing / total;
    };
    expect(share(true)).toBeLessThan(share(false) * 0.6);
  });

  it('never offers the mission just flown again as it was', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { d } = director(seed);
      d.deal();
      const flown = d.missions[0];
      d.afterSortie(flown, record({ type: flown.spec.type }), result());
      const again = d.missions.find((m) => m.spec.type === flown.spec.type && mainTarget(m.spec) === mainTarget(flown.spec));
      expect(again).toBeUndefined();
    }
  });
});

describe('MissionDirector: refresh and history', () => {
  it('after a sortie only the flown card is replaced, and a swap comes back', () => {
    const { d } = director(5);
    const cards = d.deal();
    d.swaps = 1;
    d.afterSortie(cards[1], record(), result());
    expect(d.missions[0]).toBe(cards[0]);
    expect(d.missions[2]).toBe(cards[2]);
    expect(d.missions[1]).not.toBe(cards[1]);
    expect(d.swaps).toBe(2);
    expect(d.history.map((h) => h.kind)).toContain('completed');
  });

  it('swaps are limited and never deal the same type back', () => {
    const { d } = director(7);
    d.deal();
    for (let i = 0; i < DIRECTOR.swaps.start; i++) {
      const before = d.missions[2];
      const after = d.swap(2);
      expect(after).not.toBeNull();
      expect(after!.spec.type).not.toBe(before.spec.type);
    }
    expect(d.swap(2)).toBeNull();
    expect(d.swaps).toBe(0);
  });

  it('the developer can force a mission into a slot; a forced very hard one is escalated too', () => {
    const { d } = director(11);
    d.deal();
    const m = d.force(2, { type: 'dogfight', tier: 'veryhard', target: 'T6' })!;
    expect(d.missions[2]).toBe(m);
    expect(d.offers[2].source).toBe('forced');
    expect(m.objectives[0].kind === 'intercept' && m.objectives[0].territoryId).toBe('T6');
    expect(m.spec.modifiers?.length).toBeGreaterThan(0);
  });

  it('saves and restores the same cards', () => {
    const { d } = director(9);
    d.deal();
    d.performance.record(record());
    const saved = JSON.parse(JSON.stringify(d.save()));
    const { d: e } = director(99);
    e.load(saved);
    expect(e.missions.map((m) => m.title)).toEqual(d.missions.map((m) => m.title));
    expect(e.missions.map((m) => m.reward)).toEqual(d.missions.map((m) => m.reward));
    expect(e.performance.records).toHaveLength(1);
  });
});

describe('Performance', () => {
  it('rates recent missions, the newest counting most', () => {
    const good = Array.from({ length: 8 }, () => record({ tier: 'hard' }));
    const bad = Array.from({ length: 8 }, () => record({ success: false, lost: true, landed: false, damageTaken: 1, failure: 'aircraft-lost' }));
    expect(performanceRating(good).rating).toBeGreaterThan(0.75);
    expect(performanceRating(bad).rating).toBeLessThan(0.25);
    expect(performanceRating([...bad, ...good.slice(0, 3)]).rating).toBeGreaterThan(performanceRating([...good.slice(0, 3), ...bad]).rating);
  });

  it('skill waits for a few missions, then moves gradually: one sortie never jumps it', () => {
    const t = new PerformanceTracker();
    t.record(record({ tier: 'veryhard' }));
    t.record(record({ tier: 'veryhard' }));
    expect(t.skill).toBe(DIRECTOR.skill.start);
    let last = t.skill;
    for (let i = 0; i < 10; i++) {
      t.record(record({ tier: 'veryhard', medal: 'gold' }));
      expect(t.skill - last).toBeLessThanOrEqual(DIRECTOR.skill.maxStep + 1e-9);
      expect(t.skill).toBeGreaterThanOrEqual(last);
      last = t.skill;
    }
    expect(t.skill).toBeGreaterThan(0.5);
    expect(nextSkill(0.5, [record()])).toBe(0.5);
  });

  it('spots a struggling player', () => {
    expect(isStruggling([record(), record({ lost: true, success: false }), record({ lost: true, success: false })])).toBe(true);
    expect(isStruggling([record(), record(), record({ success: false })])).toBe(false);
  });

  it('simulated profiles land in order of skill', () => {
    const skills = PROFILE_IDS.map((id) => simulatedProfile(id).skill);
    expect(skills[1]).toBeLessThan(skills[2]); // struggling < average
    expect(skills[2]).toBeLessThan(skills[3]); // average < successful
    expect(skills[3]).toBeLessThanOrEqual(skills[4] + 1e-9); // successful ≤ veteran
    expect(simulatedProfile('struggling').records.length).toBeGreaterThan(0);
    expect(isStruggling(simulatedProfile('struggling').records)).toBe(true);
  });
});

describe('Operations', () => {
  const estimate = (seed: number) => {
    const { d } = director(seed);
    return d;
  };

  it('plans three stages against one territory, with a bonus on top', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const op = planOperation(baseCtx, 'medium', seededRng(seed), () => 60);
      expect(op).not.toBeNull();
      expect(op!.stages).toHaveLength(3);
      expect(op!.stages.every((s) => s.recipe.target === op!.territoryId)).toBe(true);
      expect(op!.bonus).toBeGreaterThanOrEqual(OPERATIONS.minBonus);
      expect(openStage(op!)).toBe(0);
    }
    expect(estimate(1)).toBeTruthy();
  });

  it('a stage unlocks the next; finishing all pays the bonus; a failed stage can be tried again', () => {
    const op = planOperation(baseCtx, 'medium', seededRng(3), () => 50)!;
    expect(finishStage(op, 0, result({ success: false }))).toEqual([]);
    expect(openStage(op)).toBe(0);
    expect(op.status).toBe('active');
    const first = finishStage(op, 0, result());
    expect(openStage(op)).toBe(1);
    expect(first.length).toBeGreaterThanOrEqual(0);
    finishStage(op, 1, result({ damageTaken: 0.9 }));
    expect(op.stages[1].optional.met).toBe(false);
    const last = finishStage(op, 2, result());
    expect(op.status).toBe('completed');
    expect(last.some((p) => p.amount === op.bonus)).toBe(true);
    expect(remainingRewards(op)).toBe(0);
  });

  it('abandoning keeps what was earned but forfeits the bonus', () => {
    const op = planOperation(baseCtx, 'hard', seededRng(4), () => 80)!;
    finishStage(op, 0, result({ reward: 80 }));
    const earned = op.earned;
    abandon(op);
    expect(op.status).toBe('abandoned');
    expect(op.earned).toBe(earned);
    expect(finishStage(op, 1, result())).toEqual([]);
  });

  it('the director offers operations once the player has some experience, and keeps the stage card on the board', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { d } = director(seed);
      d.completedMissions = OPERATIONS.afterMissions;
      d.deal();
      const offer = d.offers.find((o) => o.source === 'operation');
      if (!offer) continue;
      expect(offer.slot).toBe('balanced');
      expect(offer.mission.spec.codename).toBe(d.operation!.codename);
      d.accepted(offer.mission);
      expect(d.operation!.status).toBe('active');
      expect(d.canSwap(1)).toBe(false);
      d.afterSortie(offer.mission, record(), result({ success: false }));
      // Still stage 1, on a fresh card.
      expect(d.offers[1].source).toBe('operation');
      expect(d.offers[1].stage).toBe(0);
      d.afterSortie(d.offers[1].mission, record(), result());
      expect(d.offers[1].stage).toBe(1);
      expect(d.abandonOperation()).toBe(true);
      expect(d.offers[1].source).not.toBe('operation');
      expect(d.history.some((h) => h.kind === 'abandoned')).toBe(true);
      return;
    }
    throw new Error('no operation offered in 60 deals');
  });
});

describe('flyable', () => {
  it('looks at what the player can get onto the pad', () => {
    const spec = { type: 'multi-bomb' as const, bombs: 3, objectives: [{ kind: 'bomb' as const, territoryId: 'T5', zone: { x: 0, z: 0, radius: 5, top: 0 }, precision: false }, { kind: 'bomb' as const, territoryId: 'T6', zone: { x: 0, z: 0, radius: 5, top: 0 }, precision: false }] };
    expect(flyable(spec, { paper: 100, costs: costs() })).toBe(true);
    expect(flyable(spec, { paper: 20, costs: costs() })).toBe(false);
    expect(flyable(spec, { paper: 20, costs: costs({ widewing: 10 }) })).toBe(true);
  });
  it('covers every slot', () => {
    expect(SLOTS).toEqual(['safe', 'balanced', 'risky']);
  });
});

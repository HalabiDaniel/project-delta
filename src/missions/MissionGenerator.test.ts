import { describe, expect, it } from 'vitest';
import { MISSIONS, THREAT, WORLD, type Difficulty } from '../config';
import { seededRng } from '../systems/Random';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { layoutDefenses } from '../defenses/Layout';
import { generateTerritories } from '../world/WorldGenerator';
import { insideAirspace, type Objective } from './Mission';
import {
  DEFENSE_TYPES,
  generateMission,
  generateOffers,
  MISSION_TYPES,
  missionReward,
  missionThreat,
  supports,
  threatWindow,
  type MissionContext,
} from './MissionGenerator';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const dummies = range.filter((s) => s.kind === 'dummy');
const defenses = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const installations = defenses.installations;
const obstacles = [
  ...range.flatMap((s) => s.shapes.map(footprint)),
  ...installations.map((i) => ({ x: i.x, z: i.z, r: i.footprint })),
];
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies, obstacles, installations };
const threatOf = (id: string) => territories.find((t) => t.id === id)!.threat;
/** Territories with objectives on them (not the landing at home). */
const objectiveTerritories = (objectives: readonly Objective[]) =>
  objectives.flatMap((o) => ('territoryId' in o && o.kind !== 'land' ? [o.territoryId] : []));

describe('generateOffers', () => {
  it('offers three cards with different types and one of each difficulty', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const offers = generateOffers(ctx, seededRng(seed));
      expect(offers).toHaveLength(MISSIONS.offers);
      expect(new Set(offers.map((m) => m.spec.type)).size).toBe(3);
      expect(offers.map((m) => m.spec.difficulty).sort()).toEqual(['easy', 'hard', 'medium']);
      for (const m of offers) expect(m.status).toBe('available');
    }
  });

  it('always includes a mission against the defenses, and an easy card on safe or lightly defended ground', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const offers = generateOffers(ctx, seededRng(seed));
      expect(offers.some((m) => DEFENSE_TYPES.includes(m.spec.type))).toBe(true);
      const easy = offers.find((m) => m.spec.difficulty === 'easy')!;
      for (const id of objectiveTerritories(easy.objectives)) expect(threatOf(id)).toBeLessThanOrEqual(1);
      for (const m of offers) expect(m.spec.codename).toMatch(/^Operation \w+ \w+$/);
    }
  });

  it('over many offers, targets cover T2–T9 and never home', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of generateOffers(ctx, seededRng(seed))) {
        for (const o of m.objectives) {
          if (o.kind === 'bomb' || o.kind === 'recon' || o.kind === 'reach' || o.kind === 'destroy') targets.add(o.territoryId);
        }
      }
    }
    expect([...targets].sort()).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
  });
});

describe('generateMission', () => {
  const each = (fn: (type: (typeof MISSION_TYPES)[number], difficulty: Difficulty, seed: number) => void) => {
    for (const type of MISSION_TYPES) for (const difficulty of ['easy', 'medium', 'hard'] as const) for (let seed = 1; seed <= 15; seed++) fn(type, difficulty, seed);
  };

  it('without practice planes in the world, target practice is never offered', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const offers = generateOffers({ territories, homeId: home.id, launch: ctx.launch }, seededRng(seed));
      expect(offers.some((m) => m.spec.type === 'practice')).toBe(false);
    }
  });

  it('target practice asks for the practice planes on one territory, timed only on hard', () => {
    each((type, difficulty, seed) => {
      if (type !== 'practice') return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      expect(spec.bombs).toBe(0);
      expect(spec.timeLimit !== null).toBe(difficulty === 'hard');
      const o = spec.objectives[0];
      expect(o.kind).toBe('destroy');
      if (o.kind !== 'destroy') return;
      expect(o.count).toBe(MISSIONS.practiceCount[difficulty]);
      expect(o.targets).toHaveLength(3);
      for (const id of o.targets) expect(dummies.find((d) => d.id === id)?.territoryId).toBe(o.territoryId);
    });
  });

  it('bombing missions offer one bomb per target, plus spares on easier difficulties', () => {
    each((type, difficulty, seed) => {
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const bullseyes = spec.objectives.filter((o) => o.kind === 'bomb').length;
      // Structures to knock down take a bomb too: one for the mission, plus spares.
      const structures = spec.objectives.some((o) => o.kind === 'destroy' && (o.what === 'defense' || o.what === 'supply')) ? 1 : 0;
      const targets = bullseyes || structures;
      expect(spec.bombs).toBe(targets === 0 ? 0 : targets + MISSIONS.spareBombs[difficulty]);
    });
  });

  it("targets lie in the difficulty's threat window, and missions against defenses only go where there are some", () => {
    each((type, difficulty, seed) => {
      // Ring courses aren't aimed at a territory; their threat comes from the weapons they pass (below).
      if (!supports(type, difficulty, ctx) || type === 'rings') return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const [lo, hi] = threatWindow(type, difficulty);
      for (const id of objectiveTerritories(spec.objectives)) {
        expect(threatOf(id)).toBeGreaterThanOrEqual(lo);
        expect(threatOf(id)).toBeLessThanOrEqual(hi);
      }
      expect(spec.threat?.level).toBe(Math.max(0, ...objectiveTerritories(spec.objectives).map(threatOf)));
    });
    // Strikes on depots need guarded ground or worse: never an easy card.
    expect(supports('fortified', 'easy', ctx)).toBe(false);
    expect(supports('multi-stage', 'easy', ctx)).toBe(false);
    expect(supports('fortified', 'hard', ctx)).toBe(true);
  });

  it('missions against defenses point at real installations on their territory', () => {
    each((type, difficulty, seed) => {
      if (!DEFENSE_TYPES.includes(type)) return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      for (const o of spec.objectives) {
        if (o.kind !== 'destroy') continue;
        for (const id of o.targets) expect(installations.find((i) => i.id === id)?.territoryId).toBe(o.territoryId);
        expect(o.count).toBeLessThanOrEqual(o.targets.length);
      }
      switch (type) {
        case 'suppression': {
          const o = spec.objectives[0];
          if (o.kind !== 'destroy') throw new Error('expected destroy');
          const kinds = o.targets.map((id) => installations.find((i) => i.id === id)!.kind);
          expect(kinds.every((k) => k === 'turret' || k === 'launcher')).toBe(true);
          if (difficulty === 'easy') expect(o.count).toBe(1);
          if (difficulty === 'hard') expect(o.targets.length).toBe(installations.filter((i) => i.territoryId === o.territoryId && (i.kind === 'turret' || i.kind === 'launcher')).length);
          break;
        }
        case 'danger-recon':
          expect(spec.ordered).toBe(true);
          expect(spec.objectives.map((o) => o.kind)).toEqual(['recon', 'escape']);
          break;
        case 'multi-stage':
          expect(spec.ordered).toBe(true);
          expect(spec.objectives.map((o) => (o.kind === 'destroy' ? o.what : o.kind))).toEqual(['radar', 'supply', 'land']);
          break;
        case 'fortified':
          expect(spec.objectives).toMatchObject([{ kind: 'destroy', what: 'supply', count: 1 }]);
          break;
        case 'survival':
          expect(spec.objectives).toMatchObject([{ kind: 'survive', duration: MISSIONS.survivalTime[difficulty] }]);
          break;
        case 'low-attack':
          expect(spec.objectives).toMatchObject([{ kind: 'bomb', approach: { ceiling: MISSIONS.lowCeiling[difficulty], radius: MISSIONS.lowApproachRadius } }]);
          break;
      }
    });
  });

  it('a dangerous reconnaissance escape lies beyond the reach of every weapon on the territory', () => {
    each((type, difficulty, seed) => {
      if (type !== 'danger-recon') return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const escape = spec.objectives[1];
      if (escape.kind !== 'escape') throw new Error('expected escape');
      for (const w of installations.filter((i) => i.territoryId === escape.territoryId && (i.kind === 'turret' || i.kind === 'launcher'))) {
        expect(escape.distance).toBeGreaterThan(Math.hypot(w.x - escape.x, w.z - escape.z) + w.range);
      }
    });
  });

  it('precision spots are small and stay on their territory', () => {
    each((type, difficulty, seed) => {
      if (type !== 'precision') return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const o = spec.objectives[0];
      expect(o.kind).toBe('bomb');
      if (o.kind !== 'bomb') return;
      const t = territories.find((x) => x.id === o.territoryId)!;
      expect(o.precision).toBe(true);
      expect(o.zone.radius).toBe(MISSIONS.precisionRadius[difficulty]);
      expect(t.containsXZ(o.zone.x, o.zone.z, -o.zone.radius)).toBe(true);
      // Clear of props and pencil stands, so nothing stands in the bomb's way.
      for (const f of obstacles) expect(Math.hypot(f.x - o.zone.x, f.z - o.zone.z)).toBeGreaterThanOrEqual(f.r + o.zone.radius);
    });
  });

  it('multi-target missions hit two different territories; return missions end by landing at home', () => {
    each((type, difficulty, seed) => {
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      if (type === 'multi-bomb') {
        const ids = spec.objectives.map((o) => ('territoryId' in o ? o.territoryId : ''));
        expect(new Set(ids).size).toBe(2);
      }
      if (type === 'return') {
        expect(spec.ordered).toBe(true);
        expect(spec.objectives.map((o) => o.kind)).toEqual(['bomb', 'land']);
        expect(spec.objectives[1]).toMatchObject({ territoryId: WORLD.homeId });
      }
    });
  });

  it('deliveries are timed, with less slack on harder difficulties', () => {
    // One possible target, so only the slack differs.
    const one: MissionContext = { ...ctx, territories: territories.filter((t) => t.isHome || t.id === 'T5') };
    const limits = (['easy', 'medium', 'hard'] as const).map((d) => generateMission('delivery', d, one, seededRng(7)).timeLimit!);
    expect(limits[0]).toBeGreaterThan(limits[1]);
    expect(limits[1]).toBeGreaterThan(limits[2]);
  });

  it('ring courses fly over the gaps, never through a platform, at a sensible height', () => {
    each((type, difficulty, seed) => {
      if (type !== 'rings') return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      expect(spec.objectives).toHaveLength(MISSIONS.ringCount[difficulty]);
      expect(spec.timeLimit !== null).toBe(difficulty === 'hard');
      let prev: { x: number; z: number } | null = null;
      for (const o of spec.objectives) {
        expect(o.kind).toBe('ring');
        if (o.kind !== 'ring') continue;
        const g = o.gate;
        expect(g.y).toBeGreaterThanOrEqual(MISSIONS.ringMinHeight);
        expect(g.y).toBeLessThanOrEqual(MISSIONS.ringMaxHeight);
        for (const t of territories) expect(insideAirspace({ x: t.x, z: t.z, half: t.half, ceiling: 1000 }, g)).toBe(false);
        if (prev) expect(Math.hypot(g.x - prev.x, g.z - prev.z)).toBeCloseTo((WORLD.territorySize + WORLD.gap) / 2);
        prev = g;
      }
    });
  });
});

describe('missionReward', () => {
  it('harder and longer missions pay more, in multiples of 5', () => {
    for (const type of MISSION_TYPES) {
      const easy = missionReward(type, 'easy', 100);
      const medium = missionReward(type, 'medium', 100);
      const hard = missionReward(type, 'hard', 100);
      expect(easy).toBeLessThan(medium);
      expect(medium).toBeLessThan(hard);
      expect(missionReward(type, 'easy', 200)).toBeGreaterThan(easy);
      for (const r of [easy, medium, hard]) expect(r % 5).toBe(0);
    }
  });

  it('every mission pays more than a mid-priced plane costs', () => {
    for (const type of MISSION_TYPES) expect(missionReward(type, 'easy', 50)).toBeGreaterThan(25);
  });

  it('danger pays: more for heavier defenses, and more for types that keep you under fire longer', () => {
    for (const type of MISSION_TYPES) {
      expect(missionReward(type, 'medium', 100, [2])).toBeGreaterThan(missionReward(type, 'medium', 100, [0]));
      expect(missionReward(type, 'medium', 100, [3])).toBeGreaterThanOrEqual(missionReward(type, 'medium', 100, [2]));
    }
    const bonus = (type: 'survival' | 'delivery') => missionReward(type, 'medium', 100, [3]) - missionReward(type, 'medium', 100, [0]);
    expect(bonus('survival')).toBeGreaterThan(bonus('delivery'));
    // …but distance and the job itself still matter: danger is not the whole reward.
    expect(THREAT.rewardBonus[3]).toBeLessThan(MISSIONS.baseReward.fortified);
  });

  it('a ring course near defended ground says so', () => {
    const near = installations.find((i) => i.kind === 'turret')!;
    const gate = { x: near.x + 10, y: 12, z: near.z, yaw: 0, radius: 4 };
    const far = { x: 500, y: 12, z: 500, yaw: 0, radius: 4 };
    expect(missionThreat([{ kind: 'ring', gate, number: 1 }], ctx).territories).toContain(near.territoryId);
    expect(missionThreat([{ kind: 'ring', gate: far, number: 1 }], ctx)).toMatchObject({ level: 0, territories: [] });
  });
});

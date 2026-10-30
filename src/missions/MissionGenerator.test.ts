import { describe, expect, it } from 'vitest';
import { MISSIONS, WORLD, type Difficulty } from '../config';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { insideAirspace } from './Mission';
import { generateMission, generateOffers, MISSION_TYPES, missionReward, type MissionContext } from './MissionGenerator';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 } };

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

  it('over many offers, targets cover T2–T9 and never home', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of generateOffers(ctx, seededRng(seed))) {
        for (const o of m.objectives) {
          if (o.kind === 'bomb' || o.kind === 'recon' || o.kind === 'reach') targets.add(o.territoryId);
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

  it('bombing missions carry one bomb per target, plus a spare unless hard', () => {
    each((type, difficulty, seed) => {
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const targets = spec.objectives.filter((o) => o.kind === 'bomb').length;
      expect(spec.bombs).toBe(targets === 0 ? 0 : targets + MISSIONS.spareBombs[difficulty]);
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
    const limits = (['easy', 'medium', 'hard'] as const).map((d) => generateMission('delivery', d, ctx, seededRng(7)).timeLimit!);
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

  it('every mission pays more than a new plane costs', () => {
    for (const type of MISSION_TYPES) expect(missionReward(type, 'easy', 50)).toBeGreaterThan(20);
  });
});

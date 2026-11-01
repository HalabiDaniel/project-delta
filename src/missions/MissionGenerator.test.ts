import { describe, expect, it } from 'vitest';
import { MISSIONS, THREAT, WORLD, type Difficulty } from '../config';
import { seededRng } from '../systems/Random';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { buildingSpec, layoutDefenses } from '../defenses/Layout';
import { generateTerritories } from '../world/WorldGenerator';
import { insideAirspace, type Objective } from './Mission';
import { AI, DEFENSES } from '../config';
import { floorAt } from '../ai/Navigation';
import {
  AIR_TYPES,
  DEFENSE_TYPES,
  generateMission,
  generateOffers,
  MISSION_TYPES,
  missionReward,
  missionThreat,
  rewardParts,
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

  it('over many offers, targets cover T2–T16 and never home', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of generateOffers(ctx, seededRng(seed))) {
        for (const o of m.objectives) {
          if (o.kind === 'bomb' || o.kind === 'recon' || o.kind === 'reach' || o.kind === 'destroy') targets.add(o.territoryId);
        }
      }
    }
    expect([...targets].sort()).toEqual(Array.from({ length: 15 }, (_, i) => `T${i + 2}`).sort());
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

describe('missions in the air', () => {
  const each = (fn: (type: (typeof AIR_TYPES)[number], difficulty: Difficulty, seed: number) => void) => {
    for (const type of AIR_TYPES) for (const difficulty of ['easy', 'medium', 'hard'] as const) for (let seed = 1; seed <= 10; seed++) fn(type, difficulty, seed);
  };

  it('every deal includes a mission in the air', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const offers = generateOffers(ctx, seededRng(seed));
      expect(offers.some((m) => AIR_TYPES.includes(m.spec.type))).toBe(true);
    }
  });

  it('send up the aircraft their objectives are about, with unique ids, at their own skill', () => {
    const ids = new Set<string>();
    each((type, difficulty, seed) => {
      if (!supports(type, difficulty, ctx)) return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const spawned = (spec.aircraft ?? []).map((a) => a.orders);
      expect(spawned.length).toBeGreaterThan(0);
      expect(spawned.length).toBeLessThanOrEqual(AI.maxActive - 1);
      for (const o of spawned) {
        expect(ids.has(o.id)).toBe(false);
        ids.add(o.id);
        // Enemy pilots are never better than the card says (patrol scouts are a step easier).
        if (o.side === 'enemy') expect(['easy', 'medium', 'hard'].indexOf(o.skill)).toBeLessThanOrEqual(['easy', 'medium', 'hard'].indexOf(difficulty));
        expect(o.route.length).toBeGreaterThanOrEqual(2);
      }
      for (const o of spec.objectives) {
        if (o.kind === 'intercept') for (const id of o.targets) expect(spawned.some((a) => a.id === id && a.side === 'enemy')).toBe(true);
        if (o.kind === 'escort') expect(spawned.find((a) => a.id === o.escort)).toMatchObject({ side: 'player', role: 'bomber', strike: { x: o.zone.x, z: o.zone.z } });
      }

    });
  });

  it('routes keep a safe height over the platforms', () => {
    each((type, difficulty, seed) => {
      if (!supports(type, difficulty, ctx)) return;
      for (const a of generateMission(type, difficulty, ctx, seededRng(seed)).aircraft ?? []) {
        for (const p of a.orders.route.slice(1)) expect(p.y).toBeGreaterThanOrEqual(floorAt(territories, p.x, p.z) - 0.01);
      }
    });
  });

  it('bomber interceptions go for the paper store on home, from further off and escorted on harder cards', () => {
    const store = installations.find((i) => i.territoryId === home.id && i.kind === 'supply')!;
    const dist = (d: Difficulty) => {
      const spec = generateMission('bomber-intercept', d, ctx, seededRng(1));
      const bomber = spec.aircraft![0].orders;
      expect(bomber.strike).toMatchObject({ territoryId: home.id, x: store.x, z: store.z });
      expect(spec.objectives).toMatchObject([{ kind: 'intercept', what: 'bomber', before: 'release' }]);
      expect(spec.aircraft!.every((a) => a.raid)).toBe(true);
      expect(spec.aircraft!.length).toBe(d === 'hard' ? 2 : 1);
      return Math.hypot(bomber.route[0].x - home.x, bomber.route[0].z - home.z);
    };
    expect(dist('easy')).toBeLessThan(dist('hard'));
  });

  it('escorts and patrols stay out of fortified ground, patrols reach above the turrets, and enemy pilots pay', () => {
    each((type, difficulty, seed) => {
      if ((type !== 'escort' && type !== 'patrol') || !supports(type, difficulty, ctx)) return;
      const spec = generateMission(type, difficulty, ctx, seededRng(seed));
      const o = spec.objectives[0];
      expect(threatOf('territoryId' in o ? o.territoryId : '')).toBeLessThanOrEqual(2);
    });
    expect(MISSIONS.patrolCeiling).toBeGreaterThan(DEFENSES.turret.pivot + DEFENSES.turret.range);
    expect(missionReward('dogfight', 'medium', 100, [], ['hard'])).toBeGreaterThan(missionReward('dogfight', 'medium', 100, [], ['easy']));
    expect(missionReward('dogfight', 'medium', 100, [], ['easy'])).toBeGreaterThan(missionReward('dogfight', 'medium', 100));
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

  it('rewards fall in the cost-to-reward bands: a Dart job pays 25+, a medium one a Falcon twice over, a hard one a Widewing', () => {
    const rewards = (tier: 'easy' | 'medium' | 'hard') => {
      const out: number[] = [];
      for (const type of MISSION_TYPES) {
        if (!supports(type, tier, ctx)) continue;
        for (let seed = 1; seed <= 12; seed++) out.push(generateMission(type, tier, ctx, seededRng(seed)).reward);
      }
      return out.sort((a, b) => a - b);
    };
    const median = (r: number[]) => r[Math.floor(r.length / 2)];
    const easy = rewards('easy');
    const medium = rewards('medium');
    const hard = rewards('hard');
    // Easy work always beats the price of a Dart twice over, and stays below a medium job.
    expect(easy[0]).toBeGreaterThanOrEqual(25);
    expect(median(easy)).toBeLessThanOrEqual(55);
    // Medium: a Falcon's mission pays 50–100 or so; hard: a Widewing's 75–150 or so.
    expect(median(medium)).toBeGreaterThanOrEqual(50);
    expect(median(medium)).toBeLessThanOrEqual(100);
    expect(median(hard)).toBeGreaterThanOrEqual(75);
    expect(median(hard)).toBeLessThanOrEqual(150);
    expect(hard[hard.length - 1]).toBeLessThanOrEqual(200);
  });

  it('reward = B × D × M: a very hard tier pays 2.5×, modifiers multiply, a recovery mission has a floor', () => {
    const parts = rewardParts('bombing', 'veryhard', 100, [2], ['hard'], ['tight-clock', 'alert']);
    expect(parts.difficulty).toBe(2.5);
    expect(parts.modifier).toBeCloseTo(1.1 * 1.2);
    expect(parts.base).toBeCloseTo(MISSIONS.baseReward.bombing + 100 * MISSIONS.distanceReward + THREAT.rewardBonus[2] + MISSIONS.airBonus.hard);
    expect(missionReward('bombing', 'veryhard', 100, [2], ['hard'], ['tight-clock', 'alert'])).toBe(Math.round((parts.base * 2.5 * 1.32) / 5) * 5);
    expect(missionReward('recon', 'easy', 10, [], [], ['recovery'])).toBe(30);
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
    const near = installations.find((i) => i.kind === 'turret' && i.side === 'enemy')!;
    const gate = { x: near.x + 10, y: 12, z: near.z, yaw: 0, radius: 4 };
    const far = { x: 500, y: 12, z: 500, yaw: 0, radius: 4 };
    expect(missionThreat([{ kind: 'ring', gate, number: 1 }], ctx).territories).toContain(near.territoryId);
    expect(missionThreat([{ kind: 'ring', gate: far, number: 1 }], ctx)).toMatchObject({ level: 0, territories: [] });
    // T1's own guns are no threat to the player.
    const homeT = ctx.territories.find((t) => t.isHome)!;
    const own = buildingSpec(homeT, 'D1', 'turret', 1);
    const withOwn = { ...ctx, installations: [...(ctx.installations ?? []), own] };
    expect(missionThreat([{ kind: 'ring', gate: { ...gate, x: own.x + 10, z: own.z }, number: 1 }], withOwn).territories).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import type { MissionContext } from '../missions/MissionGenerator';
import { generateTerritories } from '../world/WorldGenerator';
import { PROFILE_IDS } from './Performance';
import { simulateEconomy } from './Simulation';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies: range.filter((s) => s.kind === 'dummy'), obstacles: [], installations: layout.installations };

const run = (profile: (typeof PROFILE_IDS)[number], seed: number, strategy: 'fly' | 'abandon' = 'fly', missions = 40) =>
  simulateEconomy({ profile, missions, seed, ctx, strategy });

describe('Economy simulation', () => {
  it('every profile always has a card it can fly, whatever happens', () => {
    for (const profile of PROFILE_IDS) for (let seed = 1; seed <= 5; seed++) expect(run(profile, seed).alwaysFlyable).toBe(true);
  });

  it('a player who succeeds consistently builds up paper', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const profile of ['successful', 'veteran'] as const) {
        const r = run(profile, seed);
        expect(r.paperEnd).toBeGreaterThan(r.paperStart);
        expect(r.rewards).toBeGreaterThan(r.spent * 1.5);
      }
    }
  });

  it('a struggling player recovers rather than getting stuck', () => {
    // v0.0.18: judged over 30 seeds rather than 8, since single seeds are noisy (the v0.0.17 economy
    // itself has 2 seeds in 30 with a broke run over 8). Most runs recover quickly; none for long.
    const runs = Array.from({ length: 30 }, (_, i) => run('struggling', i + 1));
    for (const r of runs) {
      expect(r.missions).toBe(40);
      expect(r.longestBroke).toBeLessThanOrEqual(16);
      expect(r.emergencies).toBeLessThanOrEqual(3);
    }
    const mean = (f: (r: (typeof runs)[number]) => number) => runs.reduce((t, r) => t + f(r), 0) / runs.length;
    // v0.0.12 made planes dearer so a lost plane is felt: a struggling player may go a while
    // without the paper for a Falcon (flying cheaper planes meanwhile), but rarely needs the free
    // emergency plane, and nearly always ends better off than a Falcon.
    expect(mean((r) => r.longestBroke)).toBeLessThanOrEqual(5);
    expect(runs.filter((r) => r.longestBroke <= 8).length).toBeGreaterThanOrEqual(27);
    expect(mean((r) => r.emergencies)).toBeLessThanOrEqual(1.5);
    expect(runs.filter((r) => r.paperEnd > AIRCRAFT.falcon.cost).length).toBeGreaterThanOrEqual(27);
  });

  it('rewards scale with the risk taken, but stay within a few planes per sortie', () => {
    const perSuccess = (profile: 'new' | 'veteran') => {
      let rewards = 0;
      let successes = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const r = run(profile, seed);
        rewards += r.rewards;
        successes += r.successes;
      }
      return rewards / successes;
    };
    const rookie = perSuccess('new');
    const veteran = perSuccess('veteran');
    // A newcomer's mix of easy and medium work pays one and a half to four Darts (v0.0.12 prices)…
    expect(rookie).toBeGreaterThan(AIRCRAFT.dart.cost * 1.5);
    expect(rookie).toBeLessThan(AIRCRAFT.widewing.cost * 2);
    // …a veteran's hard and very hard work two to six Widewings: more, but not unbounded.
    expect(veteran).toBeGreaterThan(rookie * 2);
    expect(veteran).toBeGreaterThan(AIRCRAFT.widewing.cost * 2);
    expect(veteran).toBeLessThan(AIRCRAFT.widewing.cost * 6);
  });

  it('launching and abandoning missions earns nothing beyond home production', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = run('average', seed, 'abandon');
      expect(r.rewards).toBe(0);
      expect(r.paperEnd).toBeLessThanOrEqual(r.paperStart + r.income);
    }
  });
});

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
    for (let seed = 1; seed <= 8; seed++) {
      const r = run('struggling', seed);
      expect(r.missions).toBe(40);
      // Never long without the paper for a Falcon, and better off at the end than at the start.
      expect(r.longestBroke).toBeLessThanOrEqual(4);
      expect(r.paperEnd).toBeGreaterThan(AIRCRAFT.falcon.cost);
    }
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
    // A newcomer's mix of easy and medium work pays two to four Darts…
    expect(rookie).toBeGreaterThan(AIRCRAFT.dart.cost * 2);
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

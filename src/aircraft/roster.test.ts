import { describe, expect, it } from 'vitest';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT, MISSIONS } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import { Mission } from '../missions/Mission';
import { generateMission, type MissionContext } from '../missions/MissionGenerator';
import { GameState } from '../systems/GameState';
import { seededRng } from '../systems/Random';
import { ResourceManager } from '../systems/ResourceManager';
import { generateTerritories } from '../world/WorldGenerator';
import { aircraftRatings, assessSuitability } from './Aircraft';

/** v0.0.18 §9: the Lightning and the Thug, final roles and stats. */
const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies: [], obstacles: [], installations: layout.installations };

describe('the Thug', () => {
  const flying = (id: 'thug' | 'swift') => {
    const spec = { type: 'delivery' as const, difficulty: 'easy' as const, title: 'D', description: '', reward: 10, bombs: 0, timeLimit: null, ordered: false, objectives: [{ kind: 'reach' as const, territoryId: 'T6', airspace: { x: 999, z: 999, half: 1, ceiling: 1 } }] };
    const st = new GameState(new ResourceManager(1000, { ink: 200, rubber: 50 }), () => [new Mission(spec)]);
    st.selectAircraft(id);
    st.build();
    st.tick(5);
    st.launch();
    return st;
  };

  it('its armour absorbs a share of enemy fire, but not of a collision', () => {
    const thug = flying('thug');
    expect(thug.damageAircraft(20, 'projectile', 'turret').dealt).toBe(Math.round(20 * (1 - AIRCRAFT.thug.armour!)));
    expect(thug.damageAircraft(20, 'impact').dealt).toBe(20);
    expect(flying('swift').damageAircraft(20, 'projectile', 'turret').dealt).toBe(20);
  });

  it('is the toughest plane on paper, slow, and its cannon hits structures twice as hard', () => {
    const r = aircraftRatings(AIRCRAFT.thug);
    expect(r.durability).toBe(5);
    expect(AIRCRAFT.thug.flight.maxSpeed).toBeLessThan(AIRCRAFT.swift.flight.maxSpeed);
    expect(AIRCRAFT.thug.gun.structureFactor).toBe(2);
    expect(AIRCRAFT.thug.flight.maxTurnRate).toBeLessThan(AIRCRAFT.raptor.flight.maxTurnRate);
  });
});

describe('the Lightning', () => {
  it('is the lowest-signature fighter, with a light internal payload', () => {
    const fighters = Object.values(AIRCRAFT).filter((a) => a.role === 'fighter' || a.role === 'multirole');
    const lowest = fighters.reduce((a, b) => (b.signature < a.signature ? b : a));
    expect(lowest.id).toBe('lightning');
    expect(AIRCRAFT.lightning.bombs).toEqual({ capacity: 2, kind: 'small' });
    expect(AIRCRAFT.lightning.traits?.stealth).toBe(true);
  });
});

describe('strafing runs', () => {
  it('ask for several structures on one defended desk, against the clock', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const spec = generateMission('strafe', 'medium', ctx, seededRng(seed));
      const o = spec.objectives[0];
      expect(o.kind).toBe('destroy');
      if (o.kind !== 'destroy') continue;
      expect(o.count).toBe(MISSIONS.strafeCount.medium);
      expect(o.targets.length).toBeGreaterThanOrEqual(o.count);
      expect(spec.timeLimit).toBeGreaterThan(MISSIONS.strafeTime.medium);
    }
  });

  it('suit the Thug best, and bombers badly', () => {
    const spec = generateMission('strafe', 'medium', ctx, seededRng(1));
    const thug = assessSuitability(AIRCRAFT.thug, spec);
    const widewing = assessSuitability(AIRCRAFT.widewing, spec);
    const dart = assessSuitability(AIRCRAFT.dart, spec);
    expect(thug.score).toBeGreaterThan(widewing.score);
    expect(thug.score).toBeGreaterThan(dart.score);
    expect(['recommended', 'good']).toContain(thug.level);
  });
});

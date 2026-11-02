import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_ORDER, LANDING, PLANE, STARTER_AIRCRAFT, type AircraftId, type Difficulty } from '../config';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { layoutDefenses } from '../defenses/Layout';
import type { MissionType } from '../missions/Mission';
import { generateMission, MISSION_TYPES, type MissionContext } from '../missions/MissionGenerator';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { aircraftRatings, assessSuitability, bombLoad, bombTargets, RATING_KEYS } from './Aircraft';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const dummies = range.filter((t) => t.kind === 'dummy');
const installations = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint))).installations;
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies, installations };

const mission = (type: MissionType, difficulty: Difficulty = 'medium') => generateMission(type, difficulty, ctx, seededRng(3));
const level = (id: AircraftId, type: MissionType, difficulty: Difficulty = 'medium') => assessSuitability(AIRCRAFT[id], mission(type, difficulty)).level;

describe('aircraft catalog', () => {
  it('has eleven distinct designs, every one in the garage, covering all four roles', () => {
    expect(AIRCRAFT_ORDER).toHaveLength(11);
    expect(new Set(AIRCRAFT_ORDER)).toEqual(new Set(Object.keys(AIRCRAFT)));
    expect(new Set(AIRCRAFT_ORDER.map((id) => AIRCRAFT[id].name)).size).toBe(11);
    expect(new Set(AIRCRAFT_ORDER.map((id) => AIRCRAFT[id].role)).size).toBe(4);
    // v0.0.11 re-roling: the Swift is the starter and the cheapest; the Dart costs more than before.
    expect(['swift', 'dart', 'falcon', 'widewing'].map((id) => AIRCRAFT[id as AircraftId].cost)).toEqual([10, 25, 30, 40]);
    expect(STARTER_AIRCRAFT).toBe('swift');
    expect(AIRCRAFT_ORDER[0]).toBe(STARTER_AIRCRAFT);
    for (const id of AIRCRAFT_ORDER) if (id !== 'swift') expect(AIRCRAFT[id].cost).toBeGreaterThan(AIRCRAFT.swift.cost);
  });

  it('every design can slow down enough to land, and refits cost less than a new plane', () => {
    for (const id of AIRCRAFT_ORDER) {
      const a = AIRCRAFT[id];
      expect(a.flight.minSpeed).toBeLessThan(LANDING.maxSpeed - 4);
      expect(a.flight.cruiseSpeed).toBeGreaterThan(a.flight.minSpeed);
      expect(a.flight.maxSpeed).toBeGreaterThan(a.flight.cruiseSpeed);
      expect(a.refitCost).toBeLessThan(a.cost);
      expect(PLANE.launchGrace * a.flight.cruiseSpeed).toBeGreaterThan(10); // clears the pad on climb-out
    }
  });

  it('the Dart is fragile and quick, the Widewing heavy and sluggish', () => {
    const { dart, widewing } = AIRCRAFT;
    expect(dart.maxHealth).toBeLessThan(widewing.maxHealth);
    expect(dart.flight.speedResponse).toBeGreaterThan(widewing.flight.speedResponse);
    expect(widewing.flight.rollResponse).toBeLessThan(dart.flight.rollResponse);
    expect(widewing.bombs.capacity).toBe(4);
  });

  it('re-roles the original four (v0.0.11): starter Swift, agile Falcon, fast recon Dart, Widewing unchanged', () => {
    const { swift, falcon, dart, widewing } = AIRCRAFT;
    // Swift: cheap, forgiving (lowest stall speed of the four), balanced guns, one small bomb.
    expect(swift.bombs).toEqual({ capacity: 1, kind: 'small' });
    expect(swift.gun.barrels).toBe(2);
    expect(swift.flight.minSpeed).toBeLessThanOrEqual(Math.min(dart.flight.minSpeed, falcon.flight.minSpeed));
    // Falcon: the best turn rate in the game, strong guns, no bombs; stealth in the data, dormant.
    for (const id of AIRCRAFT_ORDER) if (id !== 'falcon') expect(AIRCRAFT[id].flight.maxTurnRate).toBeLessThan(falcon.flight.maxTurnRate);
    expect(falcon.bombs.capacity).toBe(0);
    expect(falcon.traits?.stealth).toBe(true);
    expect(aircraftRatings(falcon).firepower).toBe(5);
    // Dart: the fastest plane, longest range of the four, weak guns, no bombs, a recon bonus.
    const top = (id: AircraftId) => AIRCRAFT[id].flight.maxSpeed + AIRCRAFT[id].flight.boostSpeed;
    for (const id of AIRCRAFT_ORDER) if (id !== 'dart') expect(top(id)).toBeLessThan(top('dart'));
    expect(dart.range).toBeGreaterThan(Math.max(swift.range, falcon.range, widewing.range));
    expect(dart.bombs.capacity).toBe(0);
    expect(aircraftRatings(dart).firepower).toBe(1);
    expect(dart.traits?.reconRate).toBeGreaterThan(1);
    // Widewing: the heavy bomber it was.
    expect(widewing).toMatchObject({ cost: 40, refitCost: 10, maxHealth: 150, bombs: { capacity: 4, kind: 'standard' }, signature: 1.25 });
  });
});

describe('aircraftRatings', () => {
  it('rates every stat 1–5 from the specs', () => {
    for (const id of AIRCRAFT_ORDER) {
      const r = aircraftRatings(AIRCRAFT[id]);
      for (const key of RATING_KEYS) expect(r[key]).toBeGreaterThanOrEqual(1), expect(r[key]).toBeLessThanOrEqual(5);
    }
  });

  it('reflects each role', () => {
    const dart = aircraftRatings(AIRCRAFT.dart);
    const falcon = aircraftRatings(AIRCRAFT.falcon);
    const swift = aircraftRatings(AIRCRAFT.swift);
    const widewing = aircraftRatings(AIRCRAFT.widewing);
    expect(dart.range).toBe(5);
    expect(dart.speed).toBe(5);
    expect(dart.durability).toBe(1);
    expect(falcon.maneuverability).toBe(5);
    expect(falcon.firepower).toBe(5);
    expect(widewing.payload).toBe(5);
    expect(widewing.durability).toBe(5);
    expect(widewing.maneuverability).toBe(1);
    expect(dart.stealth).toBe(5);
    expect(widewing.stealth).toBe(1);
    // The starter is middling: nothing at the extremes but its small bomb load.
    for (const key of RATING_KEYS) if (key !== 'payload') expect(swift[key]).toBeGreaterThanOrEqual(2), expect(swift[key]).toBeLessThanOrEqual(4);
  });
});

describe('assessSuitability', () => {
  it('recommends the bomber for multi-target bombing and the Dart for reconnaissance and deliveries', () => {
    expect(level('widewing', 'multi-bomb')).toBe('recommended');
    expect(level('dart', 'recon')).toBe('recommended');
    expect(level('dart', 'delivery')).toBe('recommended');
    expect(level('falcon', 'practice')).toBe('recommended');
    expect(level('falcon', 'rings')).toBe('recommended');
  });

  it('recommends the right planes for the missions against defenses', () => {
    expect(level('falcon', 'suppression')).toBe('recommended');
    expect(level('swift', 'suppression')).toBe('good');
    expect(level('dart', 'danger-recon')).toBe('recommended');
    expect(level('falcon', 'danger-recon')).toBe('recommended');
    expect(level('widewing', 'danger-recon')).toBe('possible');
    expect(level('widewing', 'fortified')).toBe('recommended');
    expect(level('falcon', 'fortified')).toBe('good');
    expect(level('falcon', 'survival')).toBe('recommended');
    // A multi-stage strike needs a bit of everything: the weakest stat decides, which favours an all-rounder
    // with a real bomb load (the Lightning); none of the original four is more than possible.
    expect(level('lightning', 'multi-stage')).not.toBe('possible');
    for (const id of ['swift', 'dart', 'falcon', 'widewing'] as const) expect(level(id, 'multi-stage')).toBe('possible');
  });

  it('a rack too small for one bomb per target is the only thing that rules a plane out', () => {
    expect(level('swift', 'multi-bomb')).toBe('unsuitable');
    expect(level('lightning', 'multi-bomb', 'hard')).not.toBe('unsuitable');
    // Unconventional but possible: a bomber on a ring course, the starter on a bombing run.
    expect(level('widewing', 'rings')).toBe('possible');
    expect(level('swift', 'bombing')).toBe('possible');
    // Planes without a bomb bay (Dart, Falcon, Raptor, Specter) can't take bombing work at all.
    const bombless = AIRCRAFT_ORDER.filter((id) => AIRCRAFT[id].bombs.capacity === 0);
    expect(bombless.sort()).toEqual(['dart', 'falcon', 'raptor', 'specter']);
    for (const type of MISSION_TYPES) {
      if (type === 'multi-bomb') continue;
      for (const id of AIRCRAFT_ORDER) {
        const needsBombs = bombTargets(mission(type)) > 0;
        if (bombless.includes(id) && needsBombs) expect(level(id, type)).toBe('unsuitable');
        else expect(level(id, type)).not.toBe('unsuitable');
      }
    }
  });

  it('a plane carries as many of the offered bombs as its rack holds, and says so', () => {
    const easy = mission('bombing', 'easy');
    expect(easy.bombs).toBe(3);
    expect(bombLoad(AIRCRAFT.widewing, easy)).toBe(3);
    expect(bombLoad(AIRCRAFT.lightning, easy)).toBe(2);
    expect(bombLoad(AIRCRAFT.swift, easy)).toBe(1);
    expect(bombLoad(AIRCRAFT.falcon, easy)).toBe(0);
    expect(assessSuitability(AIRCRAFT.widewing, easy).reason).toContain('All 3 bombs aboard');
    expect(assessSuitability(AIRCRAFT.swift, easy).reason).toContain('1 of 3 bombs, no spare');
    expect(assessSuitability(AIRCRAFT.swift, mission('multi-bomb')).reason).toBe('Carries 1 bomb; 2 targets need 2');
    expect(assessSuitability(AIRCRAFT.falcon, easy).reason).toBe('No bomb bay');
  });

  it('recommends the Falcon for fighting in the air, and the Swift for a combined attack', () => {
    for (const type of ['dogfight', 'bomber-intercept', 'scout-intercept', 'escort', 'patrol'] as const) expect(level('falcon', type)).toBe('recommended');
    expect(['recommended', 'good']).toContain(level('swift', 'dogfight'));
    expect(level('widewing', 'dogfight')).toBe('possible');
    expect(level('lightning', 'combined')).not.toBe('possible');
  });
});

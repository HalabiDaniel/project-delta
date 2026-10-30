import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_ORDER, LANDING, PLANE, type AircraftId, type Difficulty } from '../config';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { layoutDefenses } from '../defenses/Layout';
import type { MissionType } from '../missions/Mission';
import { generateMission, MISSION_TYPES, type MissionContext } from '../missions/MissionGenerator';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { aircraftRatings, assessSuitability, bombLoad, RATING_KEYS } from './Aircraft';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const dummies = range.filter((t) => t.kind === 'dummy');
const installations = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint))).installations;
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies, installations };

const mission = (type: MissionType, difficulty: Difficulty = 'medium') => generateMission(type, difficulty, ctx, seededRng(3));
const level = (id: AircraftId, type: MissionType, difficulty: Difficulty = 'medium') => assessSuitability(AIRCRAFT[id], mission(type, difficulty)).level;

describe('aircraft catalog', () => {
  it('has four distinct designs, cheapest first', () => {
    expect(AIRCRAFT_ORDER.map((id) => AIRCRAFT[id].cost)).toEqual([10, 25, 30, 40]);
    expect(new Set(AIRCRAFT_ORDER.map((id) => AIRCRAFT[id].role)).size).toBe(4);
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
    expect(dart.bombs).toEqual({ capacity: 1, kind: 'small' });
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
    // The multipurpose plane sits in the middle of everything.
    for (const key of RATING_KEYS) expect(swift[key]).toBe(3);
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
    // A multi-stage strike needs a bit of everything: the weakest stat decides, which favours the all-rounder.
    expect(level('swift', 'multi-stage')).toBe('recommended');
    for (const id of ['dart', 'falcon', 'widewing'] as const) expect(level(id, 'multi-stage')).toBe('possible');
  });

  it('a rack too small for one bomb per target is the only thing that rules a plane out', () => {
    expect(level('falcon', 'multi-bomb')).toBe('unsuitable');
    expect(level('dart', 'multi-bomb')).toBe('unsuitable');
    expect(level('swift', 'multi-bomb', 'hard')).not.toBe('unsuitable');
    // Unconventional but possible: a bomber on a ring course, a Dart on a bombing run.
    expect(level('widewing', 'rings')).toBe('possible');
    expect(level('dart', 'bombing')).toBe('possible');
    for (const type of MISSION_TYPES) {
      if (type === 'multi-bomb') continue;
      for (const id of AIRCRAFT_ORDER) expect(level(id, type)).not.toBe('unsuitable');
    }
  });

  it('a plane carries as many of the offered bombs as its rack holds, and says so', () => {
    const easy = mission('bombing', 'easy');
    expect(easy.bombs).toBe(3);
    expect(bombLoad(AIRCRAFT.widewing, easy)).toBe(3);
    expect(bombLoad(AIRCRAFT.swift, easy)).toBe(2);
    expect(bombLoad(AIRCRAFT.falcon, easy)).toBe(1);
    expect(assessSuitability(AIRCRAFT.widewing, easy).reason).toContain('All 3 bombs aboard');
    expect(assessSuitability(AIRCRAFT.falcon, easy).reason).toContain('1 of 3 bombs, no spare');
    expect(assessSuitability(AIRCRAFT.falcon, mission('multi-bomb')).reason).toBe('Carries 1 bomb; 2 targets need 2');
  });
});

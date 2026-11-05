import { describe, expect, it } from 'vitest';
import type { BaseSave } from '../../src/base/Base';
import { checkBaseState } from '../store/Store';
import { fromBaseState, toBaseState } from './bases';
import { quietWorld } from './testkit';

/**
 * Portable bases (v0.0.12): a base built on one desk, saved through the store's format, and placed
 * on every other desk comes back with the same buildings, levels, damage and record.
 */

/** A lived-in base on T1: built, upgraded, hurt, a wreck, a scorched paper store and some history. */
function livedIn(): BaseSave {
  const world = quietWorld(3);
  world.join('ann', 'Ann');
  expect(world.claim('ann', 'T1')).toBeNull();
  const base = world.pilots.get('ann')!.base!;
  base.resources.capacity = 100_000;
  base.resources.restore(10_000);
  expect(base.build('D2', 'launcher')).toBe(true);
  expect(base.build('E1', 'workshop')).toBe(true);
  expect(base.upgrade('E1')).toBe(true);
  expect(base.upgrade('E1')).toBe(true);
  expect(base.build('R1', 'radar')).toBe(true);
  base.installation('D2')!.durability.health = 37.4;
  base.installation('R1')!.durability.health = 0;
  base.installation('R1')!.state = 'destroyed';
  base.store.durability.health = 61;
  base.recordKill(base.idOf('D2'), true);
  base.stats.raids = 4;
  base.stats.paperLost = 25;
  return base.save();
}

describe('portable bases', () => {
  it("converts to the store's format and back without losing anything", () => {
    const save = livedIn();
    const state = toBaseState(save);
    expect(() => checkBaseState(state)).not.toThrow();
    const back = fromBaseState(structuredClone(state));
    // Health is kept in whole points, rounded up: a hurt building never comes back as a wreck.
    expect(back.buildings.find((b) => b.slot === 'D2')!.health).toBe(38);
    expect(back.buildings.find((b) => b.slot === 'R1')!.health).toBe(0);
    expect(back).toEqual({ ...save, buildings: save.buildings.map((b) => ({ ...b, health: Math.ceil(b.health) })) });
  });

  it('is placed on every desk exactly as it was left', () => {
    const state = toBaseState(livedIn());
    const source = quietWorld(4);
    for (const desk of source.shared.claimable) {
      const world = quietWorld(5);
      world.join('ann', 'Ann');
      expect(world.claim('ann', desk, fromBaseState(state))).toBeNull();
      const p = world.pilots.get('ann')!;
      expect(p.home!.id).toBe(desk);
      expect(toBaseState(world.baseSave('ann')!)).toEqual(state);
      // The buildings stand on this desk, and the wreck is still a wreck.
      expect(world.network.get(`${desk}-E1`)).toBeDefined();
      expect(p.base!.status('R1')).toBe('destroyed');
      expect(p.base!.status('D2')).toBe('damaged');
      expect(p.base!.at('E1')!.level).toBe(3);
    }
  });

  it('hands the base back when the player leaves, and the desk returns to the AI', () => {
    const world = quietWorld(6);
    world.join('ann', 'Ann');
    world.claim('ann', 'T5', fromBaseState(toBaseState(livedIn())));
    const before = world.baseSave('ann');
    expect(world.freeDesks()).not.toContain('T5');
    const packed = world.remove('ann');
    expect(packed).toEqual(before);
    expect(world.freeDesks()).toContain('T5');
    expect(world.network.get('T5-E1')).toBeUndefined();
    expect(world.remove('ann')).toBeNull();
  });

  it('gives a new player the starting base', () => {
    const world = quietWorld(7);
    world.join('bo', 'Bo');
    world.claim('bo', 'T2', null);
    const save = world.baseSave('bo')!;
    expect(save.buildings.length).toBeGreaterThan(0);
    expect(save.stats.raids).toBe(0);
  });

  it('refuses a broken base before it reaches the store', () => {
    const ok = toBaseState(livedIn());
    expect(() => checkBaseState({ ...ok, storeHealth: -1 })).toThrow();
    expect(() => checkBaseState({ ...ok, buildings: [...ok.buildings, ok.buildings[0]] })).toThrow(/two buildings/);
    expect(() => checkBaseState({ ...ok, buildings: [{ ...ok.buildings[0], kind: 'castle' as never }] })).toThrow(/kind/);
    expect(() => checkBaseState({ ...ok, buildings: [{ ...ok.buildings[0], level: 0 }] })).toThrow(/level/);
  });
});

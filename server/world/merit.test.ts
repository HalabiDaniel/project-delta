import { describe, expect, it } from 'vitest';
import { MERIT } from '../../src/config';
import { MeritBook, backfillAward, dailyAward } from './Merit';
import { launch, place, player, quietWorld, run } from './testkit';

const total = (book: MeritBook, who: string) => book.take().filter((m) => m.player === who).reduce((s, m) => s + m.amount, 0);

describe('Merit from play (v0.0.17)', () => {
  it('pays less for shooting down the same player again in a session, then nothing', () => {
    const book = new MeritBook('s');
    const paid = [1, 2, 3, 4, 5].map((i) => {
      book.kill('a', 'b', `k${i}`, 'Bo', false);
      return total(book, 'a');
    });
    expect(paid).toEqual(MERIT.repeatKill.map((r) => Math.round(MERIT.playerKill * r)).concat([0]).slice(0, 5).map((v, i) => (i >= MERIT.repeatKill.length ? 0 : v)));
    expect(paid[0]).toBeGreaterThan(paid[1]);
    expect(paid[4]).toBe(0);
    // Another player is a fresh count.
    book.kill('a', 'c', 'k9', 'Cy', false);
    expect(total(book, 'a')).toBe(MERIT.playerKill);
  });

  it('gives only a share for shooting down a player under new-player protection', () => {
    const book = new MeritBook('s');
    book.kill('a', 'b', 'k1', 'Bo', true);
    expect(total(book, 'a')).toBe(Math.round(MERIT.playerKill * MERIT.protectedShare));
  });

  it('caps AI shoot-downs per session', () => {
    const book = new MeritBook('s');
    for (let i = 0; i < 100; i++) book.aiKill('a', `ai${i}`, 'an enemy Falcon');
    expect(total(book, 'a')).toBe(MERIT.aiKillCap);
  });

  it('pays less for repeated raids between the same two players, either way round', () => {
    const book = new MeritBook('s');
    book.raid('a', 'b', 'r1', 'Bo');
    book.defend('b', 'a', 'r2', 'Ann');
    book.raid('a', 'b', 'r3', 'Bo');
    const m = book.take();
    expect(m.map((x) => x.amount)).toEqual([MERIT.raid, Math.round(MERIT.defend * MERIT.repeatRaid[1])]);
  });

  it('pays active time only in the air, capped per session', () => {
    const book = new MeritBook('s');
    book.fly('a', MERIT.active.every - 1);
    expect(total(book, 'a')).toBe(0);
    book.fly('a', 1);
    expect(total(book, 'a')).toBe(MERIT.active.amount);
    for (let i = 0; i < 100; i++) book.fly('a', MERIT.active.every);
    expect(total(book, 'a')).toBe(MERIT.active.cap - MERIT.active.amount);
  });

  it('awards missions by tier, placement to the top three, keyed by their causes', () => {
    const book = new MeritBook('s');
    book.mission('a', 'card-1', 3, 'Bomb T5');
    book.placement('a', 'sess', 1);
    book.placement('b', 'sess', 4);
    expect(book.take()).toEqual([
      { player: 'a', key: 'mission:card-1', source: 'mission', amount: MERIT.mission[2], reason: 'Bomb T5' },
      { player: 'a', key: 'place:sess', source: 'placement', amount: MERIT.placement[0], reason: 'Finished 1st' },
    ]);
  });

  it('keys the first session of the day by the date, so it is awarded once a day', () => {
    expect(dailyAward(new Date('2026-11-07T23:59:00Z')).key).toBe(dailyAward(new Date('2026-11-07T00:01:00Z')).key);
    expect(dailyAward(new Date('2026-11-08T00:01:00Z')).key).not.toBe(dailyAward(new Date('2026-11-07T00:01:00Z')).key);
  });

  it('backfills alpha players once, from what they had played, capped', () => {
    const award = backfillAward({ planesRecovered: 10, planesLost: 5, successes: 8, kills: 3 })!;
    expect(award.amount).toBe(15 * MERIT.backfill.sortie + 8 * MERIT.backfill.mission + 3 * MERIT.backfill.kill);
    expect(award.key).toBe(backfillAward({ planesLost: 1 })!.key);
    expect(backfillAward({ planesRecovered: 1e6 })!.amount).toBe(MERIT.backfill.cap);
    expect(backfillAward({})).toBeNull();
    expect(backfillAward(null)).toBeNull();
  });
});

describe('Merit in the world (v0.0.17)', () => {
  it('earns nothing on the pad, and earns for time in the air', () => {
    const world = quietWorld(11);
    const a = player(world, 'a', 'T1', 'Ann');
    run(world, 10);
    expect(world.takeMerit()).toEqual([]);
    launch(world, a);
    place(a, 0, 40, 60, 0);
    // Shortcut the clock: the book counts what the world reports as flown.
    world.merit.fly('a', MERIT.active.every - 1);
    run(world, 2);
    expect(world.takeMerit().filter((m) => m.source === 'active').map((m) => m.player)).toEqual(['a']);
  });
});

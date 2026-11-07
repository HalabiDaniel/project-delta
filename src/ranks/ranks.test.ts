import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MERIT } from '../config';
import {
  LEVELS, RANKS, TOP_MERIT, activeEffects, cleanPrefs, decodeRank, encodeRank, indexFor, isTierPromotion, meritAt, progressFor, rankFor,
  stepAt, thresholds, trailFor, unlockedCards, unlockedEffects, unlockedTitles,
} from './Ranks';

describe('the rank ladder (v0.0.17)', () => {
  it('has 15 ranks and 48 levels, in tier order, with unique ids', () => {
    expect(RANKS).toHaveLength(15);
    expect(LEVELS).toHaveLength(48);
    expect(RANKS.map((r) => r.tier)).toEqual(RANKS.map((_, i) => i + 1));
    expect(new Set(RANKS.map((r) => r.id)).size).toBe(15);
    expect(RANKS.filter((r) => r.levels === 4).map((r) => r.id)).toEqual(['sky-scholar', 'hawk-eye', 'high-flyer']);
  });

  it('has an insignia file for every level and for the Honor Roll', () => {
    // The originals, and the small copies the game loads (tools/rank-art.py).
    for (const dir of ['assets/ranks', 'assets/ranks/web']) {
      for (const { rank, level } of LEVELS) expect(existsSync(`${dir}/${rank.id}-${level}.png`), `${dir}/${rank.id}-${level}`).toBe(true);
      expect(existsSync(`${dir}/honor-roll.png`)).toBe(true);
    }
  });

  it('turns Merit into a rank and level', () => {
    expect(rankFor(0).label).toBe('Blank Page I');
    expect(rankFor(MERIT.curve.first - 1).label).toBe('Blank Page I');
    expect(rankFor(MERIT.curve.first).label).toBe('Blank Page II');
    expect(rankFor(meritAt(3)).label).toBe('Scribbler I');
    expect(rankFor(TOP_MERIT).label).toBe('Head of the Class III');
    expect(rankFor(TOP_MERIT + MERIT.honorStar - 1).stars).toBe(0);
  });

  it('adds an Honor Roll star for every fixed amount past the top, forever', () => {
    expect(rankFor(TOP_MERIT + MERIT.honorStar).label).toBe('Honor Roll ★1');
    expect(rankFor(TOP_MERIT + 7 * MERIT.honorStar + 5).label).toBe('Honor Roll ★7');
    expect(meritAt(indexFor(TOP_MERIT + 3 * MERIT.honorStar))).toBe(TOP_MERIT + 3 * MERIT.honorStar);
  });

  it('climbs quickly at first and slowly at the top', () => {
    const t = thresholds();
    const first = t[1] - t[0];
    const last = t[47] - t[46];
    expect(first).toBeLessThanOrEqual(25);
    expect(last).toBeGreaterThan(first * 50);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it('never lowers a rank when the curve is retuned (the peak holds)', () => {
    const held = rankFor(1000);
    // A steeper curve would put 1000 Merit lower; the peak keeps the rank.
    const steeper = thresholds({ first: 60, growth: 1.2 });
    const lower = steeper.findIndex((m) => m > 1000) - 1;
    expect(lower).toBeLessThan(held.index);
    expect(rankFor(0, held.index).index).toBe(held.index);
  });

  it('shows progress to the next step', () => {
    const step = rankFor(MERIT.curve.first + 3);
    const p = progressFor(MERIT.curve.first + 3, step);
    expect(p.next.index).toBe(step.index + 1);
    expect(p.into).toBe(3);
    expect(p.needed).toBe(meritAt(step.index + 1) - meritAt(step.index));
  });

  it('unlocks titles, cards and effects by rank, and keeps earlier ones', () => {
    const start = stepAt(0);
    expect(unlockedTitles(start)).toEqual(['New Sheet']);
    expect(unlockedEffects(start)).toEqual([]);
    const glider = rankFor(meritAt(LEVELS.findIndex((l) => l.rank.id === 'glider')));
    expect(unlockedEffects(glider)).toEqual(['pennant', 'nameplate', 'pencil-trail']);
    expect(unlockedCards(glider)).toContain('blank-page');
    const honor = stepAt(LEVELS.length + 5);
    expect(unlockedTitles(honor)).toContain('Honor Roll');
    expect(unlockedCards(honor).filter((c) => c.startsWith('honor-roll'))).toEqual(['honor-roll-0', 'honor-roll-1']);
  });

  it('refuses titles, cards and effects the player has not earned', () => {
    const start = stepAt(0);
    const prefs = cleanPrefs({ title: 'Recess Legend', card: 'head-of-the-class', off: ['aura', 'nonsense'], peak: 3 }, start);
    expect(prefs).toEqual({ title: null, card: null, off: ['aura'], peak: 3 });
    expect(cleanPrefs({ title: 'New Sheet', card: 'blank-page' }, start)).toMatchObject({ title: 'New Sheet', card: 'blank-page' });
    expect(cleanPrefs('junk', start)).toEqual({ title: null, card: null, off: [], peak: 0 });
  });

  it('lets a player turn their own effects off', () => {
    const top = stepAt(47);
    expect(activeEffects(top, { off: [] })).toContain('aura');
    expect(activeEffects(top, { off: ['aura'] })).not.toContain('aura');
    expect(trailFor(activeEffects(top, { off: ['sparkle-trail'] }))).toBe('feather');
    expect(trailFor([])).toBeNull();
  });

  it('sends a rank in a few bytes and reads it back', () => {
    const step = stepAt(12);
    const wire = encodeRank(step, ['pennant', 'pencil-trail']);
    expect(wire.length).toBeLessThan(32);
    expect(decodeRank(wire)).toEqual({ step, effects: ['pennant', 'pencil-trail'] });
    expect(decodeRank('7')?.step.index).toBe(7);
    expect(decodeRank('x')).toBeNull();
    expect(decodeRank('3:hack,aura')?.effects).toEqual(['aura']);
  });

  it('tells a new rank name from a new level', () => {
    expect(isTierPromotion(stepAt(0), stepAt(1))).toBe(false);
    expect(isTierPromotion(stepAt(2), stepAt(3))).toBe(true);
  });
});

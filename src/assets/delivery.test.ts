import { describe, expect, it } from 'vitest';
import { expectedLicensedFiles, PROPS, resolveProp, type PropId } from './manifest';
import { SYNTY_PROPS, syntySlots, type SyntyCategory } from './synty';
import { backdropLayout } from '../world/Backdrop';
import { ROOM } from '../world/Classroom';
import { WORLD } from '../config';
import { BUDGETS, checkBudget, DETAIL_DISTANCE, GRAPHICS_PRESETS } from '../render/GraphicsSettings';
import { instancedDraws } from '../render/Instancer';
import { loadPercent } from '../ui/LoadingScreen';

/** Height of a built model (max y over its parts). */
function height(id: PropId): number {
  const parts = [...PROPS[id].build().model.parts.values()].filter((b) => !b.isEmpty);
  return Math.max(...parts.map((b) => b.bounds()[1][1]));
}

describe('licensed environment slots (Synty)', () => {
  it('covers furniture, architecture, props and obstacles', () => {
    const categories: SyntyCategory[] = ['furniture', 'architecture', 'prop', 'obstacle'];
    for (const c of categories) expect(syntySlots(c).length, c).toBeGreaterThan(0);
  });

  it('puts every slot in the manifest with a licensed file, a fitted height and a placeholder', () => {
    const files = new Set<string>();
    for (const id of syntySlots()) {
      const def = PROPS[id];
      expect(def, id).toBe(SYNTY_PROPS[id]);
      expect(def.licensed?.length, id).toBeGreaterThan(0);
      expect(def.fitHeight, id).toBeGreaterThan(0);
      for (const f of def.licensed!) {
        expect(f, id).toMatch(/^synty\/[a-z0-9_]+\.glb$/);
        expect(files.has(f), `${f} used twice`).toBe(false);
        files.add(f);
      }
      expect(expectedLicensedFiles().some((e) => e.prop === id), id).toBe(true);
    }
  });

  it('runs on placeholders without the files, and picks a supplied file up', () => {
    for (const id of syntySlots()) {
      expect(resolveProp(PROPS[id], new Set()), id).toEqual({ kind: 'placeholder' });
      const file = `licensed/${PROPS[id].licensed![0]}`;
      expect(resolveProp(PROPS[id], new Set([file])), id).toEqual({ kind: 'licensed', file });
    }
  });

  it('builds placeholders close to the size the real model is fitted to', () => {
    for (const id of syntySlots()) {
      const h = height(id);
      expect(h, id).toBeGreaterThan(PROPS[id].fitHeight! * 0.6);
      expect(h, id).toBeLessThan(PROPS[id].fitHeight! * 1.45);
    }
  });

  it('gives obstacles collision shapes that reach their top', () => {
    for (const id of syntySlots('obstacle')) {
      const shapes = PROPS[id].colliders ?? [];
      expect(shapes.length, id).toBeGreaterThan(0);
      const top = Math.max(...shapes.map((s) => s.y + (s.kind === 'sphere' ? s.r : s.hy)));
      expect(top, id).toBeGreaterThan(PROPS[id].fitHeight! * 0.75);
    }
  });
});

describe('classroom backdrop', () => {
  it('stands inside the walls, using only room slots', () => {
    for (const p of backdropLayout()) {
      expect(p.prop.startsWith('room.'), p.prop).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(ROOM.halfX);
      expect(p.z).toBeGreaterThanOrEqual(ROOM.minZ);
      expect(p.z).toBeLessThanOrEqual(ROOM.maxZ);
    }
  });

  it('keeps out of the airspace: below the desk tops, or above the flying ceiling', () => {
    for (const p of backdropLayout()) {
      const bottom = ROOM.floor + (p.y ?? 0);
      const top = bottom + PROPS[p.prop].fitHeight!;
      // The airspace is the square inside the walls minus a margin; anything inside it must not reach flying height.
      const inAirspace = Math.abs(p.x) < WORLD.boundaryRadius && Math.abs(p.z) < WORLD.boundaryRadius;
      if (inAirspace) expect(top < 0 || bottom > WORLD.ceilingY, p.prop).toBe(true);
    }
  });
});

describe('performance budgets', () => {
  it('has a budget and a detail distance for every preset, tighter on lower ones', () => {
    for (const p of GRAPHICS_PRESETS) {
      expect(BUDGETS[p].drawCalls).toBeGreaterThan(0);
      expect(DETAIL_DISTANCE[p]).toBeGreaterThan(0);
    }
    expect(BUDGETS.low.drawCalls).toBeLessThan(BUDGETS.medium.drawCalls);
    expect(BUDGETS.medium.drawCalls).toBeLessThan(BUDGETS.high.drawCalls);
    expect(BUDGETS.low.triangles).toBeLessThan(BUDGETS.high.triangles);
    expect(DETAIL_DISTANCE.low).toBeLessThan(DETAIL_DISTANCE.medium);
  });

  it('reports which measures are over', () => {
    expect(checkBudget('high', { drawCalls: 500, triangles: 100_000 }).ok).toBe(true);
    const over = checkBudget('low', { drawCalls: 1355, triangles: 100_000, textureMb: 500 });
    expect(over.ok).toBe(false);
    expect(over.over).toEqual(['drawCalls 1355/350', 'textureMb 500/96']);
    // Unknown measures are not judged.
    expect(checkBudget('low', { drawCalls: Number.NaN }).ok).toBe(true);
  });
});

describe('batching and loading', () => {
  it('draws every repeated mesh and material once, single ones as they are', () => {
    const desks = Array.from({ length: 16 }, () => 'desk|wood');
    const legs = Array.from({ length: 64 }, () => 'leg|metal');
    expect(instancedDraws([...desks, ...legs, 'room|paint', 'clock|red'])).toEqual({ before: 82, after: 4 });
  });

  it('shows load progress as a percentage', () => {
    expect(loadPercent({ done: 0, total: 20 })).toBe(0);
    expect(loadPercent({ done: 5, total: 20 })).toBe(25);
    expect(loadPercent({ done: 25, total: 20 })).toBe(100);
    expect(loadPercent({ done: 0, total: 0 })).toBe(100);
  });
});

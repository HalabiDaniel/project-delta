import { describe, expect, it } from 'vitest';
import { PROPS } from '../../assets/manifest';
import { AI, BASE, DEFENSES, WORLD } from '../../config';
import { LANDMARKS } from '../props/landmarks';
import { HOME_DESK, THEMES, type Placement } from './themes';

/** A placed prop's footprint on the platform: its bounding rectangle, turned and moved, as (u, v) corners. */
function footprint(p: Placement): Array<[number, number]> {
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of PROPS[p.prop].build().model.parts.values()) {
    if (b.isEmpty) continue;
    const [lo, hi] = b.bounds();
    [x0, z0, x1, z1] = [Math.min(x0, lo[0]), Math.min(z0, lo[2]), Math.max(x1, hi[0]), Math.max(z1, hi[2])];
  }
  const a = ((p.yaw ?? 0) * Math.PI) / 180;
  return ([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as Array<[number, number]>).map(([x, z]) => [
    p.at[0] + x * Math.cos(a) + z * Math.sin(a),
    p.at[1] - x * Math.sin(a) + z * Math.cos(a),
  ]);
}

/** Distance from a point to a convex polygon (0 inside). */
function distance(pt: readonly [number, number], poly: Array<[number, number]>): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (pt[1] - az) - (bz - az) * (pt[0] - ax);
    if (cross < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * (bx - ax) + (pt[1] - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1)));
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * (bx - ax)), pt[1] - (az + t * (bz - az))));
  }
  // Winding may be either way round: inside if all crosses share a sign.
  const signs = poly.map(([ax, az], i) => {
    const [bx, bz] = poly[(i + 1) % poly.length];
    return Math.sign((bx - ax) * (pt[1] - az) - (bz - az) * (pt[0] - ax));
  });
  if (inside || signs.every((s) => s >= 0) || signs.every((s) => s <= 0)) return 0;
  return best;
}

describe('Home Desk layout', () => {
  const half = WORLD.territorySize / 2;

  it('keeps every prop on the platform', () => {
    for (const p of HOME_DESK.props) {
      expect(Math.abs(p.at[0]) + 0.5, p.prop).toBeLessThanOrEqual(half);
      expect(Math.abs(p.at[1]) + 0.5, p.prop).toBeLessThanOrEqual(half);
    }
  });

  it('keeps the runway and the take-off corridor clear', () => {
    const corridor = WORLD.runwayWidth / 2 + 1.5;
    for (const p of HOME_DESK.props) {
      const vs = footprint(p).map(([, v]) => v);
      const clear = vs.every((v) => v > corridor) || vs.every((v) => v < -corridor);
      expect(clear, `${p.prop} at ${p.at}`).toBe(true);
    }
    const lm = HOME_DESK.landmark!;
    expect(Math.abs(lm.at[1]) - 3).toBeGreaterThan(corridor);
  });

  it('keeps the construction slots and the paper store free', () => {
    const pads = [...BASE.slots.map((s) => ({ id: s.id, at: s.at, r: 2.8 })), { id: 'store', at: DEFENSES.home.store, r: 2.5 }];
    for (const p of HOME_DESK.props) {
      const poly = footprint(p);
      for (const pad of pads) expect(distance(pad.at, poly), `${p.prop} vs ${pad.id}`).toBeGreaterThan(pad.r);
    }
    const lm = HOME_DESK.landmark!;
    for (const pad of pads) expect(Math.hypot(lm.at[0] - pad.at[0], lm.at[1] - pad.at[1]), pad.id).toBeGreaterThan(pad.r + 2.4);
  });

  it('only uses known props, themes and landmarks', () => {
    expect(THEMES[HOME_DESK.theme]).toBeDefined();
    for (const p of HOME_DESK.props) expect(PROPS[p.prop], p.prop).toBeDefined();
    expect(LANDMARKS[HOME_DESK.landmark!.id]).toBeDefined();
  });
});

describe('landmarks', () => {
  it('stay below the height AI pilots cruise at over a platform', () => {
    for (const build of Object.values(LANDMARKS)) expect(build().height).toBeLessThan(AI.clearance - 1.5);
  });

  it('come with collision shapes covering the parts that stick up', () => {
    for (const build of Object.values(LANDMARKS)) {
      const lm = build();
      expect(lm.colliders.length).toBeGreaterThan(1);
      const top = Math.max(...lm.colliders.map((s) => s.y + (s.kind === 'sphere' ? s.r : s.hy)));
      expect(top).toBeGreaterThan(lm.height - 1);
    }
  });

  it('every tall prop declares collision shapes', () => {
    for (const [id, def] of Object.entries(PROPS)) {
      const [, max] = [...def.build().model.parts.values()].map((b) => b.bounds()).reduce((a, b) => [a[0], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1]), Math.max(a[1][2], b[1][2])]]);
      if (max[1] > 2 && def.tier === 'prop') expect(def.colliders?.length, id).toBeGreaterThan(0);
    }
  });
});

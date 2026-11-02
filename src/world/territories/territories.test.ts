import { describe, expect, it } from 'vitest';
import { PROPS } from '../../assets/manifest';
import { AI, BASE, DEFENSES, MISSIONS, THREAT, WORLD } from '../../config';
import { footprint as collisionFootprint } from '../../combat/Collision';
import { layoutTargetRange } from '../../combat/Destructibles';
import { layoutDefenses } from '../../defenses/Layout';
import { sharedWorld } from '../../net/World';
import { quietWorld } from '../../../server/world/testkit';
import { generateTerritories } from '../Grid';
import { LANDMARKS } from '../props/landmarks';
import { CORRIDOR, decorColliders, decorFootprints, homeWorkAreas, landmarkRadius, territoryLayout } from './decor';
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

describe('every desk (v0.0.11)', () => {
  const sp = generateTerritories();
  const mp = sharedWorld();
  const half = WORLD.territorySize / 2;
  const pads = homeWorkAreas();

  it('has a theme, a landmark and a scatter of props, every theme in use', () => {
    const themes = new Set<string>();
    for (const t of sp) {
      const layout = territoryLayout(t);
      expect(THEMES[layout.theme], t.id).toBeDefined();
      expect(layout.landmark, t.id).not.toBeNull();
      expect(LANDMARKS[layout.landmark!.id], t.id).toBeDefined();
      expect(layout.props.length, t.id).toBeGreaterThanOrEqual(6);
      for (const p of layout.props) expect(PROPS[p.prop], `${t.id} ${p.prop}`).toBeDefined();
      themes.add(layout.theme);
    }
    expect([...themes].sort()).toEqual(Object.keys(THEMES).sort());
    expect(new Set(sp.map((t) => territoryLayout(t).landmark!.id)).size).toBe(16);
  });

  it('keeps the home work areas clear on every desk (any desk can be a home in multiplayer)', () => {
    for (const t of sp) {
      const layout = territoryLayout(t);
      for (const p of layout.props) {
        const poly = footprint(p);
        const vs = poly.map(([, v]) => v);
        expect(vs.every((v) => v > CORRIDOR) || vs.every((v) => v < -CORRIDOR), `${t.id} ${p.prop} on the runway`).toBe(true);
        for (const pad of pads) expect(distance([pad.u, pad.v], poly), `${t.id} ${p.prop} vs pad ${pad.u},${pad.v}`).toBeGreaterThan(pad.r);
        for (const [u, v] of poly) {
          expect(Math.abs(u), `${t.id} ${p.prop}`).toBeLessThanOrEqual(half);
          expect(Math.abs(v), `${t.id} ${p.prop}`).toBeLessThanOrEqual(half);
        }
      }
      const lm = layout.landmark!;
      const r = landmarkRadius(lm.id);
      expect(Math.abs(lm.at[1]) - r, `${t.id} landmark on the runway`).toBeGreaterThan(CORRIDOR);
      for (const pad of pads) expect(Math.hypot(lm.at[0] - pad.u, lm.at[1] - pad.v), `${t.id} landmark vs pad`).toBeGreaterThan(pad.r + r);
      expect(Math.hypot(lm.at[0], lm.at[1]) - r, `${t.id} landmark vs bullseye`).toBeGreaterThan(MISSIONS.bullseyeRadius.easy + 1);
    }
  });

  it('keeps every landmark on its desk and the props clear of it', () => {
    for (const t of sp) {
      for (const c of decorColliders(t)) {
        for (const s of c.shapes) {
          const reach = s.kind === 'sphere' ? s.r : Math.max(s.hx, s.hz);
          expect(Math.abs(s.x - t.x) + reach * 0.5, c.id).toBeLessThanOrEqual(half);
          expect(Math.abs(s.z - t.z) + reach * 0.5, c.id).toBeLessThanOrEqual(half);
        }
      }
      if (t.isHome) continue;
      const layout = territoryLayout(t);
      const lm = layout.landmark!;
      for (const p of layout.props) expect(distance(lm.at, footprint(p)), `${t.id} ${p.prop}`).toBeGreaterThan(landmarkRadius(lm.id));
    }
  });

  it('only gives collision shapes to props that show at every decoration level', () => {
    for (const t of sp) for (const p of territoryLayout(t).props) if (PROPS[p.prop].colliders?.length) expect(p.detail ?? 1, `${t.id} ${p.prop}`).toBe(1);
  });

  it('keeps the AI defenses and the practice range off the landmarks, and every defended desk fully armed', () => {
    const targets = layoutTargetRange(sp);
    const ground = decorFootprints(sp);
    const cases = [
      { territories: sp, layout: layoutDefenses(sp, [...targets.flatMap((s) => s.shapes.map(collisionFootprint)), ...ground]) },
      { territories: mp.territories, layout: mp.layout },
    ];
    for (const { territories, layout } of cases) {
      const marks = decorFootprints(territories);
      for (const i of layout.installations) {
        if (i.side !== 'enemy') continue;
        for (const m of marks) expect(Math.hypot(i.x - m.x, i.z - m.z), i.id).toBeGreaterThan(m.r + i.footprint);
      }
      for (const t of territories) {
        if (t.isHome || t.threat === 0) continue;
        const profile = THREAT.levels[t.threat];
        const placed = layout.installations.filter((i) => i.territoryId === t.id);
        expect(placed.filter((i) => i.kind === 'turret').length, t.id).toBe(profile.turrets);
        expect(placed.filter((i) => i.kind === 'launcher').length, t.id).toBe(profile.launchers);
        expect(placed.some((i) => i.kind === 'radar'), t.id).toBe(profile.radar);
        expect(placed.some((i) => i.kind === 'supply'), t.id).toBe(profile.supply);
      }
    }
    for (const s of targets) {
      for (const shape of s.shapes) {
        const f = collisionFootprint(shape);
        for (const m of ground) expect(Math.hypot(f.x - m.x, f.z - m.z), s.id).toBeGreaterThan(m.r);
      }
    }
  });

  it('gives client and server the same collision shapes', () => {
    const client = sp.flatMap((t) => decorColliders(t));
    expect(mp.decor).toEqual(client);
    expect(client.length).toBeGreaterThanOrEqual(16);
    const server = quietWorld().solids();
    for (const c of client) expect(server.find((s) => s.id === c.id)?.shapes, c.id).toEqual(c.shapes);
  });

  it('has pennant spots for owners, clear of the landmark', () => {
    for (const t of sp) {
      const layout = territoryLayout(t);
      expect(layout.flags?.length, t.id).toBe(3);
      for (const [u, v] of layout.flags!) expect(Math.hypot(u - layout.landmark!.at[0], v - layout.landmark!.at[1]), t.id).toBeGreaterThan(landmarkRadius(layout.landmark!.id));
    }
  });
});

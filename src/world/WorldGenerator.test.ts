import { Vec3 } from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../config';
import { forwardFromAngles, wrapAngle, yawFromDirection } from '../aircraft/PlaneController';
import { generateTerritories } from './WorldGenerator';

describe('generateTerritories', () => {
  const territories = generateTerritories();

  it('makes nine territories, T1 to T9, in a 3×3 grid', () => {
    expect(territories.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']);
  });

  it('T1 is the player’s home in a corner, T5 is the centre, the rest are neutral', () => {
    const [t1, , , , t5] = territories;
    expect(t1.isHome).toBe(true);
    expect([t5.x, t5.z]).toEqual([0, 0]);
    expect(t1.x).toBeLessThan(0);
    expect(t1.z).toBeLessThan(0);
    expect(territories.filter((t) => t.isHome)).toHaveLength(1);
  });

  it('neighbours are separated by the configured gap, and the whole grid fits inside the boundary', () => {
    const [t1, t2, , t4] = territories;
    expect(WORLD.gap).toBeGreaterThanOrEqual(30);
    expect(t2.x - t2.half - (t1.x + t1.half)).toBe(WORLD.gap);
    expect(t4.z - t4.half - (t1.z + t1.half)).toBe(WORLD.gap);
    for (const t of territories) {
      expect(Math.hypot(Math.abs(t.x) + t.half, Math.abs(t.z) + t.half)).toBeLessThan(WORLD.boundaryRadius - 30);
    }
  });

  it('sphere tests respect platform edges and thickness', () => {
    const t5 = territories[4];
    expect(t5.intersectsSphere(t5.x, 0.5, t5.z, 0.8)).toBe(true);
    expect(t5.intersectsSphere(t5.x, 2, t5.z, 0.8)).toBe(false);
    expect(t5.intersectsSphere(t5.x + t5.half + 1, 0, t5.z, 0.8)).toBe(false);
  });
});

describe('flight math', () => {
  it('yaw 0 faces -Z; positive yaw turns left; positive pitch climbs', () => {
    const v = new Vec3();
    forwardFromAngles(0, 0, v);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
    forwardFromAngles(Math.PI / 2, 0, v);
    expect(v.x).toBeCloseTo(-1);
    forwardFromAngles(0, Math.PI / 6, v);
    expect(v.y).toBeCloseTo(0.5);
  });

  it('yawFromDirection is the inverse of the forward vector', () => {
    const v = new Vec3();
    const yaw = yawFromDirection(1, 1);
    forwardFromAngles(yaw, 0, v);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('wrapAngle keeps angles in (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });
});

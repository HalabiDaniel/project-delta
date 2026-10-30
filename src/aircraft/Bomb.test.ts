import { describe, expect, it } from 'vitest';
import { BOMB, MISSIONS, WORLD } from '../config';
import { generateTerritories } from '../world/WorldGenerator';
import type { Collider } from '../combat/Collision';
import { sweepBomb, type ZoneRef } from './Bomb';

const territories = generateTerritories();
const t5 = territories.find((t) => t.id === 'T5')!;
const t7 = territories.find((t) => t.id === 'T7')!;
const radius = 5;
const zones: ZoneRef[] = [
  { objective: 0, territoryId: 'T5', zone: { x: t5.x, z: t5.z, radius, top: MISSIONS.targetHeight } },
  { objective: 1, territoryId: 'T7', zone: { x: t7.x + 8, z: t7.z, radius: 2, top: MISSIONS.targetHeight } },
];
const crate: Collider = { id: 'T5-crates', shapes: [{ kind: 'box', x: t5.x + 15, y: 1.5, z: t5.z + 15, hx: 2, hy: 1.5, hz: 1.5, yaw: 0.4 }] };
const r = BOMB.kinds.standard.radius;

/** One falling step straight down at (x, z). */
const drop = (x: number, z: number, from = 1.5, to = 0.2) =>
  sweepBomb({ x, y: from, z }, { x, y: to, z }, r, zones, territories);

describe('sweepBomb', () => {
  it('a ball coming down on the bullseye hits the target', () => {
    expect(drop(t5.x, t5.z)).toMatchObject({ kind: 'target', objective: 0, territoryId: 'T5' });
    expect(drop(t5.x + radius - 0.5, t5.z)?.kind).toBe('target');
  });

  it('each zone reports its own objective, including small off-centre ones', () => {
    expect(drop(t7.x + 8, t7.z)).toMatchObject({ kind: 'target', objective: 1, territoryId: 'T7' });
    expect(drop(t7.x, t7.z)).toMatchObject({ kind: 'platform', territoryId: 'T7' });
  });

  it('with no open zones every landing is a platform impact', () => {
    expect(sweepBomb({ x: t5.x, y: 1.5, z: t5.z }, { x: t5.x, y: 0.2, z: t5.z }, r, [], territories)?.kind).toBe('platform');
  });

  it('landing elsewhere on the target territory is not a hit', () => {
    const impact = drop(t5.x + 12, t5.z + 12);
    expect(impact).toMatchObject({ kind: 'platform', territoryId: 'T5' });
  });

  it('landing on another territory is a platform impact there', () => {
    const t1 = territories.find((t) => t.id === 'T1')!;
    expect(drop(t1.x, t1.z)).toMatchObject({ kind: 'platform', territoryId: 'T1' });
  });

  it('a ball in a gap keeps falling, then is lost to the void', () => {
    const gapX = t5.x + t5.half + WORLD.gap / 2;
    expect(drop(gapX, t5.z, 1.5, -5)).toBeNull();
    expect(sweepBomb({ x: gapX, y: -25, z: t5.z }, { x: gapX, y: -31, z: t5.z }, r, zones, territories)?.kind).toBe('void');
  });

  it('a fast step cannot tunnel through the bullseye', () => {
    const impact = sweepBomb({ x: t5.x - 3, y: 40, z: t5.z }, { x: t5.x + 3, y: -20, z: t5.z }, r, zones, territories);
    expect(impact?.kind).toBe('target');
    expect(Math.abs(impact!.x - t5.x)).toBeLessThan(1);
  });

  it('a prop standing in the way is hit before the platform under it', () => {
    const impact = sweepBomb({ x: t5.x + 15, y: 6, z: t5.z + 15 }, { x: t5.x + 15, y: 2.5, z: t5.z + 15 }, r, zones, territories, [crate]);
    expect(impact).toMatchObject({ kind: 'object', id: 'T5-crates' });
    expect(impact!.y).toBeGreaterThan(3);
    // Falling beside it, the ball reaches the platform.
    expect(sweepBomb({ x: t5.x - 15, y: 1.5, z: t5.z }, { x: t5.x - 15, y: 0.2, z: t5.z }, r, zones, territories, [crate])?.kind).toBe('platform');
  });

  it('nothing happens while the ball is still in the air', () => {
    expect(drop(t5.x, t5.z, 20, 19)).toBeNull();
  });
});

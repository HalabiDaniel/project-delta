import { describe, expect, it } from 'vitest';
import { BOMB, WORLD } from '../config';
import { generateTerritories } from '../world/WorldGenerator';
import { sweepBomb, type TargetZone } from './Bomb';

const territories = generateTerritories();
const t5 = territories.find((t) => t.id === 'T5')!;
const target: TargetZone = { x: t5.x, z: t5.z, radius: WORLD.targetRadius, top: WORLD.targetHeight };
const r = BOMB.radius;

/** One falling step straight down at (x, z). */
const drop = (x: number, z: number, from = 1.5, to = 0.2) =>
  sweepBomb({ x, y: from, z }, { x, y: to, z }, r, target, territories);

describe('sweepBomb', () => {
  it('a ball coming down on the bullseye hits the target', () => {
    expect(drop(t5.x, t5.z)?.kind).toBe('target');
    expect(drop(t5.x + WORLD.targetRadius - 0.5, t5.z)?.kind).toBe('target');
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
    expect(drop(gapX, t5.z, -25, -31)?.kind).toBe('void');
  });

  it('a fast step cannot tunnel through the bullseye', () => {
    const impact = sweepBomb({ x: t5.x - 3, y: 40, z: t5.z }, { x: t5.x + 3, y: -20, z: t5.z }, r, target, territories);
    expect(impact?.kind).toBe('target');
    expect(Math.abs(impact!.x - t5.x)).toBeLessThan(1);
  });

  it('nothing happens while the ball is still in the air', () => {
    expect(drop(t5.x, t5.z, 20, 19)).toBeNull();
  });
});

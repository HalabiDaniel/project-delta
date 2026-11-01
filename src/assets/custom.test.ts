import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_ORDER, WORLD } from '../config';
import { PLANE_SHAPES } from '../aircraft/PlaneShapes';
import { boundaryDistance } from '../systems/Boundary';
import { CLASSROOM_SCALE, deskPositions, FLOOR_Y, ROOM } from '../world/Classroom';
import { generateTerritories, homeHeading } from '../world/Grid';
import { CATALOG, damageState, IN_GAME_BUILDINGS, variantKey } from './CustomModels';

const assetFile = (file: string) => resolve(__dirname, '../../assets', file);

describe('custom models (asset labs)', () => {
  it('every aircraft has its exported model, with nozzles or wingtips for the flight effects', () => {
    for (const id of AIRCRAFT_ORDER) {
      const info = CATALOG.aircraft[id];
      expect(info, id).toBeDefined();
      expect(existsSync(assetFile(info.file)), info.file).toBe(true);
      expect(info.fx, id).not.toBeNull();
      expect(info.fx!.tips.length, id).toBe(2);
      // Nose +Z and roughly the stand-ins' size once scaled.
      expect(info.max[2]).toBeGreaterThan(0.9);
      expect(info.max[2] - info.min[2]).toBeGreaterThan(1.8);
      expect(info.max[2] - info.min[2]).toBeLessThan(5.5);
    }
  });

  it('every building the game places has all three levels and four damage states', () => {
    for (const id of IN_GAME_BUILDINGS) {
      const b = CATALOG.buildings[id];
      expect(existsSync(assetFile(b.file)), b.file).toBe(true);
      expect(b.levels).toEqual([1, 2, 3]);
      for (const lv of [1, 2, 3]) {
        for (const d of [0, 1, 2, 3] as const) {
          const v = b.variants[variantKey(lv, d)];
          expect(v, `${id} ${variantKey(lv, d)}`).toBeDefined();
          // Standing on its base; slot buildings stay close to a construction pad (the hangar has its own place).
          expect(v.min[1]).toBeGreaterThan(-0.5);
          if (id !== 'hangar') expect(v.max[0] - v.min[0]).toBeLessThan(9);
        }
        // Medium and critical damage smoke.
        expect(b.variants[variantKey(lv, 0)].damageSmoke).toHaveLength(0);
        expect(b.variants[variantKey(lv, 3)].damageSmoke.length).toBeGreaterThan(0);
      }
    }
    // The defenses keep the joints the rig aims with.
    for (const id of ['turret', 'launcher', 'radar'] as const) {
      const joints = CATALOG.buildings[id].variants['L1_D0'].joints.map((j) => j.node);
      expect(joints).toContain('Swivel');
      expect(joints.some((n) => n.endsWith('_Pitch'))).toBe(true);
    }
  });

  it('damage states follow health: none, minor, medium, critical, and wrecks are critical', () => {
    expect(damageState(1)).toBe(0);
    expect(damageState(0.9)).toBe(1);
    expect(damageState(0.5)).toBe(2);
    expect(damageState(0.2)).toBe(3);
    expect(damageState(0.9, false)).toBe(3);
    expect(variantKey(0, 2)).toBe('L1_D2');
    expect(variantKey(7, 0)).toBe('L3_D0');
  });

  it('stand-in shapes have a muzzle per barrel and a rack per bomb for every design', () => {
    for (const id of AIRCRAFT_ORDER) {
      const spec = AIRCRAFT[id];
      const shape = PLANE_SHAPES[id];
      if (id === spec.shape) continue;
      expect(shape.muzzles, id).toHaveLength(spec.gun.barrels);
      expect(shape.bombSlots, id).toHaveLength(spec.bombs.capacity);
    }
  });
});

describe('the classroom', () => {
  const territories = generateTerritories();

  it('puts a desk under every territory, in the same order, with the sheet on the desk top', () => {
    const desks = deskPositions();
    expect(desks).toHaveLength(territories.length);
    desks.forEach((d, i) => {
      expect(d.x).toBeCloseTo(territories[i].x, 3);
      expect(d.z).toBeCloseTo(territories[i].z, 3);
    });
    // The desk top is as deep as a territory and a little wider.
    expect(CATALOG.classroom.layout.desk.d * CLASSROOM_SCALE).toBeCloseTo(WORLD.territorySize, 3);
    expect(CATALOG.classroom.layout.desk.w * CLASSROOM_SCALE).toBeGreaterThan(WORLD.territorySize);
    expect(FLOOR_Y).toBeLessThan(WORLD.voidY);
  });

  it('keeps the airspace inside the walls, with every desk inside the airspace', () => {
    expect(WORLD.boundaryRadius).toBeLessThan(ROOM.halfX - 15);
    expect(WORLD.boundaryRadius).toBeLessThan(ROOM.maxZ - 15);
    expect(-WORLD.boundaryRadius).toBeGreaterThan(ROOM.minZ + 15);
    expect(ROOM.ceiling).toBeGreaterThan(WORLD.ceilingY + 40);
    for (const t of territories) expect(boundaryDistance(t.x, t.z) + t.half).toBeLessThan(WORLD.boundaryRadius);
  });

  it('runs every home runway square on its desk, towards the middle of the room', () => {
    for (const t of territories) {
      const h = homeHeading(t);
      expect(Math.abs(h.x) + Math.abs(h.z)).toBe(1);
      expect(h.x * -t.x + h.z * -t.z).toBeGreaterThan(0);
    }
  });
});

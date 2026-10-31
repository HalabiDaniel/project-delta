import { describe, expect, it } from 'vitest';
import { AIRCRAFT, DAMAGE, LANDING, TARGETS, WEAPONS } from '../config';
import { generateTerritories } from '../world/WorldGenerator';
import { distanceToShape, firstHit, segmentHit, sphereContact, type Shape } from './Collision';
import { blastDamage, Durability, handlingFactor, impactDamage, roughLandingDamage, wobbleAmount } from './Damage';
import { Destructible, layoutTargetRange } from './Destructibles';
import { Gun } from './Gun';
import { aimAssist, sweepShot } from './Projectiles';

const territories = generateTerritories();

describe('Collision', () => {
  const box: Shape = { kind: 'box', x: 10, y: 1, z: 0, hx: 2, hy: 1, hz: 0.5, yaw: 0 };
  const turned: Shape = { ...box, yaw: Math.PI / 2 };

  it('finds where a sphere touches a box, and which way is out', () => {
    expect(sphereContact(13, 1, 0, 0.5, box)).toBeNull();
    const c = sphereContact(12.3, 1, 0, 0.5, box)!;
    expect(c.nx).toBeCloseTo(1);
    expect(c.depth).toBeCloseTo(0.2);
    const top = sphereContact(10, 2.2, 0, 0.5, box)!;
    expect(top.ny).toBeCloseTo(1);
  });

  it('turning a box about the vertical axis turns its faces with it', () => {
    // Turned a quarter, its long side runs along z.
    expect(sphereContact(10, 1, 2.3, 0.5, turned)).not.toBeNull();
    expect(sphereContact(12.3, 1, 0, 0.5, turned)).toBeNull();
    const c = sphereContact(10.7, 1, 0, 0.5, turned)!;
    expect(c.nx).toBeCloseTo(1);
  });

  it('a centre inside a box leaves by the nearest face', () => {
    const c = sphereContact(10, 1.9, 0, 0.3, box)!;
    expect(c.ny).toBe(1);
    expect(c.depth).toBeCloseTo(0.4);
  });

  it('sweeps segments against spheres and boxes', () => {
    const ball: Shape = { kind: 'sphere', x: 0, y: 0, z: 0, r: 1 };
    expect(segmentHit({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 0, ball)).toBeCloseTo(0.4);
    expect(segmentHit({ x: -5, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, 0, ball)).toBeNull();
    expect(segmentHit({ x: -5, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: 0 }, 0.6, ball)).not.toBeNull();
    expect(segmentHit({ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 0 }, 0, box)).toBeCloseTo(0.4);
    expect(segmentHit({ x: 0, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }, 0, box)).toBeNull();
    expect(segmentHit({ x: 10, y: 1, z: -3 }, { x: 10, y: 1, z: 3 }, 0, turned)).toBeCloseTo(1 / 6);
  });

  it('picks the first thing along a path, and measures distance to surfaces', () => {
    const near = { id: 'near', shapes: [{ kind: 'sphere', x: 5, y: 0, z: 0, r: 1 } as Shape] };
    const far = { id: 'far', shapes: [{ kind: 'sphere', x: 15, y: 0, z: 0, r: 1 } as Shape] };
    expect(firstHit({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, 0, [far, near])?.id).toBe('near');
    expect(distanceToShape({ x: 15, y: 1, z: 0 }, box)).toBeCloseTo(3);
    expect(distanceToShape({ x: 10, y: 1, z: 0 }, box)).toBe(0);
  });
});

describe('Damage', () => {
  it('gentle contacts are free; fast ones hurt, and head-on at cruise wrecks any plane', () => {
    expect(impactDamage(DAMAGE.safeImpactSpeed)).toBe(0);
    expect(impactDamage(2)).toBe(0);
    expect(impactDamage(8)).toBeGreaterThan(0);
    for (const a of Object.values(AIRCRAFT)) expect(impactDamage(a.flight.cruiseSpeed)).toBeGreaterThanOrEqual(a.maxHealth);
  });

  it('a slightly fast touchdown is a scratch; a steep one is serious', () => {
    const scratch = roughLandingDamage({ speed: LANDING.maxSpeed + 2, sink: 2, roll: 0 });
    const steep = roughLandingDamage({ speed: 24, sink: 12, roll: 0 });
    expect(scratch).toBeGreaterThan(0);
    expect(scratch).toBeLessThan(AIRCRAFT.dart.maxHealth / 2);
    expect(steep).toBeGreaterThan(AIRCRAFT.falcon.maxHealth * 0.6);
  });

  it('health never goes below zero and can be repaired', () => {
    const d = new Durability(50);
    expect(d.damage(20)).toBe(20);
    expect(d.damage(80)).toBe(30);
    expect(d.destroyed).toBe(true);
    expect(d.damage(5)).toBe(0);
    d.repair();
    expect(d.fraction).toBe(1);
  });

  it('heavy damage makes a plane harder to fly, within limits', () => {
    expect(handlingFactor(1)).toBe(1);
    expect(handlingFactor(DAMAGE.handlingThreshold)).toBe(1);
    expect(handlingFactor(0)).toBe(DAMAGE.handlingFloor);
    expect(wobbleAmount(0.9)).toBe(0);
    expect(wobbleAmount(0)).toBe(DAMAGE.wobble);
  });

  it('bomb blasts fade towards the edge', () => {
    expect(blastDamage(90, 5, 0)).toBe(90);
    expect(blastDamage(90, 5, 5)).toBe(27);
    expect(blastDamage(90, 5, 5.1)).toBe(0);
  });
});

describe('Gun', () => {
  it('fires in turn from each barrel, limited by rate and ammunition, and rearms', () => {
    const gun = new Gun({ ...AIRCRAFT.falcon.gun, ammo: 3 });
    expect(gun.fire()).toBe(0);
    expect(gun.fire()).toBeNull(); // still chambering
    gun.update(AIRCRAFT.falcon.gun.interval);
    expect(gun.fire()).toBe(1);
    gun.update(1);
    expect(gun.fire()).toBe(0);
    gun.update(1);
    expect(gun.empty).toBe(true);
    expect(gun.fire()).toBeNull();
    gun.refill();
    expect(gun.ammo).toBe(3);
  });
});

describe('target range', () => {
  const specs = layoutTargetRange(territories);

  it('puts three practice planes and two props on every unclaimed territory, none at home', () => {
    expect(specs).toHaveLength(8 * 5);
    expect(specs.some((s) => s.territoryId === 'T1')).toBe(false);
    for (const t of territories.filter((x) => !x.isHome)) {
      const own = specs.filter((s) => s.territoryId === t.id);
      expect(own.filter((s) => s.kind === 'dummy')).toHaveLength(3);
      expect(new Set(own.filter((s) => s.kind === 'dummy').map((s) => s.aircraft)).size).toBe(3);
      for (const s of own) expect(t.containsXZ(s.x, s.z, -2)).toBe(true);
      // The centre stays clear for bullseyes.
      for (const s of own) expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeGreaterThan(10);
    }
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it('a plane flies into no more than you can see, while rounds get a generous target', () => {
    for (const s of specs) {
      expect(s.solids.length).toBe(s.shapes.length);
      if (s.kind !== 'dummy') continue;
      const [hit, solid] = [s.shapes[0], s.solids[0]];
      expect(hit.kind === 'sphere' && solid.kind === 'sphere' && solid.r < hit.r).toBe(true);
    }
  });

  it('practice planes have names and roles for their labels', () => {
    const dummy = specs.find((s) => s.kind === 'dummy')!;
    expect(dummy.name).toMatch(/^Practice (Dart|Falcon|Swift|Widewing)$/);
    expect(dummy.role).toMatch(/dummy$/);
  });

  it('targets take damage, go down, and fold back up after a while', () => {
    const target = new Destructible(specs[0]);
    expect(target.damage(15)).toEqual({ dealt: 15, destroyed: false });
    expect(target.damage(100)).toEqual({ dealt: TARGETS.dummyHealth - 15, destroyed: true });
    expect(target.alive).toBe(false);
    expect(target.damage(10).dealt).toBe(0);
    expect(target.update(TARGETS.respawnTime - 1)).toBe(false);
    expect(target.update(1)).toBe(true);
    expect(target.health).toBe(TARGETS.dummyHealth);
  });
});

describe('sweepShot', () => {
  const t5 = territories.find((t) => t.id === 'T5')!;
  const dummy = { id: 'dummy', shapes: [{ kind: 'sphere', x: t5.x, y: 8, z: t5.z, r: 1.7 } as Shape] };

  it('ink hits a practice plane in its path', () => {
    expect(sweepShot({ x: t5.x - 5, y: 8, z: t5.z }, { x: t5.x + 5, y: 8, z: t5.z }, 0.12, [dummy], territories)).toMatchObject({ kind: 'object', id: 'dummy' });
  });

  it('ink fired into a platform splats on it; a miss flies on', () => {
    expect(sweepShot({ x: t5.x, y: 2, z: t5.z }, { x: t5.x, y: -1, z: t5.z }, 0.12, [dummy], territories)).toMatchObject({ kind: 'platform', territoryId: 'T5' });
    expect(sweepShot({ x: t5.x, y: 20, z: t5.z }, { x: t5.x + 5, y: 20, z: t5.z }, 0.12, [dummy], territories)).toBeNull();
  });

  it('the nearer of a target and a platform is hit', () => {
    // Fired down through the dummy towards the ground: the dummy is first.
    expect(sweepShot({ x: t5.x, y: 12, z: t5.z }, { x: t5.x, y: -1, z: t5.z }, 0.12, [dummy], territories)?.kind).toBe('object');
  });
});

describe('ink against aircraft', () => {
  const plane = (x: number, z: number, px = x, pz = z) => ({ id: 'bandit', x, y: 20, z, px, py: 20, pz, r: AIRCRAFT.falcon.hitRadius });

  it('hits an aircraft that crosses the round between frames', () => {
    const hit = sweepShot({ x: 0, y: 20, z: 0 }, { x: 0, y: 20, z: -4 }, WEAPONS.projectileRadius, [], [], [plane(1.5, -2, -1.5, -2)]);
    expect(hit).toMatchObject({ kind: 'object', id: 'bandit' });
    expect(sweepShot({ x: 0, y: 20, z: 0 }, { x: 0, y: 20, z: -4 }, WEAPONS.projectileRadius, [], [], [plane(6, -2, 5, -2)])).toBeNull();
  });

  it('aim assistance widens aircraft a little within a small cone, never close in and never by much', () => {
    expect(aimAssist(0)).toBe(0);
    expect(aimAssist(10)).toBeLessThan(0.3);
    expect(aimAssist(40)).toBeGreaterThan(aimAssist(10));
    expect(aimAssist(500)).toBe(WEAPONS.aimAssist.max);
    // A round passing just outside the plane: a miss at the muzzle, a hit after 40 m of flight.
    const miss = AIRCRAFT.falcon.hitRadius + WEAPONS.projectileRadius + 0.5;
    const args = [{ x: miss, y: 20, z: 0 }, { x: miss, y: 20, z: -4 }, WEAPONS.projectileRadius, [], [], [plane(0, -2)]] as const;
    expect(sweepShot(...args, aimAssist(2))).toBeNull();
    expect(sweepShot(...args, aimAssist(40))).not.toBeNull();
  });
});

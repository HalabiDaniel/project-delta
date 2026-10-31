import { Mat4, Quat, Vec3 } from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT, PLANE } from '../config';
import { generateTerritories } from '../world/WorldGenerator';
import { FlightModel, wrapAngle, type FlightControls } from './FlightModel';

const territories = generateTerritories();
const DT = 1 / 60;
const idle: FlightControls = { mouseDX: 0, mouseDY: 0, throttle: 0, bank: 0, boost: false, autoLevel: true, autopilot: null, gliding: false };

describe('FlightModel', () => {
  it('spawns already flying, with no climb-out and no home to land on', () => {
    const m = new FlightModel(AIRCRAFT.falcon);
    m.spawn({ x: 0, y: 30, z: 0 }, 0);
    expect(m.status).toBe('flying');
    expect(m.speed).toBe(AIRCRAFT.falcon.flight.cruiseSpeed);
    for (let t = 0; t < 1; t += DT) m.fly(DT, idle, territories, []);
    // No automatic climb: it holds its height.
    expect(Math.abs(m.position.y - 30)).toBeLessThan(0.5);
  });

  it('flies wherever an aim direction points it, through the same banking turns as the player', () => {
    const m = new FlightModel(AIRCRAFT.falcon);
    m.spawn({ x: 0, y: 40, z: 0 }, 0);
    const aim = { yaw: Math.PI / 2, pitch: 0.2 };
    let maxBank = 0;
    for (let t = 0; t < 4; t += DT) {
      m.fly(DT, { ...idle, aim }, territories, []);
      maxBank = Math.max(maxBank, Math.abs(m.roll));
    }
    expect(Math.abs(wrapAngle(m.yaw - aim.yaw))).toBeLessThan(0.05);
    expect(Math.abs(m.pitch - aim.pitch)).toBeLessThan(0.05);
    // It banked into the turn and levelled out once it got there.
    expect(maxBank).toBeGreaterThan(0.5);
    expect(Math.abs(m.roll)).toBeLessThan(0.1);
  });

  it('turns no faster than its design allows: the Falcon out-turns the Widewing', () => {
    const turned = (id: 'falcon' | 'widewing') => {
      const m = new FlightModel(AIRCRAFT[id]);
      m.spawn({ x: 0, y: 40, z: 0 }, 0);
      for (let t = 0; t < 1.5; t += DT) m.fly(DT, { ...idle, aim: { yaw: m.yaw + 1, pitch: 0 } }, territories, []);
      return wrapAngle(m.yaw);
    };
    expect(turned('falcon')).toBeGreaterThan(turned('widewing') + 0.4);
  });

  it('throttle and boost change the speed within the design limits', () => {
    const m = new FlightModel(AIRCRAFT.dart);
    const f = AIRCRAFT.dart.flight;
    m.spawn({ x: 0, y: 40, z: 0 }, 0);
    for (let t = 0; t < 3; t += DT) m.fly(DT, { ...idle, throttle: 1, aim: { yaw: 0, pitch: 0 } }, territories, []);
    expect(m.speed).toBeGreaterThan(f.maxSpeed - 1);
    for (let t = 0; t < 0.8; t += DT) m.fly(DT, { ...idle, boost: true, aim: { yaw: 0, pitch: 0 } }, territories, []);
    expect(m.speed).toBeGreaterThan(f.maxSpeed + f.boostSpeed / 2);
    expect(m.speed).toBeLessThanOrEqual(f.maxSpeed + f.boostSpeed);
  });

  it('bounces off a platform it flies into and reports how hard', () => {
    const m = new FlightModel(AIRCRAFT.falcon);
    const t5 = territories.find((t) => t.id === 'T5')!;
    m.spawn({ x: t5.x, y: 3, z: t5.z }, 0, 20, -PLANE.maxPitch);
    let closing = 0;
    for (let t = 0; t < 1 && closing === 0; t += DT) {
      for (const c of m.fly(DT, { ...idle, aim: { yaw: 0, pitch: -PLANE.maxPitch } }, territories, []).collisions) closing = c.closing;
    }
    expect(closing).toBeGreaterThan(5);
    expect(m.position.y).toBeGreaterThan(t5.top);
  });

  it('places points in the plane frame exactly where its model is drawn', () => {
    const m = new FlightModel(AIRCRAFT.falcon);
    m.spawn({ x: 3, y: 20, z: -4 }, 0.7, 20, 0.3);
    m.roll = -0.5;
    const q = new Quat()
      .setFromAxisAngle(Vec3.UP, (m.yaw * 180) / Math.PI)
      .mul(new Quat().setFromAxisAngle(Vec3.RIGHT, (m.pitch * 180) / Math.PI))
      .mul(new Quat().setFromAxisAngle(Vec3.BACK, (m.roll * 180) / Math.PI));
    const matrix = new Mat4().setTRS(m.position, q, Vec3.ONE);
    const expected = matrix.transformPoint(new Vec3(0.4, 0.1, -1.2), new Vec3());
    const got = m.toWorld(0.4, 0.1, -1.2, { x: 0, y: 0, z: 0 });
    expect(got.x).toBeCloseTo(expected.x, 5);
    expect(got.y).toBeCloseTo(expected.y, 5);
    expect(got.z).toBeCloseTo(expected.z, 5);
  });
});

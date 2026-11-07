import { describe, expect, it } from 'vitest';
import { ACRO, AIRCRAFT, AIRCRAFT_ORDER, MANEUVERS, MANEUVER_ORDER, PLANE, type AircraftId, type ManeuverId } from '../config';
import { packFrames, parseCommand, unpackFrames, NEUTRAL_FRAME } from '../net/protocol';
import { GameState } from '../systems/GameState';
import { ResourceManager } from '../systems/ResourceManager';
import { generateTerritories } from '../world/WorldGenerator';
import { eulerToMatrix, FLIGHT_SNAPSHOT_SIZE, FlightModel, interpolateAttitude, wrapAngle, type FlightControls } from './FlightModel';
import { cycleManeuver, defaultManeuver, designsWith, maneuverDuration, TRACKS } from './maneuvers';

const DT = 1 / 60;
const idle: FlightControls = { mouseDX: 0, mouseDY: 0, throttle: 0, bank: 0, boost: false, autoLevel: true, autopilot: null };
/** Reverses the heading: the move comes out flying the other way. */
const REVERSES: ReadonlySet<ManeuverId> = new Set(['foldBack', 'diveFold', 'paperHang', 'paperPivot']);

function flying(id: AircraftId, slot: ManeuverId | null, yaw = 0, y = 40, speed?: number): FlightModel {
  const m = new FlightModel(AIRCRAFT[id]);
  m.spawn({ x: 0, y, z: 0 }, yaw, speed ?? AIRCRAFT[id].flight.cruiseSpeed);
  m.maneuverSlot = slot;
  return m;
}

/** Presses the Maneuver key, then flies until the move is over (or `limit` seconds). */
function fly(m: FlightModel, controls: Partial<FlightControls> = {}, limit = 6): { time: number; minY: number; maxY: number } {
  m.fly(DT, { ...idle, ...controls, maneuver: true }, [], []);
  let time = 0, minY = m.position.y, maxY = m.position.y;
  while (m.activeManeuver && time < limit) {
    m.fly(DT, { ...idle, ...controls }, [], []);
    time += DT;
    minY = Math.min(minY, m.position.y);
    maxY = Math.max(maxY, m.position.y);
  }
  return { time, minY, maxY };
}

describe('maneuver sets (v0.0.16)', () => {
  it('fighters, multiroles and recon planes have maneuvers; bombers have none', () => {
    for (const id of AIRCRAFT_ORDER) {
      const spec = AIRCRAFT[id];
      if (spec.role === 'bomber') expect(spec.maneuvers, id).toEqual([]);
      else expect(spec.maneuvers.length, id).toBeGreaterThan(0);
      expect(new Set(spec.maneuvers).size).toBe(spec.maneuvers.length);
      for (const m of spec.maneuvers) expect(MANEUVER_ORDER).toContain(m);
    }
  });

  it('every maneuver is on at least one plane, and several are shared between planes', () => {
    for (const m of MANEUVER_ORDER) expect(designsWith(m).length, m).toBeGreaterThan(0);
    expect(MANEUVER_ORDER.filter((m) => designsWith(m).length > 1).length).toBeGreaterThanOrEqual(6);
  });

  it('the slot defaults to the first of the set and cycles through it', () => {
    const falcon = AIRCRAFT.falcon;
    expect(defaultManeuver(falcon)).toBe(falcon.maneuvers[0]);
    expect(defaultManeuver(falcon, 'spiralDrill')).toBe(falcon.maneuvers[0]); // not one the Falcon carries
    expect(defaultManeuver(AIRCRAFT.widewing)).toBeNull();
    let m: ManeuverId | null = falcon.maneuvers[0];
    for (let i = 0; i < falcon.maneuvers.length; i++) m = cycleManeuver(falcon, m, 1);
    expect(m).toBe(falcon.maneuvers[0]);
    expect(cycleManeuver(falcon, falcon.maneuvers[0], -1)).toBe(falcon.maneuvers[falcon.maneuvers.length - 1]);
  });

  it('nimbler planes fly a move faster; a damaged plane slower', () => {
    expect(maneuverDuration('slipRoll', AIRCRAFT.falcon.flight)).toBeLessThan(maneuverDuration('slipRoll', AIRCRAFT.swift.flight));
    expect(maneuverDuration('slipRoll', AIRCRAFT.falcon.flight, 0.6)).toBeGreaterThan(maneuverDuration('slipRoll', AIRCRAFT.falcon.flight));
  });
});

describe('automatic maneuvers in the flight model', () => {
  it('every move on every plane that carries it ends level, the right way up, on the right heading', () => {
    for (const id of AIRCRAFT_ORDER) {
      for (const man of AIRCRAFT[id].maneuvers) {
        for (const yaw of [0, 1.1, -2.6]) {
          const m = flying(id, man, yaw, 45, AIRCRAFT[id].flight.maxSpeed);
          const { time } = fly(m);
          const label = `${id} ${man} yaw ${yaw}`;
          expect(m.activeManeuver, label).toBeNull();
          expect(time, label).toBeGreaterThan(0.5);
          expect(Math.abs(m.pitch), label).toBeLessThan(0.02);
          expect(Math.abs(m.roll), label).toBeLessThan(0.02);
          const want = REVERSES.has(man) ? yaw + Math.PI : yaw;
          expect(Math.abs(wrapAngle(m.yaw - want)), label).toBeLessThan(0.03);
          // The aim follows the new heading, so the plane does not swing back after a reversal.
          expect(Math.abs(wrapAngle(m.aimYaw - m.yaw)), label).toBeLessThan(1e-9);
          expect(m.throttleSpeed, label).toBeGreaterThanOrEqual(m.flight.minSpeed);
          expect(m.throttleSpeed, label).toBeLessThanOrEqual(m.flight.maxSpeed);
          expect(m.maneuverCooldown, label).toBe(MANEUVERS[man].cooldown);
        }
      }
    }
  });

  it('entered from a bank or a climb, it still comes out the right way up', () => {
    for (const man of ['foldBack', 'craneFlip', 'slipRoll'] as ManeuverId[]) {
      const m = flying('falcon', man, 0.4, 45, 30);
      m.roll = 0.7;
      m.pitch = 0.3;
      fly(m);
      // Normal flight then levels the wings.
      for (let t = 0; t < 2; t += DT) m.fly(DT, idle, [], []);
      expect(Math.abs(m.roll), man).toBeLessThan(0.1);
    }
  });

  it('the Crane Flip slows right down while the nose turns a full circle, sliding along its old path', () => {
    const m = flying('falcon', 'craneFlip', 0, 40, 30);
    m.fly(DT, { ...idle, maneuver: true }, [], []);
    let maxPitch = 0, minSpeed = Infinity, inverted = false;
    while (m.activeManeuver) {
      m.fly(DT, idle, [], []);
      maxPitch = Math.max(maxPitch, m.pitch);
      minSpeed = Math.min(minSpeed, m.speed);
      if (Math.abs(m.roll) > 2.5) inverted = true;
    }
    expect(maxPitch).toBeGreaterThan(1.5);
    expect(inverted).toBe(true);
    expect(minSpeed).toBeLessThan(m.flight.minSpeed);
    // It barely climbed: the velocity kept to the old path while the nose went round.
    expect(Math.abs(m.position.y - 40)).toBeLessThan(3);
    expect(m.position.z).toBeLessThan(-5);
  });

  it('the Slip Roll shoves the plane sideways, towards A or D', () => {
    const left = flying('falcon', 'slipRoll');
    fly(left, { bank: 1 });
    const right = flying('falcon', 'slipRoll');
    fly(right, { bank: -1 });
    expect(left.position.x).toBeLessThan(-4);
    expect(right.position.x).toBeGreaterThan(4);
  });

  it('Fold Back climbs, Dive Fold dives', () => {
    const up = flying('falcon', 'foldBack');
    expect(fly(up).maxY).toBeGreaterThan(48);
    const down = flying('falcon', 'diveFold');
    expect(fly(down).minY).toBeLessThan(32);
    expect(down.speed).toBeGreaterThan(down.flight.cruiseSpeed);
  });

  it('refuses with a reason: no slot, not ready, too slow, too low, no room', () => {
    const bomber = flying('widewing', null);
    bomber.fly(DT, { ...idle, maneuver: true }, [], []);
    expect(bomber.lastRefusal).toBe('none');
    expect(bomber.activeManeuver).toBeNull();

    const m = flying('falcon', 'foldBack');
    fly(m);
    m.fly(DT, { ...idle, maneuver: true }, [], []);
    expect(m.lastRefusal).toBe('cooldown');
    for (let t = 0; t < MANEUVERS.foldBack.cooldown + 0.1; t += DT) m.fly(DT, idle, [], []);
    expect(m.maneuverReadiness).toBe(1);

    const slow = flying('falcon', 'craneFlip', 0, 40, AIRCRAFT.falcon.flight.minSpeed);
    slow.fly(DT, { ...idle, maneuver: true }, [], []);
    expect(slow.lastRefusal).toBe('slow');

    const low = flying('falcon', 'diveFold', 0, -12);
    low.fly(DT, { ...idle, maneuver: true }, [], []);
    expect(low.lastRefusal).toBe('low');
    expect(low.position.y).toBeCloseTo(-12 + 0, 0); // the check moved nothing

    // A desk right above: no room for a Fold Back's half loop.
    const territories = generateTerritories();
    const t1 = territories[0];
    const under = flying('falcon', 'foldBack', 0, t1.bottom - 6);
    under.position.x = t1.x;
    under.position.z = t1.z + t1.half - 4;
    under.fly(DT, { ...idle, maneuver: true }, territories, []);
    expect(under.lastRefusal).toBe('room');
  });

  it('hitting something ends the move with the normal impact rules', () => {
    const territories = generateTerritories();
    const t1 = territories[0];
    const m = flying('falcon', 'diveFold', 0, t1.top + 9);
    m.position.x = t1.x;
    m.position.z = t1.z;
    m.fly(DT, { ...idle, maneuver: true }, [], []); // started in the clear (no colliders yet)
    expect(m.activeManeuver).toBe('diveFold');
    let hit = false;
    for (let t = 0; t < 4 && !hit; t += DT) hit = m.fly(DT, idle, territories, []).collisions.length > 0;
    expect(hit).toBe(true);
    expect(m.activeManeuver).toBeNull();
    expect(m.mode).toBe('normal');
    expect(Math.abs(m.pitch)).toBeLessThanOrEqual(PLANE.maxPitch + 1e-9);
  });

  it('the snapshot carries a move in progress: restore and replay give the same flight', () => {
    const a = flying('raptor', 'paperHang', 0.5);
    a.fly(DT, { ...idle, maneuver: true }, [], []);
    for (let i = 0; i < 40; i++) a.fly(DT, idle, [], []);
    const snap = a.saveState();
    expect(snap.length).toBe(FLIGHT_SNAPSHOT_SIZE);
    const b = new FlightModel(AIRCRAFT.raptor);
    expect(b.loadState(snap)).toBe(true);
    expect(b.activeManeuver).toBe('paperHang');
    expect(b.maneuverSlot).toBe('paperHang');
    for (let i = 0; i < 120; i++) {
      a.fly(DT, { ...idle, mouseDX: 3 }, [], []);
      b.fly(DT, { ...idle, mouseDX: 3 }, [], []);
    }
    expect(b.saveState()).toEqual(a.saveState());
  });

  it('every track turns by exactly its angles, whatever the step length', () => {
    for (const id of MANEUVER_ORDER) {
      for (const step of [1 / 30, 1 / 60, 1 / 144]) {
        const m = flying('falcon', id);
        m.maneuverSlot = id;
        // Fly with the given step; any combination of spec sets works the same, so force the slot.
        (m as unknown as { design: { maneuvers: ManeuverId[] } }).design = { ...AIRCRAFT.falcon, maneuvers: [id] } as never;
        m.fly(step, { ...idle, maneuver: true }, [], []);
        expect(m.activeManeuver, id).toBe(id);
        let t = 0;
        while (m.activeManeuver && t < 8) {
          m.fly(step, idle, [], []);
          t += step;
        }
        expect(Math.abs(m.pitch) + Math.abs(m.roll), `${id} @ ${step}`).toBeLessThan(0.02);
      }
      expect(TRACKS[id].turns.length).toBeGreaterThan(0);
    }
  });
});

describe('manual maneuvers: what the flight model allows', () => {
  it('pulling on past the pitch limit loops the plane through vertical and back upright', () => {
    const m = flying('falcon', null);
    let looped = false, inverted = false, maxPitch = 0;
    for (let t = 0; t < 7; t += DT) {
      m.fly(DT, { ...idle, mouseDY: t < 4 ? -8 : 0 }, [], []);
      if (m.mode === 'loop') looped = true;
      if (Math.abs(m.roll) > 2.5) inverted = true;
      maxPitch = Math.max(maxPitch, m.pitch);
    }
    expect(looped).toBe(true);
    expect(inverted).toBe(true);
    expect(maxPitch).toBeGreaterThan(PLANE.maxPitch + 0.3);
    // Let go: it carries on to within the normal limit, rolls upright and hands back.
    expect(m.mode).toBe('normal');
    expect(Math.abs(m.roll)).toBeLessThan(0.2);
    expect(Math.abs(wrapAngle(m.aimYaw - m.yaw))).toBeLessThan(1e-9);
  });

  it('bombers keep the pitch limit: no loops', () => {
    const m = flying('widewing', null);
    for (let t = 0; t < 5; t += DT) {
      m.fly(DT, { ...idle, mouseDY: -8 }, [], []);
      expect(m.mode).toBe('normal');
      expect(m.pitch).toBeLessThanOrEqual(PLANE.maxPitch + 1e-9);
    }
  });

  it('the air brake: holding S at the bottom of the throttle slows far below the minimum, and the boost recovers', () => {
    const m = flying('falcon', null);
    for (let t = 0; t < 4; t += DT) m.fly(DT, { ...idle, throttle: -1 }, [], []);
    expect(m.speed).toBeLessThan(m.flight.minSpeed * 0.6);
    expect(m.speed).toBeGreaterThanOrEqual(m.flight.minSpeed * ACRO.airbrakeFloor - 1e-9);
    for (let t = 0; t < 1; t += DT) m.fly(DT, { ...idle, boost: true }, [], []);
    expect(m.speed).toBeGreaterThan(m.flight.cruiseSpeed);
  });

  it('brake and let pass: a chaser at the same speed overshoots a braking plane', () => {
    const me = flying('falcon', null, 0, 40, 24);
    const chaser = flying('falcon', null, 0, 40, 24);
    chaser.position.z = 14; // 14 m behind (the planes fly towards -z)
    for (let t = 0; t < 3; t += DT) {
      me.fly(DT, { ...idle, throttle: -1, mouseDY: t < 0.4 ? -6 : 0 }, [], []);
      chaser.fly(DT, idle, [], []);
    }
    expect(chaser.position.z).toBeLessThan(me.position.z);
  });

  it('slower turns tighter: braking in a turn out-turns the same turn at full speed', () => {
    const turn = (throttle: number, speed: number) => {
      const m = flying('falcon', null, 0, 40, speed);
      const start = m.yaw;
      for (let t = 0; t < 2; t += DT) m.fly(DT, { ...idle, throttle, aim: { yaw: m.yaw + 1.2, pitch: 0 } }, [], []);
      return wrapAngle(m.yaw - start);
    };
    expect(turn(-1, AIRCRAFT.falcon.flight.minSpeed)).toBeGreaterThan(turn(1, AIRCRAFT.falcon.flight.maxSpeed) + 0.2);
  });
});

describe('the maneuver slot is chosen at home, before take-off', () => {
  it('locks in the air and changes again after landing', () => {
    const state = new GameState(new ResourceManager(), () => []);
    state.aircraft = 'falcon';
    expect(state.maneuverSlot).toBe(AIRCRAFT.falcon.maneuvers[0]);
    expect(state.chooseManeuver('paperHang')).toBe(true);
    expect(state.maneuverSlot).toBe('paperHang');
    expect(state.chooseManeuver('spiralDrill')).toBe(false); // the Falcon can't carry it
    state.phase = 'flying';
    expect(state.canChangeManeuver()).toBe(false);
    expect(state.cycleManeuver(1)).toBe(false);
    expect(state.chooseManeuver('foldBack')).toBe(false);
    state.phase = 'landed';
    expect(state.cycleManeuver(1)).toBe(true);
    expect(state.maneuverSlot).not.toBe('paperHang');
    // Each design remembers its own choice.
    state.phase = 'desk';
    expect(state.selectAircraft('dart')).toBe(true);
    expect(state.maneuverSlot).toBe(AIRCRAFT.dart.maneuvers[0]);
    state.aircraft = 'widewing';
    expect(state.maneuverSlot).toBeNull();
    expect(state.canChangeManeuver()).toBe(false);
  });
});

describe('maneuvers on the network', () => {
  it('the Maneuver press travels in the input frame', () => {
    const packed = packFrames([{ ...NEUTRAL_FRAME, seq: 7, maneuver: true }, { ...NEUTRAL_FRAME, seq: 8 }]);
    const [a, b] = unpackFrames(packed);
    expect(a.maneuver).toBe(true);
    expect(b.maneuver).toBe(false);
  });

  it('the maneuver command is checked', () => {
    expect(parseCommand({ a: 'maneuver', id: 'craneFlip' })).toEqual({ a: 'maneuver', id: 'craneFlip' });
    expect(parseCommand({ a: 'maneuver', id: 'teleport' })).toBeNull();
  });

  it('attitude interpolation follows the shortest rotation, also through vertical', () => {
    // Just past straight up the angles jump (yaw and bank by half a turn); the plane hardly moved.
    const a = { yaw: 0, pitch: 1.5, roll: 0 };
    const b = { yaw: Math.PI, pitch: 1.5, roll: Math.PI };
    const mid = interpolateAttitude(a, b, 0.5, { yaw: 0, pitch: 0, roll: 0 });
    const ma = eulerToMatrix(a.yaw, a.pitch, a.roll, new Float64Array(9));
    const mm = eulerToMatrix(mid.yaw, mid.pitch, mid.roll, new Float64Array(9));
    // The nose (−Z column) of the midpoint is close to straight up, not swung round through level.
    expect(-mm[5]).toBeGreaterThan(0.99);
    expect(-ma[5]).toBeGreaterThan(0.99);
  });
});

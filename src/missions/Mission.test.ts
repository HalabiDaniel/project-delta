import { describe, expect, it } from 'vitest';
import { crossesRing, insideAirspace, Mission, type MissionSpec, type RingGate } from './Mission';

const zone = { x: 0, z: 0, radius: 5, top: 0.3 };
const airspace = { x: 70, z: 0, half: 20, ceiling: 20 };

function mission(overrides: Partial<MissionSpec> = {}): Mission {
  return new Mission({
    type: 'bombing',
    difficulty: 'easy',
    title: 'Test',
    description: '',
    reward: 50,
    bombs: 1,
    timeLimit: null,
    ordered: false,
    objectives: [{ kind: 'bomb', territoryId: 'T5', zone, precision: false }],
    ...overrides,
  });
}

describe('Mission', () => {
  it('moves available → active → succeeded, once', () => {
    const m = mission();
    expect(m.succeed()).toBe(false); // not started
    expect(m.start()).toBe(true);
    expect(m.start()).toBe(false);
    expect(m.succeed()).toBe(true);
    expect(m.succeed()).toBe(false);
    expect(m.fail('missed')).toBe(false);
    expect(m.status).toBe('succeeded');
  });

  it('records why it failed', () => {
    const m = mission();
    m.start();
    expect(m.fail('aircraft-lost')).toBe(true);
    expect(m.failure).toBe('aircraft-lost');
    expect(m.completeBomb(0)).toBe(false); // too late
  });

  it('bomb objectives only complete while active and open', () => {
    const m = mission();
    expect(m.completeBomb(0)).toBe(false);
    m.start();
    expect(m.completeBomb(0)).toBe(true);
    expect(m.completeBomb(0)).toBe(false);
    expect(m.allDone).toBe(true);
  });

  it('unordered objectives are all open; ordered ones open one at a time', () => {
    const objectives: MissionSpec['objectives'] = [
      { kind: 'bomb', territoryId: 'T5', zone, precision: false },
      { kind: 'bomb', territoryId: 'T9', zone: { ...zone, x: 70 }, precision: false },
    ];
    const any = mission({ objectives });
    expect(any.openObjectives()).toEqual([0, 1]);
    const ordered = mission({ objectives, ordered: true });
    ordered.start();
    expect(ordered.openObjectives()).toEqual([0]);
    expect(ordered.completeBomb(1)).toBe(false);
    expect(ordered.completeBomb(0)).toBe(true);
    expect(ordered.openObjectives()).toEqual([1]);
  });

  it('recon fills up only while inside the airspace and below its ceiling', () => {
    const m = mission({ type: 'recon', bombs: 0, objectives: [{ kind: 'recon', territoryId: 'T6', airspace, duration: 2 }] });
    m.start();
    const inside = { x: 70, y: 10, z: 5 };
    const tooHigh = { x: 70, y: 30, z: 5 };
    expect(m.updateFlight(inside, inside, 1)).toEqual([]);
    expect(m.progress[0]).toBeCloseTo(0.5);
    m.updateFlight(tooHigh, tooHigh, 1);
    expect(m.progress[0]).toBeCloseTo(0.5);
    expect(m.updateFlight(inside, inside, 1)).toEqual([0]);
    expect(m.allDone).toBe(true);
  });

  it('reach completes on entering the airspace', () => {
    const m = mission({ type: 'delivery', bombs: 0, objectives: [{ kind: 'reach', territoryId: 'T6', airspace }] });
    m.start();
    expect(m.updateFlight({ x: 20, y: 10, z: 0 }, { x: 40, y: 10, z: 0 }, 0.1)).toEqual([]);
    expect(m.updateFlight({ x: 40, y: 10, z: 0 }, { x: 52, y: 10, z: 0 }, 0.1)).toEqual([0]);
  });

  it('rings must be flown in order', () => {
    const g1: RingGate = { x: 0, y: 10, z: -20, yaw: 0, radius: 4 };
    const g2: RingGate = { x: 0, y: 10, z: -40, yaw: 0, radius: 4 };
    const m = mission({
      type: 'rings',
      bombs: 0,
      ordered: true,
      objectives: [
        { kind: 'ring', gate: g1, number: 1 },
        { kind: 'ring', gate: g2, number: 2 },
      ],
    });
    m.start();
    // Through ring 2 first: doesn't count.
    expect(m.updateFlight({ x: 0, y: 10, z: -38 }, { x: 0, y: 10, z: -42 }, 0.1)).toEqual([]);
    expect(m.updateFlight({ x: 0, y: 10, z: -18 }, { x: 0, y: 10, z: -22 }, 0.1)).toEqual([0]);
    expect(m.updateFlight({ x: 0, y: 10, z: -38 }, { x: 0, y: 10, z: -42 }, 0.1)).toEqual([1]);
  });

  it('times out exactly once when it has a time limit', () => {
    const m = mission({ timeLimit: 2 });
    m.start();
    expect(m.tick(1.5)).toBe(false);
    expect(m.timeLeft).toBeCloseTo(0.5);
    expect(m.tick(1)).toBe(true);
    m.fail('out-of-time');
    expect(m.tick(1)).toBe(false);
  });

  it('a landing objective completes on the right territory only', () => {
    const m = mission({
      type: 'return',
      ordered: true,
      objectives: [
        { kind: 'bomb', territoryId: 'T5', zone, precision: false },
        { kind: 'land', territoryId: 'T1' },
      ],
    });
    m.start();
    expect(m.completeLanding('T1')).toBe(false); // must bomb first
    m.completeBomb(0);
    expect(m.completeLanding('T2')).toBe(false);
    expect(m.completeLanding('T1')).toBe(true);
    expect(m.allDone).toBe(true);
  });
});

describe('destroy objectives', () => {
  const practice = () =>
    mission({
      type: 'practice',
      bombs: 0,
      objectives: [{ kind: 'destroy', territoryId: 'T4', targets: ['T4-d1', 'T4-d2', 'T4-d3'], count: 2 }],
    });

  it('count each practice target once, and complete at the required number', () => {
    const m = practice();
    expect(m.completeDestroy('T4-d1')).toEqual([]); // not started
    m.start();
    expect(m.completeDestroy('T4-d1')).toEqual([]);
    expect(m.progress[0]).toBeCloseTo(0.5);
    expect(m.completeDestroy('T4-d1')).toEqual([]); // respawned and shot again: still one
    expect(m.completeDestroy('T5-d1')).toEqual([]); // not one of ours
    expect(m.completeDestroy('T4-d3')).toEqual([0]);
    expect(m.allDone).toBe(true);
    expect([...m.destroyedTargets(0)].sort()).toEqual(['T4-d1', 'T4-d3']);
  });
});

describe('geometry', () => {
  it('insideAirspace checks the square and the ceiling', () => {
    expect(insideAirspace(airspace, { x: 89, y: 5, z: -19 })).toBe(true);
    expect(insideAirspace(airspace, { x: 91, y: 5, z: 0 })).toBe(false);
    expect(insideAirspace(airspace, { x: 70, y: 21, z: 0 })).toBe(false);
  });

  it('crossesRing needs the step to pass through the disc', () => {
    const gate: RingGate = { x: 0, y: 10, z: 0, yaw: 0, radius: 4 };
    expect(crossesRing(gate, { x: 0, y: 10, z: 1 }, { x: 0, y: 10, z: -1 })).toBe(true);
    expect(crossesRing(gate, { x: 0, y: 10, z: -1 }, { x: 0, y: 10, z: 1 })).toBe(true); // either direction
    expect(crossesRing(gate, { x: 3, y: 12, z: 1 }, { x: 3, y: 12, z: -1 })).toBe(true);
    expect(crossesRing(gate, { x: 5, y: 10, z: 1 }, { x: 5, y: 10, z: -1 })).toBe(false); // beside it
    expect(crossesRing(gate, { x: 0, y: 10, z: 3 }, { x: 0, y: 10, z: 1 })).toBe(false); // not there yet
    const sideways: RingGate = { ...gate, yaw: Math.PI / 2 }; // faces -X
    expect(crossesRing(sideways, { x: 1, y: 10, z: 0 }, { x: -1, y: 10, z: 0 })).toBe(true);
    expect(crossesRing(sideways, { x: 0, y: 10, z: 1 }, { x: 0, y: 10, z: -1 })).toBe(false);
  });
});

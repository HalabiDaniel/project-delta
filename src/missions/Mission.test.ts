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

describe('objectives against defenses', () => {
  it('survival counts time inside the airspace, below its ceiling', () => {
    const m = mission({ type: 'survival', bombs: 0, objectives: [{ kind: 'survive', territoryId: 'T6', airspace, duration: 3 }] });
    m.start();
    m.updateFlight({ x: 70, y: 10, z: 0 }, { x: 70, y: 10, z: 0 }, 2);
    m.updateFlight({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }, 5); // outside: doesn't count
    expect(m.progress[0]).toBeCloseTo(2 / 3);
    expect(m.updateFlight({ x: 70, y: 10, z: 0 }, { x: 70, y: 10, z: 0 }, 1)).toEqual([0]);
  });

  it('an escape completes once far enough away, and only after the reconnaissance', () => {
    const m = mission({
      type: 'danger-recon',
      bombs: 0,
      ordered: true,
      objectives: [
        { kind: 'recon', territoryId: 'T6', airspace, duration: 1 },
        { kind: 'escape', territoryId: 'T6', x: 70, z: 0, distance: 100 },
      ],
    });
    m.start();
    const far = { x: 70, y: 10, z: -120 };
    expect(m.updateFlight(far, far, 0.1)).toEqual([]); // the escape isn't open yet
    expect(m.updateFlight({ x: 70, y: 10, z: 0 }, { x: 70, y: 10, z: 0 }, 1)).toEqual([0]);
    expect(m.updateFlight({ x: 70, y: 10, z: -60 }, { x: 70, y: 10, z: -60 }, 0.1)).toEqual([]);
    expect(m.updateFlight(far, far, 0.1)).toEqual([1]);
  });

  it('a low-level approach is clean only if the plane stays low inside the zone; leaving resets it', () => {
    const approach = { x: 0, z: 0, radius: 50, ceiling: 12 };
    const m = mission({ type: 'low-attack', objectives: [{ kind: 'bomb', territoryId: 'T5', zone, precision: false, approach }] });
    m.start();
    const at = (x: number, y: number) => m.updateFlight({ x, y, z: 0 }, { x, y, z: 0 }, 0.1);
    at(-80, 30);
    expect(m.approachState(0)).toBe('outside');
    expect(m.releaseClean).toBe(false);
    at(-40, 10);
    expect(m.approachState(0)).toBe('clean');
    expect(m.releaseClean).toBe(true);
    at(-20, 20);
    expect(m.approachState(0)).toBe('blown');
    at(-20, 8); // coming back down inside the zone doesn't help
    expect(m.approachState(0)).toBe('blown');
    expect(m.completeBomb(0, false)).toBe(false);
    at(-80, 8);
    at(-40, 8);
    expect(m.approachState(0)).toBe('clean');
    expect(m.completeBomb(0, true)).toBe(true);
  });

  it('entering the zone too high blows the run at once', () => {
    const approach = { x: 0, z: 0, radius: 50, ceiling: 12 };
    const m = mission({ type: 'low-attack', objectives: [{ kind: 'bomb', territoryId: 'T5', zone, precision: false, approach }] });
    m.start();
    m.updateFlight({ x: -40, y: 30, z: 0 }, { x: -40, y: 30, z: 0 }, 0.1);
    expect(m.approachState(0)).toBe('blown');
  });

  it('in an ordered strike, a target destroyed early counts as soon as its stage opens', () => {
    const m = mission({
      type: 'multi-stage',
      ordered: true,
      objectives: [
        { kind: 'destroy', territoryId: 'T8', targets: ['T8-radar'], count: 1, what: 'radar' },
        { kind: 'destroy', territoryId: 'T8', targets: ['T8-supply'], count: 1, what: 'supply' },
        { kind: 'land', territoryId: 'T1' },
      ],
    });
    m.start();
    expect(m.completeDestroy('T8-supply')).toEqual([]); // the radar comes first
    expect(m.isDone(1)).toBe(false);
    // The radar opens the depot's stage, which is already down: both complete together.
    expect(m.completeDestroy('T8-radar')).toEqual([0, 1]);
    expect(m.settle()).toEqual([]);
    expect(m.completeLanding('T1')).toBe(true);
    expect(m.allDone).toBe(true);
  });
});

describe('objectives in the air', () => {
  const base = { difficulty: 'medium', title: '', description: '', reward: 50, bombs: 0, timeLimit: null, ordered: false } as const;

  it('intercepts count aircraft destroyed, once each, and fail only for their own targets', () => {
    const m = new Mission({ ...base, type: 'patrol', objectives: [{ kind: 'intercept', territoryId: 'T5', targets: ['a', 'b'], count: 2, what: 'aircraft', before: 'escape' }] });
    m.start();
    expect(m.lostTo('c', 'escape')).toBe(false);
    expect(m.lostTo('a', 'release')).toBe(false);
    expect(m.lostTo('a', 'escape')).toBe(true);
    m.completeDestroy('a');
    expect(m.lostTo('a', 'escape')).toBe(false);
    expect(m.progress[0]).toBe(0.5);
    expect(m.completeDestroy('b')).toEqual([0]);
  });

  it('patrols fill up inside the patrol area only', () => {
    const m = new Mission({ ...base, type: 'patrol', objectives: [{ kind: 'patrol', territoryId: 'T5', airspace: { x: 0, z: 0, half: 35, ceiling: 45 }, duration: 10 }] });
    m.start();
    m.updateFlight({ x: 0, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }, 5);
    m.updateFlight({ x: 0, y: 60, z: 0 }, { x: 0, y: 60, z: 0 }, 5);
    expect(m.patrolProgress).toBe(0.5);
  });

  it('an escort completes when its bomber hits, for its own bomber only', () => {
    const m = new Mission({ ...base, type: 'escort', objectives: [{ kind: 'escort', territoryId: 'T5', escort: 'friend', zone: { x: 0, z: 0, radius: 5, top: 0.3 } }] });
    m.start();
    expect(m.escorting('friend')).toBe(true);
    expect(m.completeEscort('stranger')).toBe(-1);
    expect(m.completeEscort('friend')).toBe(0);
    expect(m.escorting('friend')).toBe(false);
  });
});

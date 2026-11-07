import { describe, expect, it } from 'vitest';
import { assessSuitability } from '../aircraft/Aircraft';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT, MISSIONS } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import { Progress } from '../progress/Progress';
import { GameState } from '../systems/GameState';
import { seededRng } from '../systems/Random';
import { ResourceManager } from '../systems/ResourceManager';
import { validateSave } from '../systems/SaveGame';
import { landmarkSpot } from '../world/territories/decor';
import { generateTerritories } from '../world/WorldGenerator';
import { crossesRing, Mission } from './Mission';
import { generateMission, trialCircuit, type MissionContext } from './MissionGenerator';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = {
  territories,
  homeId: home.id,
  launch: { x: home.x + 8, z: home.z + 8 },
  dummies: range.filter((s) => s.kind === 'dummy'),
  obstacles: [],
  installations: layout.installations,
};

describe('v0.0.18: stunt courses', () => {
  it('has maneuver rings and one low pass, and bombers cannot fly it', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const spec = generateMission('stunt', 'medium', ctx, seededRng(seed));
      const gates = spec.objectives.flatMap((o) => (o.kind === 'ring' ? [o.gate] : []));
      expect(gates).toHaveLength(MISSIONS.stuntRings.medium);
      expect(gates.filter((g) => g.maneuver)).toHaveLength(MISSIONS.maneuverGates.medium);
      expect(gates.filter((g) => g.y === MISSIONS.lowGate)).toHaveLength(1);
      expect(gates[0].maneuver).toBeFalsy();
      expect(spec.ordered).toBe(true);
    }
    const spec = generateMission('stunt', 'easy', ctx, seededRng(1));
    expect(assessSuitability(AIRCRAFT.falcon, spec).level).not.toBe('unsuitable');
  });

  it('a maneuver ring only counts when flown through mid-maneuver', () => {
    const gate = { x: 0, y: 10, z: 0, yaw: 0, radius: 4, maneuver: true };
    const m = new Mission({ type: 'stunt', difficulty: 'easy', title: 'S', description: '', reward: 10, bombs: 0, timeLimit: null, ordered: true, objectives: [{ kind: 'ring', gate, number: 1 }] });
    m.start();
    const a = { x: 0, y: 10, z: 2 };
    const b = { x: 0, y: 10, z: -2 };
    expect(crossesRing(gate, a, b)).toBe(true);
    expect(m.updateFlight(a, b, 0.1, 1, false)).toEqual([]);
    expect(m.updateFlight(a, b, 0.1, 1, true)).toEqual([0]);
  });
});

describe('v0.0.18: time trials', () => {
  it("a desk's circuit is the same every time, so its record means something", () => {
    const t = territories.find((x) => x.id === 'T7')!;
    expect(trialCircuit(t, 6, 4)).toEqual(trialCircuit(t, 6, 4));
    const a = generateMission('time-trial', 'easy', ctx, seededRng(1), { target: t.id });
    const b = generateMission('time-trial', 'easy', ctx, seededRng(99), { target: t.id });
    expect(a.objectives).toEqual(b.objectives);
    expect(a.recordKey).toBe('time-trial:T7');
    expect(a.timeLimit).toBeGreaterThan(0);
  });

  it('every ring of the circuit faces along the loop, so it can be flown round in order', () => {
    const t = territories.find((x) => x.id === 'T6')!;
    const gates = trialCircuit(t, 6, 4);
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      const next = gates[(i + 1) % gates.length];
      // A step from just before the ring towards the next one passes through it.
      const dx = next.x - g.x;
      const dz = next.z - g.z;
      const l = Math.hypot(dx, dz);
      expect(crossesRing(g, { x: g.x - (dx / l) * 1, y: g.y, z: g.z - (dz / l) * 1 }, { x: g.x + (dx / l) * 1, y: g.y, z: g.z + (dz / l) * 1 })).toBe(true);
    }
  });
});

describe('v0.0.18: discovery flights', () => {
  it('fly to a landmark, and go to undiscovered ones first', () => {
    const spec = generateMission('discovery', 'easy', ctx, seededRng(3));
    const o = spec.objectives[0];
    expect(o.kind).toBe('reach');
    if (o.kind !== 'reach') return;
    const spot = landmarkSpot(territories.find((t) => t.id === o.territoryId)!)!;
    expect(o.airspace.x).toBeCloseTo(spot.x);
    expect(spec.title).toContain(spot.name);
    const visited = new Set(territories.filter((t) => t.id !== 'T9').map((t) => t.id));
    for (let seed = 1; seed <= 8; seed++) {
      const only = generateMission('discovery', 'easy', { ...ctx, visited }, seededRng(seed));
      expect((only.objectives[0] as { territoryId: string }).territoryId).toBe('T9');
    }
  });
});

describe('v0.0.18: delivery cargo', () => {
  it('easy deliveries carry nothing special; harder ones sometimes fragile or heavy cargo, paid more', () => {
    for (let seed = 1; seed <= 10; seed++) expect(generateMission('delivery', 'easy', ctx, seededRng(seed)).cargo).toBeUndefined();
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => generateMission('delivery', 'hard', ctx, seededRng(i + 1)).cargo));
    expect(kinds).toEqual(new Set([undefined, 'fragile', 'heavy']));
  });

  const deliver = (cargo: 'fragile' | 'heavy') => {
    const r = new ResourceManager(1000);
    const spec = { type: 'delivery' as const, difficulty: 'medium' as const, title: 'D', description: '', reward: 40, bombs: 0, timeLimit: null, ordered: false, cargo, objectives: [{ kind: 'reach' as const, territoryId: 'T6', airspace: { x: 70, z: 0, half: 20, ceiling: 35 } }] };
    const st = new GameState(r, () => [new Mission(spec)]);
    st.selectAircraft('swift');
    st.build();
    st.tick(5);
    st.launch();
    return st;
  };

  it('fragile cargo breaks on a hard knock, not on a scratch or on ink', () => {
    const st = deliver('fragile');
    st.damageAircraft(2, 'impact');
    expect(st.mission!.isActive).toBe(true);
    st.damageAircraft(10, 'projectile', 'turret');
    expect(st.mission!.isActive).toBe(true);
    st.damageAircraft(MISSIONS.fragileImpact, 'impact');
    expect(st.mission!.status).toBe('failed');
    expect(st.mission!.failure).toBe('cargo-broken');
  });

  it('heavy cargo slows the plane until it is delivered', () => {
    const st = deliver('heavy');
    expect(st.cargoFactor).toBe(MISSIONS.heavyCargo);
    st.updateFlight({ x: 0, y: 10, z: 0 }, { x: 70, y: 10, z: 0 }, 0.1);
    expect(st.mission!.status).toBe('succeeded');
    expect(st.cargoFactor).toBe(1);
  });
});

describe('v0.0.18: records and discoveries', () => {
  const finished = (spec: ConstructorParameters<typeof Mission>[0], elapsed: number) => {
    const m = new Mission(spec);
    m.start();
    m.elapsed = elapsed;
    m.objectives.forEach((_, i) => (m.progress[i] = 1));
    m.succeed();
    return m;
  };
  const log = { aircraft: 'swift' as const, kind: 'fold' as const, paperSpent: 15, paperEarned: 0, inkSpent: 0, rubberSpent: 0, maneuvers: 0, damageDealt: 0, damageTaken: 0, bombsDropped: 0, bombHits: 0, shotsFired: 0, shotsHit: 0, targetsDestroyed: 0, defensesDestroyed: 0, turretsDestroyed: 0, enemyShots: 0, enemyHits: 0, killedBy: null, aircraftDestroyed: 0, bombersIntercepted: 0, objectivesProtected: 0, paperLost: 0, paperOverflow: 0, rearms: 0, distanceFlown: 100, landings: 1, emergency: false, outcome: 'recovered' as const };
  const trial = { type: 'time-trial' as const, difficulty: 'easy' as const, title: 'Time trial: T7 circuit', description: '', reward: 20, bombs: 0, timeLimit: 90, ordered: true, recordKey: 'time-trial:T7', objectives: [] };

  it('keeps the best time per challenge, and a beaten record unlocks Record breaker', () => {
    const p = new Progress(() => 1);
    const first = p.sortieEnded({ mission: finished(trial, 60), sortie: log, aircraft: 'swift', maxHealth: 90, recovered: true, operationCompleted: false });
    expect(p.data.times['time-trial:T7']).toBe(60);
    expect(first.records.some((r) => r.includes('Time trial'))).toBe(true);
    p.sortieEnded({ mission: finished(trial, 70), sortie: log, aircraft: 'swift', maxHealth: 90, recovered: true, operationCompleted: false });
    expect(p.data.times['time-trial:T7']).toBe(60);
    const beat = p.sortieEnded({ mission: finished(trial, 52.04), sortie: log, aircraft: 'swift', maxHealth: 90, recovered: true, operationCompleted: false });
    expect(p.data.times['time-trial:T7']).toBe(52);
    expect(beat.achievements.map((a) => a.id)).toContain('record-breaker');
  });

  it('remembers discovered landmarks, and five unlock Explorer', () => {
    const p = new Progress(() => 1);
    let last;
    for (const t of ['T2', 'T3', 'T4', 'T5', 'T6']) {
      const spec = { type: 'discovery' as const, difficulty: 'easy' as const, title: 'Discover', description: '', reward: 20, bombs: 0, timeLimit: null, ordered: false, objectives: [{ kind: 'reach' as const, territoryId: t, airspace: { x: 0, z: 0, half: 10, ceiling: 32 } }] };
      last = p.sortieEnded({ mission: finished(spec, 30), sortie: log, aircraft: 'swift', maxHealth: 90, recovered: true, operationCompleted: false });
    }
    expect(p.data.discovered).toEqual(['T2', 'T3', 'T4', 'T5', 'T6']);
    expect(last!.achievements.map((a) => a.id)).toContain('explorer');
  });

  it('five maneuvers in a sortie unlock Origami acrobat', () => {
    const p = new Progress(() => 1);
    const r = p.sortieEnded({ mission: null, sortie: { ...log, maneuvers: 5 }, aircraft: 'swift', maxHealth: 90, recovered: true, operationCompleted: false });
    expect(r.achievements.map((a) => a.id)).toContain('acrobat');
  });

  it('a saved game keeps best times and discoveries, and drops nonsense', () => {
    const problems: string[] = [];
    const save = validateSave({ progress: { times: { 'time-trial:T7': 52, bad: -1, worse: 'x' }, discovered: ['T2', 'T2', 'nope', 3] } }, problems);
    expect(save!.progress.times).toEqual({ 'time-trial:T7': 52 });
    expect(save!.progress.discovered).toEqual(['T2']);
  });
});

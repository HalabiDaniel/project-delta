import { describe, expect, it } from 'vitest';
import { predictImpact } from '../aircraft/Bomb';
import { AI, BOMB, DEFENSES, PLAYER_ID, WORLD, type Difficulty } from '../config';
import { seededRng } from '../systems/Random';
import type { AiOrders } from './AiAircraft';
import { patrolPlan, raidPlan, scoutPlan } from './FlightPlans';
import { aimSpread, leadPoint, TargetTrack } from './Gunnery';
import { at, circle, DT, home, run, Session, store, straight, territories, traffic, type Script } from './harness';
import { edgePoint, floorAt, terrainAhead } from './Navigation';

const t6 = at('T6');

/** A fighter guarding T6, flying a short line across it. */
const guard = (skill: Difficulty, id = 'f1'): AiOrders => ({
  id, side: 'enemy', role: 'fighter', skill, purpose: 'mission',
  route: [{ x: t6.x + 40, y: 25, z: t6.z + 30 }, { x: t6.x + 40, y: 25, z: t6.z - 30 }],
  loop: true, exit: edgePoint(t6.x, t6.z, 30), guard: { x: t6.x, z: t6.z },
});

/** Flying round T6 on a circle whose radius keeps changing: hard to predict. */
const jinking = (): Script => {
  const pos = (t: number) => {
    const r = 45 + 18 * Math.sin(t * 1.7);
    const a = t * 0.42;
    return { x: t6.x + Math.cos(a) * r, z: t6.z + Math.sin(a) * r };
  };
  return (t) => {
    const p = pos(t);
    const q = pos(t + 0.01);
    return { x: p.x, y: 22, z: p.z, vx: (q.x - p.x) / 0.01, vy: 0, vz: (q.z - p.z) / 0.01 };
  };
};

/** Average damage per second a fighter of this skill deals to a scripted player over T6. */
function dps(skill: Difficulty, script: () => Script, seconds = 20, seeds = 6): { dps: number; hitRate: number } {
  let damage = 0;
  let shots = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const air = traffic(seed);
    air.spawn(guard(skill));
    const r = run(air, seconds, script());
    damage += r.damage;
    shots += r.shots;
  }
  return { dps: damage / seeds / seconds, hitRate: shots ? damage / AI_DAMAGE / shots : 0 };
}
const AI_DAMAGE = 7; // the Falcon's ink

describe('navigation', () => {
  it('keeps clear of platforms (and their edges), lower over the gaps, and enters and leaves out beyond the airspace', () => {
    expect(floorAt(territories, t6.x, t6.z)).toBe(t6.top + AI.clearance);
    expect(floorAt(territories, t6.x + t6.half + 3, t6.z)).toBe(t6.top + AI.clearance);
    expect(floorAt(territories, t6.x + t6.half + 15, t6.z)).toBe(AI.gapFloor);
    const e = edgePoint(t6.x, t6.z, 30);
    expect(Math.hypot(e.x, e.z)).toBeGreaterThan(WORLD.boundaryRadius + 20);
  });

  it('sees a platform coming before it flies into it', () => {
    // Low, in the middle of the gap between T5 and T6.
    const level = { x: t6.x - t6.half - 15, y: 6, z: t6.z };
    expect(terrainAhead(territories, level, { x: 20, y: 0, z: 0 }, AI.clearance)).toBeGreaterThan(5);
    expect(terrainAhead(territories, level, { x: 0, y: 0, z: 20 }, AI.clearance)).toBe(0);
  });
});

describe('gunnery', () => {
  const skills = AI.skill;

  it('aim gets worse with distance, speed difference and manoeuvring, and better with time spent tracking', () => {
    const base = aimSpread(skills.medium, 20, 5, 0, 3);
    expect(aimSpread(skills.medium, 60, 5, 0, 3)).toBeGreaterThan(base);
    expect(aimSpread(skills.medium, 20, 20, 0, 3)).toBeGreaterThan(base);
    expect(aimSpread(skills.medium, 20, 5, 1, 3)).toBeGreaterThan(base * 2);
    expect(aimSpread(skills.medium, 20, 5, 0, 0)).toBeGreaterThan(base * 1.5);
    expect(aimSpread(skills.easy, 20, 5, 0, 3)).toBeGreaterThan(base);
    expect(aimSpread(skills.hard, 20, 5, 0, 3)).toBeLessThan(base);
  });

  it("a pilot's idea of the target's velocity lags behind a change of course, and it notices the turning", () => {
    const track = new TargetTrack();
    for (let t = 0; t < 2; t += DT) track.update(DT, { id: 'a', x: 0, y: 0, z: 0, vx: 20, vy: 0, vz: 0 }, skills.medium.trackingLag);
    expect(track.velocity.x).toBeCloseTo(20, 0);
    for (let t = 0; t < 0.2; t += DT) track.update(DT, { id: 'a', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 20 }, skills.medium.trackingLag);
    expect(track.velocity.x).toBeGreaterThan(5);
    expect(track.turnRate).toBeGreaterThan(1);
    track.update(DT, { id: 'b', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 20 }, skills.medium.trackingLag);
    expect(track.time).toBeCloseTo(DT);
  });

  it('leads a crossing target by its motion relative to the shooter', () => {
    const lead = leadPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -40 }, { x: 20, y: 0, z: 0 }, 78, 1);
    expect(lead.x).toBeGreaterThan(8);
    const flying = leadPoint({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: -40 }, { x: 20, y: 0, z: 0 }, 78, 1);
    expect(Math.abs(flying.x)).toBeLessThan(0.01);
  });

  it('bomb release prediction matches how bombs fall', () => {
    const from = { x: 0, y: 18, z: 0 };
    const v = { x: 15, y: 0, z: 3 };
    const predicted = predictImpact(from, v, 0);
    const p = { ...from };
    const vel = { x: v.x, y: v.y - BOMB.releaseKick, z: v.z };
    while (p.y > BOMB.kinds.standard.radius) {
      vel.y -= BOMB.gravity * DT;
      p.x += vel.x * DT;
      p.y += vel.y * DT;
      p.z += vel.z * DT;
    }
    expect(Math.hypot(p.x - predicted.x, p.z - predicted.z)).toBeLessThan(0.6);
  });
});

describe('fighters', () => {
  it('attack: veterans are deadlier than regulars, regulars than rookies', () => {
    const rookie = dps('easy', () => circle(t6.x, t6.z, 60, 21)).dps;
    const regular = dps('medium', () => circle(t6.x, t6.z, 60, 21)).dps;
    const veteran = dps('hard', () => circle(t6.x, t6.z, 60, 21)).dps;
    expect(rookie).toBeLessThan(regular);
    expect(regular).toBeLessThan(veteran);
    expect(rookie).toBeGreaterThan(0);
    // A veteran on your tail is a real danger, but you have time to react: more than five seconds.
    expect(veteran).toBeLessThan(100 / 5);
  });

  it('nobody has perfect aim, and unpredictable flying is much harder to hit', () => {
    const steady = dps('hard', () => circle(t6.x, t6.z, 60, 21));
    expect(steady.hitRate).toBeLessThan(0.8);
    expect(dps('hard', jinking).dps).toBeLessThan(steady.dps * 0.7);
  });

  it('get behind their target and shoot when lined up', () => {
    const air = traffic(5);
    const f = air.spawn(guard('hard'));
    const script = circle(t6.x, t6.z, 50, 21);
    const s = new Session(air, script);
    s.run(12);
    const p = script(s.time)!;
    const speed = Math.hypot(p.vx, p.vz);
    const behind = ((f.position.x - p.x) * p.vx + (f.position.z - p.z) * p.vz) / speed;
    expect(f.state).toBe('attack');
    expect(behind).toBeLessThan(0);
    expect(s.result.damage).toBeGreaterThan(0);
  });

  it('never fire at a shielded player (over home, or just after take-off)', () => {
    const air = traffic(2);
    air.spawn(guard('hard'));
    const r = run(air, 15, circle(t6.x, t6.z, 50, 21), { shielded: () => true });
    expect(r.damage).toBe(0);
    expect(r.events.filter((e) => e.type === 'engaging')).toHaveLength(0);
  });

  it('give up the chase beyond their pursuit range, and go back to what they guard', () => {
    const air = traffic(3);
    const f = air.spawn(guard('medium'));
    const s = new Session(air, straight({ x: t6.x - 10, y: 24, z: t6.z }, Math.PI / 2, 34));
    s.run(2.5);
    expect(['alert', 'attack']).toContain(f.state);
    s.run(10);
    expect(['disengage', 'patrol']).toContain(f.state);
    s.run(15);
    expect(Math.hypot(f.position.x - t6.x, f.position.z - t6.z)).toBeLessThan(AI.leash);
  });

  it('never chase into home', () => {
    const t4 = at('T4');
    for (let seed = 1; seed <= 3; seed++) {
      const air = traffic(seed);
      const f = air.spawn({ ...guard('hard'), route: [{ x: t4.x, y: 25, z: t4.z + 20 }, { x: t4.x, y: 25, z: t4.z - 20 }], guard: { x: t4.x, z: t4.z } });
      const s = new Session(air, circle(home.x, home.z, 25, 18));
      let closest = Infinity;
      for (let k = 0; k < 40; k++) {
        s.run(0.5);
        closest = Math.min(closest, Math.max(Math.abs(f.position.x - home.x), Math.abs(f.position.z - home.z)) - home.half);
      }
      expect(closest).toBeGreaterThan(DEFENSES.homeSafeMargin);
    }
  });
});

describe('scouts and bombers', () => {
  it('scouts run from the player rather than fight, and get away through their exit', () => {
    const air = traffic(4);
    const orders = scoutPlan(territories, ['T8', 'T5', 'T6'], 'medium', 'scout', seededRng(4), 'mission');
    air.startMission([{ orders }]);
    const s = new Session(air);
    s.run(1);
    const scout = air.get('scout')!;
    // Chase it from behind once it is over the map.
    s.run(8);
    const from = { x: scout.position.x - 30, y: scout.position.y, z: scout.position.z };
    const chase = new Session(air, (t) => {
      const p = air.get('scout')?.position ?? { x: from.x, y: from.y, z: from.z };
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      from.x += (dx / len) * 21 * DT;
      from.z += (dz / len) * 21 * DT;
      void t;
      return { x: from.x, y: from.y, z: from.z, vx: (dx / len) * 21, vy: 0, vz: (dz / len) * 21 };
    });
    chase.run(3);
    expect(['alert', 'evade', 'leave']).toContain(scout.state);
    chase.run(45);
    expect(chase.result.shots).toBe(0);
    expect(chase.result.events.some((e) => e.type === 'escaped' && e.aircraft.id === 'scout')).toBe(true);
  });

  it('bombers fly to T1 and make a steady run at the store, released half a minute after setting out', () => {
    const hits: Record<string, number> = {};
    for (const skill of ['easy', 'hard'] as const) {
      hits[skill] = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const air = traffic(seed);
        air.startRaid(skill, false, 'T9');
        const s = new Session(air);
        s.run(20);
        expect(s.result.events.some((e) => e.type === 'released')).toBe(false);
        s.run(30);
        const raid = air.raids[0];
        expect(raid.stage).toBe('over');
        if (raid.outcome === 'bombed') hits[skill]++;
        expect(s.result.events.filter((e) => e.type === 'collision' || e.type === 'destroyed')).toHaveLength(0);
      }
    }
    expect(hits.hard).toBeGreaterThanOrEqual(7);
    expect(hits.easy).toBeLessThan(hits.hard);
  });

  it('a raid is settled: intercepted when shot down before it releases, driven off when it turns back badly hurt', () => {
    const air = traffic(1);
    const raid = air.startRaid('medium', false, 'T6')!;
    expect(raid.eta).toBeGreaterThan(25);
    expect(air.startRaid('medium')).toBeNull();
    run(air, 3);
    air.damage(raid.bomber, 40, PLAYER_ID, true);
    air.damage(raid.bomber, 200, 'T1-turret1', false);
    expect(raid).toMatchObject({ stage: 'over', outcome: 'intercepted', participated: true });

    const second = air.startRaid('hard', false, 'T6')!;
    run(air, 3);
    air.damage(second.bomber, AI.abortHealth * 150 + 70, null, false);
    run(air, 1);
    expect(second.outcome).toBe('driven-off');
    expect(second.participated).toBe(false);
  });

  it('an escort flies on its bomber’s wing and turns on whoever comes for it', () => {
    const air = traffic(6);
    const raid = air.startRaid('medium', true, 'T8')!;
    const s = new Session(air);
    let worst = 0;
    for (let k = 0; k < 15; k++) {
      s.run(1);
      const bomber = air.get(raid.bomber)!;
      const escort = air.get(raid.escorts[0])!;
      if (k > 5) worst = Math.max(worst, bomber.position.distance(escort.position));
    }
    expect(worst).toBeLessThan(35);
    const bomber = air.get(raid.bomber)!;
    const from = { x: bomber.position.x + 50, y: bomber.position.y, z: bomber.position.z };
    const r = run(air, 4, straight(from, Math.PI / 2, 18));
    expect(r.events.some((e) => e.type === 'engaging' && e.target === PLAYER_ID)).toBe(true);
  });
});

describe('air traffic', () => {
  it('ambient patrols keep the world busy over enemy country, within the limit, appearing out of sight', () => {
    const air = traffic(9, true);
    const visible = (p: { x: number; z: number }) => p.x < 0; // the camera only sees the west half
    const s = new Session(air, null, { visible });
    let most = 0;
    for (let k = 0; k < 240; k++) {
      s.run(1);
      most = Math.max(most, air.aircraft.length);
    }
    const spawned = s.result.events.filter((e) => e.type === 'spawned');
    expect(spawned.length).toBeGreaterThanOrEqual(3);
    expect(most).toBeLessThanOrEqual(AI.maxActive);
    for (const e of spawned) if (e.type === 'spawned') expect(visible(e.aircraft.orders.route[0])).toBe(false);
    expect(s.result.events.some((e) => e.type === 'gone')).toBe(true);
    expect(s.result.events.filter((e) => e.type === 'destroyed')).toHaveLength(0);
  });

  it('avoid platforms and each other, even on low routes', () => {
    const air = traffic(11);
    const rng = seededRng(11);
    const zones = [['T2', 'T6', 'T10'], ['T5', 'T6', 'T7'], ['T3', 'T7', 'T11'], ['T9', 'T10', 'T6']];
    zones.forEach((zone, i) => {
      const orders = patrolPlan(territories, zone, i % 2 ? 'scout' : 'bomber', 'medium', `p${i}`, rng, 'mission');
      air.spawn({ ...orders, route: orders.route.map((p) => ({ ...p, y: 6 })) });
    });
    const s = new Session(air);
    let closest = Infinity;
    for (let k = 0; k < 600; k++) {
      s.run(0.1);
      for (const a of air.aircraft) for (const b of air.aircraft) if (a !== b) closest = Math.min(closest, a.position.distance(b.position));
    }
    expect(s.result.events.filter((e) => e.type === 'collision' || e.type === 'destroyed')).toHaveLength(0);
    expect(closest).toBeGreaterThan(3);
  });

  it('missions and raids come first: ambient patrols make way', () => {
    const air = traffic(12, true);
    const s = new Session(air);
    s.run(60);
    const ambient = air.aircraft.filter((a) => a.purpose === 'ambient').length;
    expect(ambient).toBeGreaterThan(0);
    const rng = seededRng(3);
    air.startMission([0, 1, 2].map((i) => ({ orders: patrolPlan(territories, ['T5'], 'fighter', 'easy', `m${i}`, rng, 'mission') })));
    s.run(1);
    air.startRaid('easy');
    s.run(1);
    expect(air.aircraft.filter((a) => !a.leaving).length).toBeLessThanOrEqual(AI.maxActive);
    expect(air.aircraft.filter((a) => a.purpose !== 'ambient')).toHaveLength(4);
    air.reset();
    expect(air.aircraft.some((a) => a.purpose === 'mission')).toBe(false);
  });

  it('a mission raid is announced and settled like any raid', () => {
    const air = traffic(2);
    const plan = raidPlan(at('T3'), store, 'easy', 'mission-bomber', seededRng(2));
    air.startMission(plan.map((orders) => ({ orders, raid: true })));
    const r = run(air, 1);
    expect(r.events.some((e) => e.type === 'raid' && e.raid.mission && e.raid.bomber === 'mission-bomber')).toBe(true);
    expect(air.activeRaid?.bomber).toBe('mission-bomber');
  });
});

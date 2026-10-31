import { describe, expect, it } from 'vitest';
import { Mission, type MissionSpec } from '../missions/Mission';
import type { SortieLog } from '../systems/GameState';
import { Progress, rateMission, type SortieInput } from './Progress';

const zone = { x: 0, z: 0, radius: 5, top: 0.3 };

function mission(spec: Partial<MissionSpec> = {}, succeed = true, elapsed = 30): Mission {
  const m = new Mission({
    type: 'bombing', difficulty: 'medium', title: 'Bomb T5', description: '', reward: 80, bombs: 2, timeLimit: null, ordered: false, par: 45,
    objectives: [{ kind: 'bomb', territoryId: 'T5', zone, precision: false }],
    ...spec,
  });
  m.start();
  m.elapsed = elapsed;
  if (succeed) {
    m.completeBomb(0);
    m.succeed();
  } else m.fail('missed');
  return m;
}

const log = (over: Partial<SortieLog> = {}): SortieLog => ({
  aircraft: 'widewing', kind: 'fold', paperSpent: 40, paperEarned: 0, damageDealt: 0, damageTaken: 0, bombsDropped: 1, bombHits: 1,
  shotsFired: 0, shotsHit: 0, targetsDestroyed: 0, defensesDestroyed: 0, turretsDestroyed: 0, enemyShots: 0, enemyHits: 0, killedBy: null,
  aircraftDestroyed: 0, bombersIntercepted: 0, objectivesProtected: 0, paperLost: 0, rearms: 0, distanceFlown: 400, landings: 1,
  emergency: false, outcome: 'recovered', ...over,
});

const input = (m: Mission | null, over: Partial<SortieInput> = {}, sortie: Partial<SortieLog> = {}): SortieInput => ({
  mission: m, sortie: log(sortie), aircraft: 'widewing', maxHealth: 150, recovered: true, operationCompleted: false, ...over,
});

describe('rateMission', () => {
  it('bronze for the objective, silver for efficiency with limited damage, gold for fast and home', () => {
    const m = mission();
    expect(rateMission({ mission: m, sortie: log(), maxHealth: 150, recovered: true })).toBe('gold');
    expect(rateMission({ mission: m, sortie: log(), maxHealth: 150, recovered: false })).toBe('silver');
    expect(rateMission({ mission: mission({}, true, 60), sortie: log(), maxHealth: 150, recovered: true })).toBe('silver');
    expect(rateMission({ mission: m, sortie: log({ damageTaken: 100 }), maxHealth: 150, recovered: true })).toBe('bronze');
    expect(rateMission({ mission: m, sortie: log({ bombsDropped: 4 }), maxHealth: 150, recovered: true })).toBe('bronze');
    expect(rateMission({ mission: mission({}, false), sortie: log(), maxHealth: 150, recovered: true })).toBeNull();
  });

  it('a gunfight asks for accuracy instead', () => {
    const m = mission({ type: 'dogfight', bombs: 0, objectives: [{ kind: 'intercept', territoryId: 'T6', targets: ['f'], count: 1, what: 'fighter' }] }, false);
    // Force success through the intercept objective.
    const won = new Mission(m.spec);
    won.start();
    won.elapsed = 20;
    won.completeDestroy('f');
    won.succeed();
    expect(rateMission({ mission: won, sortie: log({ shotsFired: 100, shotsHit: 30 }), maxHealth: 100, recovered: true })).toBe('gold');
    expect(rateMission({ mission: won, sortie: log({ shotsFired: 100, shotsHit: 5 }), maxHealth: 100, recovered: true })).toBe('bronze');
  });
});

describe('Progress', () => {
  it('a streak pays a modest bonus from three in a row, and resets on a failure', () => {
    const p = new Progress(() => 1);
    expect(p.sortieEnded(input(mission())).streakBonus).toBe(0);
    expect(p.sortieEnded(input(mission())).streakBonus).toBe(0);
    expect(p.sortieEnded(input(mission())).streakBonus).toBe(4); // 5% of 80
    p.sortieEnded(input(mission()));
    expect(p.sortieEnded(input(mission())).streakBonus).toBe(8); // 10% from five
    expect(p.data.streak.best).toBe(5);
    expect(p.sortieEnded(input(mission({}, false))).streak).toBe(0);
    expect(Progress.streakRate(100)).toBeLessThanOrEqual(0.1);
  });

  it('keeps personal bests and says when one is broken', () => {
    const p = new Progress();
    const first = p.sortieEnded(input(mission({}, true, 50), {}, { bombsDropped: 2, bombHits: 2, aircraftDestroyed: 1, distanceFlown: 900 }));
    expect(first.records.join(' ')).toMatch(/Fastest bombing run: 0:50/);
    expect(first.records.join(' ')).toMatch(/Most accurate bombing mission: 100% of 2/);
    expect(first.records.join(' ')).toMatch(/Longest successful flight: 0.90 km/);
    expect(first.records.join(' ')).toMatch(/Most aircraft downed in one sortie: 1/);
    const slower = p.sortieEnded(input(mission({}, true, 70)));
    expect(slower.records.join(' ')).not.toMatch(/Fastest/);
    expect(p.data.bests.fastestBombing?.time).toBe(50);
    // A lost plane ends the clean run.
    expect(p.data.bests.cleanRun).toBe(2);
    p.sortieEnded(input(mission(), { recovered: false }, { outcome: 'lost', landings: 0 }));
    expect(p.data.clean).toBe(0);
  });

  it('tracks mastery per design: flights, missions by category, accuracy', () => {
    const p = new Progress();
    p.sortieEnded(input(mission(), {}, { bombsDropped: 3, bombHits: 2 }));
    p.sortieEnded(input(mission({}, false), {}, { bombsDropped: 1, bombHits: 0 }));
    const m = p.data.mastery.widewing!;
    expect(m.flights).toBe(2);
    expect(m.missions).toBe(1);
    expect(m.byCategory.bombing).toBe(1);
    expect(m.bombsDropped).toBe(4);
    expect(m.bombHits).toBe(2);
  });

  it('unlocks achievements once, and lists them in the session summary', () => {
    const p = new Progress(() => 42);
    const a = p.sortieEnded(input(mission(), {}, { turretsDestroyed: 3, aircraftDestroyed: 1 }));
    const ids = a.achievements.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['first-bombing', 'first-kill', 'three-turrets', 'flawless', 'gold']));
    expect(p.sortieEnded(input(mission(), {}, { turretsDestroyed: 3 })).achievements.map((x) => x.id)).not.toContain('three-turrets');
    expect(p.data.achievements['first-bombing']).toBe(42);
    expect(p.session.achievements).toContain('Bombs away');
    expect(p.unlockNow('operation')?.id).toBe('operation');
    expect(p.unlockNow('operation')).toBeNull();
  });

  it('sums up the session', () => {
    const p = new Progress();
    p.sortieEnded(input(mission(), {}, { aircraftDestroyed: 2, defensesDestroyed: 1 }));
    p.sortieEnded(input(mission({}, false), { recovered: false }, { outcome: 'lost' }));
    p.paper(80, false);
    p.paper(-40, true);
    expect(p.session).toMatchObject({ sorties: 2, missionsCompleted: 1, missionsFailed: 1, aircraftLost: 1, enemiesDestroyed: 3, paperEarned: 80, paperSpent: 40, bestMedal: 'gold' });
    expect(p.session.bestReward).toEqual({ amount: 80, title: 'Bomb T5' });
  });
});

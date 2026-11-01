import { describe, expect, it } from 'vitest';
import { Base } from '../base/Base';
import { AIRCRAFT } from '../config';
import { DefenseNetwork } from '../defenses/Installation';
import { homeDefenses } from '../defenses/Layout';
import type { MissionFailure } from '../missions/Mission';
import { ResourceManager } from '../systems/ResourceManager';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { dashboardView, type DashboardInput } from './dashboardView';
import { failureText, nextStepText, paperBreakdown } from './reportText';

const MISSION_FAILURES: MissionFailure[] = ['missed', 'out-of-time', 'aircraft-lost', 'abandoned', 'target-escaped', 'target-bombed', 'escort-lost'];
const home = generateTerritories().find((t) => t.isHome)!;

function base(paper: number) {
  const resources = new ResourceManager(paper);
  const b = new Base(home, new DefenseNetwork(homeDefenses(home), seededRng(1)), resources);
  b.startFresh();
  return { base: b, resources };
}

function input(over: Partial<DashboardInput> = {}): DashboardInput {
  const { base: b } = base(over.paper ?? 100);
  return {
    paper: 100,
    rate: 5,
    base: b,
    hangar: new Map(),
    mission: { title: 'Bombing T3', reward: 40, bombs: 1 },
    plane: { id: 'swift', fit: 'good', cost: AIRCRAFT.swift.cost, kind: 'fold', canBuild: true },
    lostPlane: null,
    onPad: false,
    raidInbound: false,
    emergency: false,
    ...over,
  };
}

describe('the sortie report', () => {
  it('explains every way a mission can fail, with advice', () => {
    for (const f of MISSION_FAILURES) {
      const t = failureText(f);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.why).toMatch(/\.$/);
      expect(t.advice.length).toBeGreaterThan(20);
    }
    expect(failureText(null).title).toBe('Landed before finishing');
  });

  it('breaks the paper down: reward, bonuses, other earnings, then costs and losses', () => {
    const lines = paperBreakdown({ reward: 50, missionTitle: 'Dogfight T4', bonuses: [{ label: 'Streak bonus', amount: 5 }], earned: 100, spent: 25, lost: 10, overflow: 3 });
    expect(lines.map((l) => l.amount)).toEqual([50, 5, 45, -25, -10, -3]);
    expect(paperBreakdown({ reward: 0, missionTitle: 'x', bonuses: [], earned: 0, spent: 0, lost: 0, overflow: 0 })).toEqual([]);
  });

  it('suggests the quick rebuild after a loss and a refit after a recovery', () => {
    expect(nextStepText({ succeeded: false, recovered: false, aircraftName: 'Swift', refitCost: 7, cost: 30, repairs: 0 })).toMatch(/Quick rebuild: F .* Swift for 30/);
    expect(nextStepText({ succeeded: true, recovered: true, aircraftName: 'Swift', refitCost: 7, cost: 30, repairs: 2 })).toMatch(/refit costs 7\. 2 buildings at home need repairs/);
  });
});

describe('the home dashboard', () => {
  it('sums up the base, the hangar and the chosen mission, and says what to do next', () => {
    const v = dashboardView(input({ hangar: new Map([['falcon', { condition: 'recovered', health: AIRCRAFT.falcon.maxHealth / 2 }]]) }));
    expect(v.base.total).toBe(1);
    expect(v.base.repairs).toBe(0);
    expect(v.hangar).toEqual([{ id: 'falcon', name: 'Falcon', condition: 'recovered', health: 0.5 }]);
    expect(v.mission).toMatchObject({ title: 'Bombing T3', plane: 'Swift', fit: 'good' });
    expect(v.next[0].text).toMatch(/Fold the Swift/);
    expect(v.rebuild).toBeNull();
  });

  it('offers to rebuild the plane lost last sortie, with its key only when it is the one chosen', () => {
    const v = dashboardView(input({ lostPlane: 'widewing', paper: 20 }));
    expect(v.rebuild).toMatchObject({ id: 'widewing', cost: AIRCRAFT.widewing.cost, canAfford: false, key: null });
    expect(dashboardView(input({ lostPlane: 'swift' })).rebuild?.key).toBe('F');
    // Not once a plane is on the pad, nor when the same plane waits in the hangar.
    expect(dashboardView(input({ lostPlane: 'swift', onPad: true })).rebuild).toBeNull();
  });

  it('puts repairs, raids and a full store first', () => {
    const { base: b, resources } = base(1000);
    b.store.damage(30);
    const v = dashboardView(input({ base: b, paper: resources.paper, raidInbound: true }));
    expect(v.next[0].tone).toBe('warn');
    expect(v.next[0].text).toMatch(/raid/);
    expect(v.next.length).toBeLessThanOrEqual(3);
  });
});

import { describe, expect, it } from 'vitest';
import { BASE, ECONOMY, RAIDS } from '../config';
import { DefenseNetwork } from '../defenses/Installation';
import { homeDefenses } from '../defenses/Layout';
import { ResourceManager } from '../systems/ResourceManager';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { Base, STORE, type BaseEvent } from './Base';
import { chooseRaidTarget, raidLoss, raidPace, RaidTracker, raidTargetFor } from './Raids';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;

function setup(paper = 1000) {
  const network = new DefenseNetwork(homeDefenses(home), seededRng(1));
  const resources = new ResourceManager(paper);
  const base = new Base(home, network, resources);
  const events: BaseEvent[] = [];
  base.onEvent((e) => events.push(e));
  return { base, network, resources, events };
}

describe('Base: building', () => {
  it('a new game starts with one ink turret in a defense slot, and the paper store', () => {
    const { base, network } = setup();
    base.startFresh();
    expect([...base.buildings.values()].map((b) => [b.slot, b.kind, b.level])).toEqual([['D1', 'turret', 1]]);
    expect(network.get('T1-D1')!.spec.side).toBe('player');
    expect(base.store.spec.name).toBe('Paper store');
  });

  it('builds into slots that take the building, for its cost; radars only in the radar slot, one of them', () => {
    const { base, resources, events } = setup(1000);
    expect(base.canBuild('E1', 'turret').reason).toBe('slot');
    expect(base.canBuild('R1', 'workshop').reason).toBe('slot');
    expect(base.canBuild('U1', 'radar').reason).toBe('slot');
    expect(base.build('D1', 'turret')).toBe(true);
    expect(resources.paper).toBe(1000 - BASE.buildings.turret.levels[0].cost);
    expect(base.canBuild('D1', 'launcher').reason).toBe('slot'); // taken
    expect(base.build('U1', 'launcher')).toBe(true); // utility takes weapons…
    expect(base.build('U2', 'workshop')).toBe(true); // …and economy buildings
    expect(base.build('R1', 'radar')).toBe(true);
    expect(base.stats.construction).toBe(60 + 110 + 80 + 70);
    expect(events.filter((e) => e.type === 'built')).toHaveLength(4);
  });

  it('refuses what the player cannot afford, saying how much is missing', () => {
    const { base, resources, events } = setup(40);
    expect(base.build('D1', 'turret')).toBe(false);
    expect(resources.paper).toBe(40);
    expect(events.at(-1)).toEqual({ type: 'refused', reason: 'paper', missing: 20 });
    expect(base.canBuild('D1', 'turret')).toMatchObject({ ok: false, missing: 20, cost: 60 });
  });

  it('upgrades in place up to level 3, keeping the share of health; a wreck must be repaired first', () => {
    const { base } = setup(2000);
    base.build('D1', 'turret');
    base.installation('D1')!.damage(45);
    expect(base.upgrade('D1')).toBe(true);
    const i = base.installation('D1')!;
    expect(i.spec.level).toBe(2);
    expect(i.spec.range).toBe(BASE.buildings.turret.levels[1].range);
    expect(i.durability.fraction).toBeCloseTo(0.5, 1);
    expect(base.upgrade('D1')).toBe(true);
    expect(base.canUpgrade('D1').reason).toBe('max-level');
    base.build('D2', 'launcher');
    base.installation('D2')!.damage(1000);
    expect(base.canUpgrade('D2').reason).toBe('destroyed');
    expect(base.at('D1')!.invested).toBe(60 + 45 + 70);
  });
});

describe('Base: economy', () => {
  it('workshops raise production 5 → 7 → 10 → 14 paper a minute, by level, and less when damaged', () => {
    const { base } = setup(2000);
    expect(base.production).toBe(5);
    base.build('E1', 'workshop');
    expect(base.production).toBe(7);
    base.upgrade('E1');
    expect(base.production).toBe(10);
    base.upgrade('E1');
    expect(base.production).toBe(14);
    base.installation('E1')!.damage(60); // half of 120
    expect(base.production).toBeCloseTo(9.5, 5);
    base.installation('E1')!.damage(1000);
    expect(base.production).toBe(5);
    // A wrecked paper store halves base production.
    base.store.damage(1000);
    expect(base.production).toBe(5 * BASE.wreckedStore);
  });

  it('storage boxes raise capacity 300 → 500 → 800 and protect more paper; damage exposes it', () => {
    const { base } = setup(2000);
    expect(base.capacity).toBe(300);
    expect(base.protectedPaper).toBe(ECONOMY.protectedPaper);
    base.build('E2', 'storage');
    expect(base.capacity).toBe(500);
    expect(base.protectedPaper).toBe(ECONOMY.protectedPaper + 25);
    base.upgrade('E2');
    expect(base.capacity).toBe(800);
    base.installation('E2')!.damage(Math.round(115 / 2));
    expect(base.capacity).toBe(800);
    expect(base.protectedPaper).toBeLessThan(ECONOMY.protectedPaper + 50);
    base.installation('E2')!.damage(1000);
    expect(base.capacity).toBe(300);
    expect(base.protectedPaper).toBe(ECONOMY.protectedPaper);
    expect(base.vulnerable(400)).toBe(400 - ECONOMY.protectedPaper);
  });

  it('a radar pushes detection out while it stands', () => {
    const { base } = setup(2000);
    expect(base.detectionRange).toBe(BASE.detection);
    base.build('R1', 'radar');
    expect(base.detectionRange).toBe(BASE.buildings.radar.levels[0].range);
    base.upgrade('R1');
    expect(base.detectionRange).toBe(BASE.buildings.radar.levels[1].range);
    base.installation('R1')!.damage(1000);
    expect(base.detectionRange).toBe(BASE.detection);
  });

  it('counts the weapons ready to fight', () => {
    const { base } = setup(2000);
    base.build('D1', 'turret');
    base.build('D2', 'launcher');
    base.build('U1', 'turret');
    base.installation('D2')!.damage(10);
    base.installation('U1')!.damage(1000);
    expect(base.readiness).toEqual({ ready: 2, total: 3, damaged: 1, destroyed: 1 });
    expect(base.integrity).toBeLessThan(1);
  });
});

describe('Base: repairs and removal', () => {
  it('repairing a turret at half health costs 15; a wreck costs more, but less than a new one', () => {
    const { base, resources } = setup(1000);
    base.build('D1', 'turret');
    base.installation('D1')!.damage(45);
    expect(base.repairCost('D1')).toBe(15);
    expect(base.repair('D1')).toBe(true);
    expect(base.status('D1')).toBe('ok');
    expect(resources.paper).toBe(1000 - 60 - 15);
    base.installation('D1')!.damage(1000);
    const rebuild = base.repairCost('D1');
    expect(rebuild).toBeGreaterThan(15);
    expect(rebuild).toBeLessThan(BASE.buildings.turret.levels[0].cost);
    expect(base.repair('D1')).toBe(true);
    expect(base.installation('D1')!.alive).toBe(true);
    expect(base.canRepair('D1').reason).toBe('intact');
    expect(base.stats.repairs).toBe(2);
  });

  it('repair all fixes everything, the store too, if the paper covers it', () => {
    const { base, resources } = setup(400);
    base.build('D1', 'turret');
    base.build('E1', 'workshop');
    base.installation('D1')!.damage(90);
    base.installation('E1')!.damage(30);
    base.store.damage(60);
    const cost = base.repairAllCost;
    expect(base.needsRepair.sort()).toEqual(['D1', 'E1', STORE].sort());
    resources.spend(resources.paper - (cost - 1));
    expect(base.repairAll()).toBe(false);
    resources.earn(1);
    expect(base.repairAll()).toBe(true);
    expect(base.needsRepair).toEqual([]);
    expect(resources.paper).toBe(0);
  });

  it('removing a building frees the slot and refunds half of what went in, by its condition', () => {
    const { base, resources, network } = setup(1000);
    base.build('E1', 'storage');
    base.upgrade('E1');
    const invested = base.at('E1')!.invested;
    base.installation('E1')!.damage(Math.round(115 / 2));
    const refund = base.refundFor('E1');
    expect(refund).toBeLessThan(invested * BASE.refund);
    expect(refund).toBeGreaterThan(invested * BASE.refund * 0.4);
    const before = resources.paper;
    expect(base.remove('E1')).toBe(true);
    expect(resources.paper).toBe(before + refund);
    expect(base.at('E1')).toBeNull();
    expect(network.get('T1-E1')).toBeUndefined();
    expect(base.canBuild('E1', 'workshop').ok).toBe(true);
  });
});

describe('Base: saving', () => {
  it('a saved base comes back with levels, damage, records and stats', () => {
    const a = setup(2000);
    a.base.build('D1', 'turret');
    a.base.upgrade('D1');
    a.base.build('R1', 'radar');
    a.base.installation('R1')!.damage(1000);
    a.base.installation('D1')!.damage(20);
    a.base.recordKill('T1-D1', true);
    a.base.store.damage(30);
    const save = JSON.parse(JSON.stringify(a.base.save()));
    const b = setup(0);
    b.base.startFresh();
    b.base.load(save);
    expect(b.base.at('D1')).toMatchObject({ kind: 'turret', level: 2, kills: 1, bombers: 1 });
    expect(b.base.installation('D1')!.durability.health).toBe(a.base.installation('D1')!.durability.health);
    expect(b.base.status('R1')).toBe('destroyed');
    expect(b.base.store.durability.health).toBe(90);
    expect(b.base.stats.bombersDowned).toBe(1);
  });

  it('a damaged save is repaired, not trusted: wrong slots and second radars are dropped', () => {
    const { base } = setup(0);
    base.load({
      buildings: [
        { slot: 'R1', kind: 'turret', level: 1, invested: 60, kills: 0, bombers: 0, damage: 0, health: 90 },
        { slot: 'Z9', kind: 'workshop', level: 1, invested: 80, kills: 0, bombers: 0, damage: 0, health: 90 },
        { slot: 'D1', kind: 'turret', level: 3, invested: 175, kills: 2, bombers: 0, damage: 0, health: 130 },
      ],
      store: 120,
      stats: base.stats,
    });
    expect([...base.buildings.keys()]).toEqual(['D1']);
  });
});

describe('Raids on the base', () => {
  it('raiders aim at standing structures, the store more when it is full of paper', () => {
    const { base } = setup(1000);
    base.build('D1', 'turret');
    base.build('E1', 'workshop');
    base.installation('E1')!.damage(1000);
    const rng = seededRng(7);
    const picks = new Map<string, number>();
    for (let n = 0; n < 400; n++) {
      const t = chooseRaidTarget(base, rng);
      picks.set(t.key, (picks.get(t.key) ?? 0) + 1);
      expect(t.strike.territoryId).toBe(home.id);
    }
    expect(picks.has('E1')).toBe(false);
    expect(picks.get(STORE)!).toBeGreaterThan(picks.get('D1')!);
    // With every structure wrecked, the store's ruin is still the mark.
    base.store.damage(1000);
    base.installation('D1')!.damage(1000);
    expect(chooseRaidTarget(base, rng).key).toBe(STORE);
    const t = raidTargetFor(base, 'D1');
    expect(t.strike).toMatchObject({ x: base.installation('D1')!.spec.x, radius: RAIDS.hitRadius });
  });

  it('a hit destroys a share of the vulnerable paper, more on the store, never more than the cap', () => {
    expect(raidLoss(100, false)).toBe(10);
    expect(raidLoss(100, true)).toBe(20);
    expect(raidLoss(5000, false)).toBe(RAIDS.loss.building.max);
    expect(raidLoss(5000, true)).toBe(RAIDS.loss.store.max);
    expect(raidLoss(0, true)).toBe(0);
  });

  it('the director slows raids while T1 recovers, the player struggles or is busy, and when there is little to take', () => {
    const calm = { vulnerable: 200, integrity: 1, skill: 0.5, struggling: false, onMission: false };
    const normal = raidPace(calm);
    expect(raidPace({ ...calm, integrity: 0.5 })).toBeLessThan(normal);
    expect(raidPace({ ...calm, struggling: true })).toBeLessThan(normal);
    expect(raidPace({ ...calm, onMission: true })).toBeLessThan(normal);
    expect(raidPace({ ...calm, vulnerable: 5 })).toBeLessThan(normal);
    expect(raidPace({ ...calm, skill: 1 })).toBeGreaterThan(normal);
    const worst = raidPace({ vulnerable: 0, integrity: 0.1, skill: 0, struggling: true, onMission: true });
    expect(worst).toBeGreaterThanOrEqual(0.2);
  });

  it('the defense report says what happened', () => {
    const { base } = setup(1000);
    base.build('E1', 'workshop');
    const target = raidTargetFor(base, 'E1');
    const t = new RaidTracker(1, new Set(['raider-1']), target, 24);
    expect(t.involves('raider-1')).toBe(true);
    t.raiderHit(60, false);
    t.raiderHit(20, true);
    t.raiderDown(false);
    const r = t.finish('intercepted', 15);
    expect(r).toMatchObject({ repelled: true, aircraftDestroyed: 1, byDefenses: 1, paperLost: 0, prevented: 24, defenseDamage: 60, playerDamage: 20, repairCost: 15 });
    expect(r.highlight).toContain('Defenses stopped it');

    const hit = new RaidTracker(2, new Set(['raider-2']), target, 24);
    hit.structureHit('Paper workshop', false);
    hit.structureHit('Paper workshop', true);
    hit.hit(18);
    const h = hit.finish('bombed', 56);
    expect(h).toMatchObject({ repelled: false, paperLost: 18, prevented: 0, destroyed: ['Paper workshop'], damaged: [] });
  });
});

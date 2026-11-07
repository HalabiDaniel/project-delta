import { describe, expect, it } from 'vitest';
import { Base } from '../base/Base';
import { AIRCRAFT, BASE, ECONOMY, STARTER_AIRCRAFT } from '../config';
import { DefenseNetwork } from '../defenses/Installation';
import { homeDefenses } from '../defenses/Layout';
import { Mission, type MissionSpec } from '../missions/Mission';
import { generateTerritories } from '../world/WorldGenerator';
import { applyBaseEconomy, armingFor, fullArmingCost, newIncomes, startingStock } from './Economy';
import { GameState, type GameEvent } from './GameState';
import { HomeIncome } from './HomeIncome';
import { seededRng } from './Random';
import { describeBundle, ResourceManager } from './ResourceManager';

const home = generateTerritories().find((t) => t.isHome)!;
const zone = (x: number) => ({ x, z: 0, radius: 5, top: 0.3 });
const BOMBING: MissionSpec = {
  type: 'bombing', difficulty: 'easy', title: 'Bomb T5', description: '', reward: 50, bombs: 4, timeLimit: null, ordered: false,
  objectives: [{ kind: 'bomb', territoryId: 'T5', zone: zone(0), precision: false }],
};
const DOGFIGHT: MissionSpec = {
  type: 'delivery', difficulty: 'easy', title: 'Deliver', description: '', reward: 40, bombs: 0, timeLimit: null, ordered: false,
  objectives: [{ kind: 'reach', territoryId: 'T6', airspace: { x: 70, z: 0, half: 20, ceiling: 35 } }],
};

function baseWith(resources: ResourceManager) {
  const base = new Base(home, new DefenseNetwork(homeDefenses(home), seededRng(1)), resources);
  base.startFresh();
  return base;
}

function state(resources: ResourceManager, spec: MissionSpec = BOMBING) {
  const st = new GameState(resources, () => [new Mission(spec)]);
  const events: GameEvent[] = [];
  st.onEvent((e) => events.push(e));
  return { st, events };
}

function flyFrom(st: GameState, id = STARTER_AIRCRAFT): void {
  st.selectAircraft(id);
  expect(st.build()).toBe(true);
  st.tick(10);
  expect(st.launch()).toBe(true);
}

describe('v0.0.18: three resources', () => {
  it('spends a bundle all at once or not at all', () => {
    const r = new ResourceManager(100, { ink: 10, rubber: 2 });
    expect(r.spendAll({ paper: 50, ink: 20 })).toBe(false);
    expect(r.all).toEqual({ paper: 100, ink: 10, rubber: 2 });
    expect(r.shortfall({ paper: 50, ink: 20, rubber: 1 })).toEqual({ ink: 10 });
    expect(r.spendAll({ paper: 50, ink: 10, rubber: 2 })).toBe(true);
    expect(r.all).toEqual({ paper: 50, ink: 0, rubber: 0 });
  });

  it('keeps each store under its own capacity and its own protected floor', () => {
    const r = new ResourceManager(0, { ink: 0, rubber: 0 });
    r.capacities.ink = 30;
    expect(r.earnOf('ink', 50)).toBe(30);
    expect(r.loseOf('ink', 25, 20)).toBe(10);
    expect(r.ink).toBe(20);
    expect(r.paper).toBe(0);
  });

  it('tells paper listeners about paper only, and the new listeners about everything', () => {
    const r = new ResourceManager(100);
    const paper: number[] = [];
    const any: string[] = [];
    r.onChange((_p, d) => paper.push(d));
    r.onAnyChange((res, _v, d, source) => any.push(`${res}:${d}:${source}`));
    r.spendAll({ paper: 10, ink: 5 }, 'Folded Falcon');
    r.draw('rubber', 3, 'Armed Swift: bombs');
    expect(paper).toEqual([-10]);
    expect(any).toEqual(['paper:-10:spend', 'ink:-5:spend', 'rubber:-3:arm']);
  });

  it('describes bundles in plain words', () => {
    expect(describeBundle({ paper: 40, ink: 6, rubber: 2 })).toBe('40 paper · 6 ink · 2 rubber balls');
    expect(describeBundle({})).toBe('nothing');
  });
});

describe('v0.0.18: production and storage per resource', () => {
  it('a fresh base makes ink and scavenges rubber balls, with no building needed', () => {
    const r = new ResourceManager();
    const base = baseWith(r);
    expect(base.productionOf('ink')).toBe(BASE.inkProduction);
    expect(base.productionOf('rubber')).toBe(BASE.rubberProduction);
    expect(base.capacityOf('ink')).toBe(BASE.inkCapacity);
    expect(base.protectedOf('rubber')).toBe(ECONOMY.protectedRubber);
  });

  it('an ink well adds ink, a storage box holds and guards more of everything', () => {
    const r = new ResourceManager(1000, { ink: 100, rubber: 50 });
    const base = baseWith(r);
    expect(base.build('E1', 'inkwell')).toBe(true);
    expect(base.build('E2', 'storage')).toBe(true);
    expect(base.productionOf('ink')).toBe(BASE.inkProduction + BASE.buildings.inkwell.levels[0].production!);
    expect(base.capacityOf('ink')).toBe(BASE.inkCapacity + BASE.buildings.storage.levels[0].holds!.ink);
    expect(base.protectedOf('rubber')).toBe(ECONOMY.protectedRubber + BASE.buildings.storage.levels[0].guards!.rubber);
  });

  it('refuses an upgrade that needs rubber balls the stores lack, and changes nothing', () => {
    const r = new ResourceManager(5000, { ink: 100, rubber: 0 });
    const base = baseWith(r);
    base.build('E1', 'inkwell');
    base.upgrade('E1');
    const check = base.canUpgrade('E1');
    expect(check).toMatchObject({ ok: false, reason: 'materials', short: { rubber: 4 } });
    const before = r.all;
    expect(base.upgrade('E1')).toBe(false);
    expect(r.all).toEqual(before);
  });

  it('the incomes follow the base, and stop together while the player is offline', () => {
    const r = new ResourceManager(0, { ink: 0, rubber: 0 });
    const base = baseWith(r);
    const incomes = newIncomes();
    applyBaseEconomy(base, r, incomes, true);
    for (let i = 0; i < 600; i++) {
      incomes.ink.update(0.1, r);
      incomes.rubber.update(0.1, r);
    }
    expect(r.ink).toBeGreaterThan(0);
    expect(r.rubber).toBeGreaterThan(0);
    applyBaseEconomy(base, r, incomes, false);
    const ink = r.ink;
    for (let i = 0; i < 600; i++) incomes.ink.update(0.1, r);
    expect(r.ink).toBe(ink);
  });

  it('upkeep only touches a second top-level building, and never makes production negative', () => {
    const r = new ResourceManager(100000, { ink: 1000, rubber: 1000 });
    const base = baseWith(r);
    for (const slot of ['E1', 'E2']) {
      base.build(slot, 'inkwell');
      base.upgrade(slot);
      base.upgrade(slot);
    }
    expect(base.upkeepOf('paper')).toBe(BASE.buildings.inkwell.levels[2].upkeep!.paper);
    expect(base.netProductionOf('paper')).toBeCloseTo(base.production - base.upkeepOf('paper'));
    expect(base.netProductionOf('paper')).toBeGreaterThanOrEqual(0);
  });

  it('a player from before ink gets half of what the base holds, never less than a new start', () => {
    expect(startingStock('ink', BASE.inkCapacity)).toBe(Math.max(ECONOMY.startingInk, BASE.inkCapacity / 2));
    expect(startingStock('rubber', 2)).toBe(ECONOMY.startingRubber);
  });

  it('a HomeIncome for ink pays ink, never paper', () => {
    const r = new ResourceManager(0, { ink: 0, rubber: 0 });
    const ink = new HomeIncome({ resource: 'ink', perMinute: 60, capacity: 100, reserve: 0 });
    ink.update(1, r);
    expect(r.ink).toBe(1);
    expect(r.paper).toBe(0);
  });
});

describe('v0.0.18: arming from the stores', () => {
  it('a full load costs ink by rounds and rubber balls by bombs', () => {
    const swift = AIRCRAFT.swift;
    expect(fullArmingCost(swift)).toEqual({ ink: Math.ceil(swift.gun.ammo * (1 - ECONOMY.arming.basicLoad) / ECONOMY.arming.roundsPerInk), rubber: 0 });
    // The Widewing's first bomb is free; the other three cost rubber balls.
    expect(fullArmingCost(AIRCRAFT.widewing).rubber).toBe(3 * ECONOMY.arming.rubberPerBomb.standard);
  });

  it('with empty stores a plane still gets its basic load and a free bomb', () => {
    const a = armingFor(AIRCRAFT.widewing, AIRCRAFT.widewing.gun.ammo, 0, 4, 0, 0);
    expect(a).toEqual({ rounds: Math.ceil(AIRCRAFT.widewing.gun.ammo * ECONOMY.arming.basicLoad), bombs: 1, ink: 0, rubber: 0, short: true });
  });

  it('launching draws ink and rubber balls; an empty store never grounds the plane', () => {
    // Just enough rubber balls to fold it, nothing left to arm it with.
    const r = new ResourceManager(1000, { ink: 0, rubber: AIRCRAFT.widewing.materials!.rubber! });
    const { st, events } = state(r);
    flyFrom(st, 'widewing');
    expect(st.phase).toBe('flying');
    expect(st.bombsLoaded).toBe(1);
    expect(st.gun!.ammo).toBe(Math.ceil(AIRCRAFT.widewing.gun.ammo * ECONOMY.arming.basicLoad));
    expect(events.find((e) => e.type === 'armed')).toMatchObject({ arming: { short: true } });
  });

  it('a well-stocked plane flies fully armed, and the sortie counts what it used', () => {
    const r = new ResourceManager(1000, { ink: 100, rubber: 50 });
    const { st } = state(r);
    flyFrom(st, 'widewing');
    expect(st.bombsLoaded).toBe(4);
    expect(st.gun!.ammo).toBe(AIRCRAFT.widewing.gun.ammo);
    const folded = AIRCRAFT.widewing.materials!.rubber!;
    expect(r.rubber).toBe(50 - folded - 3 * ECONOMY.arming.rubberPerBomb.standard);
    expect(st.sortie!.rubberSpent).toBe(50 - r.rubber);
  });

  it('a new plane needs its materials; the Swift needs none, so the starter is always reachable', () => {
    const r = new ResourceManager(1000, { ink: 0, rubber: 0 });
    const { st, events } = state(r, DOGFIGHT);
    st.selectAircraft('falcon');
    expect(st.canBuild()).toBe(false);
    expect(st.build()).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'build-refused', reason: 'materials' });
    expect(r.paper).toBe(1000);
    st.selectAircraft('swift');
    expect(st.canBuild()).toBe(true);
    expect(AIRCRAFT.swift.materials).toBeUndefined();
  });

  it('topping up on the runway costs ink for the missing rounds only', () => {
    const r = new ResourceManager(1000, { ink: 100, rubber: 50 });
    const { st } = state(r, DOGFIGHT);
    flyFrom(st, 'swift');
    for (let i = 0; i < 40; i++) {
      st.fire();
      st.tick(0.2);
    }
    const fired = AIRCRAFT.swift.gun.ammo - st.gun!.ammo;
    expect(fired).toBeGreaterThan(0);
    const ink = r.ink;
    st.land('T1');
    expect(st.rearm()).toBe(true);
    st.tick(5);
    expect(st.gun!.ammo).toBe(AIRCRAFT.swift.gun.ammo);
    expect(ink - r.ink).toBe(Math.ceil(fired / ECONOMY.arming.roundsPerInk));
  });

  it('the free emergency plane takes nothing from the stores', () => {
    const r = new ResourceManager(0, { ink: 5, rubber: 5 });
    const { st } = state(r, DOGFIGHT);
    expect(st.emergencyAvailable()).toBe(true);
    for (const i of Object.values(st.incomes)) i.perMinute = 0;
    expect(st.buildEmergency()).toBe(true);
    st.tick(10);
    expect(st.launch()).toBe(true);
    expect(r.all).toEqual({ paper: 0, ink: 5, rubber: 5 });
    expect(st.gun!.ammo).toBe(ECONOMY.emergency.ammo);
  });
});

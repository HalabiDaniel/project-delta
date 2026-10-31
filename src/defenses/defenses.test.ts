import { describe, expect, it } from 'vitest';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { AIRCRAFT, BASE, DEFENSES, MISSIONS, THREAT, WORLD, type AircraftId, type ThreatLevel } from '../config';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { isRocket, Ordnance, steerRocket, sweepMoving, type AircraftTarget, type Shot, type ShotOrder } from '../combat/Ordnance';
import { DefenseNetwork, Installation, leadTime, wrapAngle, type DefenseEvent, type Target } from './Installation';
import { buildingSpec, departurePoint, homeDefenses, layoutDefenses, overHome, reachesHome, type InstallationSpec } from './Layout';
import { fits } from '../base/Base';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const occupied = layoutTargetRange(territories).flatMap((s) => s.shapes.map(footprint));
const layout = layoutDefenses(territories, occupied);
const DT = 1 / 60;

/** A weapon standing at the origin, facing -Z. */
function weapon(kind: 'turret' | 'launcher'): InstallationSpec {
  const c = DEFENSES[kind];
  return {
    id: kind, kind, territoryId: 'T0', side: 'enemy', name: c.name, role: c.role, x: 0, z: 0, ground: 0,
    pivot: c.pivot, facing: 0, arc: kind === 'turret' ? DEFENSES.turret.arc : null, range: c.range,
    maxHealth: c.health, footprint: c.footprint, shapes: [], solids: [],
  };
}

const still = (x: number, y: number, z: number, signature = 1, id = 'plane'): Target => ({ id, side: 'player', x, y, z, vx: 0, vy: 0, vz: 0, signature });

/** Runs an installation for `seconds`; returns the time of its first shot, or null. */
function firstShot(i: Installation, target: Target | null, seconds: number, alerted = false, scale = 1): number | null {
  for (let t = 0; t < seconds; t += DT) if (i.update(DT, target, alerted, scale)) return t;
  return null;
}

describe('threat levels', () => {
  it('home is safe, two neighbours are unprotected, and every level from light to fortified appears', () => {
    expect(home.threat).toBe(0);
    const level = (n: ThreatLevel) => territories.filter((t) => !t.isHome && t.threat === n).length;
    expect(level(0) + level(1)).toBeGreaterThanOrEqual(2);
    expect(level(0)).toBeGreaterThanOrEqual(2);
    for (const n of [1, 2, 3] as const) expect(level(n)).toBeGreaterThan(0);
    expect(territories.find((t) => t.id === 'T8')!.threat).toBe(3);
  });

  it('nothing shoots over home, and the safe zone ends near its edge', () => {
    expect(overHome(home, home.x, home.z)).toBe(true);
    expect(overHome(home, home.x + home.half + 5, home.z)).toBe(true);
    expect(overHome(home, home.x + home.half + DEFENSES.homeSafeMargin + 1, home.z)).toBe(false);
  });
});

describe('layoutDefenses', () => {
  const on = (id: string) => layout.installations.filter((i) => i.territoryId === id);

  it("puts each territory's profile on it, none on unprotected ground, and home's paper store at home", () => {
    for (const t of territories) {
      const own = on(t.id);
      const profile = THREAT.levels[t.threat];
      const count = (kind: string) => own.filter((i) => i.kind === kind).length;
      expect(count('turret')).toBe(t.isHome ? 0 : profile.turrets);
      expect(count('launcher')).toBe(t.isHome ? 0 : profile.launchers);
      expect(count('radar')).toBe(!t.isHome && profile.radar ? 1 : 0);
      expect(count('supply')).toBe(t.isHome || profile.supply ? 1 : 0);
      for (const i of own) expect(i.side).toBe(t.isHome ? 'player' : 'enemy');
      expect(layout.flags.filter((f) => f.territoryId === t.id)).toHaveLength(!t.isHome && t.threat > 0 ? 1 : 0);
    }
    expect(new Set(layout.installations.map((i) => i.id)).size).toBe(layout.installations.length);
  });

  it('keeps everything on its platform, off the bullseye area and clear of the target range and each other', () => {
    for (const i of layout.installations) {
      const t = territories.find((x) => x.id === i.territoryId)!;
      expect(t.containsXZ(i.x, i.z, -i.footprint)).toBe(true);
      expect(Math.hypot(i.x - t.x, i.z - t.z)).toBeGreaterThan(MISSIONS.bullseyeRadius.easy + i.footprint);
      for (const o of occupied) expect(Math.hypot(o.x - i.x, o.z - i.z)).toBeGreaterThanOrEqual(o.r + i.footprint);
      for (const j of layout.installations) {
        if (j !== i) expect(Math.hypot(j.x - i.x, j.z - i.z)).toBeGreaterThanOrEqual(j.footprint + i.footprint);
      }
    }
  });

  it("no enemy weapon reaches home or the first stretch after take-off", () => {
    for (const i of layout.installations) {
      if ((i.kind === 'turret' || i.kind === 'launcher') && i.side === 'enemy') expect(reachesHome(home, i.x, i.z, i.range)).toBe(false);
    }
    // The departure point lies between home and the middle of the map.
    const d = departurePoint(home);
    expect(Math.abs(d.x)).toBeLessThan(Math.abs(home.x));
    expect(Math.abs(d.z)).toBeLessThan(Math.abs(home.z));
  });

  it('weapons face the middle of their territory, and territories are laid out differently', () => {
    for (const i of layout.installations.filter((x) => x.kind === 'turret' && x.side === 'enemy')) {
      const t = territories.find((x) => x.id === i.territoryId)!;
      const toward = Math.atan2(-(t.x - i.x), -(t.z - i.z));
      expect(Math.abs(wrapAngle(i.facing - toward))).toBeLessThan(1e-9);
    }
    const shapes = territories
      .filter((t) => t.threat >= 2)
      .map((t) => on(t.id).map((i) => `${i.kind}:${Math.round(i.x - t.x)},${Math.round(i.z - t.z)}`).sort().join(' '));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('turrets are walled in at the back and sides, open to the front', () => {
    for (const turret of layout.installations.filter((i) => i.kind === 'turret' && i.side === 'enemy')) {
      const walls = layout.barriers.filter((b) => b.id.startsWith(`${turret.id}-`));
      expect(walls).toHaveLength(3);
      const ahead = { x: turret.x - Math.sin(turret.facing) * 2.4, z: turret.z - Math.cos(turret.facing) * 2.4 };
      for (const w of walls) expect(Math.hypot(w.x - ahead.x, w.z - ahead.z)).toBeGreaterThan(1);
    }
  });
});

describe('Installation: turrets', () => {
  it('notice planes at their range times the signature: small planes get closer', () => {
    const t = new Installation(weapon('turret'));
    const at40 = still(0, 10, -40);
    expect(t.sees(at40)).toBe(true);
    expect(t.sees({ ...at40, signature: AIRCRAFT.dart.signature })).toBe(false);
    expect(t.sees({ ...still(0, 10, -55), signature: AIRCRAFT.widewing.signature })).toBe(true);
    expect(t.sees(still(0, 10, -55))).toBe(false);
  });

  it('need a moment to get a fix, unless a radar has already done it', () => {
    const shot = firstShot(new Installation(weapon('turret'), seededRng(1)), still(0, 10, -30), 3)!;
    expect(shot).toBeGreaterThanOrEqual(DEFENSES.turret.acquireTime - DT);
    expect(shot).toBeLessThan(DEFENSES.turret.acquireTime + 0.4);
    expect(firstShot(new Installation(weapon('turret'), seededRng(1)), still(0, 10, -30), 3, true)!).toBeLessThan(0.3);
  });

  it('only fire within range, and see less far once their radar is lost', () => {
    expect(firstShot(new Installation(weapon('turret')), still(0, 10, -60), 3, true)).toBeNull();
    expect(firstShot(new Installation(weapon('turret')), still(0, 10, -40), 3, false, DEFENSES.radarLostDetection)).toBeNull();
    expect(firstShot(new Installation(weapon('turret')), still(0, 10, -28), 3, false, DEFENSES.radarLostDetection)).not.toBeNull();
  });

  it('never fire into the blind spot behind them, and never turn through it', () => {
    const t = new Installation(weapon('turret'));
    expect(firstShot(t, still(0, 10, 30), 3, true)).toBeNull();
    // Swing from far left to far right: it must go round the front.
    const left = new Installation(weapon('turret'));
    firstShot(left, still(-25, 10, -10), 2, true);
    let passedFront = false;
    for (let s = 0; s < 3; s += DT) {
      left.update(DT, still(25, 10, -10), true);
      expect(Math.abs(wrapAngle(left.yaw - left.spec.facing))).toBeLessThanOrEqual(DEFENSES.turret.arc + 1e-9);
      if (Math.abs(wrapAngle(left.yaw)) < 0.1) passedFront = true;
    }
    expect(passedFront).toBe(true);
  });

  it('turn at a limited rate: a plane that appears far off its aim is safe for a while', () => {
    const t = new Installation(weapon('turret'));
    firstShot(t, still(0, 10, -30), 2, true);
    const swing = DEFENSES.turret.arc * 0.9;
    const shot = firstShot(t, still(-Math.sin(swing) * 30, 10, -Math.cos(swing) * 30), 3, true)!;
    expect(shot).toBeGreaterThan((swing - DEFENSES.turret.fireCone) / DEFENSES.turret.turnRate - 0.1);
  });

  it('lead a steady plane, so its rounds meet it', () => {
    const from = { x: 0, y: 0, z: 0 };
    const target = { x: 0, y: 0, z: -40 };
    const v = { x: 20, y: 0, z: 0 };
    const t = leadTime(from, target, v, 44);
    const meet = { x: target.x + v.x * t, y: 0, z: target.z };
    expect(Math.hypot(meet.x, meet.z) / 44).toBeCloseTo(t, 2);
  });

  it('are destroyed at zero health and come back when restored', () => {
    const t = new Installation(weapon('turret'));
    expect(t.damage(30)).toEqual({ dealt: 30, destroyed: false });
    expect(t.damage(999)).toEqual({ dealt: DEFENSES.turret.health - 30, destroyed: true });
    expect(t.state).toBe('destroyed');
    expect(firstShot(t, still(0, 10, -30), 2, true)).toBeNull();
    t.restore();
    expect(t.alive).toBe(true);
    expect(firstShot(t, still(0, 10, -30), 2, true)).not.toBeNull();
  });
});

describe('Installation: rocket launchers', () => {
  it('lock on for a while, then launch, then reload', () => {
    const l = new Installation(weapon('launcher'));
    const target = still(0, 30, -60);
    const first = firstShot(l, target, 5)!;
    expect(first).toBeGreaterThanOrEqual(DEFENSES.launcher.lockTime - DT);
    expect(first).toBeLessThan(DEFENSES.launcher.lockTime + 1.2);
    expect(firstShot(l, target, DEFENSES.launcher.reload - 0.2)).toBeNull();
  });

  it("can't aim at planes low on the horizon", () => {
    expect(firstShot(new Installation(weapon('launcher')), still(0, 3, -70), 6)).toBeNull();
    expect(firstShot(new Installation(weapon('launcher')), still(0, 25, -65), 6)).not.toBeNull();
  });

  it('report the lock, and its loss when the plane gets away', () => {
    const net = new DefenseNetwork([weapon('launcher')]);
    const events: DefenseEvent['type'][] = [];
    for (let t = 0; t < 1; t += DT) events.push(...net.update(DT, [still(0, 30, -60)]).events.map((e) => e.type));
    for (let t = 0; t < 1; t += DT) events.push(...net.update(DT, [still(0, 30, -200)]).events.map((e) => e.type));
    expect(events).toContain('spotted');
    expect(events).toContain('lock');
    expect(events).toContain('lock-broken');
    expect(events).not.toContain('launch');
  });
});

describe('DefenseNetwork', () => {
  const t8 = layout.installations.filter((i) => i.territoryId === 'T8');

  it("a territory's radar alerts all its weapons from far out; without it they see less far", () => {
    const net = new DefenseNetwork(t8);
    const radar = net.radar('T8')!;
    // Beyond every weapon's own reach, but inside the radar's.
    const far = still(radar.spec.x, 30, radar.spec.z - DEFENSES.radar.range * 0.95);
    expect(net.alerted('T8', far)).toBe(true);
    const { events } = net.update(DT, [far]);
    expect(events).toContainEqual({ type: 'spotted', territoryId: 'T8', target: 'plane', by: 'radar' });
    expect(net.detectionScale('T8')).toBe(1);
    radar.damage(999);
    expect(net.alerted('T8', far)).toBe(false);
    expect(net.detectionScale('T8')).toBe(DEFENSES.radarLostDetection);
    net.restoreAll();
    expect(net.radar('T8')!.alive).toBe(true);
  });

  it('with nothing to shoot at, everything stands down', () => {
    const net = new DefenseNetwork(t8);
    const radar = net.radar('T8')!;
    for (let t = 0; t < 1; t += DT) net.update(DT, [still(radar.spec.x, 30, radar.spec.z - 20)]);
    expect(net.engagedWith('plane').length).toBeGreaterThan(0);
    const events: DefenseEvent[] = [];
    for (let t = 0; t < DEFENSES.memory + 0.5; t += DT) events.push(...net.update(DT, []).events);
    expect(net.engagedWith('plane')).toHaveLength(0);
    expect(events).toContainEqual({ type: 'lost', territoryId: 'T8', target: 'plane' });
  });
});

describe('sides', () => {
  const homeGuns = [...homeDefenses(home), buildingSpec(home, 'D1', 'turret', 1), buildingSpec(home, 'D2', 'turret', 1)];
  const t1 = homeGuns.find((i) => i.kind === 'turret')!;
  const aircraft = (id: string, side: 'player' | 'enemy', x: number, z: number, signature = 1.25, role?: Target['role']): Target => ({ id, side, x, y: 15, z, vx: 0, vy: 0, vz: 0, signature, role });

  it("home has the paper store, and every slot holds its buildings on the platform, clear of the runway, weapons facing out", () => {
    const store = homeDefenses(home).find((i) => i.kind === 'supply')!;
    expect(store.name).toBe(DEFENSES.home.storeName);
    expect(store.side).toBe('player');
    const launch = { x: home.x - (-home.x / Math.hypot(home.x, home.z)) * 9, z: home.z - (-home.z / Math.hypot(home.x, home.z)) * 9 };
    const specs = BASE.slots.flatMap((slot) => BASE.order.filter((k) => fits(k, slot.kind)).map((k) => buildingSpec(home, slot.id, k, 3)));
    for (const i of [store, ...specs]) {
      expect(i.side).toBe('player');
      expect(home.containsXZ(i.x, i.z, -Math.min(i.footprint, 2.5))).toBe(true);
      // Off the runway (7 m wide, along the diagonal through the middle) with room for a wing.
      const u = { x: -home.x / Math.hypot(home.x, home.z), z: -home.z / Math.hypot(home.x, home.z) };
      const side = Math.abs((i.x - home.x) * -u.z + (i.z - home.z) * u.x);
      expect(side - i.footprint).toBeGreaterThan(WORLD.runwayWidth / 2);
      expect(Math.hypot(i.x - launch.x, i.z - launch.z)).toBeGreaterThan(6);
    }
    // Slots keep apart from each other and from the store.
    const points = [store, ...BASE.slots.map((s) => buildingSpec(home, s.id, 'storage', 1))];
    for (const a of points) for (const b of points) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(8);
    // A weapon faces away from the middle of T1, so where it stands decides what it covers.
    for (const i of specs.filter((x) => x.kind === 'turret')) {
      const out = Math.atan2(home.x - i.x, home.z - i.z);
      expect(Math.abs(wrapAngle(i.facing - out))).toBeLessThan(1e-9);
    }
  });

  it("T1's turrets shoot at hostile aircraft, never at the player", () => {
    const fire = (targets: Target[]) => {
      const net = new DefenseNetwork(homeGuns, seededRng(2));
      const orders: ShotOrder[] = [];
      for (let t = 0; t < 3; t += DT) orders.push(...net.update(DT, targets).orders);
      return orders;
    };
    const ahead = { x: t1.x - Math.sin(t1.facing) * 25, z: t1.z - Math.cos(t1.facing) * 25 };
    expect(fire([aircraft('plane', 'player', ahead.x, ahead.z)])).toHaveLength(0);
    const shots = fire([aircraft('plane', 'player', ahead.x, ahead.z), aircraft('bandit', 'enemy', ahead.x + 3, ahead.z)]);
    expect(shots.length).toBeGreaterThan(0);
    for (const o of shots) expect(o).toMatchObject({ side: 'player', target: 'bandit' });
  });

  it('a player turret empties its magazine, then pauses to reload; upgrades hit harder', () => {
    const spec = buildingSpec(home, 'D1', 'turret', 1);
    const net = new DefenseNetwork([spec], seededRng(3));
    const ahead = { x: spec.x - Math.sin(spec.facing) * 20, z: spec.z - Math.cos(spec.facing) * 20 };
    const times: number[] = [];
    for (let t = 0; t < 20; t += DT) if (net.update(DT, [aircraft('bandit', 'enemy', ahead.x, ahead.z)]).orders.length) times.push(t);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const mag = BASE.buildings.turret.levels[0].magazine!;
    expect(times.length).toBeGreaterThan(mag);
    // The longest gap is the reload, every magazine.
    expect(Math.max(...gaps)).toBeGreaterThan(BASE.buildings.turret.levels[0].reloadTime! * 0.9);
    expect(gaps[mag - 1]).toBeGreaterThan(BASE.buildings.turret.levels[0].reloadTime! * 0.9);
    const l3 = new DefenseNetwork([buildingSpec(home, 'D1', 'turret', 3)], seededRng(3));
    let order: ShotOrder | undefined;
    for (let t = 0; t < 5 && !order; t += DT) order = l3.update(DT, [aircraft('bandit', 'enemy', ahead.x, ahead.z)]).orders[0];
    expect(order!.damage).toBe(BASE.buildings.turret.levels[2].damage);
  });

  it('a player launcher deals with bombers first; a turret takes the nearest', () => {
    const launcher = buildingSpec(home, 'D1', 'launcher', 1);
    const turret = buildingSpec(home, 'D2', 'turret', 1);
    const dir = (s: InstallationSpec, d: number) => ({ x: s.x - Math.sin(s.facing) * d, z: s.z - Math.cos(s.facing) * d });
    const net = new DefenseNetwork([launcher, turret], seededRng(5));
    const near = dir(launcher, 30);
    const far = dir(launcher, 60);
    const fighter = aircraft('fighter', 'enemy', near.x, near.z, 1, 'fighter');
    const bomber = aircraft('bomber', 'enemy', far.x, far.z, 1.25, 'bomber');
    for (let t = 0; t < 1; t += DT) net.update(DT, [fighter]);
    expect(net.get(launcher.id)!.targetId).toBe('fighter');
    // A bomber turns up further out: the launcher switches to it.
    for (let t = 0; t < 1; t += DT) net.update(DT, [fighter, bomber]);
    expect(net.get(launcher.id)!.targetId).toBe('bomber');
    expect(launcher.prefer).toBe('bomber');
    expect(turret.prefer).toBeUndefined();
  });

  it('buildings can be added, upgraded in place and removed; between sorties the player\'s keep their damage', () => {
    const net = new DefenseNetwork(homeDefenses(home), seededRng(1));
    const spec = buildingSpec(home, 'D1', 'turret', 1);
    net.add(spec);
    expect(net.on(home.id)).toHaveLength(2);
    net.get(spec.id)!.damage(45);
    const up = net.replace(buildingSpec(home, 'D1', 'turret', 2));
    expect(up.spec.level).toBe(2);
    expect(up.durability.fraction).toBeCloseTo(45 / 90, 1);
    net.restoreAll();
    expect(net.get(spec.id)!.durability.health).toBe(up.durability.health);
    net.get(spec.id)!.damage(1000);
    net.restoreAll();
    expect(net.get(spec.id)!.alive).toBe(false);
    net.remove(spec.id);
    expect(net.get(spec.id)).toBeUndefined();
    expect(net.on(home.id)).toHaveLength(1);
  });

  it("enemy guns shoot at the player and friendly aircraft, not at their own side's", () => {
    const turret = layout.installations.find((i) => i.id === 'T8-turret1')!;
    const ahead = { x: turret.x - Math.sin(turret.facing) * 25, z: turret.z - Math.cos(turret.facing) * 25 };
    const net = new DefenseNetwork([turret], seededRng(2));
    const orders: ShotOrder[] = [];
    for (let t = 0; t < 3; t += DT) orders.push(...net.update(DT, [aircraft('enemy-scout', 'enemy', ahead.x, ahead.z)]).orders);
    expect(orders).toHaveLength(0);
    for (let t = 0; t < 3; t += DT) orders.push(...net.update(DT, [aircraft('enemy-scout', 'enemy', ahead.x, ahead.z), aircraft('escort-bomber', 'player', ahead.x, ahead.z + 4)]).orders);
    expect(orders.length).toBeGreaterThan(0);
    expect(net.engagedWith('escort-bomber')).toHaveLength(1);
  });

  it('a weapon sticks with the aircraft it follows while it sees it, then takes the nearest other one', () => {
    const i = layout.installations.find((x) => x.id === 'T8-turret1')!;
    const net = new DefenseNetwork([i], seededRng(4));
    const dir = { x: -Math.sin(i.facing), z: -Math.cos(i.facing) };
    const at = (d: number) => ({ x: i.x + dir.x * d, z: i.z + dir.z * d });
    const a = aircraft('a', 'player', at(30).x, at(30).z, 1);
    for (let t = 0; t < 1; t += DT) net.update(DT, [a]);
    expect(net.installations[0].targetId).toBe('a');
    // A second plane closer in doesn't steal its attention while it still sees the first.
    const b = aircraft('b', 'player', at(15).x, at(15).z + 2, 1);
    for (let t = 0; t < 1; t += DT) net.update(DT, [a, b]);
    expect(net.installations[0].targetId).toBe('a');
    // Once the first is gone, it turns to the other.
    for (let t = 0; t < 1; t += DT) net.update(DT, [b]);
    expect(net.installations[0].targetId).toBe('b');
  });

  it('rounds only hit aircraft of the other side, and rockets home on the aircraft they were fired at', () => {
    const fire = new Ordnance();
    const at = (id: string, side: 'player' | 'enemy', x: number, z: number): AircraftTarget => ({ id, side, x, y: 10, z, px: x, py: 10, pz: z, radius: 1 });
    fire.spawn({ kind: 'ink', source: 'gun', side: 'enemy', x: 0, y: 10, z: 0, vx: 50, vy: 0, vz: 0 });
    const events = fire.update(0.5, [at('friend', 'enemy', 10, 0), at('foe', 'player', 20, 0)], []);
    expect(events).toMatchObject([{ type: 'hit', target: 'foe' }]);
    fire.spawn({ kind: 'rocket', source: 'launcher', side: 'enemy', target: 'b', x: 0, y: 10, z: 0, vx: 10, vy: 0, vz: 0 });
    for (let t = 0; t < 0.5; t += DT) fire.update(DT, [at('a', 'player', 0, -40), at('b', 'player', 0, 40)], []);
    expect(fire.shots[0].vz).toBeGreaterThan(0);
  });
});

/** Flies a plane in a straight line through T8's turrets; returns the damage it takes from ink. */
function straightPass(id: AircraftId, speed: number, seed: number, line = 0): number {
  const net = new DefenseNetwork(layout.installations.filter((i) => i.territoryId === 'T8' && i.kind !== 'launcher'), seededRng(seed));
  const fire = new Ordnance();
  let damage = 0;
  for (let z = -40; z < 190; ) {
    const before = z;
    z += speed * DT;
    for (const o of net.update(DT, [{ id: 'plane', side: 'player', x: line, y: 20, z, vx: 0, vy: 0, vz: speed, signature: AIRCRAFT[id].signature }]).orders) fire.spawn(o);
    for (const e of fire.update(DT, [{ id: 'plane', side: 'player', x: line, y: 20, z, px: line, py: 20, pz: before, radius: AIRCRAFT[id].hitRadius }], territories)) {
      if (e.type === 'hit') damage += e.shot.damage;
    }
  }
  return damage;
}

function averagePass(id: AircraftId, speed: number): number {
  let total = 0;
  for (const line of [0, 25]) for (let seed = 1; seed <= 6; seed++) total += straightPass(id, speed, seed, line);
  return total / 12;
}

describe('accuracy', () => {
  it('a faster plane is harder to hit', () => {
    for (const id of ['falcon', 'widewing'] as const) {
      const f = AIRCRAFT[id].flight;
      expect(averagePass(id, f.maxSpeed)).toBeLessThan(averagePass(id, f.cruiseSpeed) * 0.6);
    }
    // Boosting past the guns is close to safe.
    expect(averagePass('falcon', AIRCRAFT.falcon.flight.maxSpeed + AIRCRAFT.falcon.flight.boostSpeed)).toBeLessThan(5);
  });

  it('turrets are dangerous but not perfect: a bomber survives a straight pass at cruise', () => {
    const bomber = averagePass('widewing', AIRCRAFT.widewing.flight.cruiseSpeed);
    expect(bomber).toBeGreaterThan(15);
    expect(bomber).toBeLessThan(AIRCRAFT.widewing.maxHealth * 0.6);
  });

  it('a weaving plane is hit less than one flying straight', () => {
    const run = (weave: number) => {
      let damage = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const net = new DefenseNetwork(layout.installations.filter((i) => i.id === 'T8-turret2'), seededRng(seed));
        const turret = net.installations[0].spec;
        const fire = new Ordnance();
        let x = turret.x - 50;
        let z = turret.z + 25;
        for (let t = 0; t < 4; t += DT) {
          const vx = 20 * Math.cos(weave * Math.sin(t * 2.2));
          const vz = 20 * Math.sin(weave * Math.sin(t * 2.2));
          const px = x;
          const pz = z;
          x += vx * DT;
          z += vz * DT;
          for (const o of net.update(DT, [{ id: 'plane', side: 'player', x, y: 12, z, vx, vy: 0, vz, signature: 1 }]).orders) fire.spawn(o);
          for (const e of fire.update(DT, [{ id: 'plane', side: 'player', x, y: 12, z, px, py: 12, pz, radius: 1 }], [])) if (e.type === 'hit') damage += e.shot.damage;
        }
      }
      return damage;
    };
    expect(run(0.9)).toBeLessThan(run(0) * 0.7);
  });
});

describe('Ordnance', () => {
  const t5 = territories.find((t) => t.id === 'T5')!;
  const plane = (x: number, y: number, z: number, px = x, py = y, pz = z, radius = 1): AircraftTarget => ({ id: 'plane', side: 'player', x, y, z, px, py, pz, radius });
  const ink = (x: number, y: number, z: number, vx: number, vy: number, vz: number): ShotOrder => ({ kind: 'ink', source: 'test', side: 'enemy', x, y, z, vx, vy, vz });
  const rocket = (vx: number): ShotOrder => ({ kind: 'rocket', source: 'x', side: 'enemy', target: 'plane', x: 0, y: 10, z: 0, vx, vy: 0, vz: 0 });

  it('ink flies straight, hits a plane in its path, splats on platforms and dries up', () => {
    const fire = new Ordnance();
    fire.spawn(ink(0, 20, 0, 44, 0, 0));
    let events = fire.update(0.5, [plane(22, 20, 0)], territories);
    expect(events).toMatchObject([{ type: 'hit', target: 'plane' }]);
    fire.spawn(ink(t5.x, 5, t5.z, 0, -44, 0));
    events = fire.update(0.2, [], territories);
    expect(events).toMatchObject([{ type: 'ground', territoryId: 'T5' }]);
    fire.spawn(ink(0, 60, 0, 44, 0, 0));
    events = [];
    for (let t = 0; t < 2; t += DT) events.push(...fire.update(DT, [], []));
    expect(events).toMatchObject([{ type: 'spent' }]);
    expect(fire.shots).toHaveLength(0);
  });

  it('a round that crosses a fast plane between frames still hits it', () => {
    expect(sweepMoving({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 }, { x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 0.5)).not.toBeNull();
    expect(sweepMoving({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 }, { x: 5, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }, 0.5)).toBeNull();
  });

  it('rockets speed up and turn no faster than their turn rate', () => {
    const r: Shot = {
      id: 1, kind: 'rocket', source: 'x', side: 'enemy', target: 'plane', x: 0, y: 0, z: 0, vx: 10, vy: 0, vz: 0, px: 0, py: 0, pz: 0,
      age: 0, travelled: 0, travel: 0, damage: 0, radius: 0.3, active: true,
    };
    steerRocket(r, { x: 0, y: 0, z: 100 }, 0.1);
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(10 + DEFENSES.launcher.rocket.accel * 0.1);
    expect(Math.atan2(r.vz, r.vx)).toBeCloseTo(DEFENSES.launcher.rocket.turnRate * 0.1);
  });

  /** A rocket fired at a plane 30 m ahead; does it catch it? */
  const chase = (speed: number, turnRate: number) => {
    const fire = new Ordnance();
    fire.spawn(rocket(DEFENSES.launcher.rocket.speed));
    let heading = 0;
    let x = 30;
    let z = 0;
    for (let t = 0; t < DEFENSES.launcher.rocket.life + 0.5; t += DT) {
      const px = x;
      const pz = z;
      heading += turnRate * DT;
      x += Math.cos(heading) * speed * DT;
      z += Math.sin(heading) * speed * DT;
      if (fire.update(DT, [plane(x, 10, z, px, 10, pz)], []).some((e) => e.type === 'hit')) return true;
    }
    return false;
  };

  it('catch slow or straight-flying planes, but a fast one outruns them and a tight turn makes them overshoot', () => {
    expect(chase(20, 0)).toBe(true);
    expect(chase(AIRCRAFT.widewing.flight.cruiseSpeed, AIRCRAFT.widewing.flight.maxTurnRate)).toBe(true);
    expect(chase(AIRCRAFT.falcon.flight.maxSpeed + 2, 0)).toBe(false);
    expect(chase(20, AIRCRAFT.falcon.flight.maxTurnRate)).toBe(false);
  });

  it('rockets can be shot down; rockets over home fly straight on', () => {
    const fire = new Ordnance();
    fire.spawn(rocket(10));
    fire.update(DT, [{ ...plane(0, 10, 50), shielded: true }], []);
    expect(fire.shots[0].vz).toBeCloseTo(0);
    const [collider] = fire.rocketColliders();
    expect(isRocket(collider.id)).toBe(true);
    expect(fire.shootDown('T5-turret')).toBeNull();
    expect(fire.shootDown(collider.id)).not.toBeNull();
    expect(fire.shots).toHaveLength(0);
  });
});

describe('aircraft and defenses', () => {
  it('the Dart is hardest to spot and the Widewing the easiest and biggest target', () => {
    const sig = (id: AircraftId) => AIRCRAFT[id].signature;
    expect(sig('dart')).toBeLessThan(sig('falcon'));
    expect(sig('falcon')).toBeLessThan(sig('widewing'));
    expect(AIRCRAFT.widewing.hitRadius).toBeGreaterThan(AIRCRAFT.falcon.hitRadius);
    expect(AIRCRAFT.dart.hitRadius).toBeLessThan(AIRCRAFT.falcon.hitRadius);
  });

  it('every defense can be beaten: blind spots, low approaches, and rockets a fighter can outrun but a bomber cannot', () => {
    expect(DEFENSES.turret.lead).toBeLessThan(1);
    expect(DEFENSES.turret.arc).toBeLessThan(Math.PI);
    expect(DEFENSES.launcher.minPitch).toBeGreaterThan(0);
    expect(DEFENSES.launcher.rocket.speed).toBeLessThan(AIRCRAFT.falcon.flight.maxSpeed);
    expect(DEFENSES.launcher.rocket.speed).toBeGreaterThan(AIRCRAFT.widewing.flight.maxSpeed);
  });
});

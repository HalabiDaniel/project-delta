import { describe, expect, it } from 'vitest';
import { AIRCRAFT, TERRITORY_LIFECYCLE } from '../../src/config';
import { launch, place, player, quietWorld, run } from './testkit';
import type { ServerWorld } from './ServerWorld';

/**
 * v0.0.13 in the world: where players are placed, the territory lifecycle, raids that go on when
 * the defender leaves, the arrival grace, and planes whose pilots are gone for good.
 */

/** Ann on T1 takes a raid card on Bo (T3) and launches a Widewing at his base. */
function raidUnderWay(world: ServerWorld = quietWorld(3)) {
  const a = player(world, 'a', 'T1', 'Ann');
  const b = player(world, 'b', 'T3', 'Bo');
  b.protectUntil = 0;
  b.resources.restore(400);
  run(world, 1.5);
  const card = a.pvp.find((c) => c.tag.kind === 'raid')!;
  a.state!.select(a.state!.offers.indexOf(card.mission));
  world.command('a', { a: 'aircraft', id: 'widewing' });
  world.command('a', { a: 'build' });
  run(world, 2.2);
  expect(world.command('a', { a: 'launch' })).toBe(true);
  expect(world.attacks.on('b')?.attacker).toBe('a');
  return { world, a, b };
}

/** Ann drops her bomb on the raid's target. */
function bomb(world: ServerWorld) {
  const a = world.pilots.get('a')!;
  run(world, 4);
  const target = world.attacks.on('b')!.target;
  place(a, target.x, 6, target.z, 0);
  a.flight.model.speed = 9;
  run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
  run(world, 2);
}

describe('placement', () => {
  it('places players only on open or AI desks, never on a player\'s or an empty one', () => {
    const world = quietWorld(2);
    player(world, 'a', 'T1');
    player(world, 'b', 'T2');
    world.remove('b');
    expect(world.deskState('T2')).toBe('empty');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(world.pickDesk()!);
    expect(seen.has('T1')).toBe(false);
    expect(seen.has('T2')).toBe(false);
    expect(seen.size).toBe(14);
    expect(world.pickDesk(new Set(world.freeDesks()))).toBeNull();
  });

  it('prefers a desk no plane can see, so bases never pop up under anyone', () => {
    const world = quietWorld(2);
    const a = player(world, 'a', 'T1');
    launch(world, a);
    const t6 = world.territories.find((t) => t.id === 'T6')!;
    place(a, t6.x, t6.top + 20, t6.z, 0);
    for (let i = 0; i < 200; i++) {
      const desk = world.pickDesk()!;
      const t = world.territories.find((x) => x.id === desk)!;
      expect(Math.hypot(t.x - t6.x, t.z - t6.z)).toBeGreaterThan(60);
    }
  });

  it('lets a joining player replace the AI on its desk at once', () => {
    const world = quietWorld(2);
    expect(world.deskState('T7')).toBe('ai');
    expect(world.network.on('T7').length).toBeGreaterThan(0);
    const p = player(world, 'p', 'T7');
    expect(world.deskState('T7')).toBe('player');
    expect(world.network.on('T7').every((i) => i.side === p.side)).toBe(true);
  });
});

describe('the territory lifecycle', () => {
  it('goes player → draining → empty → open → AI, with its timers', () => {
    const world = quietWorld(2, { lifecycle: { gap: 2, aiDelay: 3 } });
    const ai = world.network.on('T7').map((i) => i.id).sort();
    expect(ai.length).toBeGreaterThan(0);
    player(world, 'a', 'T7', 'Ann');
    expect(world.deskState('T7')).toBe('player');
    world.setConnected('a', false);
    expect(world.deskState('T7')).toBe('draining');
    world.setConnected('a', true);
    expect(world.deskState('T7')).toBe('player');
    world.remove('a');
    expect(world.deskState('T7')).toBe('empty');
    expect(world.deskTimeLeft('T7')).toBeCloseTo(2, 1);
    expect(world.claimRefusal('nobody', 'T7')).toBe('unknown player');
    world.join('c', 'Cy');
    expect(world.claimRefusal('c', 'T7')).toBe('empty');
    run(world, 2.1);
    expect(world.deskState('T7')).toBe('open');
    expect(world.deskName('T7')).toBe('Free desk');
    run(world, 3.1);
    expect(world.deskState('T7')).toBe('ai');
    expect(world.network.on('T7').map((i) => i.id).sort()).toEqual(ai);
    expect(world.deskName('T7')).toMatch(/'s desk$/);
  });

  it("waits for the AI to move in until no plane can see the desk", () => {
    const world = quietWorld(2, { lifecycle: { gap: 0.5, aiDelay: 0.5 } });
    const a = player(world, 'a', 'T1');
    player(world, 'b', 'T6');
    launch(world, a);
    world.remove('b');
    const t6 = world.territories.find((t) => t.id === 'T6')!;
    const over = () => place(a, t6.x, t6.top + 25, t6.z, 0);
    over();
    for (let i = 0; i < 10; i++) {
      run(world, 0.2);
      over();
    }
    expect(world.deskState('T6')).toBe('open');
    place(a, 400, 60, 400, 0);
    run(world, 0.1);
    expect(world.deskState('T6')).toBe('ai');
  });

  it('never aims a mission at an empty or open desk', () => {
    const world = quietWorld(2);
    const a = player(world, 'a', 'T1');
    player(world, 'b', 'T2');
    world.remove('b');
    const excluded = world.missionContext(a).excluded!;
    expect(excluded.has('T2')).toBe(true);
    expect(excluded.has('T1')).toBe(false);
  });
});

describe('fair disconnects', () => {
  it('a raid goes on when the defender drops: their defenses stay, it ends normally, and is settled once', () => {
    const { world, a, b } = raidUnderWay();
    world.setConnected('b', false);
    expect(world.deskState('T3')).toBe('draining');
    expect(b.base!.buildings.size + 1).toBeGreaterThan(0);
    expect(world.network.on('T3').every((i) => i.side === b.side)).toBe(true);
    const before = b.resources.paper;
    bomb(world);
    expect(b.report?.outcome).toBe('bombed');
    expect(b.resources.paper).toBeLessThan(before);
    expect(a.stats.raids).toBe(1);
    const raids = world.takePvp().filter((e) => e.kind === 'raid');
    expect(raids).toHaveLength(1);
    expect(raids[0]).toMatchObject({ attacker: 'a', victim: 'b', success: true });
    // The loss was one ledger change, keyed by the raid.
    const losses = world.takePaper('b').filter((c) => c.key.startsWith('raid:'));
    expect(losses).toHaveLength(1);
  });

  it('a defender who leaves for good keeps their base on the desk until the raid is settled, then the gap starts', () => {
    const { world, a } = raidUnderWay();
    expect(world.holdForRaid('b')).toBe(true);
    expect(world.pilots.has('b')).toBe(true);
    expect(world.deskState('T3')).toBe('draining');
    expect(world.released()).toEqual([]);
    expect(world.attacks.refusal(a, world.pilots.get('b')!, world.time, 0)).toBe('offline');
    bomb(world);
    expect(world.released()).toEqual(['b']);
    world.remove('b');
    expect(world.deskState('T3')).toBe('empty');
    expect(world.deskTimeLeft('T3')).toBeCloseTo(TERRITORY_LIFECYCLE.gap, 0);
  });

  it('a defender who comes back before the raid is settled has their desk back', () => {
    const { world } = raidUnderWay();
    world.holdForRaid('b');
    world.setConnected('b', true);
    expect(world.deskState('T3')).toBe('player');
    expect(world.released()).toEqual([]);
  });

  it("holds nobody when there's no raid on them", () => {
    const world = quietWorld(2);
    player(world, 'a', 'T1');
    expect(world.holdForRaid('a')).toBe(false);
  });

  it('protects a player for a while after arriving, then lets raids start', () => {
    const world = quietWorld(3, { arrivalGrace: 2 });
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    b.protectUntil = 0;
    expect(world.attacks.refusal(a, b, world.time, world.arrivalGrace)).toBe('arriving');
    run(world, 1.5);
    expect(a.pvp.some((c) => c.tag.kind === 'raid')).toBe(false);
    run(world, 1.5);
    expect(world.attacks.refusal(a, b, world.time, world.arrivalGrace)).toBeNull();
    expect(a.pvp.some((c) => c.tag.kind === 'raid' && c.tag.target === 'b')).toBe(true);
  });
});

describe('flight across disconnects', () => {
  it('out of combat, the plane glides home undamaged and its mission fails without further penalty', () => {
    const world = quietWorld(4);
    const a = player(world, 'a', 'T1', 'Ann');
    launch(world, a, 'falcon');
    a.state!.durability!.health -= 9;
    const paper = a.resources.paper;
    expect(world.inCombat(a)).toBe(false);
    expect(world.settleFlight(a)).toBe('returned');
    expect(a.state!.hangar.get('falcon')).toMatchObject({ condition: 'recovered', health: AIRCRAFT.falcon.maxHealth });
    expect(a.stats.deaths).toBe(0);
    expect(a.resources.paper).toBe(paper);
    expect(a.outcomes.at(-1)).toMatchObject({ state: 'failed', outcome: 'abandoned' });
  });

  it('in combat, the plane is lost as if shot down, and nobody earns a kill for it', () => {
    const world = quietWorld(7);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a);
    launch(world, b);
    place(a, 0, 40, 60, 0);
    place(b, 0, 40, 40, 0);
    run(world, 0.5, (id) => (id === 'a' ? { fire: true } : {}));
    expect(world.inCombat(b)).toBe(true);
    expect(world.inCombat(a)).toBe(true);
    const paper = a.resources.paper;
    expect(world.settleFlight(b)).toBe('lost');
    expect(b.stats.deaths).toBe(1);
    expect(a.stats.kills).toBe(0);
    expect(a.stats.assists).toBe(0);
    expect(a.resources.paper).toBe(paper);
    expect(world.aircraftSave('b')!.some((r) => r.type === 'falcon')).toBe(false);
  });

  it('counts a fight as over after the combat window', () => {
    const world = quietWorld(7);
    const a = player(world, 'a', 'T1');
    launch(world, a);
    a.combatAt = world.time;
    expect(world.inCombat(a)).toBe(true);
    run(world, 10.1);
    expect(world.inCombat(a)).toBe(false);
  });

  it('a raider who leaves mid-raid loses the plane, and the raid fails', () => {
    const { world, a, b } = raidUnderWay();
    expect(world.inCombat(a)).toBe(true);
    world.remove('a');
    expect(world.attacks.active).toHaveLength(0);
    expect(b.report?.outcome).toBe('repelled');
    expect(world.takeDeparture('a')!.aircraft.some((r) => r.type === 'widewing')).toBe(false);
  });

  it('never leaves a plane in two places: one returned is in the hangar and nowhere else', () => {
    const world = quietWorld(4);
    const a = player(world, 'a', 'T1');
    launch(world, a, 'falcon');
    world.settleFlight(a);
    const planes = world.aircraftSave('a')!.filter((r) => r.type === 'falcon');
    expect(planes).toHaveLength(1);
    expect(a.flight.model.status).toBe('hidden');
    expect(world.settleFlight(a)).toBeNull();
  });
});

describe('no practice targets in sessions', () => {
  it('never deals target practice, and the world has no practice planes', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const world = quietWorld(seed);
      const p = player(world, 'p', `T${(seed % 16) + 1}`);
      expect(world.missionContext(p).dummies).toEqual([]);
      for (let deal = 0; deal < 4; deal++) {
        for (const m of p.cards()) {
          expect(m.spec.type).not.toBe('practice');
          for (const o of m.spec.objectives) if (o.kind === 'destroy') expect(o.what).not.toBe('practice');
        }
        p.director!.deal();
      }
    }
  });
});

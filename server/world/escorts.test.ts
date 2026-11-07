import { describe, expect, it } from 'vitest';
import { AIRCRAFT, ESCORTS } from '../../src/config';
import { parseCommand } from '../../src/net/protocol';
import type { AiOrders } from '../../src/ai/AiAircraft';
import { EscortBook } from './Escorts';
import { launch, player, quietWorld, run } from './testkit';

/** v0.0.19 §1: purchasable, single-use AI escorts. */
describe('AI escorts', () => {
  it('are chosen at home, capped at two per sortie, and the command is validated', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    expect(world.command('a', { a: 'escorts', kinds: ['wingman', 'guard'] })).toBe(true);
    expect(world.escorts.plan('a')).toEqual(['wingman', 'guard']);
    expect(world.command('a', { a: 'escorts', kinds: ['wingman', 'guard', 'spotter'] })).toBe(false);
    expect(world.escorts.plan('a')).toEqual(['wingman', 'guard']);
    expect(parseCommand({ a: 'escorts', kinds: ['wingman', 'nope'] })).toBeNull();
    expect(parseCommand({ a: 'escort-order', o: 'attack' })).toEqual({ a: 'escort-order', o: 'attack' });
    expect(parseCommand({ a: 'escort-order', o: 'kamikaze' })).toBeNull();
    expect(world.privateFor('a', true)?.escorts?.cost).toEqual({ paper: ESCORTS.roster.wingman.cost.paper + ESCORTS.roster.guard.cost.paper, ink: ESCORTS.roster.wingman.cost.ink! + ESCORTS.roster.guard.cost.ink! });
    void a;
  });

  it('are bought at launch, fly on their owner wing, weaker than a human plane, and are paid for once', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(400);
    a.resources.restoreOf('ink', 100);
    world.command('a', { a: 'escorts', kinds: ['guard', 'wingman'] });
    const paperBefore = a.resources.paper;
    launch(world, a, 'falcon');
    const mine = world.escorts.of('a');
    expect(mine.map((e) => e.kind).sort()).toEqual(['guard', 'wingman']);
    const guard = world.air.get(mine.find((e) => e.kind === 'guard')!.id)!;
    expect(guard.purpose).toBe('escort');
    expect(guard.side).toBe(a.side);
    expect(guard.durability.max).toBeLessThan(AIRCRAFT.falcon.maxHealth);
    expect(['easy', 'medium']).toContain(guard.orders.skill);
    // Escorts add no stealth: the Falcon's escort is never quieter than a plain plane.
    expect(guard.contact().signature).toBeGreaterThanOrEqual(ESCORTS.minSignature);
    // Paid once: the plane, plus both escorts.
    const escortPaper = ESCORTS.roster.guard.cost.paper + ESCORTS.roster.wingman.cost.paper;
    expect(paperBefore - a.resources.paper).toBeGreaterThanOrEqual(escortPaper);
    // A few seconds later they are flying close to their owner.
    run(world, 6, () => ({ throttle: 0 }));
    const pos = a.flight.model.position;
    expect(Math.hypot(guard.position.x - pos.x, guard.position.z - pos.z)).toBeLessThan(60);
  });

  it('are removed when the sortie ends, even if they survived, and are not refunded', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(400);
    a.resources.restoreOf('ink', 100);
    world.command('a', { a: 'escorts', kinds: ['wingman'] });
    launch(world, a, 'falcon');
    const id = world.escorts.of('a')[0].id;
    const paper = a.resources.paper;
    expect(world.air.get(id)).toBeDefined();
    expect(world.recall(a)).toBe(true);
    expect(world.escorts.of('a')).toEqual([]);
    expect(world.air.get(id)).toBeUndefined();
    expect(a.resources.paper).toBeLessThanOrEqual(paper);
  });

  it('leave with their owner: shot down, disconnected or gone', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(400);
    a.resources.restoreOf('ink', 100);
    world.command('a', { a: 'escorts', kinds: ['wingman', 'spotter'] });
    launch(world, a, 'falcon');
    expect(world.escorts.of('a')).toHaveLength(2);
    world.setConnected('a', false);
    expect(world.escorts.of('a')).toEqual([]);
    expect(world.air.aircraft.filter((x) => x.purpose === 'escort')).toEqual([]);
  });

  it('respect the session cap', () => {
    const book = new EscortBook();
    const leader = { plane: 'pl:x', side: 'p:x' as const, x: 0, y: 20, z: 0, fx: 0, fz: -1 };
    for (let i = 0; i < ESCORTS.perSession; i++) book.launch(`o${Math.floor(i / 2)}`, 'wingman', leader, []);
    expect(book.room('late')).toBe(0);
    expect(book.room('o0')).toBe(0);
  });

  it("can't finish a target their owner's mission needs", () => {
    const world = quietWorld(2);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    a.resources.restore(400);
    a.resources.restoreOf('ink', 100);
    launch(world, b, 'falcon');
    run(world, 1.5);
    // Ann's hunt card on Bo, flown with an escort.
    const hunt = a.pvp.find((c) => c.tag.kind === 'hunt')!;
    expect(hunt).toBeDefined();
    a.state!.select(a.state!.offers.indexOf(hunt.mission));
    world.command('a', { a: 'escorts', kinds: ['guard'] });
    launch(world, a, 'falcon');
    const escort = world.escorts.of('a')[0];
    const damage = (world as unknown as { escortDamage: (o: string, t: string, n: number) => number }).escortDamage.bind(world);
    const health = b.state!.durability!.health;
    expect(damage('a', b.plane, health + 50)).toBe(health - 1);
    // A plane the mission doesn't need takes it in full.
    expect(damage('a', 'someone-else', 30)).toBe(30);
    void escort;
  });

  it('obey orders: attack my target picks the hostile ahead of the owner; cover my retreat the one behind', () => {
    const leader = { plane: 'pl:a', side: 'p:a' as const, x: 0, y: 20, z: 0, fx: 0, fz: -1 };
    const ahead = { id: 'x', side: 'enemy' as const, x: 0, y: 20, z: -50, shielded: false };
    const behind = { id: 'y', side: 'enemy' as const, x: 0, y: 20, z: 40, shielded: false };
    const orders: AiOrders = { id: 'e', side: 'p:a', role: 'fighter', skill: 'easy', route: [], loop: true, exit: { x: 0, y: 0, z: 0 }, purpose: 'escort' };
    EscortBook.apply(orders, 'attack', leader, [ahead, behind], null, null);
    expect(orders.prey).toBe('x');
    EscortBook.apply(orders, 'cover', leader, [ahead, behind], null, null);
    expect(orders.prey).toBe('y');
    EscortBook.apply(orders, 'protect', leader, [ahead, behind], 'pl:bomber', null);
    expect(orders.escort).toBe('pl:bomber');
    expect(orders.prey).toBeUndefined();
    EscortBook.apply(orders, 'follow', leader, [ahead], null, null);
    expect(orders.escort).toBe('pl:a');
  });

  it('shooting one down pays a small fixed amount and nothing else', () => {
    const world = quietWorld(4);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    a.resources.restore(400);
    a.resources.restoreOf('ink', 100);
    world.command('a', { a: 'escorts', kinds: ['wingman'] });
    launch(world, a, 'falcon');
    launch(world, b, 'falcon');
    const id = world.escorts.of('a')[0].id;
    const before = b.resources.paper;
    world.air.damage(id, 9999, b.plane, true);
    run(world, 0.1);
    expect(world.escorts.of('a')).toEqual([]);
    expect(b.resources.paper - before).toBe(ESCORTS.killReward);
  });
});

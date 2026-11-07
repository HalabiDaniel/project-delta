import { describe, expect, it } from 'vitest';
import { ALLIANCES, COOP } from '../../src/config';
import { parseCommand } from '../../src/net/protocol';
import { AllianceBook } from './Alliances';
import { CoopBook } from './Coop';
import { launch, player, quietWorld, run } from './testkit';

/** v0.0.19 "Also B": alliances for the session. */
describe('alliances', () => {
  it('are offered and accepted, capped against the session, and left with a cooldown', () => {
    const book = new AllianceBook();
    expect(book.offer('a', 'a', 0, 6)).toBe('self');
    expect(book.offer('a', 'b', 0, 6)).toBeNull();
    expect(book.offer('a', 'b', 0, 6)).toBe('pending');
    expect(book.accept('b', 'c', 0, 6)).toBe('none');
    const made = book.accept('b', 'a', 1, 6);
    expect(typeof made).toBe('object');
    expect(book.allied('a', 'b')).toBe(true);
    // A third joins; a fourth can't (the cap is 3).
    expect(book.offer('c', 'a', 2, 6)).toBeNull();
    expect(book.accept('a', 'c', 2, 6)).toMatchObject({ members: ['a', 'b', 'c'] });
    expect(book.offer('d', 'a', 3, 8)).toBe('full');
    // In a session of two, the whole session is the cap (at least two).
    expect(AllianceBook.cap(2)).toBe(2);
    expect(AllianceBook.cap(4)).toBe(2);
    expect(AllianceBook.cap(16)).toBe(ALLIANCES.maxSize);
    // Leaving: the peace holds for the cooldown.
    expect(book.leave('c', 10)).toEqual(['a', 'b']);
    expect(book.allied('a', 'c')).toBe(false);
    expect(book.peaceful('a', 'c', 10 + ALLIANCES.leaveCooldown - 1)).toBe(true);
    expect(book.peaceful('a', 'c', 10 + ALLIANCES.leaveCooldown)).toBe(false);
    expect(book.offer('c', 'a', 11, 6)).toBe('cooldown');
    // An alliance left with one member is over.
    book.leave('b', 20);
    expect(book.of('a')).toBeUndefined();
  });

  it('validates the command', () => {
    expect(parseCommand({ a: 'ally', o: 'offer', id: 'abc' })).toEqual({ a: 'ally', o: 'offer', id: 'abc' });
    expect(parseCommand({ a: 'ally', o: 'offer' })).toBeNull();
    expect(parseCommand({ a: 'ally', o: 'leave' })).toEqual({ a: 'ally', o: 'leave' });
    expect(parseCommand({ a: 'ally', o: 'merge', id: 'x' })).toBeNull();
    expect(parseCommand({ a: 'coop', w: 'anyone' })).toEqual({ a: 'coop', w: 'anyone' });
  });

  it('in the world: no friendly fire, no raids or hunts between allies, raids shared, bases hold fire', () => {
    const world = quietWorld(11);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    for (const p of [a, b]) p.protectUntil = 0;
    b.resources.restore(300);
    run(world, 1.2);
    expect(a.pvp.some((c) => c.tag.kind === 'raid' && c.tag.target === 'b')).toBe(true);
    expect(world.command('a', { a: 'ally', o: 'offer', id: 'b' })).toBe(true);
    expect(world.privateFor('b', true)?.alliance?.offers).toEqual(['a']);
    expect(world.command('b', { a: 'ally', o: 'accept', id: 'a' })).toBe(true);
    expect(world.alliances.allied('a', 'b')).toBe(true);
    run(world, 1.2);
    expect(a.pvp.some((c) => ['raid', 'hunt', 'recon'].includes(c.tag.kind) && c.tag.target === 'b')).toBe(false);
    launch(world, a, 'falcon');
    launch(world, b, 'falcon');
    const hurt = (world as unknown as { hurtPilot: (v: unknown, n: number, s: string, w: string, by: unknown, at: unknown) => number }).hurtPilot.bind(world);
    expect(hurt(a, 20, 'projectile', 'ink', { player: 'b', name: 'Bo' }, { x: 0, y: 0, z: 0 })).toBe(0);
    const turret = world.network.on('T3').find((i) => i.isWeapon)!;
    const pos = a.flight.model.position;
    expect(world.hostile(turret, { side: a.side, x: b.home!.x, z: b.home!.z })).toBe(false);
    void pos;
    // Leaving: still at peace for the cooldown, then fair game again.
    expect(world.command('a', { a: 'ally', o: 'leave' })).toBe(true);
    expect(hurt(a, 20, 'projectile', 'ink', { player: 'b', name: 'Bo' }, { x: 0, y: 0, z: 0 })).toBe(0);
    run(world, ALLIANCES.leaveCooldown + 0.5);
    expect(world.hostile(turret, { side: a.side, x: b.home!.x, z: b.home!.z })).toBe(true);
  });
});

/** v0.0.19 §3: cooperation offers. */
describe('cooperation', () => {
  it('pays an escort by presence at the bomber side, nothing below the minimum', () => {
    const book = new CoopBook();
    book.fly('e', 'b', true, 6);
    book.fly('e', 'b', false, 4);
    expect(book.presenceOf('e', 'b')).toBeCloseTo(0.6);
    expect(CoopBook.escortPay(0.6)).toBe(Math.round(COOP.escortReward * 0.6));
    expect(CoopBook.escortPay(COOP.minPresence - 0.01)).toBe(0);
    expect(book.welcomes('x')).toBe('allies');
  });

  it("offers an ally the escort card on a bombing run, completes it with the bomber and pays once", () => {
    const world = quietWorld(12);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    const v = player(world, 'v', 'T6', 'Vic');
    for (const p of [a, b, v]) p.protectUntil = 0;
    v.resources.restore(300);
    world.command('a', { a: 'ally', o: 'offer', id: 'b' });
    world.command('b', { a: 'ally', o: 'accept', id: 'a' });
    run(world, 1.2);
    const raid = a.pvp.find((c) => c.tag.kind === 'raid' && c.tag.target === 'v')!;
    expect(raid).toBeDefined();
    a.state!.select(a.state!.offers.indexOf(raid.mission));
    launch(world, a, 'widewing');
    run(world, 1.2);
    const card = b.pvp.find((c) => c.tag.kind === 'escort' && c.tag.target === 'a')!;
    expect(card).toBeDefined();
    // Vic, the raid's victim, is never offered the escort.
    expect(v.pvp.some((c) => c.tag.kind === 'escort')).toBe(false);
    b.state!.select(b.state!.offers.indexOf(card.mission));
    launch(world, b, 'falcon');
    // Bo flies at Ann's side the whole way.
    for (let i = 0; i < 5; i++) {
      const m = a.flight.model.position;
      b.flight.model.position.set(m.x + 8, m.y, m.z);
      b.flight.model.prevPosition.copy(b.flight.model.position);
      run(world, 1);
    }
    const before = b.resources.paper;
    // Ann's bombs hit: her mission succeeds, Bo's escort completes and is paid.
    (world as unknown as { bomberSucceeded: (p: unknown) => void }).bomberSucceeded(a);
    expect(b.state!.mission!.status).toBe('succeeded');
    expect(b.resources.paper).toBeGreaterThan(before);
    const paid = b.resources.paper;
    (world as unknown as { bomberSucceeded: (p: unknown) => void }).bomberSucceeded(a);
    expect(b.resources.paper).toBe(paid);
  });

  it('a player who declines escorts is never offered as a bomber to escort', () => {
    const world = quietWorld(13);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    const v = player(world, 'v', 'T6', 'Vic');
    for (const p of [a, b, v]) p.protectUntil = 0;
    for (const p of [b, v]) p.resources.restore(300);
    world.command('a', { a: 'coop', w: 'anyone' });
    run(world, 1.2);
    const raid = a.pvp.find((c) => c.tag.kind === 'raid')!;
    expect(raid).toBeDefined();
    const helper = raid.tag.target === 'b' ? v : b;
    a.state!.select(a.state!.offers.indexOf(raid.mission));
    launch(world, a, 'widewing');
    run(world, 1.2);
    // Anyone welcome: the player who isn't being raided (not an ally) gets the card.
    expect(helper.pvp.some((c) => c.tag.kind === 'escort')).toBe(true);
    world.command('a', { a: 'coop', w: 'none' });
    run(world, 1.2);
    expect(helper.pvp.some((c) => c.tag.kind === 'escort')).toBe(false);
  });

  it('joint defense: a neighbour helping shoot the raider down shares the helpers pot; the defender keeps theirs', () => {
    const world = quietWorld(14);
    const r = player(world, 'r', 'T1', 'Raider');
    const v = player(world, 'v', 'T2', 'Vic');
    const h = player(world, 'h', 'T3', 'Helper');
    for (const p of [r, v, h]) p.protectUntil = 0;
    v.resources.restore(300);
    run(world, 1.2);
    const raid = r.pvp.find((c) => c.tag.kind === 'raid' && c.tag.target === 'v')!;
    expect(raid).toBeDefined();
    r.state!.select(r.state!.offers.indexOf(raid.mission));
    launch(world, r, 'widewing');
    run(world, 1.2);
    const card = h.pvp.find((c) => c.tag.kind === 'defend' && c.tag.target === 'r');
    expect(card).toBeDefined();
    h.state!.select(h.state!.offers.indexOf(card!.mission));
    launch(world, h, 'falcon');
    r.damageLog.push({ by: 'h', amount: 60, at: world.time });
    const before = h.resources.paper;
    r.state!.crash('shot-down');
    expect(h.resources.paper - before).toBeGreaterThanOrEqual(COOP.defensePot);
  });

  it('joint attack: two intermediate players are offered the same target on a much stronger one and share the pot', () => {
    const world = quietWorld(15);
    const big = player(world, 'big', 'T1', 'Big');
    const a = player(world, 'a', 'T6', 'Ann');
    const b = player(world, 'b', 'T11', 'Bo');
    for (const p of [big, a, b]) p.protectUntil = 0;
    big.resources.restore(big.base!.capacity);
    big.resources.restoreOf('ink', 300);
    big.resources.restoreOf('rubber', 60);
    big.lifetime.successes = 100;
    for (const p of [a, b]) {
      p.lifetime.successes = 20;
      p.resources.restore(120);
    }
    run(world, 2.2);
    expect(world.situations.get('a')!.tier).toBe('intermediate');
    const j = world.coop.jointOn('big');
    expect(j?.members.sort()).toEqual(['a', 'b']);
    expect(a.pvp.some((c) => c.tag.kind === 'joint')).toBe(true);
    expect(b.pvp.some((c) => c.tag.kind === 'joint')).toBe(true);
    // The target is told, and gets a card to hold their desk.
    expect(big.pvp.some((c) => c.tag.kind === 'defend' && c.tag.target === 'big')).toBe(true);
    // Paid by contribution once the installation is wrecked.
    const pay = (world as unknown as { payJoint: (j: unknown, d: Map<string, number>) => void }).payJoint.bind(world);
    const [pa, pb] = [a.resources.paper, b.resources.paper];
    pay(j, new Map([['a', 75], ['b', 25]]));
    expect(a.resources.paper - pa).toBe(Math.floor(COOP.jointPot * 0.75));
    expect(b.resources.paper - pb).toBe(Math.floor(COOP.jointPot * 0.25));
    expect(world.coop.jointOn('big')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { AIRCRAFT, BASE, ECONOMY } from '../../src/config';
import { PRODUCTION_EVERY } from './Paper';
import { ServerWorld } from './ServerWorld';
import { launch, place, player, quietWorld, run, chooseFlyable } from './testkit';

/**
 * Paper on the way to the ledger (v0.0.12 phase 2): every change the rules make in the world is
 * written down with a key built from its cause, production is gathered and credited at most once a
 * minute, and nothing is produced while the player is away.
 */

/** Paper changes only: ink and rubber balls (v0.0.18) have balances of their own. */
const sum = (changes: Array<{ amount: number; resource?: string }>) => changes.filter((c) => (c.resource ?? 'paper') === 'paper').reduce((s, c) => s + c.amount, 0);

describe('the paper journal', () => {
  it('writes down every change in order, so the changes explain the balance', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const start = a.resources.paper;
    run(world, 30);
    chooseFlyable(world, a, 'swift');
    expect(world.command('a', { a: 'build' })).toBe(true);
    run(world, 2.5);
    const changes = world.takePaper('a');
    expect(changes.length).toBeGreaterThan(0);
    expect(start + sum(changes)).toBe(a.resources.paper);
    // The fold is the last change; the production before it was credited first.
    const fold = changes[changes.length - 1];
    expect(fold).toMatchObject({ kind: 'spend', amount: -AIRCRAFT.swift.cost });
    expect(changes[0].kind).toBe('production');
    expect(changes[0].key).toMatch(/^prod:[0-9a-f-]{36}:1$/);
    // Nothing is taken twice.
    expect(world.takePaper('a')).toEqual([]);
  });

  it('v0.0.18: folding and arming a plane write ink and rubber-ball changes of their own, keyed apart from paper', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const ink = a.resources.ink;
    world.takePaper('a');
    launch(world, a, 'falcon');
    const changes = world.takePaper('a');
    const inkChanges = changes.filter((c) => c.resource === 'ink');
    // The Falcon's materials and its rounds, each a change of its own.
    expect(inkChanges.map((c) => c.kind)).toEqual(['spend', 'arm']);
    expect(inkChanges[0].amount).toBe(-AIRCRAFT.falcon.materials!.ink!);
    for (const c of inkChanges) expect(c.key).toMatch(/:ink$/);
    expect(new Set(changes.map((c) => c.key)).size).toBe(changes.length);
    expect(ink + inkChanges.reduce((t, c) => t + c.amount, 0) + a.journal!.unflushedOf('ink')).toBe(a.resources.ink);
  });

  it('credits production once a minute, not paper by paper', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(0);
    run(world, PRODUCTION_EVERY - 1);
    expect(world.takePaper('a')).toEqual([]);
    expect(a.resources.paper).toBeGreaterThan(0);
    run(world, 12);
    const [prod] = world.takePaper('a');
    expect(prod.kind).toBe('production');
    expect(prod.amount + a.journal!.unflushed).toBe(a.resources.paper);
  });

  it('produces nothing while the player is away, and starts again when they are back', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(0);
    world.setConnected('a', false);
    run(world, 120);
    expect(a.resources.paper).toBe(0);
    expect(world.takePaper('a')).toEqual([]);
    world.setConnected('a', true);
    run(world, PRODUCTION_EVERY + 10);
    expect(a.resources.paper).toBeGreaterThan(0);
    expect(sum(world.takePaper('a')) + a.journal!.unflushed).toBe(a.resources.paper);
  });

  it("keeps a leaving player's last changes, production included, for the ledger", () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const start = a.resources.paper;
    run(world, 20);
    const end = a.resources.paper;
    expect(end).toBeGreaterThan(start);
    world.remove('a');
    const left = world.takePaper('a');
    expect(left.map((c) => c.kind)).toEqual(['production']);
    expect(start + sum(left)).toBe(end);
  });

  it('keys a mission reward by the mission, and a raid loss by the raid', () => {
    const world = new ServerWorld({ seed: 1, ambient: false, newPlayerProtection: 0, arrivalGrace: 0 });
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    b.resources.restore(400);
    a.resources.restore(100);
    run(world, 1.5);
    world.takePaper('a');
    world.takePaper('b');
    const card = a.pvp.find((c) => c.tag.kind === 'raid')!;
    a.state!.select(a.state!.offers.indexOf(card.mission));
    world.command('a', { a: 'aircraft', id: 'widewing' });
    world.command('a', { a: 'build' });
    run(world, 2.2);
    expect(world.command('a', { a: 'launch' })).toBe(true);
    const attack = world.attacks.on('b')!;
    run(world, 4);
    place(a, attack.target.x, 6, attack.target.z, 0);
    a.flight.model.speed = 9;
    run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
    run(world, 2);
    expect(a.state!.mission!.status).toBe('succeeded');
    const paidA = world.takePaper('a');
    const reward = paidA.find((c) => c.kind === 'reward')!;
    expect(reward.key).toBe(`mission:${a.missionId(a.state!.mission!)}`);
    expect(reward.amount).toBe(a.state!.mission!.reward);
    const lostB = world.takePaper('b').filter((c) => c.kind === 'raid');
    // v0.0.18: one change per resource, each keyed by the raid and its resource.
    expect(lostB.map((c) => c.key)).toEqual([`raid:${attack.uid}:loss`, `raid:${attack.uid}:loss:ink`, `raid:${attack.uid}:loss:rubber`]);
    for (const c of lostB) expect(c.amount).toBeLessThan(0);
  });

  it('follows the store when it refuses a change, without writing anything new', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(50);
    expect(world.adjustPaper('a', -20)).toBe(30);
    expect(world.adjustPaper('a', -100)).toBe(0);
    expect(world.takePaper('a')).toEqual([]);
  });

  it('restores a saved balance on placement without writing it as a change', () => {
    const world = quietWorld();
    world.join('a', 'Ann');
    expect(world.claim('a', 'T5', null, { paper: 237, stint: 'stint-1' })).toBeNull();
    expect(world.pilots.get('a')!.resources.paper).toBe(237);
    expect(world.stintOf('a')).toBe('stint-1');
    expect(world.takePaper('a')).toEqual([]);
    // A new player starts with the starting paper (the room writes it to the ledger once).
    world.join('b', 'Bo');
    world.claim('b', 'T6');
    expect(world.pilots.get('b')!.resources.paper).toBe(ECONOMY.startingPaper);
    expect(BASE.production).toBeGreaterThan(0);
  });
});

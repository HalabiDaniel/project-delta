import { describe, expect, it } from 'vitest';
import { ECONOMY, PVP } from '../../src/config';
import { NET, parseCommand, planeId, unpackFrames, packFrames, type NetEvent } from '../../src/net/protocol';
import { launch, place, player, quietWorld, run } from './testkit';

const events = (world: ReturnType<typeof quietWorld>, type: NetEvent['t']) => world.drainEvents().map((o) => o.e).filter((e) => e.t === type);

describe('joining and claiming territories', () => {
  it('gives each player one territory, refuses taken ones and the centre', () => {
    const world = quietWorld();
    world.join('a', 'Ann');
    world.join('b', 'Bo');
    expect(world.claim('a', 'T3')).toBeNull();
    expect(world.claim('b', 'T3')).toBe('taken');
    expect(world.claim('b', 'T11')).toBe('not claimable');
    expect(world.claim('a', 'T7')).toBe('already claimed');
    expect(world.claim('b', 'T7')).toBeNull();
    expect(world.owners.get('T3')).toBe('a');
    expect(world.owners.get('T7')).toBe('b');
    expect(world.pilots.get('a')!.colour).not.toBe(world.pilots.get('b')!.colour);
  });

  it("replaces the AI's defenses with the player's base, and brings them back when the player leaves", () => {
    const world = quietWorld();
    const ai = world.network.on('T3').map((i) => i.id);
    expect(ai.length).toBeGreaterThan(0);
    const a = player(world, 'a', 'T3');
    const now = world.network.on('T3');
    expect(now.every((i) => i.side === a.side)).toBe(true);
    expect(now.some((i) => i.spec.kind === 'supply')).toBe(true);
    expect(world.territories.find((t) => t.id === 'T3')!.threat).toBe(0);
    world.remove('a');
    expect(world.network.on('T3').map((i) => i.id).sort()).toEqual([...ai].sort());
    expect(world.owners.has('T3')).toBe(false);
    expect(world.territories.find((t) => t.id === 'T3')!.threat).toBeGreaterThan(0);
  });

  it('starts every player with their own paper, base and board of cards', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const b = player(world, 'b', 'T9');
    expect(a.resources.paper).toBe(ECONOMY.startingPaper);
    expect(b.resources.paper).toBe(ECONOMY.startingPaper);
    expect(a.state!.offers.length).toBeGreaterThanOrEqual(3);
    // Missions never send a player to another player's home.
    for (const m of a.state!.offers) for (const o of m.objectives) if (o.kind !== 'land' && 'territoryId' in o) expect(o.territoryId).not.toBe('T9');
  });
});

describe('flight', () => {
  it('flies the plane from the input frames, at the speed real time allows', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    launch(world, a);
    expect(a.state!.phase).toBe('flying');
    const start = a.flight.model.position.clone();
    const seqBefore = a.inputs.lastSeq;
    run(world, 1, () => ({ throttle: 1 }));
    expect(a.inputs.lastSeq - seqBefore).toBe(60);
    const moved = start.distance(a.flight.model.position);
    expect(moved).toBeGreaterThan(10);
    expect(moved).toBeLessThan(a.flight.model.flight.maxSpeed + 1);
  });

  it("ignores frames sent faster than real time (a speed hack can't fly faster)", () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    launch(world, a);
    const start = a.flight.model.position.clone();
    // A cheating client sends three frames per step for a second.
    run(world, 1, (id) => {
      world.input(id, unpackFrames(packFrames([1, 2].map(() => ({ seq: 0, mx: 0, my: 0, throttle: 1 as const, bank: 0 as const, boost: false, autoLevel: true, fire: false, bomb: false })))));
      return { throttle: 1 };
    });
    const moved = start.distance(a.flight.model.position);
    expect(moved).toBeLessThan(a.flight.model.flight.maxSpeed + 1);
  });

  it('keeps flying a plane whose player has gone quiet, and takes their frames again when they return', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    launch(world, a);
    const start = a.flight.model.position.clone();
    run(world, 2, () => null);
    expect(a.inputs.autoSteps).toBeGreaterThan(30);
    expect(start.distance(a.flight.model.position)).toBeGreaterThan(10);
    const applied = a.inputs.applied;
    run(world, 0.5);
    expect(a.inputs.applied).toBeGreaterThan(applied + 20);
  });

  it('reports its own flight for reconciliation while it flies', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    expect(world.ownFor('a')).toBeNull();
    launch(world, a);
    const own = world.ownFor('a')!;
    expect(own.seq).toBe(a.inputs.lastSeq);
    expect(own.flight.length).toBe(23);
  });
});

describe('player versus player combat', () => {
  function duel() {
    const world = quietWorld(7);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a);
    launch(world, b);
    // Both over open ground between territories, B 20 m ahead of A, flying the same way.
    place(a, 0, 40, 60, 0);
    place(b, 0, 40, 40, 0);
    return { world, a, b };
  }

  it('the server decides hits: rounds from A damage B, credited to A', () => {
    const { world, a, b } = duel();
    world.drainEvents();
    const before = b.state!.durability!.health;
    run(world, 0.6, (id) => (id === 'a' ? { fire: true } : {}));
    expect(b.state!.durability!.health).toBeLessThan(before);
    const dmg = events(world, 'dmg').filter((e) => e.t === 'dmg' && e.tg === planeId('b'));
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.t === 'dmg' && e.by === 'a')).toBe(true);
    expect(a.state!.sortie!.shotsHit).toBeGreaterThan(0);
  });

  it('a kill is credited, reported in the kill feed and pays a bounty; the victim rebuilds', () => {
    const { world, a, b } = duel();
    const paper = a.resources.paper;
    world.drainEvents();
    run(world, 6, (id) => (id === 'a' ? { fire: true } : {}));
    expect(b.state!.phase).toBe('crashed');
    expect(a.stats.kills).toBe(1);
    expect(b.stats.deaths).toBe(1);
    const kill = events(world, 'kill').find((e) => e.t === 'kill' && e.victim === 'b');
    expect(kill).toMatchObject({ killer: 'a', killerName: 'Ann', victimName: 'Bo' });
    expect(a.resources.paper).toBeGreaterThan(paper);
    // Respawning is folding a new plane at home.
    run(world, 1.5);
    expect(world.command('b', { a: 'continue' })).toBe(true);
    expect(b.state!.phase).toBe('desk');
    expect(world.command('b', { a: 'build' })).toBe(true);
  });

  it('a plane that has just taken off cannot be hurt by other players', () => {
    const { world, b } = duel();
    b.launchedAt = world.time;
    const before = b.state!.durability!.health;
    run(world, 0.5, (id) => (id === 'a' ? { fire: true } : {}));
    expect(b.state!.durability!.health).toBe(before);
  });

  it('shooting down the same player again soon pays less, and an emergency Dart pays nothing', () => {
    const { world } = duel();
    const first = world.kills.record('a', 'b', 25, false, 0);
    const second = world.kills.record('a', 'b', 25, false, 10);
    const dart = world.kills.record('a', 'c', 0, true, 10);
    expect(second).toBeLessThan(first);
    expect(dart).toBe(0);
  });
});

describe('raids between players', () => {
  function rivals() {
    const world = quietWorld(3);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    return { world, a, b };
  }

  it('protects new players, then offers a raid card on their base', () => {
    const { world, a, b } = rivals();
    run(world, 1.5);
    expect(a.pvp.some((c) => c.tag.kind === 'raid')).toBe(false);
    b.protectUntil = 0;
    run(world, 1.5);
    const card = a.pvp.find((c) => c.tag.kind === 'raid');
    expect(card?.tag.target).toBe('b');
    expect(a.state!.offers).toContain(card!.mission);
  });

  it('a successful raid pays the attacker, costs the defender a capped share above the protected reserve, and shields them', () => {
    const { world, a, b } = rivals();
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
    run(world, 4);
    // Over the target, low and slow, and let go.
    const target = world.attacks.on('b')!.target;
    place(a, target.x, 6, target.z, 0);
    a.flight.model.speed = 9;
    const paperB = b.resources.paper;
    const paperA = a.resources.paper;
    run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
    run(world, 2);
    expect(a.state!.mission!.status).toBe('succeeded');
    expect(a.resources.paper).toBeGreaterThan(paperA);
    const lost = paperB - b.resources.paper;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(80);
    expect(b.resources.paper).toBeGreaterThanOrEqual(b.base!.protectedPaper);
    expect(b.shieldUntil).toBeGreaterThan(world.time);
    expect(b.report?.outcome).toBe('bombed');
    expect(a.stats.raids).toBe(1);
    // The shield keeps everyone off for a while.
    expect(world.attacks.refusal(a, b, world.time)).toBe('shield');
  });

  it('never raids offline players, and calls off a raid when the defender drops', () => {
    const { world, a, b } = rivals();
    b.protectUntil = 0;
    world.setConnected('b', false);
    expect(world.attacks.refusal(a, b, world.time)).toBe('offline');
    world.setConnected('b', true);
    expect(world.attacks.refusal(a, b, world.time)).toBeNull();
    world.attacks.start('a', 'b', 'T3', { installationId: 'T3-store', name: 'store', x: 0, z: 0 }, world.time);
    world.setConnected('b', false);
    expect(world.attacks.on('b')).toBeUndefined();
  });

  it("other players can't grind down a base outside a raid; its guns only engage intruders", () => {
    const { world, a, b } = rivals();
    const turret = world.network.on('T3').find((i) => i.spec.kind === 'turret')!;
    expect(world.mayDamage(a, turret)).toBe(false);
    expect(world.hostile(turret, { side: a.side, x: 0, z: 0 })).toBe(false);
    const home = b.home!;
    expect(world.hostile(turret, { side: a.side, x: home.x, z: home.z })).toBe(true);
    expect(world.hostile(turret, { side: 'enemy', x: 0, z: 0 })).toBe(true);
  });

  it('repeated raids on the same base pay less and less, then nothing', () => {
    const { world } = rivals();
    const book = world.attacks;
    const factors = [0, 1, 2, 3].map((n) => {
      if (n > 0) book.finish(book.start('a', 'b', 'T3', { installationId: '', name: '', x: 0, z: 0 }, n), true, n);
      return book.repeatFactor('a', 'b', n + 0.5);
    });
    expect(factors).toEqual([...PVP.repeat]);
  });
});

describe('what clients may send', () => {
  it('rejects malformed commands and frames', () => {
    expect(parseCommand({ a: 'pay-me', amount: 1000 })).toBeNull();
    expect(parseCommand({ a: 'base-build', slot: 'nowhere', kind: 'turret' })).toBeNull();
    expect(parseCommand({ a: 'select', i: -1 })).toBeNull();
    expect(unpackFrames([1, 2, 3])).toEqual([]);
    expect(unpackFrames(new Array(NET.framesPerMessage * 4 + 4).fill(0))).toEqual([]);
    const [f] = unpackFrames([5, 99999, -99999, 64]);
    expect(f.mx).toBe(400);
    expect(f.my).toBe(-400);
    expect(f.fire).toBe(true);
  });

  it("can't build or launch for a player who hasn't claimed a territory", () => {
    const world = quietWorld();
    world.join('a', 'Ann');
    expect(world.command('a', { a: 'build' })).toBe(false);
    expect(world.command('a', { a: 'launch' })).toBe(false);
  });
});

describe('missions in a shared world', () => {
  it('pays a mission reward only when the server sees the objective done (recon of a rival base)', () => {
    const world = quietWorld(5);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T9', 'Bo');
    run(world, 1.5);
    const card = a.pvp.find((c) => c.tag.kind === 'recon' && c.tag.target === 'b');
    expect(card).toBeDefined();
    a.state!.select(a.state!.offers.indexOf(card!.mission));
    world.command('a', { a: 'aircraft', id: 'dart' });
    world.command('a', { a: 'build' });
    run(world, 2.2);
    expect(world.command('a', { a: 'launch' })).toBe(true);
    run(world, 3.5);
    const paper = a.resources.paper;
    expect(a.state!.mission!.status).toBe('active');
    // Low over Bo's base, circling so it stays inside.
    const home = b.home!;
    let t = 0;
    while (a.state!.mission!.status === 'active' && t < 20) {
      place(a, home.x + Math.cos(t) * 8, 10, home.z + Math.sin(t) * 8, t + Math.PI / 2);
      run(world, 0.5);
      t += 0.5;
    }
    expect(a.state!.mission!.status).toBe('succeeded');
    expect(a.resources.paper).toBeGreaterThan(paper);
    expect(a.stats.missions).toBe(1);
  });

  it("puts each player's mission aircraft up under their own names, and sends them home when the mission ends", () => {
    const world = quietWorld(9);
    const a = player(world, 'a', 'T1');
    const st = a.state!;
    const withAir = st.offers.findIndex((m) => (m.spec.aircraft?.length ?? 0) > 0 && m.spec.aircraft!.every((s) => (s.delay ?? 0) < 3 && s.afterPatrol === undefined));
    if (withAir < 0) return; // this seed dealt no air mission: nothing to check
    st.select(withAir);
    launch(world, a, world.suits(a, 'falcon') ? 'falcon' : 'swift');
    run(world, 3);
    const mine = world.air.aircraft.filter((x) => x.id.startsWith('a/'));
    expect(mine.length).toBeGreaterThan(0);
    world.command('a', { a: 'end' });
    st.crash('impact');
    expect(mine.every((x) => x.leaving)).toBe(true);
  });
});

describe('connections', () => {
  it('a player who drops mid-flight keeps flying (and keeps their desk) until they come back or leave', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    launch(world, a);
    world.setConnected('a', false);
    const start = a.flight.model.position.clone();
    run(world, 3);
    expect(a.state!.phase).toBe('flying');
    expect(start.distance(a.flight.model.position)).toBeGreaterThan(20);
    expect(world.owners.get('T1')).toBe('a');
    world.setConnected('a', true);
    expect(a.connected).toBe(true);
    world.remove('a');
    expect(world.pilots.has('a')).toBe(false);
    expect(world.owners.has('T1')).toBe(false);
    expect(world.history.at(planeId('a'), world.time, { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('leaving mid-fight counts as being shot down by whoever was fighting you', () => {
    const world = quietWorld(7);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a);
    launch(world, b);
    place(a, 0, 40, 60, 0);
    place(b, 0, 40, 40, 0);
    run(world, 0.5, (id) => (id === 'a' ? { fire: true } : {}));
    expect(b.damageLog.length).toBeGreaterThan(0);
    world.drainEvents();
    world.remove('b');
    expect(a.stats.kills).toBe(1);
    const kill = world.drainEvents().map((o) => o.e).find((e) => e.t === 'kill');
    expect(kill).toMatchObject({ killer: 'a', victimName: 'Bo' });
  });

  it('limits emotes to one every so often', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    launch(world, a);
    expect(world.emote('a', 'waggle')).toBe(true);
    expect(world.emote('a', 'heart')).toBe(false);
    run(world, NET.emoteCooldown + 0.1);
    expect(world.emote('a', 'confetti')).toBe(true);
  });
});

describe('recovery and defense', () => {
  it('a player with no paper can always fold the free emergency Dart', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(0);
    const st = a.state!;
    const bombless = st.offers.findIndex((m) => m.spec.bombs === 0);
    if (bombless >= 0) st.select(bombless);
    expect(st.emergencyAvailable()).toBe(true);
    expect(world.command('a', { a: 'build' })).toBe(bombless >= 0);
    if (bombless >= 0) expect(st.emergency).toBe(true);
  });

  it('shooting down a raider on its way in pays the defender and counts as a defense', () => {
    const world = quietWorld(4);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    b.protectUntil = 0;
    run(world, 1.5);
    const card = a.pvp.find((c) => c.tag.kind === 'raid')!;
    a.state!.select(a.state!.offers.indexOf(card.mission));
    world.command('a', { a: 'aircraft', id: 'widewing' });
    world.command('a', { a: 'build' });
    run(world, 2.2);
    world.command('a', { a: 'launch' });
    launch(world, b);
    run(world, 2);
    // Bo sits behind Ann over open ground and opens fire.
    place(a, 0, 40, 60, 0);
    place(b, 0, 40, 75, 0);
    const paper = b.resources.paper;
    run(world, 8, (id) => (id === 'b' ? { fire: true } : {}));
    expect(a.state!.phase).toBe('crashed');
    expect(b.stats.defends).toBe(1);
    expect(b.resources.paper).toBeGreaterThan(paper);
    expect(world.attacks.on('b')).toBeUndefined();
    expect(b.report?.outcome).toBe('repelled');
  });

  it("a player who hurts you stays a target for your base's guns for a while", () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const b = player(world, 'b', 'T9');
    const turret = world.network.on('T9').find((i) => i.spec.kind === 'turret')!;
    expect(world.hostile(turret, { side: a.side, x: 0, z: 0 })).toBe(false);
    a.aggression.set('b', world.time);
    expect(world.hostile(turret, { side: a.side, x: 0, z: 0 })).toBe(true);
    run(world, PVP.aggression + 1, () => null);
    expect(world.hostile(turret, { side: a.side, x: 0, z: 0 })).toBe(false);
    void b;
  });
});

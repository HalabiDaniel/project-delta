import { describe, expect, it } from 'vitest';
import { PVP, RAID_KINDS, RAIDS, type RaidKind } from '../../src/config';
import type { Pilot } from './Pilot';
import type { ServerWorld } from './ServerWorld';
import { chooseFlyable, launch, place, player, quietWorld, run } from './testkit';

/** Two players, the second with paper worth raiding, and the first's raid card of `kind`. */
function setup(kind: RaidKind, seed = 21): { world: ServerWorld; a: Pilot; b: Pilot } {
  const world = quietWorld(seed, { raidKinds: [kind] });
  const a = player(world, 'a', 'T1', 'Ann');
  const b = player(world, 'b', 'T3', 'Bo');
  for (const p of [a, b]) p.protectUntil = 0;
  // A base worth raiding: a radar and a workshop besides the store and the starting turret.
  b.resources.restore(600);
  b.base!.build('R1', 'radar');
  b.base!.build('E1', 'workshop');
  b.resources.restore(400);
  a.resources.restore(150);
  a.resources.restoreOf('ink', 100);
  a.resources.restoreOf('rubber', 40);
  run(world, 1.2);
  return { world, a, b };
}

function pick(a: Pilot, kind: string) {
  const card = a.pvp.find((c) => c.tag.kind === kind)!;
  expect(card, `a ${kind} card`).toBeDefined();
  a.state!.select(a.state!.offers.indexOf(card.mission));
  return card;
}

function bombAt(world: ServerWorld, a: Pilot, x: number, z: number): void {
  place(a, x, 6, z, 0);
  a.flight.model.speed = 9;
  run(world, 0.05, (id) => (id === 'a' ? { bomb: true } : {}));
  run(world, 2);
}

/** v0.0.19 §4 and "Also A": deeper raids and three kinds of raid. */
describe('deeper raids', () => {
  it('a bombing raid on a well-built base asks for several standing structures, pays more, and takes one capped loss', () => {
    const { world, a, b } = setup('bombing');
    const card = pick(a, 'raid');
    const bombs = card.mission.objectives.filter((o) => o.kind === 'bomb');
    expect(bombs.length).toBe(RAID_KINDS.multiTargets);
    // Every target is something actually standing on Bo's base.
    const standing = new Set(world.network.on('T3').filter((i) => i.alive).map((i) => `${i.spec.x},${i.spec.z}`));
    for (const o of bombs) if (o.kind === 'bomb') expect(standing.has(`${o.zone.x},${o.zone.z}`)).toBe(true);
    launch(world, a, 'widewing');
    const attack = world.attacks.on('b')!;
    expect(attack.targets).toHaveLength(RAID_KINDS.multiTargets);
    // One structure is not enough.
    bombAt(world, a, attack.targets[0].x, attack.targets[0].z);
    expect(world.attacks.on('b')).toBeDefined();
    const before = b.resources.paper;
    bombAt(world, a, attack.targets[1].x, attack.targets[1].z);
    expect(world.attacks.on('b'), JSON.stringify({ t: attack.targets, p: a.state!.mission!.progress, s: a.state!.mission!.status, f: a.state!.mission!.failure, bombs: a.state!.bombsLoaded })).toBeUndefined();
    expect(b.report?.outcome).toBe('bombed');
    // The loss cap applies to the whole raid, once.
    expect(before - b.resources.paper).toBeLessThanOrEqual(RAIDS.loss.store.max);
    expect(b.shieldUntil).toBeGreaterThan(world.time);
    expect(b.report?.decided).toMatch(/all 2 targets/);
  });

  it('a staged raid runs each stage on its own clock: stage one alone pays a little, never the store', () => {
    const { world, a, b } = setup('staged');
    const card = pick(a, 'raid');
    expect(card.tag.raid).toBe('staged');
    expect(card.mission.spec.ordered).toBe(true);
    chooseFlyable(world, a, 'thug');
    launch(world, a, 'thug');
    const attack = world.attacks.on('b')!;
    expect(attack.kind).toBe('staged');
    // Stage one: knock out the radar or turret (here: wreck it outright).
    const first = world.network.get(attack.targets[0].installationId)!;
    (world as unknown as { damageInstallation: (i: unknown, n: number, by: unknown, w: string) => number }).damageInstallation(first, 9999, a, 'ink');
    run(world, 0.5);
    expect(attack.stage).toBe(1);
    const paper = a.resources.paper;
    const bPaper = b.resources.paper;
    // Stage two runs out of time.
    run(world, RAID_KINDS.stageTime + 1);
    expect(world.attacks.on('b')).toBeUndefined();
    expect(a.state!.mission!.status).toBe('failed');
    const partial = Math.round((card.mission.spec.reward * RAID_KINDS.stagePartial) / 5) * 5;
    expect(a.resources.paper - paper).toBeGreaterThanOrEqual(partial);
    expect(a.resources.paper - paper).toBeLessThan(card.mission.spec.reward);
    // The store was never hit: nothing lost but the wrecked structure.
    expect(b.resources.paper).toBeGreaterThanOrEqual(bPaper);
    expect(b.report?.stages).toEqual([{ label: expect.any(String), done: true }, { label: 'Bomb the store', done: false }]);
  });

  it('a strike wrecks infrastructure with guns, shields the base, and takes no resources', () => {
    const { world, a, b } = setup('strike');
    const card = pick(a, 'strike');
    const o = card.mission.objectives[0];
    expect(o.kind).toBe('destroy');
    launch(world, a, 'thug');
    const attack = world.attacks.on('b')!;
    expect(attack.kind).toBe('strike');
    const paper = b.resources.paper;
    for (const t of attack.targets) (world as unknown as { damageInstallation: (i: unknown, n: number, by: unknown, w: string) => number }).damageInstallation(world.network.get(t.installationId)!, 9999, a, 'ink');
    run(world, 0.2);
    expect(a.state!.mission!.status).toBe('succeeded');
    expect(world.attacks.on('b')).toBeUndefined();
    expect(b.report?.outcome).toBe('struck');
    expect(b.resources.paper).toBe(paper);
    expect(b.shieldUntil).toBeGreaterThan(world.time);
    // The pair cooldown and the shield now hold for the whole raid.
    expect(world.attacks.refusal(a, b, world.time)).not.toBeNull();
  });

  it('a challenge is only offered against a player at their desk; a no-show costs them a capped share and pays the challenger less', () => {
    const { world, a, b } = setup('challenge');
    launch(world, b, 'falcon');
    run(world, 1.2);
    // Bo is mid-sortie: no challenge on them.
    expect(a.pvp.some((c) => c.tag.kind === 'challenge')).toBe(false);
    world.recall(b);
    world.command('b', { a: 'continue' });
    // Back at the desk: Ann's next raid card may be a challenge again.
    a.pvp = [];
    run(world, 1.2);
    const card = pick(a, 'challenge');
    // A no-show pays less than winning (the underdog bonus can lift it a little).
    expect(card.mission.spec.reward).toBeGreaterThan(0);
    expect(card.mission.spec.reward).toBeLessThan(RAID_KINDS.challenge.reward);
    launch(world, a, 'falcon');
    const attack = world.attacks.on('b')!;
    expect(attack.kind).toBe('challenge');
    run(world, 1.2);
    expect(b.pvp.some((c) => c.tag.kind === 'challenged')).toBe(true);
    // No intercept card: a challenge isn't a raid on the base.
    expect(b.pvp.some((c) => c.tag.kind === 'intercept')).toBe(false);
    // And the challenger can't touch the base.
    const turret = world.network.on('T3').find((i) => i.isWeapon)!;
    expect(world.mayDamage(a, turret)).toBe(false);
    const vulnerable = b.base!.vulnerable();
    const paperB = b.resources.paper;
    const paperA = a.resources.paper;
    run(world, RAID_KINDS.challenge.answer + 0.5);
    expect(world.attacks.on('b')).toBeUndefined();
    expect(b.report?.outcome).toBe('declined');
    const forfeit = Math.min(RAID_KINDS.challenge.forfeit.max, Math.round(vulnerable * RAID_KINDS.challenge.forfeit.share));
    expect(paperB - b.resources.paper).toBeLessThanOrEqual(forfeit);
    expect(b.resources.paper).toBeGreaterThanOrEqual(b.base!.protectedPaper);
    // Paid the no-show reward (plus whatever their desk produced while they waited).
    expect(a.resources.paper - paperA).toBeGreaterThanOrEqual(card.mission.spec.reward);
    expect(a.state!.mission!.status).toBe('succeeded');
  });

  it('a challenge can be declined at once, and taking off answers it; the winner of the dogfight is paid', () => {
    const { world, a, b } = setup('challenge', 22);
    pick(a, 'challenge');
    launch(world, a, 'falcon');
    run(world, 1.2);
    // Declining costs what not showing up costs.
    expect(world.command('b', { a: 'challenge-decline' })).toBe(true);
    expect(world.attacks.on('b')).toBeUndefined();
    expect(b.report?.outcome).toBe('declined');

    const w2 = setup('challenge', 23);
    pick(w2.a, 'challenge');
    launch(w2.world, w2.a, 'falcon');
    w2.world.attacks.history.length = 0;
    run(w2.world, 1.2);
    const answer = w2.b.pvp.find((c) => c.tag.kind === 'challenged')!;
    w2.b.state!.select(w2.b.state!.offers.indexOf(answer.mission));
    launch(w2.world, w2.b, 'falcon');
    const attack = w2.world.attacks.on('b')!;
    expect(attack.answered).toBe(true);
    // Ann shoots Bo down: Ann wins the challenge's full reward.
    const before = w2.a.resources.paper;
    const changes: string[] = [];
    w2.a.resources.onAnyChange((r, _v, d, _s, label) => changes.push(`${r} ${d} ${label}`));
    w2.b.damageLog.push({ by: 'a', amount: 999, at: w2.world.time });
    w2.b.state!.crash('shot-down');
    run(w2.world, 0.1);
    expect(w2.a.report?.outcome, changes.join('; ')).toBe('won');
    expect(w2.a.resources.paper - before, changes.join('; ')).toBeGreaterThanOrEqual(RAID_KINDS.challenge.reward);
  });

  it('the defender is told how many escorts fly with the raider when it is detected', () => {
    const { world, a, b } = setup('bombing', 24);
    pick(a, 'raid');
    world.command('a', { a: 'escorts', kinds: ['wingman', 'guard'] });
    launch(world, a, 'widewing');
    const attack = world.attacks.on('b')!;
    world.drainEvents();
    place(a, b.home!.x, 18, b.home!.z, 0);
    run(world, 0.5);
    expect(attack.detected).toBe(true);
    expect(attack.escorts).toBe(2);
    const notes = world.drainEvents().map((o) => o.e).filter((e) => e.t === 'note' && e.title.includes('Ann'));
    expect(notes.some((n) => n.t === 'note' && n.value?.includes('2 escorts'))).toBe(true);
    expect(world.privateFor('b', true)?.attacks?.[0]?.escorts).toBe(2);
  });

  it('every kind keeps the protections: no raid of any kind on a new player, a shielded base, or within the pair cooldown', () => {
    for (const kind of ['bombing', 'staged', 'strike', 'challenge'] as RaidKind[]) {
      const world = quietWorld(25, { raidKinds: [kind] });
      const a = player(world, 'a', 'T1', 'Ann');
      const b = player(world, 'b', 'T3', 'Bo');
      a.protectUntil = 0;
      b.resources.restore(400);
      run(world, 1.2);
      expect(a.pvp.some((c) => ['raid', 'strike', 'challenge'].includes(c.tag.kind)), `${kind}: new player`).toBe(false);
      b.protectUntil = 0;
      b.shieldUntil = world.time + PVP.raidShield;
      run(world, 1.2);
      expect(a.pvp.some((c) => ['raid', 'strike', 'challenge'].includes(c.tag.kind)), `${kind}: shield`).toBe(false);
      b.shieldUntil = 0;
      world.attacks.history.push({ id: `x${kind}`, attacker: 'a', victim: 'b', at: world.time - 1, success: false });
      run(world, 1.2);
      expect(a.pvp.some((c) => ['raid', 'strike', 'challenge'].includes(c.tag.kind)), `${kind}: cooldown`).toBe(false);
    }
  });
});

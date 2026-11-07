import { describe, expect, it } from 'vitest';
import { launch, player, quietWorld, run } from './testkit';

/**
 * The end of a session (v0.0.13), in the world: planes in the air go home in their current
 * condition, missions in flight are called off, raids in progress are settled as they stand, and
 * leaving afterwards loses nothing.
 */
describe('wrapping up a session', () => {
  it('brings every plane in the air home in its current condition and calls off its mission', () => {
    const world = quietWorld(4);
    const a = player(world, 'a', 'T1', 'Ann');
    launch(world, a, 'falcon');
    expect(a.state!.phase).toBe('flying');
    a.state!.durability!.health -= 7;
    const health = a.state!.durability!.health;
    const mission = a.state!.mission!;
    world.wrapUp();
    expect(a.state!.phase).toBe('debrief');
    expect(mission.status).toBe('failed');
    expect(mission.failure).toBe('abandoned');
    expect(a.state!.hangar.get('falcon')).toMatchObject({ condition: 'recovered', health });
    expect(a.flight.model.status).toBe('hidden');
    // Not a loss: no death, and the plane is still the player's.
    expect(a.stats.deaths).toBe(0);
    expect(world.aircraftSave('a')!.some((r) => r.type === 'falcon' && r.status === 'damaged' && r.health === Math.ceil(health))).toBe(true);
    expect(a.outcomes.at(-1)).toMatchObject({ state: 'failed', outcome: 'abandoned' });
    // Leaving now is no crash either.
    world.remove('a');
    expect(world.takeDeparture('a')!.aircraft.some((r) => r.type === 'falcon')).toBe(true);
  });

  it('settles a raid in progress as it stands: nothing lost, nobody shielded, the attacker not shot down', () => {
    const world = quietWorld(3);
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
    world.wrapUp();
    expect(world.attacks.active).toHaveLength(0);
    expect(b.resources.paper).toBe(400);
    expect(b.shieldUntil).toBe(0);
    expect(a.report?.outcome).toBe('abandoned');
    expect(b.report?.outcome).toBe('abandoned');
    expect(a.state!.phase).toBe('debrief');
    expect(a.stats.deaths).toBe(0);
    expect(world.takePvp()).toEqual([expect.objectContaining({ kind: 'raid', attacker: 'a', victim: 'b', success: false })]);
  });

  it('leaves planes on the pad and players at their desk as they are', () => {
    const world = quietWorld(5);
    const a = player(world, 'a', 'T1', 'Ann');
    world.command('a', { a: 'aircraft', id: 'falcon' });
    // A card the Falcon can fly (it carries no bombs).
    for (let i = 0; i < a.state!.offers.length && !world.suits(a, 'falcon'); i++) a.state!.select(i);
    world.command('a', { a: 'build' });
    run(world, 0.5);
    expect(a.state!.phase).toBe('building');
    world.wrapUp();
    expect(a.state!.phase).toBe('building');
    expect(world.aircraftSave('a')!.some((r) => r.type === 'falcon' && r.status === 'ready')).toBe(true);
  });
});

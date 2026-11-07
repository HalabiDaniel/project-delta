import { describe, expect, it } from 'vitest';
import { place, player, quietWorld, run } from './testkit';

/** v0.0.18 §8.D: a stealth raider is still announced to the defender, in time to launch an interceptor. */
describe('stealth in a two-player session', () => {
  it('a Lightning raiding a base is detected before it reaches the target, and its pilot sees its state', () => {
    const world = quietWorld(3);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    b.protectUntil = 0;
    b.resources.restore(400);
    run(world, 1.5);
    const card = a.pvp.find((c) => c.tag.kind === 'raid')!;
    expect(card).toBeDefined();
    a.state!.select(a.state!.offers.indexOf(card.mission));
    world.command('a', { a: 'aircraft', id: 'lightning' });
    expect(world.command('a', { a: 'build' })).toBe(true);
    run(world, 3.5);
    expect(world.command('a', { a: 'launch' })).toBe(true);
    const attack = world.attacks.on('b')!;
    expect(attack.detected).toBe(false);
    // Fly in from well outside the base, straight at the target, quietly.
    const home = b.home!;
    const from = 140;
    let detectedAt: number | null = null;
    for (let d = from; d > 0; d -= 4) {
      place(a, home.x, 18, home.z - d, Math.PI);
      run(world, 0.2);
      if (attack.detected) {
        detectedAt = d;
        break;
      }
    }
    expect(detectedAt).not.toBeNull();
    // Detected with room to spare: still beyond the platform's edge.
    expect(detectedAt!).toBeGreaterThan(home.half);
    // The raider's pilot is told whether the defenses have them.
    const me = world.privateFor('a', true);
    expect(me?.plane?.detection).toMatch(/^(hidden|detected|locked)$/);
  });
});

describe('the Thug in a two-player session', () => {
  it("its armour holds against a Raptor's ink on the server too", async () => {
    const { launch } = await import('./testkit');
    const world = quietWorld(3);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a, 'thug');
    launch(world, b, 'raptor');
    const hurt = (world as unknown as { hurtPilot: (v: unknown, n: number, s: string, w: string, by: unknown, at: unknown) => number }).hurtPilot.bind(world);
    const dealt = hurt(a, 20, 'projectile', 'ink', { player: 'b', name: 'Bo' }, { x: 0, y: 0, z: 0 });
    expect(dealt).toBe(15);
  });
});

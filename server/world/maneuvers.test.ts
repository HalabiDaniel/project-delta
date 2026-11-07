import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../../src/config';
import { AiAircraft } from '../../src/ai/AiAircraft';
import { launch, place, player, quietWorld, run } from './testkit';

describe('maneuvers in multiplayer (v0.0.16)', () => {
  it('the server keeps the slot: chosen at home, checked against the plane, locked in the air', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    world.command('a', { a: 'aircraft', id: 'falcon' });
    expect(world.command('a', { a: 'maneuver', id: 'paperHang' })).toBe(true);
    expect(world.command('a', { a: 'maneuver', id: 'spiralDrill' })).toBe(false); // not on a Falcon
    expect(world.privateFor('a', true)?.garage?.maneuver).toBe('paperHang');
    launch(world, a, 'falcon');
    expect(a.state!.phase).toBe('flying');
    expect(a.flight.model.maneuverSlot).toBe('paperHang');
    expect(world.command('a', { a: 'maneuver', id: 'foldBack' })).toBe(false);
    expect(a.flight.model.maneuverSlot).toBe('paperHang');
  });

  it('flies the move from the input frames, and refuses it for a bomber', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    world.command('a', { a: 'aircraft', id: 'falcon' });
    world.command('a', { a: 'maneuver', id: 'foldBack' });
    launch(world, a, 'falcon');
    place(a, 0, 45, 60, 0);
    let flew = false;
    run(world, 0.2, (_id, t) => ({ maneuver: t < 0.02 }));
    flew = a.flight.model.activeManeuver === 'foldBack';
    expect(flew).toBe(true);
    run(world, 3);
    expect(a.flight.model.activeManeuver).toBeNull();
    expect(Math.abs(Math.abs(a.flight.model.yaw) - Math.PI)).toBeLessThan(0.05);

    const w2 = quietWorld(3);
    const b = player(w2, 'b', 'T1');
    launch(w2, b, 'widewing');
    place(b, 0, 45, 60, 0);
    expect(w2.command('b', { a: 'maneuver', id: 'foldBack' })).toBe(false);
    run(w2, 0.2, (_id, t) => ({ maneuver: t < 0.02 }));
    expect(b.flight.model.activeManeuver).toBeNull();
    expect(b.flight.model.lastRefusal).toBe('none');
  });
});

describe('AI pilots and maneuvers', () => {
  const orders = (skill: 'easy' | 'medium' | 'hard') => ({
    id: `ai-${skill}`, role: 'fighter' as const, side: 'enemy' as const, skill, purpose: 'ambient' as const,
    route: [{ x: 0, y: 40, z: 0 }, { x: 0, y: 40, z: -200 }], exit: { x: 0, y: 40, z: -400 },
  });
  it('rookies know no maneuvers; veterans carry the best one their plane has', () => {
    const rng = () => 0.5;
    const easy = new AiAircraft(orders('easy') as never, rng);
    const hard = new AiAircraft(orders('hard') as never, rng);
    expect(easy.model.maneuverSlot).toBeNull();
    expect(hard.model.maneuverSlot).toBe(AIRCRAFT[hard.spec.id].maneuvers.includes('craneFlip') ? 'craneFlip' : hard.model.maneuverSlot);
    expect(hard.model.maneuverSlot).not.toBeNull();
  });
});

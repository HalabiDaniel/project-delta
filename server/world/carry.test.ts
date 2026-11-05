import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../../src/config';
import { planesFrom, progressFrom } from './carry';
import type { PlayerCarry } from './ServerWorld';
import { launch, player, quietWorld, run } from './testkit';

/**
 * What travels with a player besides their buildings (v0.0.12 phase 4): their planes, the garage,
 * the mission board, lifetime statistics and the outcomes of the missions they flew. Each test
 * saves from one world and places into another, as two sessions would.
 */

/** Everything a world would save for `id`, as the room loads it into the next one. */
function carried(world: ReturnType<typeof quietWorld>, id: string): PlayerCarry {
  return { planes: planesFrom(world.aircraftSave(id)!), ...progressFrom(world.progressSave(id)) };
}

function placeIn(carry: PlayerCarry, territory = 'T5', seed = 2) {
  const world = quietWorld(seed);
  world.join('a', 'Ann');
  expect(world.claim('a', territory, null, carry)).toBeNull();
  return { world, p: world.pilots.get('a')! };
}

describe('planes and the hangar', () => {
  it('keeps a recovered plane, which needs only a refit next time', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(200);
    launch(world, a, 'falcon');
    const st = a.state!;
    st.land(a.home!.id);
    expect(st.endSortie()).toBe(true);
    const saved = world.aircraftSave('a')!;
    expect(saved).toEqual([{ id: a.planeIds.get('falcon'), type: 'falcon', status: 'damaged', health: expect.any(Number), loadout: { invested: 0 } }]);
    const { p } = placeIn(carried(world, 'a'));
    expect(p.state!.hangar.get('falcon')?.condition).toBe('recovered');
    expect(p.state!.buildKindFor('falcon')).toBe('refit');
    expect(p.planeIds.get('falcon')).toBe(saved[0].id);
  });

  it('keeps a plane left on the pad, paid for: it rolls out free next time', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    world.command('a', { a: 'aircraft', id: 'dart' });
    expect(world.command('a', { a: 'build' })).toBe(true);
    run(world, 2.5);
    expect(a.state!.phase).toBe('ready');
    const [plane] = world.aircraftSave('a')!;
    expect(plane).toMatchObject({ type: 'dart', status: 'ready', loadout: { invested: AIRCRAFT.dart.cost } });
    const { p } = placeIn(carried(world, 'a'));
    expect(p.state!.buildKindFor('dart')).toBe('rollout');
    expect(p.state!.buildCostFor('dart')).toBe(0);
    expect(p.state!.aircraft).toBe('dart');
  });

  it('never brings back a plane that crashed: the next one of its design is a new plane', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(200);
    launch(world, a, 'falcon');
    const first = a.planeIds.get('falcon');
    expect(first).toBeTruthy();
    a.state!.crash('impact');
    expect(world.aircraftSave('a')).toEqual([]);
    expect(a.planeIds.has('falcon')).toBe(false);
    run(world, 1.5);
    world.command('a', { a: 'continue' });
    world.command('a', { a: 'build' });
    expect(a.planeIds.get('falcon')).not.toBe(first);
  });

  it('never stores the free emergency plane', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(0);
    world.command('a', { a: 'aircraft', id: 'swift' });
    expect(world.command('a', { a: 'build' })).toBe(true);
    expect(a.state!.emergency).toBe(true);
    run(world, 2.5);
    expect(world.aircraftSave('a')).toEqual([]);
    expect(a.planeIds.size).toBe(0);
  });

  it("brings a plane that was in the air back as recovered (the server didn't see it land)", () => {
    const planes = planesFrom([
      { id: '00000000-0000-4000-8000-000000000001', type: 'raptor', status: 'airborne', health: 30, loadout: {} },
      { id: '00000000-0000-4000-8000-000000000002', type: 'raptor', status: 'ready', health: 30, loadout: {} },
      { id: '00000000-0000-4000-8000-000000000003', type: 'zeppelin', status: 'ready', health: 30, loadout: {} },
    ]);
    expect(planes).toEqual([{ id: '00000000-0000-4000-8000-000000000001', design: 'raptor', condition: 'recovered', health: 30, invested: 0 }]);
  });
});

describe('the mission board and statistics', () => {
  it('brings the board back as it was, every card with its id (so its reward keeps its key)', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const before = a.director!.offers.map((o) => ({ slot: o.slot, title: o.mission.title, id: a.missionId(o.mission) }));
    const { p } = placeIn(carried(world, 'a'), 'T1', 9);
    const after = p.director!.offers.map((o) => ({ slot: o.slot, title: o.mission.title, id: p.missionId(o.mission) }));
    expect(after).toEqual(before);
  });

  it("checks the board against the new desk: a card about the player's new home is replaced", () => {
    // Find a board with a card aimed at a desk a base can stand on, then move the base onto it.
    for (let seed = 1; seed <= 40; seed++) {
      const world = quietWorld(seed);
      const a = player(world, 'a', 'T1');
      const aimed = a.director!.offers.find((o) => o.mission.objectives.some((x) => 'territoryId' in x && x.territoryId !== 'T1' && world.shared.claimable.includes(x.territoryId)));
      if (!aimed) continue;
      const target = aimed.mission.objectives.find((x) => 'territoryId' in x && x.territoryId !== 'T1')! as { territoryId: string };
      const { p } = placeIn(carried(world, 'a'), target.territoryId, seed);
      for (const m of p.state!.offers) for (const o of m.objectives) if (o.kind !== 'land' && 'territoryId' in o) expect(o.territoryId).not.toBe(target.territoryId);
      return;
    }
    throw new Error('no board with a card aimed at a claimable desk');
  });

  it('adds this session to the lifetime statistics', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.lifetime = { kills: 10, deaths: 4, planesBuilt: 7 };
    a.stats.kills = 2;
    a.resources.restore(200);
    launch(world, a, 'falcon');
    const stats = world.progressSave('a')!.stats;
    expect(stats).toMatchObject({ kills: 12, deaths: 4, planesBuilt: 8 });
    const { p } = placeIn(carried(world, 'a'));
    expect(p.lifetime).toMatchObject({ kills: 12, planesBuilt: 8 });
    // The scoreboard counts this session only.
    expect(p.stats.kills).toBe(0);
  });

  it("writes down each mission flown to the end, by its card's id", () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    a.resources.restore(200);
    launch(world, a, 'falcon');
    const mission = a.state!.mission!;
    a.state!.crash('impact');
    const [outcome] = world.takeOutcomes('a');
    expect(outcome).toMatchObject({ id: a.missionId(mission), template: mission.spec.type, state: 'failed', outcome: 'aircraft-lost', reward: 0 });
    expect(world.takeOutcomes('a')).toEqual([]);
  });

  it('ignores a progress record it cannot trust', () => {
    const carry = progressFrom({ stats: { kills: 3, 'drop table': 1, deaths: -4, score: Number.NaN }, director: { junk: true }, garage: { aircraft: 'zeppelin', board: { safe: 'not-an-id' } } });
    expect(carry.stats).toEqual({ kills: 3 });
    expect(carry.aircraft).toBeUndefined();
    expect(carry.board).toEqual({});
    const { p } = placeIn(carry);
    expect(p.director!.offers).toHaveLength(3);
  });
});

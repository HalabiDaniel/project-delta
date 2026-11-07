import { describe, expect, it } from 'vitest';
import { progressFrom } from './carry';
import { launch, player, quietWorld } from './testkit';

/** v0.0.18 §5: medals, records, achievements and mastery in multiplayer, decided by the server. */
describe('server-side progression', () => {
  const finish = (world: ReturnType<typeof quietWorld>, id: string) => {
    const p = world.pilots.get(id)!;
    launch(world, p, 'swift');
    const m = p.state!.mission!;
    m.objectives.forEach((_, i) => (m.progress[i] = 1));
    (p.state as unknown as { objectiveComplete: (i: number) => void }).objectiveComplete(0);
    world.recall(p);
    return { p, m };
  };

  it('a completed mission gives a medal, mastery and achievements, and Merit for them, each once', () => {
    const world = quietWorld(4);
    player(world, 'a', 'T1');
    const { p, m } = finish(world, 'a');
    expect(m.status).toBe('succeeded');
    const data = p.progress!.data;
    expect(data.mastery.swift?.missions).toBe(1);
    expect(data.streak.current).toBe(1);
    expect(p.result?.medal).not.toBeUndefined();
    const merit = world.takeMerit().filter((e) => e.player === 'a');
    const medal = merit.filter((e) => e.source === 'medal');
    if (p.result?.medal) expect(medal.map((e) => e.key)).toEqual([`medal:${p.missionId(m)}`]);
    const ach = merit.filter((e) => e.source === 'achievement').map((e) => e.key);
    expect(new Set(ach).size).toBe(ach.length);
  });

  it('progress travels with the player: saved with the rest, checked when it comes back', () => {
    const world = quietWorld(4);
    player(world, 'a', 'T1');
    const { p } = finish(world, 'a');
    const saved = world.progressSave('a')!;
    expect(saved.profile).toEqual(p.progress!.data);
    const carried = progressFrom({ ...saved, profile: JSON.parse(JSON.stringify(saved.profile)) });
    expect(carried.profile!.mastery.swift?.missions).toBe(1);
    const again = quietWorld(5);
    again.join('a', 'a');
    again.claim('a', 'T4', null, { ...carried, paper: 100 });
    expect(again.pilots.get('a')!.progress!.data.mastery.swift?.missions).toBe(1);
  });

  it('a broken profile from the store is cleaned, never trusted', () => {
    const carried = progressFrom({ stats: {}, director: null, garage: {}, profile: { medals: { gold: -5 }, times: { x: 'fast' }, discovered: ['T2', 'nope'] } });
    expect(carried.profile!.medals.gold).toBe(0);
    expect(carried.profile!.times).toEqual({});
    expect(carried.profile!.discovered).toEqual(['T2']);
  });
});

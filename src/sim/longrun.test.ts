import { describe, expect, it } from 'vitest';
import type { MissionContext } from '../missions/MissionGenerator';
import { sharedWorld } from '../net/World';
import { longRunCsv, simulateLongRun } from './LongRun';

/** v0.0.18 §7: the long-run simulator in CI, on a short fixed-seed run. */
const world = sharedWorld();
const home = world.territories.find((t) => t.id === 'T1')!;
const ctx: MissionContext = { territories: world.territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies: [], obstacles: [], installations: world.layout.installations };
const homes = world.territories.filter((t) => t.id !== 'T1');

describe('the long-run economy', () => {
  const report = simulateLongRun({ players: ['steady', 'steady', 'aggressive', 'newcomer', 'idle', 'exploiter', 'exploiter'], days: 3, seed: 7, ctx, homes });

  it('has no runaway leader, no dead end, and no exploit that beats normal play', () => {
    expect(report.flags).toMatchObject({ runawayLeader: false, deadEnd: false, exploitBeatsPlay: false });
  });

  it('abandoning missions and trading raids between two accounts earns less than playing', () => {
    const steady = report.players.filter((p) => p.profile === 'steady').map((p) => p.gainPerHour);
    const exploit = report.players.filter((p) => p.profile === 'exploiter').map((p) => p.gainPerHour);
    for (const e of exploit) expect(e).toBeLessThan(Math.min(...steady));
  });

  it('everyone who plays grows, an idle player can always fly, and a raid is recovered from', () => {
    for (const p of report.players.filter((x) => x.profile !== 'exploiter' && x.profile !== 'idle')) expect(p.gainPerHour).toBeGreaterThan(0);
    // A few minutes a day drifts down in ink and rubber balls (a finding for the developer), but never into a dead end.
    const idle = report.players.find((p) => p.profile === 'idle')!;
    expect(idle.longestStuck).toBeLessThan(3);
    expect(idle.sorties).toBeGreaterThan(0);
    const recoveries = report.players.flatMap((p) => p.recoveries);
    expect(recoveries.length).toBeGreaterThan(0);
    expect(recoveries.filter((r) => r !== null).length).toBeGreaterThanOrEqual(recoveries.length * 0.7);
  });

  it('flows show every resource coming in and going out', () => {
    const steady = report.players.find((p) => p.profile === 'steady')!;
    for (const r of ['paper', 'ink', 'rubber'] as const) {
      const f = Object.values(steady.flows[r]);
      expect(f.some((x) => x!.in > 0)).toBe(true);
      expect(f.some((x) => x!.out > 0)).toBe(true);
    }
  });

  it('exports CSV with a row per player per day', () => {
    const csv = longRunCsv(report).trim().split('\n');
    expect(csv[0]).toMatch(/^player,profile,day/);
    expect(csv).toHaveLength(1 + 7 * 3);
  });
});

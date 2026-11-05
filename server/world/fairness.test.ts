import { describe, expect, it } from 'vitest';
import { DESK_NAMES, PVP } from '../../src/config';
import { ServerWorld } from './ServerWorld';

/**
 * Fairness timers that follow the player (v0.0.12 phase 5): protections as clock times, raids and
 * kills remembered across sessions and restarts, and desks named after whoever holds them.
 */

/** A world on a clock the test moves. */
function clocked(start = 1_800_000_000_000, protection: number = PVP.newPlayerProtection) {
  const clock = { now: start };
  const world = new ServerWorld({ seed: 4, ambient: false, newPlayerProtection: protection, clock: () => clock.now, arrivalGrace: 0 });
  return { world, clock };
}

describe('protections on the real clock', () => {
  it("starts a new player's protection when their first base is placed, and saves it as a clock time", () => {
    const { world, clock } = clocked();
    world.join('a', 'Ann');
    world.claim('a', 'T1');
    const saved = world.progressSave('a')!;
    expect(saved.protectUntil!.getTime()).toBe(clock.now + PVP.newPlayerProtection * 1000);
    expect(saved.shieldUntil).toBeNull();
  });

  it('carries protection and shield on exactly where they were, in another session after a restart', () => {
    const { world, clock } = clocked();
    world.join('a', 'Ann');
    // Two minutes of protection and ten of shield left when the last session saved.
    world.claim('a', 'T1', null, { protection: { protectUntil: clock.now + 120_000, shieldUntil: clock.now + 600_000 } });
    const p = world.pilots.get('a')!;
    expect(p.protectUntil - world.time).toBeCloseTo(120, 5);
    expect(p.shieldUntil - world.time).toBeCloseTo(600, 5);
    // The next session starts later (a restart): the same clock times, less left.
    const later = clocked(clock.now + 60_000);
    later.world.join('a', 'Ann');
    later.world.claim('a', 'T6', null, { protection: { protectUntil: world.progressSave('a')!.protectUntil!.getTime(), shieldUntil: world.progressSave('a')!.shieldUntil!.getTime() } });
    const q = later.world.pilots.get('a')!;
    expect(q.protectUntil - later.world.time).toBeCloseTo(60, 3);
    expect(q.shieldUntil - later.world.time).toBeCloseTo(540, 3);
  });

  it('never gives a returning player new-player protection again', () => {
    const { world } = clocked();
    world.join('a', 'Ann');
    world.claim('a', 'T1', null, { protection: { protectUntil: null, shieldUntil: null } });
    const p = world.pilots.get('a')!;
    expect(p.protectUntil).toBe(0);
    expect(world.progressSave('a')!.protectUntil).toBeNull();
  });
});

describe('raids and kills remembered across sessions', () => {
  function rivals() {
    const { world, clock } = clocked(1_800_000_000_000, 0);
    world.join('a', 'Ann');
    world.join('b', 'Bob');
    world.claim('a', 'T1');
    world.claim('b', 'T3');
    return { world, clock, a: world.pilots.get('a')!, b: world.pilots.get('b')! };
  }

  it('reports a raid with its clock time, and a world that remembers it keeps the cooldown and the repeat rule', () => {
    const { world, clock, a, b } = rivals();
    const attack = world.attacks.start('a', 'b', 'T3', { installationId: 'x', name: 'store', x: 0, z: 0 }, world.time);
    // A raid that succeeds (the attacker's bombs got through).
    (world as unknown as { endAttack(a: typeof attack, o: string): void }).endAttack(attack, 'bombed');
    const [raid] = world.takePvp();
    expect(raid).toMatchObject({ id: attack.uid, kind: 'raid', attacker: 'a', victim: 'b', success: true, at: clock.now });
    expect(world.takePvp()).toEqual([]);
    // Another session five minutes later knows nothing of it until it is told.
    const next = rivals();
    next.clock.now = clock.now + 300_000;
    next.b.shieldUntil = 0;
    expect(next.world.attacks.refusal(next.a, next.b, next.world.time, next.world.arrivalGrace)).toBeNull();
    next.world.rememberPvp([raid, raid]);
    expect(PVP.pairCooldown).toBeGreaterThan(300);
    expect(next.world.attacks.refusal(next.a, next.b, next.world.time, next.world.arrivalGrace)).toBe('cooldown');
    expect(next.world.attacks.repeatFactor('a', 'b', next.world.time)).toBe(PVP.repeat[1]);
    void a;
    void b;
  });

  it('reports a kill between players for the store', () => {
    const { world, clock, a, b } = rivals();
    a.resources.restore(200);
    b.resources.restore(200);
    b.damageLog.push({ by: 'a', amount: 50, at: world.time });
    b.state!.phase = 'flying';
    b.state!.plane = b.state!.chosen;
    b.state!.crash('shot-down');
    const kills = world.takePvp().filter((e) => e.kind === 'kill');
    expect(kills).toEqual([{ id: expect.any(String), kind: 'kill', attacker: 'a', victim: 'b', success: true, at: clock.now }]);
  });

  it('pays less for shooting down the same player again, even after a restart', () => {
    const first = rivals();
    const bounty = first.world.kills.record('a', 'b', 45, false, first.world.time);
    const remembered = { id: first.world.kills.last!.id, kind: 'kill' as const, attacker: 'a', victim: 'b', success: true, at: first.clock.now };
    const next = rivals();
    next.clock.now = first.clock.now + 30_000;
    next.world.rememberPvp([remembered]);
    expect(next.world.kills.record('a', 'b', 45, false, next.world.time)).toBeLessThan(bounty);
  });
});

describe('desk names', () => {
  it("names the AI's desks from the list for the session, and a player's after them", () => {
    const { world } = clocked();
    const labels = world.territories.map((t) => world.deskName(t.id));
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(DESK_NAMES.map((n) => `${n}'s desk`)).toContain(l);
    world.join('a', 'Daniel');
    world.claim('a', 'T5');
    expect(world.deskName('T5')).toBe("Daniel's desk");
    world.remove('a');
    // Bare between players (v0.0.13), then the AI's again under its own name.
    expect(world.deskName('T5')).toBe('Empty desk');
  });

  it("never names an AI desk like a player in the session", () => {
    for (const name of ['Billy', 'Big_Greg', 'margo']) {
      const { world } = clocked();
      world.join('a', name);
      const labels = world.territories.map((t) => world.deskName(t.id).toLowerCase().replace(/[\s_]/g, ''));
      expect(labels).not.toContain(`${name.toLowerCase().replace(/[\s_]/g, '')}'sdesk`);
    }
    const { world } = clocked();
    world.join('a', 'Somebody');
    world.rename('a', 'Tina');
    expect(world.territories.map((t) => world.deskName(t.id))).not.toContain("Tina's desk");
  });
});

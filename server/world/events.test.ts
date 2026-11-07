import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/config';
import { seededRng } from '../../src/systems/Random';
import { SessionEvents } from './SessionEvents';
import { launch, place, player, quietWorld, run } from './testkit';

/** v0.0.18 §4: world events in multiplayer sessions. */
describe('session events: the rules', () => {
  const withEvent = () => {
    const ev = new SessionEvents(seededRng(1));
    ev.events.push({ uid: 'u', kind: 'convoy', territoryId: 'T5', title: '', until: null, target: 'c1', status: 'active' });
    return ev;
  };

  it('splits a bounty by share of the damage, never paying more than the bounty', () => {
    const ev = withEvent();
    ev.contribute('c1', 'a', 60);
    ev.contribute('c1', 'b', 30);
    ev.contribute('c1', 'c', 5); // under the minimum share: nothing
    const shares = ev.split('c1', 50);
    expect(shares.reduce((t, s) => t + s.amount, 0)).toBe(50);
    expect(shares.find((s) => s.player === 'a')!.amount).toBeGreaterThan(shares.find((s) => s.player === 'b')!.amount);
    expect(shares.some((s) => s.player === 'c')).toBe(false);
    // Paid once: the log is gone afterwards.
    expect(ev.split('c1', 50)).toEqual([]);
  });

  it("leaves out players paid by the event's own card; their part goes to the others", () => {
    const ev = withEvent();
    ev.contribute('c1', 'a', 50);
    ev.contribute('c1', 'b', 50);
    expect(ev.split('c1', 40, new Set(['a']))).toEqual([{ player: 'b', amount: 40 }]);
  });

  it('only counts damage to what an event is about', () => {
    const ev = withEvent();
    ev.contribute('other', 'a', 50);
    expect(ev.split('other', 40)).toEqual([]);
  });

  it('is paced by population: nothing with nobody there, never a flood with two', () => {
    expect(SessionEvents.maxActive(2)).toBe(1);
    expect(SessionEvents.maxActive(12)).toBe(2);
    expect(SessionEvents.pace(2)).toBe(1);
    expect(SessionEvents.pace(16)).toBeGreaterThan(SessionEvents.pace(4));
    const ev = new SessionEvents(seededRng(2));
    let started = 0;
    for (let t = 0; t < 3600; t++) if (ev.tick(1, 0, () => null)) started++;
    expect(started).toBe(0);
    // Two players for an hour: a handful of events, one at a time.
    const two = new SessionEvents(seededRng(2));
    let n = 0;
    for (let t = 0; t < 3600; t++) {
      for (const e of two.active) if (++n % 60 === 0) e.status = 'resolved';
      two.tick(1, 2, (kind, uid) => ({ uid, kind, territoryId: null, title: '', until: null, target: null, status: 'active' }));
      expect(two.active.length).toBeLessThanOrEqual(1);
    }
    expect(two.events.length).toBeGreaterThanOrEqual(5);
    expect(two.events.length).toBeLessThanOrEqual(3600 / EVENTS.session.cooldown[0] + 1);
  });
});

describe('session events in the world', () => {
  it('a shipment at an AI depot: two players bomb it, the bounty is split once, keyed by the event', () => {
    const world = quietWorld(3);
    const a = player(world, 'a', 'T1');
    const b = player(world, 'b', 'T4');
    const e = world.forceEvent('high-value')!;
    expect(e).not.toBeNull();
    expect(world.owners.has(e.territoryId!)).toBe(false);
    // Both players get the card.
    expect(a.director!.event?.eventId).toBe(e.uid);
    expect(a.cards()).toContain(a.director!.event!.mission);
    const depot = world.network.get(e.target!)!;
    world.takePaper('a');
    world.takePaper('b');
    const hurt = (world as unknown as { damageInstallation: (i: unknown, n: number, by: unknown, w: string) => number }).damageInstallation.bind(world);
    hurt(depot, depot.durability.max * 0.6, a, 'bomb');
    hurt(depot, depot.durability.max, b, 'bomb');
    expect(e.status).toBe('resolved');
    const paid = [...world.takePaper('a'), ...world.takePaper('b')].filter((c) => c.key.startsWith(`event:${e.uid}`));
    expect(paid.map((c) => c.key).sort()).toEqual([`event:${e.uid}:a`, `event:${e.uid}:b`]);
    expect(paid.reduce((t, c) => t + c.amount, 0)).toBe(EVENTS.bounty['high-value']);
    // The card leaves the boards.
    expect(a.director!.event).toBeNull();
  });

  it('a supply drop goes to the first plane low over it, and only once', () => {
    const world = quietWorld(5);
    const a = player(world, 'a', 'T1');
    const b = player(world, 'b', 'T4');
    const e = world.forceEvent('supply-drop')!;
    const d = e.drop!;
    launch(world, a, 'swift');
    launch(world, b, 'swift');
    const before = { a: a.resources.amount(d.resource), b: b.resources.amount(d.resource) };
    place(a, d.x, d.top + 4, d.z, 0);
    place(b, d.x + 1, d.top + 4, d.z, 0);
    run(world, 0.1);
    expect(e.status).toBe('resolved');
    const gained = { a: a.resources.amount(d.resource) - before.a, b: b.resources.amount(d.resource) - before.b };
    expect(gained.a + gained.b).toBeGreaterThanOrEqual(d.amount);
    expect(Math.min(gained.a, gained.b)).toBeLessThan(d.amount);
  });

  it('never happens on a player\'s desk', () => {
    const world = quietWorld(7);
    player(world, 'a', 'T1');
    player(world, 'b', 'T4');
    for (let i = 0; i < 20; i++) {
      for (const kind of ['high-value', 'supply-drop'] as const) {
        const e = world.forceEvent(kind);
        if (e) {
          expect(world.owners.has(e.territoryId!)).toBe(false);
          e.status = 'expired';
        }
      }
    }
  });

  it('an ink storm pays a mission\'s ink twice, once', () => {
    const world = quietWorld(9);
    const a = player(world, 'a', 'T1');
    world.forceEvent('ink-storm');
    expect(world.sessionEvents.storm).toBe(true);
    launch(world, a, 'swift');
    const m = a.state!.mission!;
    (m.spec as { supplies?: object }).supplies = { ink: 10 };
    const ink = a.resources.ink;
    m.objectives.forEach((_, i) => (m.progress[i] = 1));
    // Settle through GameState so the reward and the event fire as in play.
    (a.state as unknown as { objectiveComplete: (i: number) => void }).objectiveComplete(0);
    expect(m.status).toBe('succeeded');
    expect(a.resources.ink - ink).toBe(10 * EVENTS.session.stormFactor);
    const storm = world.takePaper('a').filter((c) => c.key.startsWith('storm:'));
    expect(storm).toHaveLength(1);
  });
});

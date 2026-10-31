import { describe, expect, it } from 'vitest';
import type { AiOrders } from '../ai/AiAircraft';
import type { Raid } from '../ai/AirTraffic';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { EVENTS, RAIDS } from '../config';
import { layoutDefenses } from '../defenses/Layout';
import type { MissionContext } from '../missions/MissionGenerator';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { WorldEvents } from './WorldEvents';

const territories = generateTerritories();
const home = territories.find((t) => t.isHome)!;
const range = layoutTargetRange(territories);
const layout = layoutDefenses(territories, range.flatMap((s) => s.shapes.map(footprint)));
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x, z: home.z }, dummies: range.filter((s) => s.kind === 'dummy'), obstacles: [], installations: layout.installations };
const storeSpec = layout.installations.find((i) => i.territoryId === home.id && i.kind === 'supply')!;
const store = { territoryId: home.id, x: storeSpec.x, y: 0, z: storeSpec.z, radius: RAIDS.hitRadius };

function setup(seed = 1, room = 4) {
  const spawned: AiOrders[] = [];
  const down = new Set<string>();
  const left: string[] = [];
  const events = new WorldEvents(
    { context: () => ctx, store, room: () => room, spawn: (o) => spawned.push(o), leave: (id) => left.push(id), standing: (id) => !down.has(id) },
    seededRng(seed),
  );
  return { events, spawned, down, left };
}

const raid = (over: Partial<Raid> = {}): Raid => ({
  id: 1, bomber: 'raider-1', escorts: [], origin: 'T9', skill: 'medium', mission: false, stage: 'inbound', outcome: null, eta: 30, participated: false, ...over,
});

describe('WorldEvents: pacing', () => {
  it('nothing happens before the first sortie, then events come one at a time with a cooldown', () => {
    const { events } = setup();
    for (let t = 0; t < 600; t++) events.update(1, 0);
    expect(events.events).toHaveLength(0);
    let started = 0;
    let overlap = false;
    for (let t = 0; t < 1800; t++) {
      events.update(1, 1);
      if (events.active.length > EVENTS.maxActive) overlap = true;
      for (const e of events.active) {
        if (e.status !== 'active') continue;
        // Resolve air events after a while so the next can come.
        if (e.kind !== 'high-value' && events.time % 90 === 0) events.aircraftEscaped(e.aircraft[0]);
      }
      started = events.events.length;
    }
    expect(overlap).toBe(false);
    expect(started).toBeGreaterThanOrEqual(4);
    expect(started).toBeLessThanOrEqual(1800 / EVENTS.cooldown[0] + 1);
  });

  it('raids wait their turn behind other events', () => {
    const { events } = setup();
    expect(events.raidsAllowed(0)).toBe(false);
    expect(events.raidsAllowed(1)).toBe(true);
    events.start('high-value');
    expect(events.raidsAllowed(1)).toBe(false);
  });
});

describe('WorldEvents: kinds', () => {
  it('a high-value shipment offers a card worth more, expires, and pays a bounty off its card', () => {
    const { events } = setup(2);
    const e = events.start('high-value')!;
    expect(e.mission!.spec.modifiers).toContain('high-value');
    expect(e.mission!.spec.rewardParts!.modifier).toBeGreaterThanOrEqual(1.5);
    expect(e.timeLeft).toBe(EVENTS.shipmentTime);
    events.targetDestroyed(e.target!, true, false);
    expect(e.status).toBe('resolved');
    expect(events.takePayouts()).toEqual([{ amount: EVENTS.bounty['high-value'], label: 'Shipment bounty' }]);

    const f = events.start('high-value')!;
    for (let t = 0; t < EVENTS.shipmentTime + 1; t++) events.update(1, 1);
    expect(f.status).toBe('expired');
  });

  it("a shipment the player is flying for doesn't expire under them, and the card pays instead of the bounty", () => {
    const { events } = setup(3);
    const e = events.start('high-value')!;
    events.bound = e.id;
    for (let t = 0; t < EVENTS.shipmentTime + 5; t++) events.update(1, 1);
    expect(e.status).toBe('active');
    events.targetDestroyed(e.target!, true, true);
    expect(events.takePayouts()).toEqual([]);
  });

  it('a convoy flies an enemy Widewing (maybe escorted) across the map; shooting it down pays a bounty', () => {
    const { events, spawned } = setup(4);
    const e = events.start('convoy')!;
    expect(spawned[0].role).toBe('bomber');
    expect(spawned[0].purpose).toBe('event');
    expect(spawned[0].side).toBe('enemy');
    expect(e.mission!.objectives[0]).toMatchObject({ kind: 'intercept', targets: [spawned[0].id], before: 'escape' });
    events.aircraftDown(spawned[0].id, true, false);
    expect(e.status).toBe('resolved');
    expect(events.takePayouts()[0].amount).toBe(EVENTS.bounty.convoy);
  });

  it("when an event ends, what it sent up heads home: nothing hangs about using up the sky", () => {
    const { events, spawned, left } = setup(9);
    events.start('supply-run');
    for (let t = 0; t < 30; t++) events.update(1, 1);
    events.aircraftDown(spawned[0].id, false, false);
    expect(left).toEqual(expect.arrayContaining(spawned.map((o) => o.id)));
  });

  it('a supply plane that turns back ends its run', () => {
    const { events, spawned } = setup(10);
    const e = events.start('supply-run')!;
    events.aircraftEscaped(spawned[0].id);
    expect(e.status).toBe('failed');
  });

  it('a convoy that gets away costs nothing', () => {
    const { events, spawned } = setup(5);
    const e = events.start('convoy')!;
    events.aircraftEscaped(spawned[0].id);
    expect(e.status).toBe('failed');
    expect(events.takePayouts()).toEqual([]);
  });

  it('a supply run sends a friendly Widewing home, and its hunters later; delivered supplies pay', () => {
    const { events, spawned } = setup(6);
    const e = events.start('supply-run')!;
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ side: 'player', role: 'bomber', purpose: 'event' });
    expect(spawned[0].strike).toMatchObject({ territoryId: home.id });
    // It comes in over unprotected ground next to home.
    const origin = territories.find((t) => t.id === e.territoryId)!;
    expect(origin.threat).toBe(0);
    expect(Math.hypot(origin.x - home.x, origin.z - home.z)).toBeLessThan(80);
    for (let t = 0; t < 30; t++) events.update(1, 1);
    expect(spawned.length).toBeGreaterThan(1);
    expect(spawned.slice(1).every((o) => o.side === 'enemy' && o.prey === spawned[0].id)).toBe(true);
    events.supplyDropped(spawned[0].id, true);
    expect(e.status).toBe('resolved');
    expect(events.takePayouts()[0].amount).toBe(EVENTS.supplies);
  });

  it('with no room in the sky, no air event starts', () => {
    const { events } = setup(7, 0);
    expect(events.start('convoy')).toBeNull();
    expect(events.start('supply-run')).toBeNull();
  });

  it('a raid puts home under attack with an emergency card, until it is settled', () => {
    const { events } = setup(8);
    const e = events.raidStarted(raid());
    expect(events.stateOf(home.id)).toBe('under-attack');
    expect(e.mission!.spec.modifiers).toContain('emergency');
    expect(e.mission!.objectives[0]).toMatchObject({ kind: 'intercept', targets: ['raider-1'], before: 'release' });
    events.raidEnded(raid({ stage: 'over', outcome: 'intercepted' }));
    expect(e.status).toBe('resolved');
    expect(events.stateOf(home.id)).toBe('peaceful');
  });
});

describe('WorldEvents: territory states', () => {
  it('striking a territory puts it on alert and keeps its wrecks down; all weapons gone disables it', () => {
    const { events } = setup();
    events.recordDestroyed('T6-turret1', 'T6', 1);
    expect(events.stateOf('T6')).toBe('alert');
    expect(events.alarmed.has('T6')).toBe(true);
    expect(events.persistentWrecks.has('T6-turret1')).toBe(true);
    events.recordDestroyed('T6-turret2', 'T6', 0);
    expect(events.stateOf('T6')).toBe('disabled');
    expect(events.territoryStates.get('T6')).toBe('disabled');
    for (let t = 0; t < EVENTS.disabledTime + 1; t++) events.update(1, 0);
    expect(events.stateOf('T6')).toBe('peaceful');
    expect(events.persistentWrecks.size).toBe(0);
  });

  it('an operation holds its territory on alert until it ends', () => {
    const { events } = setup();
    events.hold('T8');
    for (let t = 0; t < EVENTS.alertTime * 2; t++) events.update(1, 0);
    expect(events.stateOf('T8')).toBe('alert');
    events.hold(null);
    expect(events.stateOf('T8')).toBe('peaceful');
  });
});

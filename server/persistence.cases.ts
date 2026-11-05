import type { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AIRCRAFT, ECONOMY } from '../src/config';
import { PROTOCOL_VERSION, ROOM, type WelcomeDTO } from '../src/net/protocol';
import { migrate } from './db/migrate';
import { TEST_DATABASE_URL, testDatabase, type TestDatabase } from './db/testdb';
import { DEV_PEPPER } from './config';
import { Identity } from './identity/Identity';
import { economyWorld, memoryServices, setServices, type Services } from './services';
import { PgStore } from './store/PgStore';
import type { Store } from './store/Store';
import { WorldRoom } from './WorldRoom';

/**
 * What travels with a player (v0.0.12), through the real room and the real store: paper through
 * the ledger, and (later phases) planes, progress and fairness timers. Every test runs against the
 * in-memory store, and against PostgreSQL when TEST_DATABASE_URL is set.
 *
 * Run from room.test.ts, on its test server (two Colyseus test servers can't boot at once).
 */

let colyseus: ColyseusTestServer;
const join = { v: PROTOCOL_VERSION };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pg: TestDatabase | null = null;

export function persistenceCases(server: () => ColyseusTestServer): void {
  beforeAll(async () => {
    colyseus = server();
    pg = await testDatabase();
    if (pg) await migrate(pg.db);
  });
  afterAll(async () => {
    await pg?.dispose();
  });

  async function room(): Promise<WorldRoom> {
    const r = (await colyseus.createRoom(ROOM, {
      ambient: false,
      seed: 5,
    })) as unknown as WorldRoom;
    r.autoDispose = false;
    return r;
  }

  /**
   * Usernames are unique across the game and the PostgreSQL schema lives for the whole file: each
   * test's "Ann" is its own player, the same one every time that test joins as Ann.
   */
  const names = new Map<string, string>();
  let serial = 0;
  const unique = (name: string) => {
    let u = names.get(name);
    if (!u) {
      u = `${name}_${process.pid % 1000}${++serial}`;
      names.set(name, u);
    }
    return u;
  };

  async function enter(r: WorldRoom, options: Record<string, unknown>) {
    if (typeof options.name === 'string') options = { ...options, name: unique(options.name) };
    const client = await colyseus.connectTo(r, { ...join, ...options });
    client.send('hello');
    const welcome = (await client.waitForMessage('welcome')) as WelcomeDTO;
    return { client, id: welcome.id, welcome };
  }

  async function placed(client: Awaited<ReturnType<typeof enter>>['client']) {
    client.send('claim', { t: 'T1' });
    return (await client.waitForMessage('claimed')) as {
      ok: boolean;
      territory: string;
      error: string | null;
    };
  }

  /** Until `check` holds (the store is written behind the world), or fails after a second. */
  async function eventually(check: () => Promise<boolean> | boolean, ms = 1500): Promise<void> {
    const until = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > until) throw new Error('timed out waiting');
      await wait(20);
    }
  }

  const stores: Array<[string, () => Services | null]> = [
    ['memory', () => memoryServices('open')],
    [
      'postgres',
      () =>
        pg
          ? {
              store: new PgStore(pg.db),
              identity: new Identity(new PgStore(pg.db), DEV_PEPPER, 'open'),
            }
          : null,
    ],
  ];

  for (const [label, make] of stores) {
    describe.skipIf(label === 'postgres' && !TEST_DATABASE_URL)(`paper and the ledger (${label})`, () => {
      let s: Services;
      beforeEach(async () => {
        await colyseus.cleanup();
        names.clear();
        s = make()!;
        setServices(s);
      });

      const recordOf = async (store: Store, publicId: string) => (await store.findPlayers(publicId))[0];

      /** The player's log, oldest first, and the balance it explains. */
      async function ledger(store: Store, playerId: string) {
        const worldId = await economyWorld();
        const log = (await store.transactions(worldId, playerId, 1000)).reverse();
        return {
          log,
          balance: await store.balance(worldId, playerId),
          sum: log.reduce((a, t) => a + t.amount, 0),
        };
      }

      it("writes a new player's starting paper once, then every change; the balance always equals the log", async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        expect((await placed(ann.client)).ok).toBe(true);
        const rec = await recordOf(s.store, ann.id);
        await eventually(async () => (await ledger(s.store, rec.id)).log.length === 1);
        const first = await ledger(s.store, rec.id);
        expect(first.log[0]).toMatchObject({
          key: `start:${rec.id}`,
          amount: ECONOMY.startingPaper,
        });
        // Fold a plane: a spend in the ledger, and the world and the store agree.
        ann.client.send('cmd', { a: 'aircraft', id: 'swift' });
        ann.client.send('cmd', { a: 'build' });
        const pilot = r.world.pilots.get(ann.id)!;
        await eventually(async () => (await ledger(s.store, rec.id)).log.some((t) => t.kind === 'spend'));
        const after = await ledger(s.store, rec.id);
        expect(after.log.find((t) => t.kind === 'spend')!.amount).toBe(-AIRCRAFT.swift.cost);
        expect(after.balance).toBe(after.sum);
        expect(after.balance + pilot.journal!.unflushed).toBe(pilot.resources.paper);
      });

      it('brings the paper back exactly on the next join, and never pays the starting paper twice', async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        await placed(ann.client);
        ann.client.send('cmd', { a: 'aircraft', id: 'swift' });
        ann.client.send('cmd', { a: 'build' });
        await wait(150);
        const paper = r.world.pilots.get(ann.id)!.resources.paper;
        await ann.client.leave();
        const rec = await recordOf(s.store, ann.id);
        await eventually(async () => (await s.store.base(rec.id))?.placement === null);
        const left = await ledger(s.store, rec.id);
        expect(left.balance).toBe(paper);
        const again = await enter(r, {
          name: 'Ann',
          token: ann.welcome.token,
        });
        expect((await placed(again.client)).ok).toBe(true);
        expect(r.world.pilots.get(ann.id)!.resources.paper).toBe(paper);
        await wait(100);
        const now = await ledger(s.store, rec.id);
        expect(now.log.filter((t) => t.key.startsWith('start:'))).toHaveLength(1);
        expect(now.balance).toBe(now.sum);
        // The limits are saved with the balance.
        const economy = await s.store.economy(await economyWorld(), rec.id);
        expect(economy!.capacity).toBeGreaterThan(0);
        expect(economy!.protected).toBeGreaterThan(0);
      });

      it('follows the store when it refuses a change: the world is corrected, never the log', async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        await placed(ann.client);
        const rec = await recordOf(s.store, ann.id);
        await eventually(async () => (await ledger(s.store, rec.id)).log.length === 1);
        // Someone (a retry after a restart) already applied the next change's key: it pays nothing again.
        const real = s.store.applyTransaction.bind(s.store);
        s.store.applyTransaction = async (tx) =>
          tx.kind === 'spend'
            ? {
                status: 'duplicate',
                balance: await s.store.balance(tx.worldId, tx.playerId),
              }
            : real(tx);
        ann.client.send('cmd', { a: 'aircraft', id: 'swift' });
        ann.client.send('cmd', { a: 'build' });
        const pilot = r.world.pilots.get(ann.id)!;
        await eventually(() => pilot.state!.phase === 'building');
        await eventually(() => pilot.resources.paper - pilot.journal!.unflushed === ECONOMY.startingPaper);
        s.store.applyTransaction = real;
        const now = await ledger(s.store, rec.id);
        expect(now.balance).toBe(now.sum);
      });
    });
  }

  for (const [label, make] of stores) {
    describe.skipIf(label === 'postgres' && !TEST_DATABASE_URL)(`planes and progress (${label})`, () => {
      let s: Services;
      beforeEach(async () => {
        await colyseus.cleanup();
        names.clear();
        s = make()!;
        setServices(s);
      });

      it('brings back the hangar, the garage, the board and the statistics after leaving', async () => {
        // The same desk both times, so every card on the board still makes sense there.
        setServices({ ...s, chooseDesk: true });
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        await placed(ann.client);
        const pilot = r.world.pilots.get(ann.id)!;
        // A plane on the pad (paid for), and a board to come back to.
        ann.client.send('cmd', { a: 'aircraft', id: 'dart' });
        ann.client.send('cmd', { a: 'build' });
        await eventually(() => pilot.state!.phase === 'ready', 4000);
        pilot.stats.kills = 2;
        const board = pilot.director!.offers.map((o) => ({ title: o.mission.title, id: pilot.missionId(o.mission) }));
        const paper = pilot.resources.paper;
        await ann.client.leave();
        const rec = (await s.store.findPlayers(ann.id))[0];
        await eventually(async () => (await s.store.base(rec.id))?.placement === null);
        await eventually(async () => (await s.store.progress(await economyWorld(), rec.id)) !== null);
        const again = await enter(r, { name: 'Ann', token: ann.welcome.token });
        expect((await placed(again.client)).ok).toBe(true);
        const back = r.world.pilots.get(ann.id)!;
        expect(back.state!.aircraft).toBe('dart');
        expect(back.state!.buildKindFor('dart')).toBe('rollout');
        expect(back.resources.paper).toBe(paper);
        expect(back.lifetime.kills).toBe(2);
        expect(back.director!.offers.map((o) => ({ title: o.mission.title, id: back.missionId(o.mission) }))).toEqual(board);
      }, 10000);

      it('destroys for good a plane its pilot leaves in the air, and writes the mission once', async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        await placed(ann.client);
        const pilot = r.world.pilots.get(ann.id)!;
        ann.client.send('cmd', { a: 'aircraft', id: 'swift' });
        ann.client.send('cmd', { a: 'build' });
        await eventually(() => pilot.state!.phase === 'ready', 4000);
        ann.client.send('cmd', { a: 'launch' });
        await eventually(() => pilot.state!.phase === 'flying');
        const planeId = pilot.planeIds.get('swift')!;
        const missionId = pilot.missionId(pilot.state!.mission!);
        // Saved while flying: airborne.
        (r as unknown as { saveBase(id: string): void }).saveBase(ann.id);
        const worldId = await economyWorld();
        const rec = (await s.store.findPlayers(ann.id))[0];
        await eventually(async () => (await s.store.aircraft(worldId, rec.id)).some((a) => a.id === planeId && a.status === 'airborne'));
        await ann.client.leave();
        await eventually(async () => (await s.store.base(rec.id))?.placement === null);
        await eventually(async () => (await s.store.aircraft(worldId, rec.id)).length === 0);
        expect(await s.store.recordMission(worldId, rec.id, { id: missionId, template: 'x', state: 'failed', outcome: null, reward: 0, spec: {} })).toBe(false);
        await expect(s.store.saveAircraft(worldId, rec.id, [{ id: planeId, type: 'swift', status: 'ready', health: 10, loadout: {} }])).rejects.toThrow();
      }, 10000);
    });
  }

  for (const [label, make] of stores) {
    describe.skipIf(label === 'postgres' && !TEST_DATABASE_URL)(`usernames and fairness timers (${label})`, () => {
      let s: Services;
      beforeEach(async () => {
        await colyseus.cleanup();
        names.clear();
        s = make()!;
        setServices(s);
      });

      it('gives a player the username they typed, and asks the next one with the same name for another', async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        expect(ann.welcome.username).toBe(names.get('Ann'));
        const twin = await colyseus.connectTo(r, { ...join, name: names.get('Ann')!.toUpperCase() });
        twin.send('hello');
        const welcome = (await twin.waitForMessage('welcome')) as WelcomeDTO;
        expect(welcome.username).toBeNull();
        expect(welcome.usernameNote).toMatch(/taken/);
        // No base before a username.
        twin.send('claim', { t: 'T1' });
        expect(await twin.waitForMessage('claimed')).toMatchObject({ ok: false, error: expect.stringMatching(/username/i) });
        twin.send('username', { name: 'admin' });
        expect(await twin.waitForMessage('username')).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
        await wait(600);
        const mine = unique('Twin');
        twin.send('username', { name: mine });
        expect(await twin.waitForMessage('username')).toMatchObject({ ok: true, username: mine });
        expect(r.state.players.get(welcome.id)?.name).toBe(mine);
        twin.send('claim', { t: 'T1' });
        expect(await twin.waitForMessage('claimed')).toMatchObject({ ok: true });
        await twin.waitForNextPatch();
        const desk = r.world.pilots.get(welcome.id)!.home!.id;
        expect(r.state.territories.get(desk)?.label).toBe(`${mine}'s desk`);
      });

      it("keeps a shield across sessions, and never renews a returning player's new-player protection", async () => {
        const r = await room();
        const ann = await enter(r, { name: 'Ann' });
        await placed(ann.client);
        const p = r.world.pilots.get(ann.id)!;
        expect(p.protectUntil).toBeGreaterThan(r.world.time + 200);
        // Raided a moment ago: shielded for a while. Protection over.
        p.protectUntil = r.world.time - 1;
        p.shieldUntil = r.world.time + 100;
        await ann.client.leave();
        const rec = (await s.store.findPlayers(ann.id))[0];
        await eventually(async () => (await s.store.base(rec.id))?.placement === null);
        await eventually(async () => !!(await s.store.progress(await economyWorld(), rec.id))?.shieldUntil);
        const again = await enter(r, { name: 'Ann', token: ann.welcome.token });
        await placed(again.client);
        const q = r.world.pilots.get(ann.id)!;
        expect(q.protectUntil).toBe(0);
        expect(q.shieldUntil - r.world.time).toBeGreaterThan(90);
        expect(q.shieldUntil - r.world.time).toBeLessThanOrEqual(100);
      });
    });
  }
}

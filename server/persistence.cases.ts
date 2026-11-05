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

  async function enter(r: WorldRoom, options: Record<string, unknown>) {
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
}

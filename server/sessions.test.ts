import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_RESTARTING, CLOSE_SESSION_ENDED, PROTOCOL_VERSION, ROOM, type SessionListing, type SessionResultsDTO } from '../src/net/protocol';
import type { WorldState } from '../src/net/schema';
import { memoryServices, services, setServices } from './services';
import { resetStopping, restoreSessions, sessions, setSessionDefaults, shutdownAll } from './sessions/directory';
import { sessionRoutes } from './sessions/routes';
import { WorldRoom } from './WorldRoom';

/**
 * Sessions over real WebSockets (v0.0.13): opened by the server only, quick join filling one
 * before opening another, a spare opening when every session is full, empty sessions closing,
 * joining closing near the end, and the end itself: everything settled and saved, the results
 * card, and the connections closed.
 */

const PORT = 2583;
let colyseus: ColyseusTestServer;
const join = { v: PROTOCOL_VERSION };
const http = (path: string) => (colyseus.sdk as unknown as { getHttpEndpoint(p: string): string }).getHttpEndpoint(path.replace(/^\//, ''));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function eventually(check: () => Promise<boolean> | boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await wait(20);
  }
}

beforeAll(async () => {
  // Its own port (boot() would put every test file's server on the same one).
  const server = defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, routes: sessionRoutes(), greet: false });
  await server.listen(PORT);
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => colyseus.shutdown());
beforeEach(async () => {
  resetStopping();
  await colyseus.cleanup();
  setServices(memoryServices('open'));
  setSessionDefaults({ ambient: false, seed: 5 });
});

async function quick(): Promise<string> {
  const response = await fetch(http('/sessions/quick'), { method: 'POST' });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

const roomOf = (id: string) => matchMaker.getLocalRoomById(id) as unknown as WorldRoom;

/** Joins session `id` and says hello; resolves once the server has welcomed the player. */
async function enter(id: string, name: string) {
  const client = await colyseus.connectTo(roomOf(id) as never, { ...join, name });
  client.send('hello');
  await client.waitForMessage('welcome');
  // As the browser does: ask for our base to be placed on a free desk.
  client.send('claim', { t: '' });
  return client;
}

describe('sessions', () => {
  it('are opened by the server only: a client can neither create one nor choose its settings', async () => {
    await expect(colyseus.sdk.create(ROOM, { ...join, name: 'Mallory', seed: 1, newPlayerProtection: 0 })).rejects.toThrow(/opened by the server/);
    await expect(matchMaker.createRoom(ROOM, { seed: 1 })).rejects.toThrow(/opened by the server/);
    expect(sessions()).toHaveLength(0);
  });

  it('quick join fills one session before opening another, and a spare opens once it is full', async () => {
    setSessionDefaults({ ambient: false, seed: 5, session: { capacity: 2 } });
    const first = await quick();
    expect(await quick()).toBe(first);
    await enter(first, 'Ann');
    expect(await quick()).toBe(first);
    await enter(first, 'Bob');
    // Full: a spare is waiting for the next player.
    await eventually(() => sessions().length === 2);
    const spare = await quick();
    expect(spare).not.toBe(first);
    await expect(enter(first, 'Cy')).rejects.toThrow(/full/);
    await enter(spare, 'Cy');
    const list = (await (await fetch(http('/sessions'))).json()) as SessionListing[];
    expect(list.map((s) => [s.id, s.players, s.capacity, s.joinable])).toEqual([
      [spare, 1, 2, true],
      [first, 2, 2, false],
    ]);
    expect(list[0].left).toBeGreaterThan(3500);
  });

  it('closes a session nobody is in, but keeps the spare while others are full', async () => {
    setSessionDefaults({ ambient: false, seed: 5, session: { capacity: 1, emptyClose: 0.3 } });
    const first = await quick();
    const ann = await enter(first, 'Ann');
    await eventually(() => sessions().length === 2);
    const spare = sessions().find((s) => s.id !== first)!.id;
    await wait(700);
    // The spare stays while the full session runs.
    expect(roomOf(spare)).toBeDefined();
    await ann.leave();
    // Now both are empty: both go.
    await eventually(() => sessions().length === 0, 3000);
    expect(roomOf(first)).toBeUndefined();
  });

  it('closes joining near the end, then ends: everything settled and saved, results for everyone, connections closed', async () => {
    setSessionDefaults({ ambient: false, seed: 5, session: { length: 2.4, resultsHold: 0.4 } });
    const id = await quick();
    const ann = await enter(id, 'Ann');
    const bo = await enter(id, 'Bob');
    const r = roomOf(id);
    await eventually(() => [...r.world.pilots.values()].every((p) => !!p.base));
    // Bob leaves before the end: Bob is on the card, as having left.
    const boId = [...r.world.pilots.values()].find((p) => p.name === 'Bob')!.id;
    await bo.leave();
    await eventually(() => r.world.pilots.size === 1);
    const pilot = [...r.world.pilots.values()][0];
    pilot.stats.kills = 2;
    pilot.addScore(20);
    // Joining has closed (halfway through so short a session).
    await eventually(() => r.hour.status === 'closing', 3000);
    await expect(enter(id, 'Late')).rejects.toThrow(/about to end/);
    // Ann, who is still in, could come back.
    expect(r.summary(Date.now()).status).toBe('closing');
    let closedWith = 0;
    ann.onLeave((code) => (closedWith = code));
    const results = (await ann.waitForMessage('results', 4000)) as SessionResultsDTO;
    expect(results.lines.map((l) => [l.name, l.placing, l.present])).toEqual([
      ['Ann', 1, true],
      ['Bob', 2, false],
    ]);
    expect(results.lines[0]).toMatchObject({ kills: 2, score: 20 });
    expect(results.lines[0].paper).toBeGreaterThanOrEqual(0);
    expect(results.lines.find((l) => l.id === boId)).toBeDefined();
    expect(r.world.pilots.size).toBe(0);
    await expect(enter(id, 'Later')).rejects.toThrow();
    await eventually(() => closedWith === CLOSE_SESSION_ENDED, 3000);
    await eventually(() => sessions().every((s) => s.id !== id));
    // Every base was packed and the session is recorded as over.
    const store = services().store;
    for (const p of await store.listPlayers()) expect((await store.base(p.id))?.placement ?? null).toBeNull();
    expect((await store.sessionRecords()).find((s) => s.id === id)).toMatchObject({ status: 'ended', peakPlayers: 2 });
  }, 10000);

  it("keeps a departed defender's base on the desk until the raid on it is settled, then packs it", async () => {
    const id = await quick();
    const ann = await enter(id, 'Ann');
    const bob = await enter(id, 'Bob');
    const r = roomOf(id);
    await eventually(() => [...r.world.pilots.values()].every((p) => !!p.base));
    const [a, b] = ['Ann', 'Bob'].map((n) => [...r.world.pilots.values()].find((p) => p.name === n)!);
    const attack = r.world.attacks.start(a.id, b.id, b.home!.id, { installationId: b.base!.idOf('store'), name: 'store', x: b.home!.x, z: b.home!.z }, r.world.time);
    await bob.leave();
    await wait(300);
    // Still on the desk, draining, its defenses up: the raid goes on.
    expect(r.world.pilots.get(b.id)?.leaving).toBe(true);
    expect(r.world.deskState(b.home!.id)).toBe('draining');
    await ann.waitForNextPatch();
    expect((ann.state as WorldState).territories.get(b.home!.id)?.state).toBe(2);
    const bobRecord = (await services().store.findPlayers(b.id))[0];
    expect((await services().store.base(bobRecord.id))?.placement).not.toBeNull();
    // Settled: now the base is packed and the desk's gap starts.
    (r.world as unknown as { endAttack(x: unknown, o: string): void }).endAttack(attack, 'repelled');
    await eventually(() => !r.world.pilots.has(b.id));
    await eventually(async () => (await services().store.base(bobRecord.id))?.placement === null);
    expect(r.world.deskState(b.home?.id ?? attack.territoryId)).toBe('empty');
  });

  it('shows the time left in the shared state', async () => {
    setSessionDefaults({ ambient: false, seed: 5, session: { length: 600 } });
    const id = await quick();
    const ann = await enter(id, 'Ann');
    await ann.waitForNextPatch();
    await ann.waitForNextPatch();
    const state = ann.state as WorldState;
    expect(state.left).toBeGreaterThan(590);
    expect(state.left).toBeLessThanOrEqual(600);
    expect(state.session).toBe(0);
  });

  it('shuts down gracefully: everyone told, planes home, bases saved, the session recorded with its desks; a restart restores it', async () => {
    setSessionDefaults({ ambient: false, seed: 5, session: { length: 1200 } });
    const id = await quick();
    const ann = await enter(id, 'Ann');
    const bob = await enter(id, 'Bob');
    const r = roomOf(id);
    await eventually(() => [...r.world.pilots.values()].every((p) => !!p.base));
    const pilots = [...r.world.pilots.values()];
    const desks = new Map(pilots.map((p) => [p.name, p.home!.id]));
    const endsAt = r.hour.endsAt;
    // Ann is in the air.
    const a = pilots.find((p) => p.name === 'Ann')!;
    ann.send('cmd', { a: 'aircraft', id: 'swift' });
    ann.send('cmd', { a: 'build' });
    await eventually(() => a.state!.phase === 'ready', 4000);
    ann.send('cmd', { a: 'launch' });
    await eventually(() => a.state!.phase === 'flying');
    const told = ann.waitForMessage('restarting');
    const closed = new Promise<number>((resolve) => ann.onLeave((code) => resolve(code)));
    await shutdownAll('The server is restarting. Back in a moment.');
    expect(await told).toMatchObject({ text: expect.stringMatching(/restarting/) });
    expect(await closed).toBe(CLOSE_RESTARTING);
    const store = services().store;
    const players = await store.listPlayers();
    for (const p of players) expect((await store.base(p.id))?.placement ?? null).toBeNull();
    const record = (await store.sessionRecords(['interrupted'])).find((x) => x.id === id)!;
    expect(record).toBeDefined();
    const byName = new Map(players.map((p) => [p.username ?? p.name, p.id]));
    expect(record.desks).toEqual({ [byName.get('Ann')!]: desks.get('Ann'), [byName.get('Bob')!]: desks.get('Bob') });
    // Ann's plane came home rather than being lost.
    const { economyWorld } = await import('./services');
    expect((await store.aircraft(await economyWorld(), byName.get('Ann')!)).some((x) => x.type === 'swift')).toBe(true);
    void bob;
    await eventually(() => !roomOf(id));
    // The restart: the same session, the same clock, each desk held for its player.
    resetStopping();
    expect(await restoreSessions(store)).toEqual([id]);
    const back = roomOf(id);
    expect(back.hour.endsAt).toBe(endsAt);
    // A stranger can't take a held desk; Ann lands back on hers.
    const cy = await enter(id, 'Cyd');
    await eventually(() => [...back.world.pilots.values()].some((p) => p.name === 'Cyd' && !!p.home));
    const cyDesk = [...back.world.pilots.values()].find((p) => p.name === 'Cyd')!.home!.id;
    expect([...desks.values()]).not.toContain(cyDesk);
    void cy;
  }, 15000);

  it("recovers from a crash: a session left running is restored and every base comes back as last committed", async () => {
    const store = services().store;
    setSessionDefaults({ ambient: false, seed: 5 });
    // Ann played in session "crashed1" on T9 until the process died: her base still has a live
    // lease held by the dead process, and the session was never closed.
    const first = await quick();
    const ann = await colyseus.connectTo(roomOf(first) as never, { ...join, name: 'Ann' });
    ann.send('hello');
    const welcome = (await ann.waitForMessage('welcome')) as { token?: string };
    ann.send('claim', { t: '' });
    const r = roomOf(first);
    await eventually(() => [...r.world.pilots.values()].some((p) => !!p.base));
    const pilot = [...r.world.pilots.values()][0];
    const accountId = (await store.findPlayers(pilot.id))[0].id;
    await ann.leave();
    await eventually(async () => (await store.base(accountId))?.placement === null);
    const saved = (await store.base(accountId))!.state!;
    const crashed = 'crashed1';
    await store.placeBase(accountId, `deadbeef/${crashed}`, 'T9', 120);
    await store.saveBase(accountId, `deadbeef/${crashed}`, saved, 120);
    await store.recordSession({ id: crashed, title: 'Classroom 9', capacity: 16, createdAt: new Date(), startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 1800_000), endedAt: null, status: 'open', peakPlayers: 1, desks: { [accountId]: 'T9' } });
    expect(await restoreSessions(store)).toContain(crashed);
    // Ann comes back (her browser keeps its device token) and lands on T9 with her base as committed.
    const again = await colyseus.connectTo(roomOf(crashed) as never, { ...join, name: 'Ann', token: welcome.token });
    again.send('hello');
    await again.waitForMessage('welcome');
    again.send('claim', { t: '' });
    const claimed = (await again.waitForMessage('claimed')) as { ok: boolean; territory: string };
    expect(claimed).toMatchObject({ ok: true, territory: 'T9' });
    expect((await store.base(accountId))?.placement?.holder).not.toMatch(/^deadbeef/);
    const placed = roomOf(crashed).world.baseSave([...roomOf(crashed).world.pilots.keys()][0])!;
    expect(placed.buildings.length).toBe(saved.buildings.length);
  }, 15000);
});

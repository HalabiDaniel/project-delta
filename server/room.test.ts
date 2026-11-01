import { defineRoom, defineServer } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET, PROTOCOL_VERSION, ROOM, type MeDTO, type WelcomeDTO } from '../src/net/protocol';
import type { WorldState } from '../src/net/schema';
import { memoryServices, setServices } from './services';
import { WorldRoom } from './WorldRoom';

/**
 * The room over real WebSockets: joining, claiming, the schema and private state each player
 * receives, a dropped connection kept for its grace period and resumed with the reconnection
 * token (a browser refresh), and a player who leaves for good freeing their territory.
 */

let colyseus: ColyseusTestServer;
const join = { v: PROTOCOL_VERSION };

beforeAll(async () => {
  colyseus = await boot(defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, greet: false }), 2581);
});
afterAll(async () => colyseus.shutdown());
beforeEach(async () => {
  await colyseus.cleanup();
  setServices(memoryServices('open'));
});

async function room(): Promise<WorldRoom> {
  const r = (await colyseus.createRoom(ROOM, { ambient: false, seed: 5 })) as unknown as WorldRoom;
  // Stays up while empty, so a test can leave and come back.
  r.autoDispose = false;
  return r;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Joins and waits for the welcome: the player's public id (and token, if one was issued). */
async function enter(r: WorldRoom, options: Record<string, unknown>) {
  const client = await colyseus.connectTo(r, { ...join, ...options });
  client.send('hello');
  const welcome = (await client.waitForMessage('welcome')) as WelcomeDTO;
  return { client, id: welcome.id, welcome };
}

describe('the classroom room', () => {
  it('refuses clients speaking another protocol version', async () => {
    const r = await room();
    await expect(colyseus.connectTo(r, { v: PROTOCOL_VERSION + 1, name: 'Old' })).rejects.toThrow();
  });

  it('lets two players join, claim territories and see each other', async () => {
    const r = await room();
    const { client: ann, id: annId } = await enter(r, { name: 'Ann' });
    const { client: bo, id: boId } = await enter(r, { name: 'Bo<script>' });
    const me: MeDTO[] = [];
    ann.onMessage('me', (m: MeDTO) => me.push(m));
    ann.send('claim', { t: 'T1' });
    const claimed = await ann.waitForMessage('claimed');
    expect(claimed).toMatchObject({ ok: true, territory: 'T1' });
    bo.send('claim', { t: 'T1' });
    expect(await bo.waitForMessage('claimed')).toMatchObject({ ok: false, error: 'taken' });
    bo.send('claim', { t: 'T9' });
    expect(await bo.waitForMessage('claimed')).toMatchObject({ ok: true });
    await ann.waitForNextPatch();
    await ann.waitForNextPatch();
    const state = ann.state as WorldState;
    expect(state.players.size).toBe(2);
    expect(state.players.get(boId)?.name).toBe('Boscript');
    expect(state.territories.get('T1')?.owner).toBe(annId);
    expect(state.territories.get('T9')?.owner).toBe(boId);
    expect(state.territories.get('T5')?.claimable).toBe(false);
    expect([...state.installations.values()].some((i) => i.owner === boId && i.slot === 'store')).toBe(true);
    // Ann's private state: her paper and her cards, nobody else's.
    const merged = Object.assign({}, ...me) as MeDTO;
    expect(merged.territory).toBe('T1');
    expect(merged.economy?.paper).toBe(100);
    expect(merged.offers?.length).toBeGreaterThanOrEqual(3);
  });

  it('flies a plane from input frames and tells its pilot where the server has it', async () => {
    const r = await room();
    const { client: ann, id } = await enter(r, { name: 'Ann' });
    ann.send('claim', { t: 'T1' });
    await ann.waitForMessage('claimed');
    // Like the browser: three frames every 50 ms from the moment the desk is ours.
    let seq = 0;
    const pump = setInterval(() => {
      const frames: number[] = [];
      for (let k = 0; k < 3; k++) frames.push(++seq, 0, 0, 32 | 1);
      ann.send('in', frames);
    }, 50);
    const own: Array<{ seq: number }> = [];
    ann.onMessage('own', (m) => own.push(m));
    ann.send('cmd', { a: 'build' });
    await wait(2400);
    ann.send('cmd', { a: 'launch' });
    await wait(1200);
    clearInterval(pump);
    await ann.waitForNextPatch();
    expect(own.length).toBeGreaterThan(5);
    expect(own[own.length - 1].seq).toBeGreaterThan(60);
    const plane = (ann.state as WorldState).planes.get(id);
    expect(plane?.status).toBe(2); // flying
  }, 15000);

  it('keeps a dropped player for the grace period and resumes them with the reconnection token', async () => {
    const r = await room();
    const { client: ann, id } = await enter(r, { name: 'Ann' });
    ann.send('claim', { t: 'T3' });
    await ann.waitForMessage('claimed');
    const token = ann.reconnectionToken;
    ann.reconnection.enabled = false;
    // The connection breaks (no consented leave): a refresh, a lost network.
    (ann.connection as unknown as { transport: { ws: { close(): void } } }).transport.ws.close();
    await wait(300);
    expect(r.world.pilots.get(id)?.connected).toBe(false);
    expect(r.world.owners.get('T3')).toBe(id);
    expect(r.state.territories.get('T3')?.safe).toBe(true);
    const back = await colyseus.sdk.reconnect(token);
    back.send('hello');
    expect(((await back.waitForMessage('welcome')) as WelcomeDTO).id).toBe(id);
    await wait(200);
    expect(r.world.pilots.get(id)?.connected).toBe(true);
    expect(r.world.owners.get('T3')).toBe(id);
  });

  it('frees the territory of a player who leaves', async () => {
    const r = await room();
    const ann = await colyseus.connectTo(r, { ...join, name: 'Ann' });
    const bo = await colyseus.connectTo(r, { ...join, name: 'Bo' });
    ann.send('claim', { t: 'T3' });
    await ann.waitForMessage('claimed');
    await ann.leave();
    await wait(200);
    expect(r.world.owners.has('T3')).toBe(false);
    expect(r.world.network.on('T3').every((i) => i.side === 'enemy')).toBe(true);
    bo.send('claim', { t: 'T3' });
    expect(await bo.waitForMessage('claimed')).toMatchObject({ ok: true });
  });

  it('holds eight players and turns the ninth away', async () => {
    const r = await room();
    for (let i = 0; i < NET.maxPlayers; i++) await colyseus.connectTo(r, { ...join, name: `P${i}` });
    await expect(colyseus.connectTo(r, { ...join, name: 'Late' })).rejects.toThrow();
  });
});

describe('player identity in the room', () => {
  it('issues a device token on the first join, and the token brings back the same player', async () => {
    const r = await room();
    const first = await enter(r, { name: 'Ann' });
    expect(first.welcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    first.client.send('claim', { t: 'T2' });
    await first.client.waitForMessage('claimed');
    await first.client.leave();
    await wait(100);
    // A new day, a new connection: same token, same player (under a new name, which is only a label).
    const again = await enter(r, { name: 'Annie', token: first.welcome.token });
    expect(again.id).toBe(first.id);
    expect(again.welcome.token).toBeUndefined();
    expect(again.welcome.name).toBe('Annie');
  });

  it("never lets a client choose who it is: a name or someone else's id gets a new player", async () => {
    const r = await room();
    const ann = await enter(r, { name: 'Ann' });
    ann.client.send('claim', { t: 'T1' });
    await ann.client.waitForMessage('claimed');
    const fake = await enter(r, { name: 'Ann', id: ann.id, playerId: ann.id, token: 'x'.repeat(43) });
    expect(fake.id).not.toBe(ann.id);
    expect(r.world.owners.get('T1')).toBe(ann.id);
    fake.client.send('claim', { t: 'T1' });
    expect(await fake.client.waitForMessage('claimed')).toMatchObject({ ok: false, error: 'taken' });
  });

  it('closes the older connection when the same player connects again ("opened in another tab")', async () => {
    const r = await room();
    const tab1 = await enter(r, { name: 'Ann' });
    tab1.client.send('claim', { t: 'T4' });
    await tab1.client.waitForMessage('claimed');
    const closed = new Promise<number>((resolve) => tab1.client.onLeave((code) => resolve(code)));
    const tab2 = await enter(r, { name: 'Ann', token: tab1.welcome.token });
    expect(tab2.id).toBe(tab1.id);
    expect(tab2.welcome.reconnected).toBe(true);
    expect(await closed).toBe(4011);
    await wait(200);
    // The seat, the territory and the connection all belong to the new tab.
    expect(r.world.pilots.size).toBe(1);
    expect(r.world.owners.get('T4')).toBe(tab1.id);
    expect(r.world.pilots.get(tab1.id)?.connected).toBe(true);
    expect(r.idOf(tab2.client)).toBe(tab1.id);
    expect(r.idOf(tab1.client)).toBeNull();
  });

  it('lets a refreshed browser back in with its device token while the old connection waits to time out', async () => {
    const r = await room();
    const ann = await enter(r, { name: 'Ann' });
    ann.client.send('claim', { t: 'T6' });
    await ann.client.waitForMessage('claimed');
    ann.client.reconnection.enabled = false;
    (ann.client.connection as unknown as { transport: { ws: { close(): void } } }).transport.ws.close();
    await wait(200);
    expect(r.world.pilots.get(ann.id)?.connected).toBe(false);
    const back = await enter(r, { name: 'Ann', token: ann.welcome.token });
    expect(back.id).toBe(ann.id);
    await wait(200);
    expect(r.world.pilots.get(ann.id)?.connected).toBe(true);
    expect(r.world.owners.get('T6')).toBe(ann.id);
    expect(r.state.players.get(ann.id)?.connected).toBe(true);
  });

  it('moves a player who joins another classroom out of the first one', async () => {
    const a = await room();
    const b = await room();
    const ann = await enter(a, { name: 'Ann' });
    ann.client.send('claim', { t: 'T7' });
    await ann.client.waitForMessage('claimed');
    const closed = new Promise<number>((resolve) => ann.client.onLeave((code) => resolve(code)));
    const there = await enter(b, { name: 'Ann', token: ann.welcome.token });
    expect(there.id).toBe(ann.id);
    expect(await closed).toBe(4011);
    await wait(100);
    expect(a.world.pilots.has(ann.id)).toBe(false);
    expect(a.world.owners.has('T7')).toBe(false);
    expect(b.world.pilots.has(ann.id)).toBe(true);
  });

  it('hands out a one-time transfer code that moves the player to another computer', async () => {
    const r = await room();
    const ann = await enter(r, { name: 'Ann' });
    ann.client.send('transfer');
    const { code, expires } = (await ann.client.waitForMessage('transfer')) as { code: string; expires: number };
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(expires).toBeGreaterThan(600);
    const laptop = await enter(r, { name: 'Ann', code: code.toLowerCase() });
    expect(laptop.id).toBe(ann.id);
    expect(laptop.welcome.token).toBeTruthy();
    expect(laptop.welcome.token).not.toBe(ann.welcome.token);
    await laptop.client.leave();
    // Single use.
    await expect(colyseus.connectTo(r, { ...join, name: 'Mallory', code })).rejects.toThrow(/didn't work/);
  });

  it('refuses revoked players', async () => {
    const services = memoryServices('open');
    setServices(services);
    const r = await room();
    const ann = await enter(r, { name: 'Ann' });
    await ann.client.leave();
    const [record] = await services.store.findPlayers(ann.id);
    await services.store.setRevoked(record.id, true);
    await expect(colyseus.connectTo(r, { ...join, name: 'Ann', token: ann.welcome.token })).rejects.toThrow(/withdrawn/);
  });

  it('needs an invite with ACCESS=invite, and an invite works only as often as it allows', async () => {
    const services = memoryServices('invite');
    setServices(services);
    const r = await room();
    await expect(colyseus.connectTo(r, { ...join, name: 'Eve' })).rejects.toThrow(/invite-only/);
    await expect(colyseus.connectTo(r, { ...join, name: 'Eve', token: 'y'.repeat(43) })).rejects.toThrow(/isn't recognised/);
    const { code } = await services.identity.createInvite('for Bo');
    const bo = await enter(r, { name: 'Bo', code });
    expect(bo.welcome.token).toBeTruthy();
    await expect(colyseus.connectTo(r, { ...join, name: 'Eve', code })).rejects.toThrow(/didn't work/);
    await bo.client.leave();
    // Bo's own token keeps working without the invite.
    const again = await enter(r, { name: 'Bo', token: bo.welcome.token });
    expect(again.id).toBe(bo.id);
  });
});

import { defineRoom, defineServer } from '@colyseus/core';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET, PROTOCOL_VERSION, ROOM, type MeDTO } from '../src/net/protocol';
import type { WorldState } from '../src/net/schema';
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
beforeEach(async () => colyseus.cleanup());

async function room(): Promise<WorldRoom> {
  return (await colyseus.createRoom(ROOM, { ambient: false, seed: 5 })) as unknown as WorldRoom;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the classroom room', () => {
  it('refuses clients speaking another protocol version', async () => {
    const r = await room();
    await expect(colyseus.connectTo(r, { v: PROTOCOL_VERSION + 1, name: 'Old' })).rejects.toThrow();
  });

  it('lets two players join, claim territories and see each other', async () => {
    const r = await room();
    const ann = await colyseus.connectTo(r, { ...join, name: 'Ann' });
    const bo = await colyseus.connectTo(r, { ...join, name: 'Bo<script>' });
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
    expect(state.players.get(bo.sessionId)?.name).toBe('Boscript');
    expect(state.territories.get('T1')?.owner).toBe(ann.sessionId);
    expect(state.territories.get('T9')?.owner).toBe(bo.sessionId);
    expect(state.territories.get('T11')?.claimable).toBe(false);
    expect([...state.installations.values()].some((i) => i.owner === bo.sessionId && i.slot === 'store')).toBe(true);
    // Ann's private state: her paper and her cards, nobody else's.
    const merged = Object.assign({}, ...me) as MeDTO;
    expect(merged.territory).toBe('T1');
    expect(merged.economy?.paper).toBe(100);
    expect(merged.offers?.length).toBeGreaterThanOrEqual(3);
  });

  it('flies a plane from input frames and tells its pilot where the server has it', async () => {
    const r = await room();
    const ann = await colyseus.connectTo(r, { ...join, name: 'Ann' });
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
    const plane = (ann.state as WorldState).planes.get(ann.sessionId);
    expect(plane?.status).toBe(2); // flying
  }, 15000);

  it('keeps a dropped player for the grace period and resumes them with the reconnection token', async () => {
    const r = await room();
    const ann = await colyseus.connectTo(r, { ...join, name: 'Ann' });
    ann.send('claim', { t: 'T3' });
    await ann.waitForMessage('claimed');
    const token = ann.reconnectionToken;
    const id = ann.sessionId;
    ann.reconnection.enabled = false;
    // The connection breaks (no consented leave): a refresh, a lost network.
    (ann.connection as unknown as { transport: { ws: { close(): void } } }).transport.ws.close();
    await wait(300);
    expect(r.world.pilots.get(id)?.connected).toBe(false);
    expect(r.world.owners.get('T3')).toBe(id);
    expect(r.state.territories.get('T3')?.safe).toBe(true);
    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(id);
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

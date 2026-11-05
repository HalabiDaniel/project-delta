import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ROOM } from '../src/net/protocol';
import { explain } from '../src/mp/NetClient';
import { setLogSink } from './log';
import { RateLimit } from './RateLimit';
import { memoryServices, setServices } from './services';
import { setSessionDefaults } from './sessions/directory';
import { sessionRoutes } from './sessions/routes';
import { WorldRoom } from './WorldRoom';

/**
 * Hardening (v0.0.13): rate limits, room settings only the server can set, malformed messages
 * dropped and logged, structured logs, and errors a person can read.
 */

const PORT = 2584;
let colyseus: ColyseusTestServer;
const join = { v: PROTOCOL_VERSION };
const lines: Array<Record<string, unknown>> = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const server = defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, routes: sessionRoutes(), greet: false });
  await server.listen(PORT);
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => colyseus.shutdown());
beforeEach(async () => {
  await colyseus.cleanup();
  setServices(memoryServices('open'));
  setSessionDefaults({ ambient: false, seed: 5 });
  lines.length = 0;
  setLogSink((line) => lines.push(JSON.parse(line)));
});
afterEach(() => setLogSink(null));

const http = (path: string) => (colyseus.sdk as unknown as { getHttpEndpoint(p: string): string }).getHttpEndpoint(path);

async function session(): Promise<WorldRoom> {
  const response = await fetch(http('sessions/quick'), { method: 'POST' });
  const { id } = (await response.json()) as { id: string };
  return matchMaker.getLocalRoomById(id) as unknown as WorldRoom;
}

describe('rate limits', () => {
  it('lets a burst through, then refuses until the bucket refills', () => {
    let now = 0;
    const limit = new RateLimit(1, 3, () => now);
    expect([1, 2, 3, 4].map(() => limit.take('a'))).toEqual([true, true, true, false]);
    expect(limit.take('b')).toBe(true);
    now = 1.01;
    expect(limit.take('a')).toBe(true);
    expect(limit.take('a')).toBe(false);
  });
});

describe('the room, hardened', () => {
  it('limits joins per address (but never from this machine)', async () => {
    const r = await session();
    const auth = (ip: string) => r.onAuth({} as never, { ...join, name: 'Ann' }, { ip });
    const results: string[] = [];
    for (let i = 0; i < 45; i++) results.push(await auth('203.0.113.9').then(() => 'ok', (e: Error) => e.message));
    expect(results.filter((x) => x === 'ok').length).toBeLessThanOrEqual(41);
    expect(results.at(-1)).toMatch(/Too many attempts/);
    expect(lines.some((l) => l.event === 'join.limited' && l.ip === '203.0.113.9')).toBe(true);
    await expect(auth('127.0.0.1')).resolves.toBeDefined();
  });

  it('drops malformed messages and logs them, without trusting any of it', async () => {
    const r = await session();
    const client = await colyseus.connectTo(r as never, { ...join, name: 'Ann' });
    client.send('hello');
    await client.waitForMessage('welcome');
    client.send('cmd', { a: 'base-build', slot: '../../etc', kind: 'nuke' });
    client.send('in', [1, 2, 'x', 4]);
    client.send('claim', { t: { evil: true } });
    client.send('emote', { e: '<script>' });
    client.send('nonsense', { a: 1 });
    await wait(300);
    const pilot = [...r.world.pilots.values()][0];
    expect(pilot.home).toBeNull();
    const bad = lines.filter((l) => l.event === 'message.malformed');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]).toMatchObject({ level: 'warn', session: r.roomId, player: pilot.id });
    // Good messages still work afterwards.
    client.send('claim', { t: '' });
    expect(await client.waitForMessage('claimed')).toMatchObject({ ok: true });
  });

  it('refuses join requests with oversized or wrongly typed options', async () => {
    const r = await session();
    await expect(colyseus.connectTo(r as never, { ...join, name: 'x'.repeat(500) })).rejects.toThrow(/malformed/);
    await expect(colyseus.connectTo(r as never, { ...join, name: 'Ann', token: { $gt: '' } })).rejects.toThrow(/malformed/);
  });

  it('keeps the seed, length and protection the server chose, whatever a client sends', async () => {
    const r = await session();
    const client = await colyseus.connectTo(r as never, { ...join, name: 'Mallory', seed: 1, newPlayerProtection: 0, session: { length: 1 }, sessionKey: 'guess' });
    client.send('hello');
    await client.waitForMessage('welcome');
    expect(r.hour.length).toBe(3600);
    await expect(colyseus.sdk.create(ROOM, { ...join, sessionKey: 'guess' })).rejects.toThrow(/opened by the server/);
  });

  it('writes one structured line per join, placement and session event', async () => {
    const r = await session();
    const client = await colyseus.connectTo(r as never, { ...join, name: 'Ann' });
    client.send('hello');
    await client.waitForMessage('welcome');
    client.send('claim', { t: '' });
    await client.waitForMessage('claimed');
    const events = lines.map((l) => l.event);
    expect(events).toEqual(expect.arrayContaining(['quick', 'session.open', 'join', 'place']));
    const place = lines.find((l) => l.event === 'place')!;
    expect(place).toMatchObject({ level: 'info', session: r.roomId, base: 'new' });
    expect(typeof place.t).toBe('string');
    expect(typeof place.desk).toBe('string');
  });
});

describe('errors a person can read', () => {
  it('explains what the transport says', () => {
    expect(explain('fetch failed', 'ws://x:2567')).toMatch(/Can't reach the server at ws:\/\/x:2567/);
    expect(explain('room "abc" not found', 'ws://x')).toMatch(/session has closed/);
    expect(explain('room "abc" is locked', 'ws://x')).toMatch(/full or about to end/);
    expect(explain('This session is full (16 players).', 'ws://x')).toBe('This session is full (16 players).');
  });
});

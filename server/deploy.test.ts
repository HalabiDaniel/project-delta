import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_KICKED, PROTOCOL_VERSION, ROOM } from '../src/net/protocol';
import { adminRoutes } from './adminRoutes';
import { ConfigError, parseOrigins, serverConfig } from './config';
import { checkUpgrade, corsFor, installCors, originAllowed, setAllowedOrigins } from './origins';
import { memoryServices, setServices } from './services';
import { resetStopping, setSessionDefaults } from './sessions/directory';
import { sessionRoutes } from './sessions/routes';
import { WorldRoom } from './WorldRoom';

/**
 * Going live (v0.0.14): the settings Railway gives the server, the allowed origins, /health for the
 * deploy check and the uptime monitor, and the protected admin endpoint.
 */

const PORT = 2586;
const KEY = 'test-admin-key-0123456789abcdef';
let colyseus: ColyseusTestServer;
const join = { v: PROTOCOL_VERSION };
const url = (path: string) => (colyseus.sdk as unknown as { getHttpEndpoint(p: string): string }).getHttpEndpoint(path.replace(/^\//, ''));
const admin = (path: string, body?: unknown, key = KEY) =>
  fetch(url(`/admin/${path}`), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  installCors();
  const server = defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, routes: sessionRoutes().extend(adminRoutes(KEY).endpoints), greet: false });
  await server.listen(PORT);
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => colyseus.shutdown());
beforeEach(async () => {
  resetStopping();
  await colyseus.cleanup();
  setServices(memoryServices('open'));
  setSessionDefaults({ ambient: false, seed: 5 });
  WorldRoom.kicked.clear();
});
afterEach(() => setAllowedOrigins(null));

async function enter(name: string) {
  const { id } = (await (await fetch(url('/sessions/quick'), { method: 'POST' })).json()) as { id: string };
  const room = matchMaker.getLocalRoomById(id) as unknown as WorldRoom;
  const client = await colyseus.connectTo(room as never, { ...join, name });
  client.send('hello');
  const welcome = (await client.waitForMessage('welcome')) as { token?: string };
  client.send('claim', { t: '' });
  await client.waitForMessage('claimed');
  return { room, client, token: welcome.token };
}

describe('settings', () => {
  const prod = { NODE_ENV: 'production', TOKEN_PEPPER: 'x'.repeat(32), DATABASE_URL: 'postgres://a@b/c' };

  it('reads the allowed origins and the admin key, and says what is wrong', () => {
    const c = serverConfig({ ...prod, ALLOWED_ORIGINS: 'https://Project-Delta.vercel.app/, https://play.example.com', ADMIN_KEY: 'k'.repeat(32) });
    expect(c.allowedOrigins).toEqual(['https://project-delta.vercel.app', 'https://play.example.com']);
    expect(c.adminKey).toBe('k'.repeat(32));
    expect(c.warnings).toEqual([]);
    expect(serverConfig(prod).warnings.join(' ')).toMatch(/ALLOWED_ORIGINS is not set/);
    expect(serverConfig(prod).adminKey).toBeNull();
    expect(() => serverConfig({ ...prod, ADMIN_KEY: 'short' })).toThrow(ConfigError);
    expect(() => parseOrigins('https://game.example/play')).toThrow(/no path/);
    expect(parseOrigins(' , ')).toBeNull();
  });

  it('takes the port Railway gives', () => {
    expect(serverConfig({ ...prod, PORT: '8080' }).port).toBe(8080);
  });
});

describe('allowed origins', () => {
  it('lets the game and its preview builds in, and nobody else', () => {
    setAllowedOrigins(['https://project-delta.vercel.app', 'https://project-delta-*.vercel.app']);
    expect(originAllowed('https://project-delta.vercel.app')).toBe(true);
    expect(originAllowed('https://project-delta-git-main-dan.vercel.app')).toBe(true);
    expect(originAllowed('https://project-delta.vercel.app.evil.com')).toBe(false);
    expect(originAllowed('https://evil.vercel.app')).toBe(false);
    expect(originAllowed('http://project-delta.vercel.app')).toBe(false);
    // No Origin header: not a browser on another site (bots, the load test, curl).
    expect(originAllowed(null)).toBe(true);
    expect(corsFor('https://evil.com')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsFor('https://project-delta.vercel.app')['Access-Control-Allow-Origin']).toBe('https://project-delta.vercel.app');
    expect(checkUpgrade(new Request('http://x/'), { headers: new Headers({ origin: 'https://evil.com' }) })?.status).toBe(403);
    expect(checkUpgrade(new Request('http://x/'), { headers: new Headers({ origin: 'https://project-delta.vercel.app' }) })).toBeUndefined();
  });

  it('refuses a quick join and answers no CORS header to another site', async () => {
    setAllowedOrigins(['https://game.example']);
    const evil = await fetch(url('/sessions/quick'), { method: 'POST', headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const good = await fetch(url('/sessions/quick'), { method: 'POST', headers: { Origin: 'https://game.example' } });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe('https://game.example');
    const matchmake = await fetch(url('/matchmake/joinById/x'), { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(matchmake.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('/health', () => {
  it('answers 200 with the version, the store and the sessions', async () => {
    await enter('Ann');
    const response = await fetch(url('/health'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', store: 'memory', storeReachable: true, sessions: 1, players: 1 });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('answers 503 when the database cannot be reached', async () => {
    const s = memoryServices('open');
    s.store.ping = async () => false;
    setServices(s);
    const response = await fetch(url('/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', storeReachable: false });
  });
});

describe('the admin endpoint', () => {
  it('refuses a missing or wrong key', async () => {
    expect((await fetch(url('/admin/sessions'))).status).toBe(401);
    expect((await admin('sessions', undefined, 'wrong-key-wrong-key-wrong-key')).status).toBe(401);
  });

  it('lists sessions with their players, desks and ping', async () => {
    const { room } = await enter('Ann');
    const response = await admin('sessions');
    expect(response.status).toBe(200);
    const { sessions } = (await response.json()) as { sessions: Array<{ id: string; people: Array<Record<string, unknown>> }> };
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(room.roomId);
    expect(sessions[0].people[0]).toMatchObject({ name: 'Ann', connected: true });
    expect(typeof sessions[0].people[0].desk).toBe('string');
    expect(typeof sessions[0].people[0].ping).toBe('number');
  });

  it('kicks a player: their base is packed and they cannot rejoin for a while', async () => {
    const { room, client, token } = await enter('Ann');
    expect(token).toBeTruthy();
    const left = new Promise<number>((r) => client.onLeave((code) => r(code)));
    const response = await admin('kick', { player: 'Ann', minutes: 5, reason: 'Testing' });
    expect(response.status).toBe(200);
    expect(await left).toBe(CLOSE_KICKED);
    await wait(100);
    expect(room.world.pilots.size).toBe(0);
    await expect(colyseus.connectTo(room as never, { ...join, name: 'Ann', token })).rejects.toThrow(/removed from the game.*5 minutes/);
    expect((await admin('kick', { player: 'Nobody' })).status).toBe(404);
  });

  it('lets a kicked player back once their time is up', async () => {
    const { room, token } = await enter('Ann');
    const account = room.adminPlayers()[0].account!;
    expect(room.kick(room.adminPlayers()[0].id, 'Testing', 5)).toBe(true);
    await wait(100);
    WorldRoom.kicked.set(account, Date.now() - 1);
    await expect(colyseus.connectTo(room as never, { ...join, name: 'Ann', token })).resolves.toBeDefined();
  });

  it('ends a session with notice, then with the results card', async () => {
    const { room, client } = await enter('Ann');
    const response = await admin('end', { session: room.roomId, seconds: 1, reason: 'Testing' });
    expect(await response.json()).toMatchObject({ ok: true, endsIn: 1 });
    const results = (await client.waitForMessage('results', 4000)) as { reason: string | null };
    expect(results.reason).toBe('Testing');
  });

  it('frees a desk whose player is away, and leaves a connected one alone', async () => {
    const { room } = await enter('Ann');
    const desk = room.adminPlayers()[0].desk!;
    const busy = (await (await admin('desk', { session: room.roomId, desk })).json()) as { freed: boolean; what: string };
    expect(busy.freed).toBe(false);
    expect(busy.what).toMatch(/kick them first/);
    room.world.setConnected(room.adminPlayers()[0].id, false);
    const freed = (await (await admin('desk', { session: room.roomId, desk })).json()) as { freed: boolean };
    expect(freed.freed).toBe(true);
    await wait(100);
    expect(room.world.pilots.size).toBe(0);
  });
});

import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ROOM, type FeedbackDTO } from '../src/net/protocol';
import { exportFeedback } from './feedbackExport';
import { memoryServices, services, setServices } from './services';
import { setSessionDefaults } from './sessions/directory';
import { sessionRoutes } from './sessions/routes';
import type { FeedbackRecord } from './store/Store';
import { parseFeedback, WorldRoom } from './WorldRoom';

/** The playtest feedback log (v0.0.14): checked, stored with its context, rate limited, exported. */

const PORT = 2587;
let colyseus: ColyseusTestServer;
const url = (path: string) => (colyseus.sdk as unknown as { getHttpEndpoint(p: string): string }).getHttpEndpoint(path);

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
});

async function player(name: string) {
  const { id } = (await (await fetch(url('sessions/quick'), { method: 'POST' })).json()) as { id: string };
  const room = matchMaker.getLocalRoomById(id) as unknown as WorldRoom;
  const client = await colyseus.connectTo(room as never, { v: PROTOCOL_VERSION, name });
  client.send('hello');
  await client.waitForMessage('welcome');
  client.send('claim', { t: '' });
  await client.waitForMessage('claimed');
  return { room, client };
}

describe('feedback messages', () => {
  it('accepts a proper entry and refuses anything else', () => {
    expect(parseFeedback({ category: 'bug', text: '  The plane vanished  ', rating: 4, context: { fps: 58, browser: 'Firefox', pad: false } })).toEqual({
      category: 'bug',
      text: 'The plane vanished',
      repro: null,
      rating: 4,
      context: { fps: 58, browser: 'Firefox', pad: false },
    });
    expect(parseFeedback({ category: 'nonsense', text: 'x' })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: '   ' })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: 'x'.repeat(4001) })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: 'x', rating: 6 })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: 'x', rating: 2.5 })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: 'x', context: { nested: { a: 1 } } })).toBeNull();
    expect(parseFeedback({ category: 'bug', text: 'x', context: { 'bad key': 1 } })).toBeNull();
    expect(parseFeedback(null)).toBeNull();
  });
});

describe('the feedback log', () => {
  it('stores an entry with the server\'s context, which the client cannot overwrite', async () => {
    const { room, client } = await player('Ann');
    const entry: FeedbackDTO = { category: 'frustration', text: 'Turrets too strong', repro: 'Fly low over T3', rating: 3, context: { fps: 60, session: 'spoofed', version: '0.0.14' } };
    client.send('feedback', entry);
    expect(await client.waitForMessage('feedback')).toEqual({ ok: true });
    const [saved] = await services().store.feedback();
    expect(saved).toMatchObject({ category: 'frustration', body: 'Turrets too strong', repro: 'Fly low over T3', rating: 3, playerName: 'Ann' });
    expect(saved.context).toMatchObject({ fps: 60, version: '0.0.14', session: room.roomId, mode: expect.any(String), desk: expect.stringMatching(/^T\d+$/) });
  });

  it('limits how often one player can send', async () => {
    const { client } = await player('Bob');
    const replies: unknown[] = [];
    client.onMessage('feedback', (m) => replies.push(m));
    for (let i = 0; i < 6; i++) client.send('feedback', { category: 'bug', text: `report ${i}` });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(4);
    // Refusals come back at once, stored entries after the write: order isn't fixed.
    expect(replies.filter((r) => !(r as { ok: boolean }).ok)).toEqual([expect.objectContaining({ error: expect.stringMatching(/wait a minute/) }), expect.anything()]);
    expect(await services().store.feedback()).toHaveLength(4);
  });
});

describe('export', () => {
  const rows: FeedbackRecord[] = [
    { id: 1, worldId: null, playerId: 'p1', playerName: 'Ann', category: 'bug', body: 'Crash, then "freeze"\nTwice', repro: '1. Launch\n2. Bomb', rating: 2, context: { version: '0.0.14', session: 's1', desk: 'T3', mode: 'flying', fps: 55, position: { x: 1, y: 2, z: 3 } }, createdAt: new Date('2026-11-06T18:00:00Z') },
    { id: 2, worldId: null, playerId: 'p2', playerName: 'Bob', category: 'enjoyment', body: 'Great fun', repro: null, rating: 5, context: {}, createdAt: new Date('2026-11-06T18:05:00Z') },
  ];

  it('writes CSV a spreadsheet opens, quotes and newlines intact', () => {
    const csv = exportFeedback(rows, 'csv');
    const lines = csv.split('\r\n');
    expect(lines[0]).toMatch(/^id,created_at,player,category,rating,text,repro,version,session,desk,mode/);
    expect(csv).toContain('"Crash, then ""freeze""\nTwice"');
    expect(csv).toContain('{""x"":1,""y"":2,""z"":3}');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('writes Markdown grouped by category, with the average enjoyment', () => {
    const md = exportFeedback(rows, 'md');
    expect(md).toMatch(/^# Playtest feedback/);
    expect(md).toContain('Average enjoyment: 3.5 / 5 (2 rated).');
    expect(md.indexOf('## Bug (1)')).toBeLessThan(md.indexOf('## General enjoyment (1)'));
    expect(md).toContain('> Crash, then "freeze"\n> Twice');
    expect(md).toContain('**Steps to reproduce:**');
    expect(md).toContain('Desk: T3');
  });
});

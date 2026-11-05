import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { AircraftId } from '../src/config';
import { NET, ROOM } from '../src/net/protocol';
import { Bot, type NetConditions } from './bots/Bot';
import { sessionRoutes } from './sessions/routes';
import { WorldRoom } from './WorldRoom';
import { DEV_PEPPER } from './config';
import { Identity } from './identity/Identity';
import { setServices } from './services';
import { setSessionDefaults } from './sessions/directory';
import { openStore } from './store/open';
import { BASE_SAVE_EVERY } from './world/BaseKeeper';

/**
 * Multiplayer load test: an in-process server and headless bots that join, claim desks, fold
 * planes and dogfight using the same input frames and prediction as the browser. Runs 2, 8 and
 * 16 players (a full session), 8 on a poor network, then two sessions of 8 at once, and reports
 * server step time, bandwidth per player, prediction corrections, input stalls, memory and
 * reconnection. Every base is saved as in a real session (every 5 s, v0.0.13): in PostgreSQL
 * when DATABASE_URL is set, otherwise in memory.
 *
 *   npm run loadtest                         # 2, 8, 16 players; 8 at 120 ms ± 40 ms with a stall every 5 s; 2 × 8
 *   DATABASE_URL=postgres://… npm run loadtest   # the same, saving to PostgreSQL
 *   npm run loadtest -- --players 8 --seconds 60
 *   npm run loadtest -- --latency 200 --jitter 60 --stall 0.5   # 0.5 stalls a second
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const seconds = Number(args.get('seconds') ?? 30);
const port = Number(args.get('port') ?? 2593);
const counts = (args.get('players') ?? '2,8,16').split(',').map(Number);
const custom: NetConditions | null = args.has('latency') ? { latency: Number(args.get('latency')), jitter: Number(args.get('jitter') ?? 0), stall: Number(args.get('stall') ?? 0) } : null;

const PLANES: AircraftId[] = ['falcon', 'swift', 'falcon', 'widewing', 'falcon', 'dart', 'swift', 'falcon'];
const planeFor = (i: number) => PLANES[i % PLANES.length];
let serial = 0;

interface Result {
  players: number;
  sessions: number;
  network: string;
  tickAvg: number;
  tickMax: number;
  downKBps: number;
  upKBps: number;
  corrections: string;
  meanError: number;
  autoSteps: number;
  dropped: number;
  hits: number;
  kills: number;
  heapMB: number;
  reconnect: string;
}

async function runOnce(players: number, net: NetConditions, sessionCount = 1): Promise<Result> {
  const sdk = new Client(`ws://localhost:${port}`);
  // Several sessions: each holds its share, so quick join fills one and the spare takes the rest.
  setSessionDefaults(sessionCount > 1 ? { session: { capacity: Math.ceil(players / sessionCount) } } : {});
  const run = ++serial;
  const bots = Array.from({ length: players }, (_, i) => new Bot(sdk, `Load${run}x${i + 1}`, planeFor(i), net));
  for (const b of bots) await b.join();
  const rooms = [...new Set(bots.map((b) => b.room!.roomId))].map((id) => matchMaker.getLocalRoomById(id) as unknown as WorldRoom);
  // Let everyone claim, fold and take off, then measure.
  await sleep(8000);
  const flying = rooms.reduce((n, r) => n + [...r.world.pilots.values()].filter((p) => p.flying).length, 0);
  process.stdout.write(`(${flying}/${players} flying) `);
  for (const r of rooms) {
    r.world.perf.steps = 0;
    r.world.perf.totalMs = 0;
    r.world.perf.maxMs = 0;
  }
  const perf = { get steps() { return rooms.reduce((s, r) => s + r.world.perf.steps, 0); }, get totalMs() { return rooms.reduce((s, r) => s + r.world.perf.totalMs, 0); }, get maxMs() { return Math.max(...rooms.map((r) => r.world.perf.maxMs)); } };
  const start = bots.map((b) => ({ ...b.stats }));
  const startInputs = rooms.flatMap((r) => [...r.world.pilots.values()]).map((p) => ({ auto: p.inputs.autoSteps, dropped: p.inputs.dropped }));
  let reconnect = 'n/a';
  const half = sleep((seconds * 1000) / 2).then(async () => {
    const ok = await bots[bots.length - 1].dropAndResume().catch(() => false);
    reconnect = ok ? 'kept seat' : 'FAILED';
  });
  await sleep(seconds * 1000);
  await half;
  const heapMB = process.memoryUsage().heapUsed / 1e6;
  const sum = (f: (i: number) => number) => bots.reduce((s, _, i) => s + f(i), 0);
  const bytes = sum((i) => bots[i].stats.bytesIn - start[i].bytesIn);
  const frames = sum((i) => bots[i].stats.framesSent - start[i].framesSent);
  const reconciles = sum((i) => bots[i].stats.reconciles - start[i].reconciles);
  const corrections = sum((i) => bots[i].stats.corrections - start[i].corrections);
  const errorSum = sum((i) => bots[i].stats.sumError - start[i].sumError);
  const pilots = rooms.flatMap((r) => [...r.world.pilots.values()]);
  const result: Result = {
    players,
    sessions: rooms.length,
    network: net.latency === 0 ? 'local' : `${net.latency}±${net.jitter} ms${net.stall ? `, stall every ${(1 / net.stall).toFixed(0)} s` : ''}`,
    tickAvg: perf.totalMs / Math.max(1, perf.steps),
    tickMax: perf.maxMs,
    downKBps: bytes / seconds / players / 1024,
    // Each input message: frames × 4 numbers in msgpack (≈ 4–6 bytes each) plus framing.
    upKBps: (frames * 18 + frames / 3 * 8) / seconds / players / 1024,
    corrections: `${corrections}/${reconciles}`,
    meanError: reconciles > 0 ? errorSum / reconciles : 0,
    autoSteps: pilots.reduce((s, p, i) => s + p.inputs.autoSteps - (startInputs[i]?.auto ?? 0), 0),
    dropped: pilots.reduce((s, p, i) => s + p.inputs.dropped - (startInputs[i]?.dropped ?? 0), 0),
    hits: sum((i) => bots[i].stats.hitsDealt - start[i].hitsDealt),
    kills: sum((i) => bots[i].stats.kills - start[i].kills),
    heapMB,
    reconnect,
  };
  for (const b of bots) await b.leave();
  await sleep(1500);
  // The next run starts with no session left over.
  for (const r of rooms) await r.disconnect().catch(() => undefined);
  await sleep(500);
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (process.env.DATABASE_URL) {
  const store = await openStore(process.env.DATABASE_URL);
  setServices({ store, identity: new Identity(store, DEV_PEPPER, 'open') });
}
const storeKind = process.env.DATABASE_URL ? 'PostgreSQL' : 'memory';

const server = defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, routes: sessionRoutes(), transport: new WebSocketTransport(), greet: false });
await server.listen(port);
const local = { latency: 0, jitter: 0, stall: 0 };
const runs: Array<[number, NetConditions, number]> = custom
  ? counts.map((n) => [n, custom, 1])
  : [...counts.map((n): [number, NetConditions, number] => [n, local, 1]), [8, { latency: 120, jitter: 40, stall: 0.2 }, 1], [16, local, 2]];
const results: Result[] = [];
for (const [n, net, sessionCount] of runs) {
  process.stdout.write(`${n} players in ${sessionCount} session(s), ${net.latency} ms… `);
  const r = await runOnce(n, net, sessionCount);
  results.push(r);
  console.log('done');
}
console.log(`\nLoad test: ${seconds} s per run, server step ${(1000 / NET.tickRate).toFixed(1)} ms, patches every ${NET.patchMs} ms, bases saved every ${BASE_SAVE_EVERY} s (${storeKind}).\n`);
console.log('| Players | Sessions | Network | Server step avg / max (ms) | Down per player (KB/s) | Up per player (KB/s) | Corrections / reconciles | Mean correction (m) | Server auto-steps | Frames dropped | Hits | Kills | Heap (MB) | Drop + resume |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.players} | ${r.sessions} | ${r.network} | ${r.tickAvg.toFixed(3)} / ${r.tickMax.toFixed(1)} | ${r.downKBps.toFixed(1)} | ${r.upKBps.toFixed(1)} | ${r.corrections} | ${r.meanError.toFixed(3)} | ${r.autoSteps} | ${r.dropped} | ${r.hits} | ${r.kills} | ${r.heapMB.toFixed(0)} | ${r.reconnect} |`);
}
await server.gracefullyShutdown(false);
process.exit(0);

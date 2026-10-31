import { defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { AircraftId } from '../src/config';
import { NET, ROOM } from '../src/net/protocol';
import { Bot, type NetConditions } from './bots/Bot';
import { WorldRoom } from './WorldRoom';

/**
 * Multiplayer load test: an in-process server and headless bots that join, claim desks, fold
 * planes and dogfight using the same input frames and prediction as the browser. Runs 2, 4 and 8
 * players, then 8 on a poor network, and reports server step time, bandwidth per player,
 * prediction corrections, input stalls, memory and reconnection.
 *
 *   npm run loadtest                         # 2, 4, 8 players, then 8 at 120 ms ± 40 ms with a stall every 5 s
 *   npm run loadtest -- --players 8 --seconds 60
 *   npm run loadtest -- --latency 200 --jitter 60 --stall 0.5   # 0.5 stalls a second
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const seconds = Number(args.get('seconds') ?? 30);
const port = Number(args.get('port') ?? 2593);
const counts = (args.get('players') ?? '2,4,8').split(',').map(Number);
const custom: NetConditions | null = args.has('latency') ? { latency: Number(args.get('latency')), jitter: Number(args.get('jitter') ?? 0), stall: Number(args.get('stall') ?? 0) } : null;

const PLANES: AircraftId[] = ['falcon', 'swift', 'falcon', 'widewing', 'falcon', 'dart', 'swift', 'falcon'];

interface Result {
  players: number;
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

async function runOnce(players: number, net: NetConditions): Promise<Result> {
  const sdk = new Client(`ws://localhost:${port}`);
  const bots = PLANES.slice(0, players).map((plane, i) => new Bot(sdk, `Bot${i + 1}`, plane, net));
  for (const b of bots) await b.join();
  const roomId = bots[0].room!.roomId;
  const room = matchMaker.getLocalRoomById(roomId) as unknown as WorldRoom;
  // Let everyone claim, fold and take off, then measure.
  await sleep(6000);
  const perf = room.world.perf;
  perf.steps = 0;
  perf.totalMs = 0;
  perf.maxMs = 0;
  const start = bots.map((b) => ({ ...b.stats }));
  const startInputs = [...room.world.pilots.values()].map((p) => ({ auto: p.inputs.autoSteps, dropped: p.inputs.dropped }));
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
  const pilots = [...room.world.pilots.values()];
  const result: Result = {
    players,
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
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const server = defineServer({ rooms: { [ROOM]: defineRoom(WorldRoom) }, transport: new WebSocketTransport(), greet: false });
await server.listen(port);
const runs: Array<[number, NetConditions]> = custom
  ? counts.map((n) => [n, custom])
  : [...counts.map((n): [number, NetConditions] => [n, { latency: 0, jitter: 0, stall: 0 }]), [8, { latency: 120, jitter: 40, stall: 0.2 }]];
const results: Result[] = [];
for (const [n, net] of runs) {
  process.stdout.write(`${n} players, ${net.latency} ms… `);
  const r = await runOnce(n, net);
  results.push(r);
  console.log('done');
}
console.log(`\nLoad test: ${seconds} s per run, server step ${(1000 / NET.tickRate).toFixed(1)} ms, patches every ${NET.patchMs} ms.\n`);
console.log('| Players | Network | Server step avg / max (ms) | Down per player (KB/s) | Up per player (KB/s) | Corrections / reconciles | Mean correction (m) | Server auto-steps | Frames dropped | Hits | Kills | Heap (MB) | Drop + resume |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.players} | ${r.network} | ${r.tickAvg.toFixed(3)} / ${r.tickMax.toFixed(1)} | ${r.downKBps.toFixed(1)} | ${r.upKBps.toFixed(1)} | ${r.corrections} | ${r.meanError.toFixed(3)} | ${r.autoSteps} | ${r.dropped} | ${r.hits} | ${r.kills} | ${r.heapMB.toFixed(0)} | ${r.reconnect} |`);
}
await server.gracefullyShutdown(false);
process.exit(0);

import { Client } from '@colyseus/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AircraftId } from '../src/config';
import { Bot } from './bots/Bot';

/**
 * The load test against a deployed server (v0.0.14): bots join over the internet as players do,
 * fill sessions, fly and fight while bases are saved to the real database, and the server's own
 * numbers are read from its /admin/stats endpoint. Reports, for the README: server step time and
 * tick regularity, database writes per second and their latency, memory over the run, bandwidth
 * per player, and reconnection times (a dropped connection; a restart, if one happens meanwhile).
 *
 *   SERVER_URL=https://<server> ADMIN_KEY=… npm run loadtest:remote -- --invite <code> [options]
 *
 *   --players 16       bots per session (default 16, a full session)
 *   --sessions 2       sessions to fill (default 2)
 *   --seconds 120      how long to measure (default 120)
 *   --sample 30        seconds between samples of the server's numbers (default 30)
 *
 * The bots are players like any other: on an invite-only server make one code for all of them
 * (npm run admin -- invite create loadtest --uses 40 --days 1). Their device tokens are kept in
 * tools/out/loadtest-bots.json, so later runs come back as the same players instead of new ones.
 * For a multi-hour memory run: --seconds 10800 --sample 300. Restart the server from Railway
 * during a run to measure how long the bots take to come back.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const base = (args.get('server') ?? process.env.SERVER_URL ?? '').trim().replace(/\/+$/, '');
const key = (process.env.ADMIN_KEY ?? '').trim();
const perSession = Number(args.get('players') ?? 16);
const sessionCount = Number(args.get('sessions') ?? 2);
const seconds = Number(args.get('seconds') ?? 120);
const sampleEvery = Number(args.get('sample') ?? 30);
const invite = args.get('invite') ?? null;
if (!base) {
  console.error('Set SERVER_URL=https://<server address> (or --server).');
  process.exit(1);
}
const http = base.replace(/^ws/, 'http');
const ws = http.replace(/^http/, 'ws');

interface Stats {
  at: number;
  uptime: number;
  memory: { rssMB: number; heapMB: number };
  writes: { writes: number; totalMs: number; maxMs: number } | null;
  sessions: Array<{ id: string; players: number; steps?: number; stepMs?: number; stepMaxMs?: number; ticks?: number; tickGapS?: number; tickGapMaxS?: number }>;
}

async function stats(reset = false): Promise<Stats | null> {
  if (!key) return null;
  const r = await fetch(`${http}/admin/stats${reset ? '?reset=1' : ''}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`/admin/stats: ${r.status} ${await r.text()}`);
  return (await r.json()) as Stats;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- The bots, as the same players every run --------------------------------------------------
const saved = join(ROOT, 'tools/out/loadtest-bots.json');
const known: Record<string, Array<{ name: string; token: string }>> = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : {};
const mine = known[http] ?? [];
const PLANES: AircraftId[] = ['falcon', 'swift', 'falcon', 'widewing', 'falcon', 'dart', 'swift', 'falcon'];
const total = perSession * sessionCount;
const health = (await (await fetch(`${http}/health`)).json()) as { version: string; store: string };
console.log(`Server ${http}: version ${health.version}, store ${health.store}. ${total} bots in ${sessionCount} session(s), ${seconds} s.`);
if (!key) console.log('(No ADMIN_KEY: only what the bots measure is reported.)');

const sdk = new Client(ws);
const bots: Bot[] = [];
for (let i = 0; i < total; i++) {
  const known = mine[i];
  const bot = new Bot(sdk, known?.name ?? `Load_${Math.random().toString(36).slice(2, 8)}`, PLANES[i % PLANES.length]);
  bot.token = known?.token ?? null;
  bot.code = invite;
  try {
    await bot.join();
  } catch (error) {
    console.error(`${bot.name} couldn't join: ${(error as Error).message}${!bot.token && !invite ? ' (an invite-only server needs --invite <code>)' : ''}`);
    break;
  }
  bots.push(bot);
  if (bot.token) mine[i] = { name: bot.name, token: bot.token };
}
mkdirSync(dirname(saved), { recursive: true });
writeFileSync(saved, JSON.stringify({ ...known, [http]: mine }, null, 2));
const sessionsUsed = new Set(bots.map((b) => b.sessionId)).size;
console.log(`${bots.length} bots joined, in ${sessionsUsed} session(s). Letting them take off…`);
await sleep(10_000);

// ---- Measuring --------------------------------------------------------------------------------
const first = await stats(true);
const startBots = bots.map((b) => ({ ...b.stats }));
const samples: Array<{ t: number; rssMB: number; heapMB: number; players: number }> = [];
const dropTimes: number[] = [];
const started = performance.now();
let lastSample = started;
let dropNext = 0;
while (performance.now() - started < seconds * 1000) {
  await sleep(1000);
  const now = performance.now();
  // A dropped connection resumed now and then (as a player's Wi-Fi hiccup), timed.
  if (now - started > (dropTimes.length + 1) * Math.max(20, seconds / 4) * 1000 && bots.length > 0) {
    const bot = bots[dropNext++ % bots.length];
    const t0 = performance.now();
    const ok = await bot.dropAndResume().catch(() => false);
    dropTimes.push(ok ? performance.now() - t0 : -1);
  }
  if (now - lastSample >= sampleEvery * 1000) {
    lastSample = now;
    const s = await stats().catch(() => null);
    if (s) {
      samples.push({ t: Math.round((now - started) / 1000), rssMB: s.memory.rssMB, heapMB: s.memory.heapMB, players: s.sessions.reduce((n, x) => n + x.players, 0) });
      process.stdout.write(`  ${samples.at(-1)!.t} s: ${samples.at(-1)!.players} players, ${s.memory.rssMB} MB\n`);
    }
  }
}
const last = await stats();
const elapsed = (performance.now() - started) / 1000;

// ---- Report -----------------------------------------------------------------------------------
const sum = (f: (b: Bot, i: number) => number) => bots.reduce((n, b, i) => n + f(b, i), 0);
const bytes = sum((b, i) => b.stats.bytesIn - startBots[i].bytesIn);
const reconciles = sum((b, i) => b.stats.reconciles - startBots[i].reconciles);
const corrections = sum((b, i) => b.stats.corrections - startBots[i].corrections);
const comeBacks = bots.map((b) => b.lastComeBackMs).filter((x): x is number => x !== null);
const rows: Array<[string, string]> = [
  ['Server', `${http} (version ${health.version}, ${health.store})`],
  ['Bots / sessions', `${bots.length} in ${sessionsUsed}`],
  ['Measured', `${Math.round(elapsed)} s`],
  ['Down per player', `${(bytes / elapsed / Math.max(1, bots.length) / 1024).toFixed(1)} KB/s`],
  ['Prediction corrections', `${corrections} / ${reconciles}`],
  ['Dropped connection resumed', dropTimes.length ? dropTimes.map((t) => (t < 0 ? 'FAILED' : `${Math.round(t)} ms`)).join(', ') : 'n/a'],
  ['Back after a restart', comeBacks.length ? `${comeBacks.length} bots, median ${comeBacks.sort((a, b) => a - b)[Math.floor(comeBacks.length / 2)]} ms, slowest ${Math.max(...comeBacks)} ms` : 'no restart during the run'],
];
if (first && last) {
  for (const s of last.sessions) {
    const s0 = first.sessions.find((x) => x.id === s.id);
    if (s.steps === undefined || !s0 || s0.steps === undefined) continue;
    const steps = s.steps - s0.steps;
    const ticks = (s.ticks ?? 0) - (s0.ticks ?? 0);
    rows.push([`Session ${s.id} (${s.players} players)`, `step ${((s.stepMs! - s0.stepMs!) / Math.max(1, steps)).toFixed(2)} ms avg, ${s.stepMaxMs!.toFixed(1)} ms max; tick every ${(((s.tickGapS! - s0.tickGapS!) / Math.max(1, ticks)) * 1000).toFixed(1)} ms avg, ${(s.tickGapMaxS! * 1000).toFixed(0)} ms longest gap`]);
  }
  if (first.writes && last.writes) {
    const n = last.writes.writes - first.writes.writes;
    rows.push(['Database writes', `${(n / elapsed).toFixed(1)} a second, ${((last.writes.totalMs - first.writes.totalMs) / Math.max(1, n)).toFixed(1)} ms avg, ${last.writes.maxMs.toFixed(0)} ms max`]);
  }
  rows.push(['Server memory', `${first.memory.rssMB} MB at the start, ${last.memory.rssMB} MB at the end${samples.length ? ` (peak ${Math.max(...samples.map((s) => s.rssMB))} MB)` : ''}`]);
}
console.log('\n| Measure | Result |\n|---|---|');
for (const [k, v] of rows) console.log(`| ${k} | ${v} |`);
if (samples.length > 2) console.log(`\nMemory samples (s: MB): ${samples.map((s) => `${s.t}: ${s.rssMB}`).join(', ')}`);
for (const b of bots) await b.leave();
process.exit(0);

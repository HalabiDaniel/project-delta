/**
 * v0.0.18: the long-run economy simulator from the command line (src/sim/LongRun.ts).
 *
 *   npm run sim -- --days 7 --seed 1 --players steady,steady,aggressive,newcomer,idle,exploiter,exploiter,farmer,farmer
 *   npm run sim -- --json report.json --csv report.csv
 *
 * Prints a summary and the flags (runaway leader, dead end, exploit beats play); exits with code 1
 * when a flag is raised and --strict is given (CI).
 */
import { writeFileSync } from 'node:fs';
import type { MissionContext } from '../src/missions/MissionGenerator';
import { sharedWorld } from '../src/net/World';
import { LONG_RUN_NOTE, LONG_RUN_PROFILES, longRunCsv, simulateLongRun, type LongRunProfile } from '../src/sim/LongRun';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const players = opt('players', 'steady,steady,aggressive,newcomer,idle,exploiter,exploiter,farmer,farmer').split(',').map((p) => p.trim()) as LongRunProfile[];
for (const p of players) if (!LONG_RUN_PROFILES.includes(p)) throw new Error(`Unknown profile "${p}": use ${LONG_RUN_PROFILES.join(', ')}`);
const days = Number(opt('days', '7'));
const seed = Number(opt('seed', '1'));

// The multiplayer classroom (as the server builds it, without anything that draws).
const world = sharedWorld();
const territories = world.territories;
const home = territories.find((t) => t.id === 'T1')!;
const ctx: MissionContext = { territories, homeId: home.id, launch: { x: home.x + 8, z: home.z + 8 }, dummies: [], obstacles: [], installations: world.layout.installations };
const homes = territories.filter((t) => t.id !== home.id).slice(0, players.length);

const started = Date.now();
const report = simulateLongRun({ players, days, seed, ctx, homes });
console.log(`paperwars long-run simulation: ${players.length} players, ${days} days, seed ${seed} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
console.log(LONG_RUN_NOTE);
console.log('');
console.log('player          sorties  wins  raids±   paper    ink  rubber   worth  merit  rank  gain/h merit/h  recovery(s)');
for (const p of report.players) {
  const d = p.days[p.days.length - 1];
  const rec = p.recoveries.filter((r): r is number => r !== null);
  const median = rec.length ? rec.sort((a, b) => a - b)[Math.floor(rec.length / 2)] : '-';
  console.log(
    `${p.id.padEnd(15)} ${String(p.sorties).padStart(7)} ${String(p.successes).padStart(5)}  ${`${p.raidsMade}/${p.raidsSuffered}`.padStart(6)} ${String(d.paper).padStart(7)} ${String(d.ink).padStart(6)} ${String(d.rubber).padStart(7)} ${String(d.worth).padStart(7)} ${String(d.merit).padStart(6)} ${String(d.rankIndex).padStart(5)} ${String(p.gainPerHour).padStart(7)} ${String(p.meritPerHour).padStart(7)}  ${median}${p.recoveries.includes(null) ? ' (some never)' : ''}`,
  );
}
console.log('');
console.log('Designs flown (share of sorties, win rate):');
for (const [id, u] of Object.entries(report.planes).sort((a, b) => b[1]!.flown - a[1]!.flown)) console.log(`  ${id.padEnd(10)} ${(u!.share * 100).toFixed(1).padStart(5)}%  ${(u!.winRate * 100).toFixed(0).padStart(3)}%`);
console.log('');
console.log(`Leader ÷ median: ${report.leaderGap}`);
console.log(`Flags: runaway leader ${report.flags.runawayLeader ? 'YES' : 'no'} · dead end ${report.flags.deadEnd ? 'YES' : 'no'} · exploit beats play ${report.flags.exploitBeatsPlay ? 'YES' : 'no'}`);
for (const n of report.flags.notes) console.log(`  - ${n}`);
// v0.0.19: what the anti-farming rules did.
console.log(`Anti-farming: ${report.farming.flags.length} pair flag(s), ${report.farming.withheld} paper held back`);
for (const f of report.farming.flags.slice(0, 10)) console.log(`  - ${f.a} / ${f.b}: ${f.reason} (day ${Math.floor(f.at / 86400) + 1})`);
const json = opt('json', '');
if (json) writeFileSync(json, JSON.stringify(report, null, 2));
const csv = opt('csv', '');
if (csv) writeFileSync(csv, longRunCsv(report));
if (args.includes('--strict') && (report.flags.runawayLeader || report.flags.deadEnd || report.flags.exploitBeatsPlay)) process.exit(1);

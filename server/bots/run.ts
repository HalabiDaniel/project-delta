import { Client } from '@colyseus/sdk';
import type { AircraftId } from '../../src/config';
import { Bot } from './Bot';

/**
 * Fills a running session with bot players, for trying multiplayer alone:
 *
 *   npm run server
 *   npm run bots -- --count 3              # three bots join the open classroom and dogfight
 *   npm run bots -- --count 2 --seconds 120 --server ws://localhost:2567
 *   npm run bots -- --count 1 --raid 1     # one bot raids other players' bases (start the server
 *                                          # with PROTECTION=20 so your new base can be raided soon)
 *
 * Bots claim free desks, fold fighters, hunt the nearest plane and fire when lined up. They leave
 * (freeing their desks) when the time is up or on Ctrl+C.
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const count = Number(args.get('count') ?? 2);
const seconds = Number(args.get('seconds') ?? 300);
const endpoint = args.get('server') ?? 'ws://localhost:2567';
const raiders = Number(args.get('raid') ?? 0);
const planes: AircraftId[] = ['falcon', 'swift', 'falcon', 'widewing', 'dart', 'falcon', 'swift'];

const sdk = new Client(endpoint);
const bots: Bot[] = [];
for (let i = 0; i < count; i++) {
  const raider = i < raiders;
  const bot = new Bot(sdk, `Bot ${String.fromCharCode(65 + i)}`, raider ? 'widewing' : planes[i % planes.length], undefined, raider ? 'raider' : 'hunter');
  await bot.join();
  bots.push(bot);
  console.log(`${bot.name} joined (${bot.role}, ${bot.aircraft})`);
}

const stop = async () => {
  for (const b of bots) await b.leave();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
setTimeout(() => void stop(), seconds * 1000);

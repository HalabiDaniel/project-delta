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
 *
 *   npm run bots -- --count 8 --churn 20   # every 20 s on average a random bot leaves, and joins again a few seconds later
 *   npm run bots -- --count 2 --server wss://<server> --invite K7Q2M-9XRTA   # a server with ACCESS=invite
 *                                          # (make a code with --uses for every bot: invite create bots --uses 8)
 *   npm run bots -- --count 2 --rejoin 60  # every 60 s one bot leaves and joins again, and checks
 *                                          # its base came back as it left it (v0.0.12)
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
  // Usernames are unique across the game (and kept in the database): each run's bots get their own.
  const bot = new Bot(sdk, `Bot${String.fromCharCode(65 + i)}_${Math.floor(Math.random() * 1e4)}`, raider ? 'widewing' : planes[i % planes.length], undefined, raider ? 'raider' : 'hunter');
  bot.code = args.get('invite') ?? null;
  await bot.join();
  bots.push(bot);
  console.log(`${bot.name} joined (${bot.role}, ${bot.aircraft})`);
}

const rejoin = Number(args.get('rejoin') ?? 0);
if (rejoin > 0) {
  let next = 0;
  setInterval(() => {
    const bot = bots[next++ % bots.length];
    void bot.leaveAndRejoin().then((ok) => console.log(`${bot.username ?? bot.name} left and joined again: ${ok ? 'same base' : 'BASE CHANGED OR LOST'}`));
  }, rejoin * 1000);
}

// Players come and go during a session (v0.0.13): a random bot leaves and comes back a little later.
const churn = Number(args.get('churn') ?? 0);
if (churn > 0) {
  const tick = () => {
    setTimeout(() => {
      const bot = bots[Math.floor(Math.random() * bots.length)];
      void bot.leaveAndRejoin().then((ok) => console.log(`${bot.username ?? bot.name} came and went: ${ok ? 'same base' : 'BASE CHANGED OR LOST'}`));
      tick();
    }, churn * 1000 * (0.5 + Math.random()));
  };
  tick();
}
for (const b of bots) b.onBack = (bot) => console.log(`${bot.username ?? bot.name} is back in session ${bot.sessionId} after a restart or a session's end`);

const stop = async () => {
  for (const b of bots) await b.leave();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
setTimeout(() => void stop(), seconds * 1000);

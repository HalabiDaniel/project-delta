import { ConfigError, serverConfig } from './config';
import { Identity } from './identity/Identity';
import { openStore } from './store/open';
import { exportFeedback } from './feedbackExport';
import type { PlayerRecord, Store } from './store/Store';

/**
 * The developer's tool for the private alpha. It talks to the database directly (DATABASE_URL and
 * TOKEN_PEPPER must be the server's), so it works whether the server is running or not.
 *
 *   npm run admin -- invite create [label] [--uses N] [--days N]
 *   npm run admin -- invite list
 *   npm run admin -- invite revoke <invite id>
 *   npm run admin -- player list
 *   npm run admin -- player show <id | public id | name>
 *   npm run admin -- player revoke <player>          # nobody can join as them
 *   npm run admin -- player restore <player>
 *   npm run admin -- player logout <player>          # every device token stops working
 *   npm run admin -- player reissue <player>         # a code (valid 7 days) that gives them a new pass
 *   npm run admin -- base show <player>             # their saved base and where it stands
 *   npm run admin -- base release <player>          # a base stuck on a desk (its saved state stays)
 *   npm run admin -- world list
 *   npm run admin -- feedback export [--format csv|md] [--days N]   # the playtest feedback log (v0.0.14)
 *
 * What only the running server can do goes through its protected /admin endpoint (v0.0.14,
 * server/adminRoutes.ts). These need SERVER_URL (the server's https:// address) and ADMIN_KEY
 * instead of the database:
 *
 *   npm run admin -- live sessions                              # sessions, players and their ping
 *   npm run admin -- live kick <player> [--minutes N] [reason]  # remove a player now
 *   npm run admin -- live end <session> [--seconds N] [reason]  # end a session, with notice
 *   npm run admin -- live desk <session> <desk>                 # free a desk stuck in the wrong state
 */

const USAGE = `Usage: npm run admin -- <command>

  invite create [label] [--uses N] [--days N]   New invite code (default: 1 use, 14 days)
  invite list                                   Every invite and how often it was used
  invite revoke <invite id>
  player list                                   Every player
  player show <player>                          One player (id, public id or exact name)
  player revoke <player>                        Refuse the player on every device
  player restore <player>                       Undo revoke
  player logout <player>                        Revoke every device token (they need a reissue code)
  player reissue <player>                       A one-time code (7 days) to get a new pass
  base show <player>                            The player's saved base and where it stands
  base release <player>                         Free a base stuck on a desk (it keeps its saved state)
  world list                                    Every world and its save format
  feedback export [--format csv|md] [--days N]  The playtest feedback log (default: Markdown, all of it)

On the running server (needs SERVER_URL=https://<server address> and ADMIN_KEY):

  live sessions                                 Sessions, their players, ping and held desks
  live kick <player> [--minutes N] [reason]     Remove a player now (they can't rejoin for N minutes, default 10)
  live end <session> [--seconds N] [reason]     End a session N seconds from now (default 60), with notice
  live desk <session> <desk>                    Free a desk stuck in the wrong state`;

/** `live …`: the running server's /admin endpoint. */
async function live(args: string[]): Promise<number> {
  const base = (process.env.SERVER_URL ?? '').trim().replace(/^ws/, 'http').replace(/\/+$/, '');
  const key = (process.env.ADMIN_KEY ?? '').trim();
  if (!base || !key) {
    console.error('Set SERVER_URL (the server\'s https:// address) and ADMIN_KEY first.');
    return 1;
  }
  const [command, ...rest] = args;
  const call = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(`${base}/admin/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(json.error ?? `the server answered ${response.status}`));
    return json;
  };
  switch (command) {
    case 'sessions': {
      const { sessions } = (await call('sessions')) as { sessions: Array<{ id: string; title: string; status: string; players: number; capacity: number; left: number; people: Array<{ id: string; name: string; desk: string | null; connected: boolean; leaving: boolean; ping: number }>; held: Array<{ desk: string; for: string; why: string }> }> };
      if (sessions.length === 0) console.log('No sessions running.');
      for (const s of sessions) {
        console.log(`${s.id}  ${s.title}  ${s.status}  ${s.players}/${s.capacity} players  ${Math.floor(s.left / 60)} min left`);
        for (const p of s.people) console.log(`    ${p.id.padEnd(10)} ${p.name.padEnd(20)} ${(p.desk ?? '-').padEnd(5)} ${p.connected ? `${p.ping} ms` : p.leaving ? 'left (raid in progress)' : 'away'}`);
        for (const h of s.held) console.log(`    desk ${h.desk} held for ${h.for} (${h.why})`);
      }
      return 0;
    }
    case 'kick': {
      const minutes = flag(rest, '--minutes');
      const [player, ...reason] = rest;
      const r = await call('kick', { player, minutes: minutes ?? undefined, reason: reason.join(' ') || undefined });
      console.log(`Removed ${r.player} from ${r.session}; they can join again in ${r.minutes} minute(s).`);
      return 0;
    }
    case 'end': {
      const seconds = flag(rest, '--seconds');
      const [session, ...reason] = rest;
      const r = await call('end', { session, seconds: seconds ?? undefined, reason: reason.join(' ') || undefined });
      console.log(Number(r.endsIn) > 0 ? `${session} ends in ${r.endsIn} s; everyone was told.` : `${session} has ended.`);
      return 0;
    }
    case 'desk': {
      const [session, desk] = rest;
      const r = await call('desk', { session, desk });
      console.log(`${desk}: ${r.what}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return 1;
  }
}

function flag(args: string[], name: string): number | null {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = Number(args[i + 1]);
  args.splice(i, 2);
  if (!Number.isFinite(value)) throw new Error(`${name} needs a number`);
  return value;
}

async function onePlayer(store: Store, query: string | undefined): Promise<PlayerRecord> {
  if (!query) throw new Error('which player? (id, public id or exact name)');
  const found = await store.findPlayers(query);
  if (found.length === 0) throw new Error(`no player matches "${query}"`);
  if (found.length > 1) throw new Error(`"${query}" matches ${found.length} players: use the id\n${found.map(describe).join('\n')}`);
  return found[0];
}

function describe(p: PlayerRecord): string {
  return `${p.id}  ${p.publicId.padEnd(10)} ${(p.username ?? `(${p.name})`).padEnd(20)} ${p.revoked ? 'REVOKED ' : ''}last seen ${p.lastSeenAt.toISOString()}`;
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'live') return live(argv.slice(1));
  const config = serverConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set: the admin tool only works with the PostgreSQL store.');
    return 1;
  }
  const store = await openStore(config.databaseUrl, () => undefined);
  const identity = new Identity(store, config.pepper, config.access);
  const args = [...argv];
  const [area, command, ...rest] = args;
  try {
    switch (`${area} ${command}`) {
      case 'invite create': {
        const uses = flag(rest, '--uses') ?? 1;
        const days = flag(rest, '--days');
        const { code, invite } = await identity.createInvite(rest.join(' '), uses, days ?? undefined);
        console.log(`Invite ${invite.id}${invite.label ? ` (${invite.label})` : ''}: ${invite.maxUses} use(s), expires ${invite.expiresAt?.toISOString() ?? 'never'}`);
        console.log(`\n  Code: ${code}\n`);
        console.log('Share the code (or an invite link: https://<your game address>/?invite=' + code + '). It is shown only now.');
        return 0;
      }
      case 'invite list': {
        for (const i of await store.listInvites()) {
          const state = i.revoked ? 'revoked' : i.expiresAt && i.expiresAt.getTime() < Date.now() ? 'expired' : i.uses >= i.maxUses ? 'used up' : 'open';
          console.log(`${i.id}  ${String(i.uses).padStart(2)}/${i.maxUses} ${state.padEnd(8)} ${i.label}`);
        }
        return 0;
      }
      case 'invite revoke':
        console.log((await store.revokeInvite(rest[0] ?? '')) ? 'Revoked.' : 'No such invite.');
        return 0;
      case 'player list':
        for (const p of await store.listPlayers()) console.log(describe(p));
        return 0;
      case 'player show':
        console.log(describe(await onePlayer(store, rest.join(' '))));
        return 0;
      case 'player revoke':
      case 'player restore': {
        const p = await onePlayer(store, rest.join(' '));
        await store.setRevoked(p.id, command === 'revoke');
        console.log(`${p.name} (${p.publicId}) ${command === 'revoke' ? 'can no longer join' : 'can join again'}.`);
        return 0;
      }
      case 'player logout': {
        const p = await onePlayer(store, rest.join(' '));
        const n = await store.revokeTokens(p.id);
        console.log(`${n} device token(s) of ${p.name} revoked. Give them a code from "player reissue" to come back.`);
        return 0;
      }
      case 'player reissue': {
        const p = await onePlayer(store, rest.join(' '));
        const { code, expiresAt } = await identity.transferCode(p.id, 'admin');
        console.log(`Code for ${p.name} (${p.publicId}), valid once until ${expiresAt.toISOString()}:\n\n  ${code}\n`);
        console.log('They enter it in the multiplayer lobby\'s Code field; their territory and progress stay theirs.');
        return 0;
      }
      case 'base show': {
        const p = await onePlayer(store, rest.join(' '));
        const b = await store.base(p.id);
        if (!b) {
          console.log(`${p.name} (${p.publicId}) has no base yet.`);
          return 0;
        }
        const where = b.placement ? `on ${b.placement.territoryId}, held by ${b.placement.holder} until ${b.placement.leaseUntil.toISOString()}` : 'packed (not on any desk)';
        console.log(`${p.name} (${p.publicId}): ${where}; last saved ${b.updatedAt.toISOString()}`);
        if (!b.state) {
          console.log('  Never saved: they start with the starting base.');
          return 0;
        }
        console.log(`  Paper store: ${b.state.storeHealth} health`);
        for (const x of b.state.buildings) console.log(`  ${x.slot.padEnd(4)} ${x.kind.padEnd(9)} level ${x.level}  ${x.health} health`);
        return 0;
      }
      case 'base release': {
        const p = await onePlayer(store, rest.join(' '));
        console.log((await store.releaseBase(p.id)) ? `${p.name}'s base is off its desk; it goes on a free desk next time they join.` : `${p.name}'s base isn't on a desk.`);
        return 0;
      }
      case 'feedback export': {
        const format = (rest.includes('--format') ? rest[rest.indexOf('--format') + 1] : 'md') ?? 'md';
        if (format !== 'csv' && format !== 'md') throw new Error('--format is csv or md');
        const days = flag(rest.filter((a) => a !== '--format' && a !== format), '--days');
        const since = days !== null ? new Date(Date.now() - days * 86_400_000) : undefined;
        process.stdout.write(exportFeedback(await store.feedback(since), format));
        return 0;
      }
      case 'world list':
        for (const w of await store.listWorlds()) console.log(`${w.id}  format ${w.format}  ${w.name}  created ${w.createdAt.toISOString()}`);
        return 0;
      default:
        console.log(USAGE);
        return area ? 1 : 0;
    }
  } finally {
    await store.close();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof ConfigError ? `[config] ${error.message}` : `Error: ${(error as Error).message}`);
  process.exitCode = 1;
}

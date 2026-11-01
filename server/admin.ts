import { ConfigError, serverConfig } from './config';
import { Identity } from './identity/Identity';
import { openStore } from './store/open';
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
 *   npm run admin -- world list
 *
 * Kicking connected players, freeing territories and the protected admin endpoint come with the
 * deployment phase of v0.0.10.
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
  world list                                    Every world and its save format`;

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
  return `${p.id}  ${p.publicId.padEnd(10)} ${p.name.padEnd(20)} ${p.revoked ? 'REVOKED ' : ''}last seen ${p.lastSeenAt.toISOString()}`;
}

async function main(argv: string[]): Promise<number> {
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
        console.log('Share the code (or an invite link: https://<your game address>/?mp&invite=' + code + '). It is shown only now.');
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

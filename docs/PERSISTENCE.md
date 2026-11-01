# paperwars.io persistence (v0.0.10)

How the multiplayer world stops forgetting: player identity, the PostgreSQL store, and (in later
phases) persistent territories, economy, aircraft, recovery and the private alpha. The plan this
implements is [docs/roadmap/v0.0.10.md](roadmap/v0.0.10.md).

> **Status: developer checkpoint 1 of 3** (after phases 1 to 3). Players now have a stable,
> secure identity backed by PostgreSQL, and the database schema, migrations and data-access layer
> are in place. The world itself (territories, paper, aircraft, missions) is still kept in memory:
> persisting it is phases 4 to 6, after this review.

| Phase | Focus | Status |
|---|---|---|
| 1 | Audit v0.0.9: everything kept only in memory, a regression baseline | Done ([below](#phase-1-the-audit)) |
| 2 | Player identity: tokens, `onAuth`, player ids in `ServerWorld`, duplicate connections | Done ([below](#phase-2-player-identity)) |
| 3 | Database: schema, migrations, data-access layer, local and test databases | Done ([below](#phase-3-the-database)) |
| | **Checkpoint 1**: developer review | **Now** |
| 4 | Persist territories, buildings, balances and the transaction log with idempotency | Next |
| 5 | Persist aircraft, missions, progression and fairness state; interrupted-sortie rules | |
| 6 | World lifecycle, periodic saving, graceful shutdown, startup restoration, crash recovery | Checkpoint 2 |
| 7 | Offline protection, reconnect grace, hardening, rate limits, error messages | |
| 8 | Deployment, invite access, admin tool, backups, feedback log | Checkpoint 3 |
| 9 | Automated tests, bots with disconnects and restarts, load test with persistence | |
| 10 | Developer-and-friend acceptance sequence and release-blocking fixes | |

## Running it

Without a database, nothing changes from v0.0.9 (`npm run server`): players get a device token,
but everything lives in memory and the server says so at start-up. With PostgreSQL:

```bash
docker compose up -d                 # PostgreSQL 16 on localhost:5432 (dev and test databases)
```

```bash
cp .env.example .env                 # then fill in TOKEN_PEPPER
```

```bash
set -a; . ./.env; set +a; npm run server
```

The server applies any pending migrations on start (`npm run db:migrate` does it by hand). Without
Docker, any PostgreSQL 15+ works: create a `paperwars` user and the `paperwars` and
`paperwars_test` databases, and point `DATABASE_URL` and `TEST_DATABASE_URL` at them.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL. Unset: the in-memory store (development only). Required in production. |
| `TOKEN_PEPPER` | Secret mixed into every stored token and code hash (16+ characters). Required in production; a development default otherwise. Changing it logs everyone out. |
| `ACCESS` | `invite` (a first join needs an invite code) or `open`. Default: `invite` with `NODE_ENV=production`, `open` otherwise. |
| `PORT`, `LATENCY`, `PROTECTION` | As in v0.0.9. |
| `TEST_DATABASE_URL` | The database the PostgreSQL tests use. Unset: those tests are skipped. |

Inviting someone and looking after players (the tool talks to the database directly, with the
server's `DATABASE_URL` and `TOKEN_PEPPER`):

```bash
npm run admin -- invite create "for Sam"      # prints a code like K7Q2M-9XRTA, shown only once
```

```bash
npm run admin -- player list
```

```bash
npm run admin -- player reissue Sam           # a lost browser: a one-time code, valid for 7 days
```

`npm run admin` with no arguments lists every command (invites: create, list, revoke; players:
list, show, revoke, restore, logout, reissue; worlds: list).

The invite goes in the lobby's new **Code** field, or as a link: `…/?mp&invite=K7Q2M-9XRTA`.

## Phase 1: the audit

### What v0.0.9 keeps only in memory

Everything below is lost when the server stops, and most of it when a player leaves: v0.0.9's
`ServerWorld.remove` takes the base down and frees the territory. "Phase" is where v0.0.10
persists it.

| State | Where it lives in v0.0.9 | Notes for persisting it | Phase |
|---|---|---|---|
| Who a player is | The Colyseus `sessionId` (`Pilot.id`), which also names their side (`p:<id>`) and plane (`pl:<id>`) | Replaced by a stable public id: **done** | 2 |
| Display name | `localStorage` in the browser, cleaned by `cleanName` | Now a label on the player row: **done** | 2 |
| Territory ownership | `ServerWorld.owners` (territory → player) | `territories` table | 4 |
| Buildings, levels, health, the paper store's health | Each player's `Base` (`src/base/Base.ts`) | `Base` already has a save format (`BaseSave`, used by single-player) | 4 |
| Base statistics | `Base.stats` | Part of `BaseSave` | 4 |
| Paper, capacity, protected reserve | `ResourceManager`, `HomeIncome` per player | `balances` + `transactions` (idempotent ledger ready) | 4 |
| Production timestamp | Implicit: income ticks with the world clock | `balances.produced_at`, for offline production | 4 |
| Aircraft: hangar, selection, condition, health | `GameState.hangar`, `GameState.aircraft`, `durability` | `aircraft` table | 5 |
| The current sortie | `GameState` phase, `Mission`, `PilotFlight` | Not persisted: the interrupted-sortie rules decide what a restart leaves | 5 |
| Mission board, swaps, history, adaptive difficulty | `MissionDirector` | `MissionDirector` already exports `DirectorState`; `missions` and `progress.director` | 5 |
| Player statistics (kills, deaths, raids, ...) | `Pilot.stats` | `progress.stats` | 5 |
| New-player protection, raid shield | `Pilot.protectUntil`, `shieldUntil`, as **world times** (seconds since the room started) | Must become wall-clock times (`territories.protect_until`, `shield_until`), or a restart resets them | 5 |
| Raid history (pair cooldown, repeat rule) | `AttackBook.history` | `pvp_records` (kind `raid`) | 5 |
| Kill history (kill-farming window) | `KillBook.kills` | `pvp_records` (kind `kill`) | 5 |
| Aggression (who hurt whom lately) | `Pilot.aggression` | Short-lived (`PVP.aggression`); can reset on restart | not persisted |
| Raids in progress, rounds, bombs, AI aircraft | `AttackBook.active`, `PlayerGuns`, `FallingBombs`, `AirTraffic` | Transient; a restart ends them under the interrupted-sortie rules | 6 |
| Wrecked AI installations | `ServerWorld.aiWrecks` | Regenerated rather than persisted (allowed by the plan) | 6 |
| Tutorial and first-time tips | Single-player only (local save) | `progress.tutorial` | 5 |
| Rooms and the world | One Colyseus room per classroom, created on demand, disposed when empty | One persistent world restored from the database | 6 |

### Other findings

- **Room options are trusted.** Colyseus merges the options a client sends when it creates a room
  with the server's, so a client can create a classroom with its own `seed`, `ambient` or
  `newPlayerProtection`. Harmless for a private alpha with one world, but it goes with the
  hardening in phase 7 (the persistent world in phase 6 is created by the server, not by clients).
  For the same reason, the new store and identity service are not passed as room options
  (`server/services.ts`).
- **The welcome message could be missed.** v0.0.9 sent `welcome` during `onJoin`, which reaches
  the browser before it can listen; the client fell back on the session id, which happened to be
  the same. Now the client says `hello` once it listens, and the server answers with the welcome
  (and the full private state).
- **Leaving destroys the base.** Correct for v0.0.9's sessions, wrong for a persistent world; it
  changes with phase 4 (a leaving player's territory stays theirs, protected while offline).
- **Wall-clock versus world time.** Every timer in `ServerWorld` and `Pilot` is world time. Those
  that must survive a restart (protections, shields, cooldowns, farming windows, production) are
  stored as wall-clock times and converted when the world is restored.

### Regression baseline

Taken before any change, on this branch's starting point (v0.0.9 merged):

- `npm test`: 27 files, **370 tests, all passing** (35 of them multiplayer).
- `npm run typecheck`: clean.
- `npm run loadtest` (v0.0.9's figures in [MULTIPLAYER.md](MULTIPLAYER.md#measurements)): 8
  players at 0.43 ms per step, 13.3 KB/s down per player.

After phases 1 to 3: every one of the 370 still passes, plus the new ones below.

## Phase 2: player identity

**Who a player is comes only from what the server can check.** A browser presents a device token
(or a code); the server hashes it and looks it up. Nothing the client says about itself (a player
id, a name) decides who it is.

| | |
|---|---|
| Player id | A UUID, issued by the server. Owns everything in the database. Never sent to other players. |
| Public id | Eight characters (`y33rhhnj`), issued with the player, stable for good. What other players' clients know them by: schema keys, territory owners, kill feed, sides (`p:<id>`) and planes (`pl:<id>`). Short, because it is in many events every second. |
| Display name | A label, changed by joining with another name. Never decides ownership. |
| Session id | One connection. `ServerWorld` and its pilots no longer see it: the room maps sessions to public ids. |
| Device token | 32 random bytes (256 bits), base64url, given to the browser on its first join and kept in `localStorage` (per server). Stored only as HMAC-SHA256 with `TOKEN_PEPPER`. |
| Invite code | `K7Q2M-9XRTA` (50 bits, no look-alike characters; typing `o`, `i` or `l` works too). Needed for a first join with `ACCESS=invite`. Single-use by default, expires after 14 days, revocable. Stored hashed. |
| Transfer code | Same shape. From the pause menu ("Another computer", valid 15 minutes) or from the developer (`player reissue`, valid 7 days). Single-use; adds a new device token to the player. Stored hashed. |

**Joining** (`server/identity/Identity.ts`, called from `WorldRoom.onAuth`):

1. A typed code wins: a transfer code moves this browser to the code's player (even if the browser
   was someone else before); else an invite makes a new player.
2. Else a known, unrevoked token is its player (their name is updated if it changed).
3. Else, with `ACCESS=open`, a new player is made; with `ACCESS=invite` the join is refused.

Every new player or new device gets a fresh token in the welcome message, which the browser keeps.

**Refusals** are shown in the lobby as they are: "This alpha is invite-only. Enter your invite code
to join.", "That code didn't work: it may be mistyped, already used or expired.", "Access for this
player has been withdrawn. Ask the developer.", "This browser's pass isn't recognised any more.
Enter an invite or transfer code.", "The server can't check your pass right now. Try again in a
moment." (the database is down: no details leak), "This classroom is full (8 players)."

**One connection per player.** If the same player connects again (another tab, a refresh that beat
the old connection's timeout, or a join in another classroom on the same server), the newer
connection takes over: the older one is closed with code 4011 and "Opened in another tab" (or "You
joined another classroom"), or its wait for a reconnection is cancelled. The player keeps their
seat, territory and plane in the room. The eight-player cap counts players, not connections, so a
returning player is never turned away from their own seat in a full room.

**Revocation.** `npm run admin -- player revoke <player>` refuses a player on every device;
`player logout` revokes every device token (they come back with a `player reissue` code). Kicking
a player who is connected right now comes with the admin endpoint in phase 8.

## Phase 3: the database

PostgreSQL 15+ (tested on 16), through `pg` with a small typed layer in `server/db/` and
`server/store/`.

| Where | What |
|---|---|
| `server/config.ts` | Settings from the environment, strict in production |
| `server/db/Database.ts` | The pool: connection and statement timeouts, parameterised queries only, transactions retried on serialization failures and deadlocks, idle-connection errors logged instead of crashing, reconnection by the pool |
| `server/db/migrate.ts`, `server/db/migrations/` | Versioned SQL migrations, applied in order on start under an advisory lock, each in its own transaction, recorded with a checksum in `schema_migrations` |
| `server/store/Store.ts` | The contract the game server uses (players, devices, invites, transfer codes, worlds, the ledger) |
| `server/store/PgStore.ts` | The contract in PostgreSQL |
| `server/store/MemoryStore.ts` | The same contract in memory, for development without a database and fast tests |
| `server/identity/` | Tokens, codes, hashing, and the identity service |
| `server/admin.ts` | The developer's command-line tool |
| `server/db/testdb.ts` | A throw-away schema per test file in `TEST_DATABASE_URL` |

### Schema

`server/db/migrations/0001_initial.sql` creates every table the plan lists, so the next phases add
behaviour rather than tables:

| Table | Contents | Used from |
|---|---|---|
| `players` | Player id, public id, display name, created and last-seen times, revoked time | Phase 2 |
| `player_tokens` | Token hash, player, origin (open, invite, transfer), invite used, last use, revoked time | Phase 2 |
| `invites` | Code hash, label, uses and maximum, expiry, revoked time | Phase 2 |
| `transfer_codes` | Code hash, player, made by (player or admin), expiry, used time | Phase 2 |
| `worlds` | World id, name, save format, settings | Phase 3 |
| `balances` | Paper, capacity, protected reserve, production timestamp; per player and world; never negative | Phase 3 (ledger), 4 |
| `transactions` | Idempotency key (unique per world), player, kind, amount, balance after, reason, reference | Phase 3 (ledger), 4 |
| `territories` | Owner, claimed time, protection and shield as wall-clock times; one territory per player per world | Phase 4 |
| `buildings` | Slot, kind, level, health, other per-building data | Phase 4 |
| `aircraft` | Type, status (ready, airborne, damaged, in repair, destroyed), health, loadout, empty customisation for v0.0.18; a trigger makes destroyed final | Phase 5 |
| `missions` | Template, state, card as generated, offered and resolved times, outcome, reward | Phase 5 |
| `progress` | Tutorial flags, statistics, unlocks, the mission director's state | Phase 5 |
| `pvp_records` | Raids and kills, for cooldowns, the repeat rule and kill-farming windows | Phase 5 |
| `feedback` | Category, text, reproduction steps, rating, context | Phase 8 |
| `schema_migrations` | Applied migrations and their checksums | Phase 3 |

### Versioning

- **Migrations** are numbered `0001_…`, `0002_…` without gaps and never edited once applied (the
  checksum catches it). A database with a migration the server doesn't know (written by a newer
  build) is refused at start-up with a message saying so.
- **Save format.** Each world records the format it was written in (`worlds.format`;
  `SAVE_FORMAT = 1` in `server/store/Store.ts`). A server refuses to open a world in a newer format
  ("World "…" was saved in format 2, but this server only understands format 1 and older. Update
  the server."). Older formats are upgraded by a migration that rewrites the data and the format
  number, never by special cases in the game code.

### The ledger

`Store.applyTransaction` is the only way paper will change once phase 4 connects it: the balance
change and its row in `transactions` in one database transaction, at most once per idempotency key.

- The same key twice (a repeated message, a refresh, a reconnect, a retry after a restart) is
  reported as a duplicate and changes nothing, even when the attempts race.
- A debit larger than the balance is refused (`insufficient`); balances can't go negative (a
  database check as well).
- Changes to one player's paper are serialised by a row lock; different players don't wait for
  each other.
- The balance always equals the sum of the player's log.

## Testing

`npm test` runs everything. The PostgreSQL tests need a database:

```bash
TEST_DATABASE_URL=postgres://paperwars:paperwars@localhost:5432/paperwars_test npm test
```

Without `TEST_DATABASE_URL` they are skipped (vitest lists them as skipped), and the same store
contract still runs against the in-memory store.

| File | What it checks |
|---|---|
| `server/store/store.test.ts` | The store contract, against memory and PostgreSQL: players and hashed tokens, duplicate ids and tokens refused, renaming, revoking and restoring, invites (uses, expiry, revocation, four people racing for the last use), transfer codes (single use when two devices race, expiry, revoked players), worlds and incompatible formats, the ledger (idempotency, eight identical completions at once paying once, two players at once, simultaneous spending never overdrawing, the balance equal to the log, a failed log write leaving the balance untouched), only hashes stored, destroyed aircraft staying destroyed |
| `server/db/migrate.test.ts` | Migration files numbered without gaps; every table created on an empty database; nothing to do the second time; two servers migrating at once; a new migration on top; a failing migration rolled back completely; a newer database refused; an edited migration refused |
| `server/identity/identity.test.ts` | Tokens and codes (entropy, shape, typing variants), peppered hashes, configuration rules, the identity service (open and invite access, names as labels, invites, transfer codes winning over an existing token, developer reissue, revoked players, a failing database reported without details) |
| `server/room.test.ts` | Over real WebSockets: the v0.0.9 room tests, plus a token issued on first join and recognised later, a client that can't choose its identity (fake ids, someone else's name), "opened in another tab" (old connection closed with 4011, seat and territory kept), a refreshed browser coming back with its token while its old connection waits, moving between classrooms, transfer codes, revoked players, invite-only access |

## Measurements and checks

`npm run loadtest` after phases 1 to 3 (in-memory store; persistence of the world is not wired
yet, so this checks that identity costs nothing at run time):

| Players | Network | Server step avg / max (ms) | Down per player (KB/s) | Up per player (KB/s) | Corrections / reconciles | Drop + resume |
|---|---|---|---|---|---|---|
| 2 | local | 0.33 / 4.3 | 9.6 | 1.2 | 0 / 1184 | kept seat |
| 4 | local | 0.35 / 2.8 | 11.3 | 1.2 | 5 / 2206 | kept seat |
| 8 | local | 0.37 / 3.3 | 12.4 | 1.2 | 1 / 4669 | kept seat |
| 8 | 120 ± 40 ms, a stall every 5 s | 0.48 / 3.2 | 14.8 | 1.2 | 5 / 4587 | kept seat |

The same as v0.0.9 within run-to-run noise (the few local corrections, a few centimetres each,
come from collisions in close dogfights).

By hand, against a real server:

- **PostgreSQL, invite-only**: a join without an invite refused with the message; an invite from
  `npm run admin` letting a player in and issuing a token; the token bringing back the same player
  under a new name; the used invite refused; only a hash in `player_tokens`.
- **Server restart**: the player and their public id survived; `player reissue` gave a code that
  brought them back with a new pass.
- **In the browser** (headless Chromium): a first join stores the token; after closing the tab's
  session and reloading, the same token and the same seat; the pause menu's **Another computer**
  shows a transfer code; a second browser (no token) entering it becomes the same player, and the
  first browser returns to the lobby with "Disconnected: Opened in another tab". No page errors.

| | | |
|---|---|---|
| ![Lobby with the Code field](checkpoints/0.0.10-persistence/01-lobby-code-field.jpg) | ![A transfer code in the pause menu](checkpoints/0.0.10-persistence/02-pause-transfer-code.jpg) | ![The older browser after the transfer](checkpoints/0.0.10-persistence/03-opened-in-another-tab.jpg) |

Two fixes came out of the browser check: the room list now counts players out of eight (rooms keep
four spare connections for players taking over their own seat), and the pause menu closes when the
session ends (the HUD stopped redrawing without a home, leaving the menu over the lobby).

## Decisions for the developer (checkpoint 1)

1. **The interrupted-sortie rules** (plan §3D) need your confirmation before phase 5. Proposed:
   reconnect within the grace period resumes the sortie; a longer disconnect out of combat glides
   home undamaged and the mission fails without further penalty; during combat or a raid the plane
   is lost (no kill reward to anyone); a server restart returns airborne planes to the hangar in
   their last saved condition, cancels active missions and refunds their stake.
2. **The offline-protection rules** (plan §5A) need your confirmation before phase 7: no new raids
   on offline players; a raid in progress when the defender disconnects is called off (v0.0.9's
   rule, more generous than the plan's "continues with capped losses": keep it?); a two-minute raid
   grace after returning.
3. **Access default.** Production defaults to invite-only; development to open. One invite = one
   use, 14 days.
4. **Transfer codes** last 15 minutes from the pause menu and 7 days from `player reissue`; a
   transfer adds a device (the old one keeps working). Should a transfer instead log the old
   device out?
5. **Public ids.** Players are known to other clients by an 8-character public id rather than the
   UUID, to keep events small. It is stable and reveals nothing, but it is visible to every player
   in the world.
6. **Hosting and PostgreSQL provider** (plan §7, phase 8): any Node host with WebSockets and a
   managed or self-hosted PostgreSQL 15+. Worth deciding now so phase 8 can target it.

## Known limitations at this checkpoint

- The world is still in memory: a server restart keeps players (and their tokens) but not their
  territory, base, paper or planes. Leaving still frees the territory. (Phases 4 to 6.)
- Kicking a connected player and freeing a territory from the admin tool need the protected admin
  endpoint (phase 8).
- No rate limiting on joins or transfer-code requests beyond a 10-second cooldown per player
  (phase 7).

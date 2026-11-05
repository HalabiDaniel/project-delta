# paperwars.io persistence (v0.0.10 and v0.0.12)

How the multiplayer world stops forgetting: player identity, the PostgreSQL store, and (in later
phases) persistent territories, economy, aircraft, recovery and the private alpha. The plan this
implements is [docs/roadmap/v0.0.10.md](roadmap/v0.0.10.md).

> **Status: v0.0.10 closed after phase 3 (2026-11-02).** Players have a stable, secure identity
> backed by PostgreSQL, and the database schema, migrations and data-access layer are in place.
> The developer then changed the multiplayer design (bases that belong to players and move
> between desks, timed sessions), so phases 4 to 10 below were rewritten and moved to
> [v0.0.12](roadmap/v0.0.12.md), [v0.0.13](roadmap/v0.0.13.md) and [v0.0.14](roadmap/v0.0.14.md);
> the checkpoint decisions are recorded in the
> [roadmap](roadmap/README.md#decisions-of-2026-11-02).

| Phase | Focus | Status |
|---|---|---|
| 1 | Audit v0.0.9: everything kept only in memory, a regression baseline | Done ([below](#phase-1-the-audit)) |
| 2 | Player identity: tokens, `onAuth`, player ids in `ServerWorld`, duplicate connections | Done ([below](#phase-2-player-identity)) |
| 3 | Database: schema, migrations, data-access layer, local and test databases | Done ([below](#phase-3-the-database)) |
| | **Checkpoint 1**: developer review | Done (2026-11-02) |
| 4 | Persist territories, buildings, balances and the transaction log with idempotency | Moved to v0.0.12 ([below](#v0012-portable-bases)) |
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
| `players` | Player id, public id, display name, created and last-seen times, revoked time; tutorial (0003), first-time tips (0005), username and when it last changed (0006) | Phase 2 |
| `player_tokens` | Token hash, player, origin (open, invite, transfer), invite used, last use, revoked time | Phase 2 |
| `invites` | Code hash, label, uses and maximum, expiry, revoked time | Phase 2 |
| `transfer_codes` | Code hash, player, made by (player or admin), expiry, used time | Phase 2 |
| `worlds` | World id, name, save format, settings | Phase 3 |
| `balances` | Paper, capacity, protected reserve, production timestamp; per player and world; never negative | Phase 3 (ledger), 4 |
| `transactions` | Idempotency key (unique per world), player, kind, amount, balance after, reason, reference | Phase 3 (ledger), 4 |
| `territories` | Owner, claimed time, protection and shield as wall-clock times; one territory per player per world | Phase 4 |
| ~~`buildings`~~ | Replaced in v0.0.12 by `bases` and `base_buildings` (migration 0004): bases belong to players, not desks | ~~Phase 4~~ |
| `bases` | One per player: format, paper store health, the base's record, where it stands (holder, desk, lease) | v0.0.12 |
| `base_buildings` | Player, slot, kind, level, health, the rules' own fields | v0.0.12 |
| `aircraft` | Type, status (ready, airborne, damaged, in repair, destroyed), health, loadout, empty customisation for v0.0.21; a trigger makes destroyed final | v0.0.12 |
| `missions` | Template, state, card as generated, offered and resolved times, outcome, reward | v0.0.12 |
| `progress` | Statistics, unlocks, the mission director's state; the garage (0005); protections as clock times (0006) | v0.0.12 |
| `pvp_records` | Raids and kills, for cooldowns, the repeat rule and kill-farming windows | v0.0.12 |
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

**Answered on 2026-11-02**: see the
[decisions table in the roadmap](roadmap/README.md#decisions-of-2026-11-02). The questions as asked:

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

---

## v0.0.12: portable bases

The plan is [docs/roadmap/v0.0.12.md](roadmap/v0.0.12.md). A base belongs to the player and is
placed on whichever desk they get each session, exactly as they left it.

| Phase | Focus | Status |
|---|---|---|
| 1 | Base data model and migration; save, load, pack and place on any desk | Done |
| 2 | Ledger wiring for every paper change; online-only production | Done ([below](#phase-2-paper-through-the-ledger)) |
| 3 | Price and production retune; balance tests and simulation | Done ([below](#phase-3-the-retune)); the developer plays it at the checkpoint |
| 4 | Planes, hangar, missions, statistics, tutorial progress | Done ([below](#phase-4-planes-the-board-and-progress)) |
| 5 | Fairness timers on the player; usernames and desk names | Done ([below](#phase-5-fairness-timers-usernames-and-desk-names)) |
| 6 | Tests, bots, documentation | Done ([below](#phase-6-tests-bots-and-checks)) |

### Phase 1: the base's life

```
join ─► placeBase (lease 120 s) ─► built on a random free desk ─► saveBase every 15 s (renews lease)
                                                                      │
                     leave for good (after the reconnect grace) ─► packBase (lease cleared)
```

- **Store** (`server/store/Store.ts`, both stores): `base`, `placeBase`, `saveBase`, `packBase`,
  `releaseBase`. Only the holder (`<server instance>/<room id>`) can save or pack; a base with a
  live lease held by someone else is refused (`elsewhere`). A lease that runs out (a crashed or
  stalled server) lets the base be placed again, and the old holder can no longer write to it.
- **Format:** `bases.format` (`BASE_FORMAT = 1`); a newer one is refused (`IncompatibleBaseError`).
  `checkBaseState` refuses broken bases before either store writes them, and the database's own
  checks back it up.
- **Conversion** (`server/world/bases.ts`): the rules' `BaseSave` to the store's `BaseState` and
  back. Health is kept in whole points, rounded up, so a hurt building never comes back as a wreck.
  `Base.load` checks slots, kinds and one-radar again when it puts a base up.
- **Ordering** (`server/world/BaseKeeper.ts`): store calls for one player run one after another
  across every room in the process, so a base packed in one classroom is written before another
  places it, and a slow periodic save can't land after a pack.
- **Failures:** a base the store can't load is never replaced by a fresh one; the player sees
  "Your base couldn't be loaded right now. Try again in a moment." and a Try again button. A save
  or pack that fails is logged; the last periodic save (at most 15 s old) is what remains.
- **What travels with the base in phase 1:** buildings (slot, kind, level, health, paper invested,
  kills, bombers downed, damage dealt), the paper store's health and the base's record (raids,
  repels, losses, construction and repair spending). Paper, capacity and the reserve come with the
  ledger in phase 2; planes, the board and statistics in phase 4.
- **The world per game mode:** bases are keyed by player only (multiplayer has one base per
  player). The ledger's `world_id` will be the multiplayer game as a whole (one `worlds` row), so
  paper also travels from session to session.

Tests: `server/world/bases.test.ts` (a lived-in base round-trips and is placed on every claimable
desk with identical buildings, levels and damage), the base part of `server/store/store.test.ts`
(both stores: holders, leases, two rooms placing at once, broken bases, newer formats) and the
portable-base part of `server/room.test.ts` (random desks, save at once, pack and return, moving
classrooms, a store that fails, a base held by another server).

Known limitations after phase 1:

- Random placement uses the existing classroom room; v0.0.13's sessions replace it.
- A base left on a desk by a crashed server waits for its lease (two minutes) before it can be
  placed again, or `npm run admin -- base release <player>`.
- The board is dealt fresh on placement, so there is nothing to check against the new desk yet;
  that check comes with the saved board in phase 4. *(Done in phase 4.)*

### Phase 2: paper through the ledger

Every change to a multiplayer player's paper is a row in `transactions`, applied at most once.
The rules decide each change in the world as before (`ResourceManager`, `GameState`, `Base`);
`server/world/Paper.ts` writes each one down with a key built from its cause, and the room sends
them to `Store.applyTransaction` in order, through the player's store queue (`BaseKeeper.queue`).

| Change | Key |
|---|---|
| A new player's starting paper | `start:<player id>` (once per player, ever) |
| A mission reward (a raid's included) | `mission:<card id>` (the card's id is saved with the board, phase 4) |
| A successful raid's loss | `raid:<raid id>:loss` |
| Production | `prod:<stint>:<n>` |
| Everything else (folds, refits, buildings, upgrades, repairs, refunds, bounties, bonuses, AI raid hits) | `<kind>:<stint>:<serial>` |

- A **stint** is one placement of a base (a UUID): keys never collide between sessions, and a
  write retried after a database hiccup is still applied once.
- **The world follows the store.** A change the store refuses (a key applied before, or a debit
  the balance can't cover) is undone in the world without a new entry (`ServerWorld.adjustPaper`).
- **The balance is restored on placement** from `balances` (in the same queue as the base, so the
  last session's writes have landed). Capacity and the protected reserve are saved with it
  (`Store.setEconomyLimits`) on every save and on leaving.
- **Production only while online.** Workshops and the base produce nothing while the player's
  connection is down (`p.connected`), and there is nothing to collect on return. In the world,
  paper still trickles in sheet by sheet (the HUD's progress bar); the ledger is credited at most
  once a minute (`PRODUCTION_EVERY`), always before a spend (so the ledger never debits paper it
  hasn't been credited), and when the player leaves.
- **One economy world.** Balances, transactions, planes, missions, progress and PvP records belong
  to the `multiplayer` world (`ECONOMY_WORLD` in `server/services.ts`, opened once per store), so
  paper travels from session to session like the base.

### Phase 3: the retune

The developer's approved values (2026-11-05) are in `src/config.ts`: every plane dearer to fold
(Swift 10 → 15 up to Ghost 60 → 120, refits scaled the same way), base production 5 → 3.5 paper a
minute, workshops +2 / +5 / +9 → +1.5 / +3.5 / +6. They apply to single-player too (one rule set).

`tools/labs/economy-report.lab.ts` plays every simulated profile through 40 sorties on 20 seeds
with the real director and economy:

```bash
npx vitest run --config tools/labs/vitest.lab.config.ts --disableConsoleIntercept economy-report
```

| Profile | Spent per sortie (before → after) | Rewards per sortie | Planes lost per sortie | Emergency planes per 40 sorties | Longest run without Falcon money |
|---|---|---|---|---|---|
| New | 16.2 → 28.1 | 37.8 → 38.3 | 0.3 | 0 → 0 | 0 → 4 |
| Struggling | 18.7 → 26.6 | 27.7 → 28.3 | 0.5 | 0 → 0 (at most 2 in one run) | 4 → 9 |
| Average | 14.5 → 24.4 | 60.5 | 0.2 | 0 | 0 → 1 |
| Successful | 12.3 → 20.9 | 102.1 | 0.1 | 0 | 0 |
| Veteran | 11.0 → 18.4 | 132.8 | 0.1 | 0 | 0 |

What it shows (25 s at the desk between sorties, as the simulation assumes):

- Every profile always has a card it can fly, and a struggling player recovers in every seed
  (every run ends with more than a Falcon's worth). Not every run grows: one newcomer run in
  eight ended at 44 paper after 40 sorties (it started with 100); the median newcomer ends at 639.
- A lost plane is felt: spending per sortie is up by two thirds, and a struggling player can go
  several sorties without the paper for a Falcon, flying the Swift or the Dart meanwhile. With a
  minute at the desk between sorties (closer to real play) the emergency plane is never needed.
- A newcomer's successful sortie now pays for about one and a half new Darts (it was two and a
  half); a veteran's still pays for two Widewings or more.
- The values were kept as approved: the simulation found no one getting stuck. The balance tests
  (`src/director/simulation.test.ts` and the unit tests) were restated for the new prices. Home
  income no longer loses a sheet to floating-point rounding at fractional rates (3.5 a minute).

### Phase 4: planes, the board and progress

| What | Where | Rules |
|---|---|---|
| Planes | `aircraft` (one row per plane) | A fold is a new plane (new id); a refit or roll-out keeps the hangar's plane; a crash destroys it for good (the next save marks it, the trigger keeps it so). A plane left on the pad comes back **ready**, paid for (roll out free). One in the air when the server last saved comes back **recovered** (it needs a refit), as single-player's plane in flight does. One in the air when its pilot leaves goes down (v0.0.11's rule until v0.0.13's flight rules). The free emergency plane is never stored. |
| The garage | `progress.garage` | The design chosen, and the ids of the cards on the board by slot. |
| The board | `progress.director` | `MissionDirector.save()`; on placement the board is made again from its recipes (cards keep their ids, so a reward keeps its ledger key), then checked against the new desk (`validate`): a card that makes no sense there is replaced, not paid. |
| Mission outcomes | `missions` | Written once per card, by its id (`recordMission`; a second write is refused). |
| Statistics | `progress.stats` | Lifetime: the last saved figures plus this session's (`Pilot.lifetime` + `Pilot.stats` + `GameState.stats`). The scoreboard still counts the session (per-session scores are v0.0.13's). |
| Tutorial | `players.tutorial` (v0.0.11) | Unchanged. |
| First-time tips | `players.tips` (migration 0005) | The multiplayer desk tip is shown once per player, on any computer. |

The hangar's look (level 1 to 3) follows the number of planes kept, so it comes back with them.
Everything loaded is checked (`server/world/carry.ts`): unknown designs, broken numbers and an
unusable director state are dropped, never trusted.

### Phase 5: fairness timers, usernames and desk names

**Timers on the real clock.** New-player protection and the raid shield are saved as clock times
with the player's progress (`progress.protect_until`, `shield_until`, migration 0006). The world
converts them to and from its own time (`ServerWorld.wallOf`, `worldAt`), so a restart or a new
session neither shortens nor lengthens them. New-player protection starts once, with the first
base; a returning player never gets it again. Raids and kills go to `pvp_records` as they happen
(each with its own id) and are loaded when a base is placed (as far back as any rule looks:
`max(farmWindow, pairCooldown, killWindow)`), so the pair cooldown, the repeat rule and the
kill-farming window follow the players from session to session.

**Usernames** (`src/net/Username.ts`, shared by the browser and the server):

- 3 to 16 letters, digits or `_`; unique across the game ignoring case (a unique index on
  `lower(username)`); a block list (also matched through look-alike spellings such as `sh1t`) and
  the reserved names admin, mod, server, ai and system; changed at most once a week.
- The lobby's name field is now **Username**. A name saved from before is offered if it would do.
- Joining with a username the player may have sets it (or changes it, within the cooldown); one
  that breaks the rules is tried once more cleaned up (`Bo<script>` → `Boscript`).
- A player who still has no username (theirs was taken, say) sees **Choose a username** on the
  claim screen; their base is placed once they have one. The server's reason is shown as it is
  ("That username is taken. Try another.").
- Ownership never depends on it: players are still their UUID and public id. Accounts with sign-in
  (v0.0.22) keep the username.

**Desk names.** Every desk is named after whoever holds it: "Daniel's desk" for a player, and for
the AI a goofy name from `DESK_NAMES` in `src/config.ts`, picked per session ("Billy's desk"),
never one a player in the session uses. They are in the schema (`TerritoryState.label`), on the
claim map, in the arrival note ("This session: Daniel's desk · a corner desk") and on rival bases'
threat lines.

The protocol version is now 3 (new join and welcome fields): an older page is asked to reload.

### Phase 6: tests, bots and checks

| File | What it checks |
|---|---|
| `server/world/paper.test.ts` | Every change journalled in order; production once a minute, before a spend, never while away; a leaving player's last changes kept; mission rewards keyed by the card, raid losses by the raid; the world following the store |
| `server/world/carry.test.ts` | Recovered, on-the-pad and crashed planes; the emergency plane never stored; a plane in the air comes back recovered; the board brought back card for card; a card about the new desk replaced; lifetime statistics; mission outcomes; untrusted records dropped |
| `server/world/fairness.test.ts` | Protections as clock times, carried exactly across sessions and restarts and never renewed; raids and kills remembered (cooldown, repeat rule, kill window); desk names, and never an AI desk named like a player |
| `src/net/username.test.ts` | The username rules, the block list, suggestions, name comparison |
| `server/store/store.test.ts` (both stores) | Paper limits; planes (lost ones destroyed for good, never someone else's); progress and protections; mission outcomes written once, also when racing; tips; PvP records from either side, once each; usernames (unique ignoring case, the cooldown, two players racing for one name) |
| `server/persistence.cases.ts` (run by `room.test.ts`, both stores) | Through the real room: the starting paper once, every change in the ledger, the balance equal to the log; paper back exactly after leaving; a refused change corrected in the world; the hangar, garage, board and statistics back after leaving; a plane left in the air destroyed for good and its mission written once; usernames (taken, reserved, chosen on the claim screen, the desk label); a shield kept across sessions and new-player protection never renewed; a bot leaving and rejoining with its base |

Bots (`server/bots/`) take a username (another if theirs is taken), and
`npm run bots -- --count 2 --rejoin 60` makes one leave and join again every minute and checks its
base came back as it left it.

Checked by hand on PostgreSQL with the real client (Playwright, 2026-11-05): two browsers joining
as "Daniel" and "daniel" (the second asked for another name, then placed as Sky_Ace), the desk
names on the claim map, the new prices and 3.5/min on the HUD, and a full server restart between
two visits (the folded plane back on the pad, ready to roll out; paper exactly as the ledger says).
`npm run loadtest` (8 s runs): 4 players 0.79 ms per step, 8 players on a poor network 0.70 ms,
drop and resume kept the seat.

Known limitations after v0.0.12:

- Sessions, time limits, the territory lifecycle and the AI filling desks are v0.0.13's: the
  existing classroom room places bases on a random free desk.
- A plane in the air when its pilot leaves still goes down (v0.0.13 section 5 replaces this).
- In-world paper is ahead of the ledger by at most a minute's production: a server crash loses
  that minute (never more, never a spend).
- The block list is short and obvious; the developer can extend it in `src/net/Username.ts`.

## v0.0.13: sessions, shutdown, restore and crash recovery

v0.0.13 ([plan](roadmap/v0.0.13.md)) puts the portable bases into timed sessions (see
[MULTIPLAYER.md](MULTIPLAYER.md#sessions-v0013)). What it changes here:

- **`sessions` table** (migration `0007`): one row per session (id, title, capacity, status
  `open`/`closing`/`ended`/`interrupted`, the busiest moment, when it was created, started, ends
  and ended, and `desks`: which desk each player's base stood on). Written when a session opens,
  when a player is placed, when joining closes and at the end.
- **When things are saved.** Paper changes, purchases, builds, repairs, raid results and mission
  outcomes are written at once, in transactions (v0.0.12). The rest of a base (building health
  between hits) is saved every **5 s** (`BASE_SAVE_EVERY`, was 15), and at packing and shutdown.
- **Graceful shutdown** (SIGTERM, SIGINT): no session opens and nobody is placed any more;
  everyone is told the server is restarting; raids and missions are settled as at a session end;
  planes in the air come home; every base is saved and packed; each session is recorded as
  `interrupted` with its desks; then the connections close (4013) and the database is released.
- **Restore after a restart.** On start, every session still `open`, `closing` or `interrupted`
  whose time isn't up is reopened with the **same id** and clock for 5 minutes
  (`SESSION.restoreWindow`), each player's desk held for them. Returning players (the browser
  rejoins by itself, retrying while the server comes back) land on their desk; players who don't
  come back in time are placed normally next time. A session whose time is up, or that nobody
  was in, is recorded as ended instead.
- **Crash recovery.** Nothing uncommitted survives, so every base is in its last committed state.
  A session the dead process left `open` is restored like an interrupted one; a base it still
  holds a lease on is recognised by the session's id (`<instance>/<session id>`) and taken back at
  once instead of waiting out the 120 s lease. A plane in the air comes back as recovered in its
  last saved condition. The host restarts the process (v0.0.14).
- **Checked by hand** (PostgreSQL, two bots): SIGTERM saved and packed both bases and recorded the
  session as interrupted with both desks; the restarted server reopened it with the same id and
  the same clock. The tests (`server/sessions.test.ts`) also restart a session under bots: both
  land back on their desks with the same base, and every balance still equals its ledger.
- A base saved by a newer build is refused with a message saying so; it stays untouched.


## v0.0.14: backups, restores and the feedback table

- **Backups** (`npm run db:backup`, `server/db/backup.ts`): `pg_dump --format=custom` of
  `DATABASE_URL`, checked with `pg_restore --list` (it must hold table data), uploaded to the R2
  bucket as `paperwars/<UTC time>.dump`; copies older than `BACKUP_KEEP_DAYS` (14) are deleted,
  never the newest. On Railway a second service runs it every night (cron `15 3 * * *`).
  `--out <folder>` writes a local file instead; `--list` lists the bucket.
- **Restores** (`npm run db:restore -- latest | <key> | <file>`): `pg_restore --clean --if-exists
  --single-transaction --exit-on-error` into `DATABASE_URL`, after typing the database's name
  (`--yes` skips it). The server migrates a restored database to its own schema when it starts.
- **The drill**: with `DRILL_DATABASE_URL`, every backup is restored into that second database at
  once and compared with the live one (rows in players, bases, buildings, balances, planes, the
  ledger, missions and progress; paper in total; the most recent player's paper and buildings).
  Logged as `drill.done` with `ok` and `identical`; a failed drill fails the job.
- **Feedback** is stored in the `feedback` table from v0.0.10's first migration (category, body,
  repro, rating, context as JSON): no new migration. `Store.addFeedback` / `Store.feedback(since)`
  in both stores, with the table's rules checked in memory too.
- **Write statistics**: `Database.writes` counts every write statement and transaction and its
  time, for `/admin/stats` and the remote load test.

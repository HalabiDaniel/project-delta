import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '../../src/net/protocol';
/**
 * Durable storage, as the game server sees it. Two implementations keep the same contract (and run
 * the same tests, `store.test.ts`):
 *
 * - PgStore: PostgreSQL, for every real deployment (DATABASE_URL).
 * - MemoryStore: a process-local copy for development without a database and for fast tests.
 *
 * Secrets never reach the store: it is given hashes of tokens and codes, never the tokens.
 */

/** The version of the world data this build reads and writes (see `worlds.format`). */
export const SAVE_FORMAT = 1;

export interface PlayerRecord {
  /** Stable server-issued id (UUID): owns territory, paper, aircraft and records. Never shown to other players. */
  id: string;
  /** The short id other players' clients know this player by (schema keys, events). Stable too. */
  publicId: string;
  /** A changeable label; it never decides ownership. */
  name: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Revoked players can't join with any token until the developer restores them. */
  revoked: boolean;
  /** The name everyone sees (v0.0.12): chosen once, unique ignoring case; null until chosen. */
  username: string | null;
  usernameChangedAt: Date | null;
}

/** What became of a request for a username. */
export type UsernameResult = 'ok' | 'same' | 'taken' | 'cooldown';

/** How a device token came to be. */
export type TokenOrigin = 'open' | 'invite' | 'transfer';

export interface NewPlayer {
  id: string;
  publicId: string;
  name: string;
}

export interface InviteRecord {
  id: string;
  label: string;
  maxUses: number;
  uses: number;
  createdAt: Date;
  expiresAt: Date | null;
  revoked: boolean;
}

export interface NewInvite {
  id: string;
  codeHash: string;
  label: string;
  maxUses: number;
  expiresAt: Date | null;
}

/** Why an invite code didn't let someone in. */
export type InviteRefusal = 'unknown' | 'revoked' | 'expired' | 'used-up';

export interface WorldRecord {
  id: string;
  name: string;
  format: number;
  createdAt: Date;
  settings: Record<string, unknown>;
}

/** A world written by a newer build than this one: refused rather than misread. */
export class IncompatibleSaveError extends Error {
  constructor(
    readonly world: string,
    readonly found: number,
    readonly supported: number,
  ) {
    super(`World "${world}" was saved in format ${found}, but this server only understands format ${supported} and older. Update the server.`);
  }
}

/** A change to a player's paper, and the reason for it. */
export interface TransactionInput {
  worldId: string;
  playerId: string;
  /**
   * Built from the change's cause ("mission:<id>", "raid:<id>:reward", "build:<request id>"): the
   * same key twice is the same change, applied once.
   */
  key: string;
  kind: string;
  /** Positive: paper in. Negative: paper out (refused if the balance would go below zero). */
  amount: number;
  reason: string;
  reference?: string | null;
  /** v0.0.18: which balance it changes (paper when absent). */
  resource?: LedgerResource;
}

/** The balances a transaction can change (v0.0.18). */
export type LedgerResource = 'paper' | 'ink' | 'rubber';
export const LEDGER_RESOURCES: readonly LedgerResource[] = ['paper', 'ink', 'rubber'];

export interface TransactionRecord extends Required<Omit<TransactionInput, 'reference' | 'resource'>> {
  reference: string | null;
  resource: LedgerResource;
  balanceAfter: number;
  createdAt: Date;
}

export type TransactionResult =
  /** Applied now. */
  | { status: 'applied'; balance: number }
  /** The key was applied before: nothing changed. */
  | { status: 'duplicate'; balance: number }
  /** A debit larger than the balance: nothing changed. */
  | { status: 'insufficient'; balance: number };

/** A player's paper in one world, with the limits the store had when it was last saved. */
export interface EconomyRecord {
  paper: number;
  /** The most the player's paper store holds (base capacity plus storage boxes). */
  capacity: number;
  /** Paper a raid can never take (the protected reserve). */
  protected: number;
  /**
   * v0.0.18: ink and rubber balls. Null for a player from before them (or a new player) until the
   * server gives them their first stock.
   */
  ink: number | null;
  rubber: number | null;
}

// ---- What travels with the player (v0.0.12) -------------------------------------------------------

/** A plane the player owns (destroyed planes are history and never come back). */
export interface AircraftRecord {
  id: string;
  /** An aircraft id from src/config.ts ("falcon"). */
  type: string;
  /** ready: in the hangar, ready to roll out. damaged: recovered, needs a refit. airborne: on the pad or in the air when last saved. */
  status: 'ready' | 'airborne' | 'damaged' | 'in-repair';
  health: number;
  /** What the plane carries with it: the paper already put into it (`invested`), and later loadouts. */
  loadout: Record<string, unknown>;
}

/** The player's progress in a world, as last saved (each part checked by the game when it is loaded). */
export interface ProgressRecord {
  /** Lifetime statistics (kills, deaths, sorties, ...). */
  stats: Record<string, number>;
  /** The mission director's state (MissionDirector.DirectorState), or null. */
  director: unknown;
  /** The garage: the design chosen, the ids of the cards on the board. */
  garage: Record<string, unknown>;
  /** New-player protection and the raid shield, as clock times (null: none). */
  protectUntil?: Date | null;
  shieldUntil?: Date | null;
}

/** A raid or a kill between two players, for the cooldowns, the repeat rule and the kill-farming window. */
export interface PvpRecord {
  /** Unique (a UUID): the same record is never counted twice. */
  id: string;
  kind: 'raid' | 'kill';
  /** Player ids (UUIDs) when written; public ids when read back (what the world knows players by). */
  attacker: string;
  victim: string;
  success: boolean;
  at: Date;
}

/** A mission's outcome, written once per card. */
export interface MissionOutcome {
  /** The card's id (a UUID): the same id twice is the same mission. */
  id: string;
  template: string;
  state: 'completed' | 'failed' | 'cancelled' | 'expired';
  outcome: string | null;
  reward: number;
  spec: Record<string, unknown>;
}

// ---- Portable bases (v0.0.12) ---------------------------------------------------------------------

/** The version of a saved base's data (`bases.format`): refused if newer, upgraded by migrations if older. */
export const BASE_FORMAT = 1;

/** A building as saved: where it stands, what it is, and the rules' own fields in `data`. */
export interface SavedBuilding {
  /** A slot id from BASE.slots ("D1", ...). */
  slot: string;
  kind: 'turret' | 'launcher' | 'radar' | 'workshop' | 'storage' | 'inkwell';
  level: number;
  health: number;
  data: Record<string, unknown>;
}

/** What a base is made of, wherever it stands. */
export interface BaseState {
  /** The paper store's health. */
  storeHealth: number;
  stats: Record<string, unknown>;
  buildings: SavedBuilding[];
}

/** Where a base stands right now: which server room holds it, on which desk, and for how long. */
export interface BasePlacement {
  /** The room holding the base ("<server instance>/<room id>"). */
  holder: string;
  territoryId: string;
  /** The placement lapses after this unless the holder saves again (a crashed server lets go). */
  leaseUntil: Date;
}

export interface BaseRecord {
  playerId: string;
  /** Null until the player's first base has been built and saved (a new player starts fresh). */
  state: BaseState | null;
  placement: BasePlacement | null;
  updatedAt: Date;
}

export type PlaceResult =
  /** Placed for this holder: build the base from `state` (null: a new player's starting base). */
  | { status: 'placed'; state: BaseState | null }
  /** Already standing somewhere else: a base is never in two places. */
  | { status: 'elsewhere'; placement: BasePlacement };

/** A base saved by a newer build than this one: refused rather than misread. */
export class IncompatibleBaseError extends Error {
  constructor(
    readonly playerId: string,
    readonly found: number,
  ) {
    super(`The base of player ${playerId} was saved in format ${found}, but this server only understands format ${BASE_FORMAT} and older. Update the server.`);
  }
}

/** Where a recorded session stands. `interrupted`: the server stopped while it ran (v0.0.13). */
export type SessionRecordStatus = 'open' | 'closing' | 'ended' | 'interrupted';

/** A session, as the database keeps it for restoring and for statistics (v0.0.13). */
export interface SessionRecord {
  id: string;
  title: string;
  capacity: number;
  createdAt: Date;
  /** When its first player arrived (its clock started); null while nobody has. */
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
  status: SessionRecordStatus;
  /** The most players it held at once. */
  peakPlayers: number;
  /** Which desk each player's base stood on (player id → territory id), for a restore. */
  desks: Record<string, string>;
}

/** A session's desk map, checked: player UUIDs to desk ids, nothing else. */
export function cleanDesks(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [player, desk] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[0-9a-f-]{36}$/.test(player) && typeof desk === 'string' && /^T\d{1,2}$/.test(desk)) out[player] = desk;
  }
  return out;
}

/** A playtest feedback entry (v0.0.14): what the player wrote, and what was attached. */
export interface NewFeedback {
  worldId: string | null;
  playerId: string | null;
  category: FeedbackCategory;
  body: string;
  repro: string | null;
  rating: number | null;
  /** Version, session, position and mode, ping, frame rate, device and browser. */
  context: Record<string, unknown>;
}

export interface FeedbackRecord extends NewFeedback {
  id: number;
  /** The player's username (or name) when it was read back. */
  playerName: string | null;
  createdAt: Date;
}

// ---- Merit and ranks (v0.0.17) --------------------------------------------------------------------

/** One Merit award for a player, and its cause. */
export interface MeritAward {
  playerId: string;
  /** Built from the award's cause ("kill:<id>", "mission:<id>"): the same key twice is one award. */
  key: string;
  /** What earned it ("kill", "mission", "active", ...). */
  source: string;
  /** Always positive: Merit only counts up. */
  amount: number;
  reason: string;
}

export interface MeritRecord extends MeritAward {
  createdAt: Date;
}

export type MeritResult =
  /** Applied now: the player's total after it. */
  | { status: 'applied'; total: number }
  /** The key was awarded before: nothing changed. */
  | { status: 'duplicate'; total: number };

/** An award checked before it reaches the store (a bug, not a player, makes a bad one). */
export function checkMerit(a: MeritAward): void {
  if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount > 100_000) throw new Error(`bad Merit amount ${a.amount}`);
  if (!a.key || a.key.length > 200) throw new Error('bad Merit key');
  if (!a.source || a.source.length > 32) throw new Error('bad Merit source');
}

export interface Store {
  readonly kind: 'memory' | 'postgres';

  // ---- Players and devices ----------------------------------------------------------------------

  /** A new player with their first device token (open access). */
  createPlayer(player: NewPlayer, tokenHash: string, origin: TokenOrigin): Promise<PlayerRecord>;
  /**
   * A new player through an invite, in one step: the invite is checked and one use taken from it,
   * the player and their first token are created. Either everything happens or nothing does.
   */
  redeemInvite(codeHash: string, player: NewPlayer, tokenHash: string): Promise<PlayerRecord | InviteRefusal>;
  /** The player a device token belongs to (revoked tokens belong to nobody); marks the token used. */
  playerByToken(tokenHash: string): Promise<PlayerRecord | null>;
  playerById(id: string): Promise<PlayerRecord | null>;
  /** By id, public id or exact name (the admin tool). */
  findPlayers(query: string): Promise<PlayerRecord[]>;
  listPlayers(): Promise<PlayerRecord[]>;
  rename(playerId: string, name: string): Promise<void>;
  touch(playerId: string): Promise<void>;
  /** Revoked players and their tokens can't join; restoring lets their existing tokens work again. */
  setRevoked(playerId: string, revoked: boolean): Promise<boolean>;
  /** Revokes every device token of the player (a stolen or lost device); the player stays. */
  revokeTokens(playerId: string): Promise<number>;
  /** The player's tutorial progress as last saved (a TutorialRecord), or null if never saved. */
  tutorial(playerId: string): Promise<unknown>;
  /** Saves the player's tutorial progress (already validated by the caller). */
  setTutorial(playerId: string, record: Record<string, unknown>): Promise<void>;

  // ---- Transfer codes (moving to another computer, or a reissued token) -------------------------

  createTransferCode(playerId: string, codeHash: string, expiresAt: Date, by: 'player' | 'admin'): Promise<void>;
  /**
   * Uses a transfer code: if it is unused, unexpired and its player isn't revoked, a new device token
   * is added to that player. Single use, even when two devices try at once.
   */
  redeemTransferCode(codeHash: string, tokenHash: string): Promise<PlayerRecord | null>;

  // ---- Invites ----------------------------------------------------------------------------------

  createInvite(invite: NewInvite): Promise<InviteRecord>;
  listInvites(): Promise<InviteRecord[]>;
  revokeInvite(id: string): Promise<boolean>;

  // ---- Worlds -----------------------------------------------------------------------------------

  /**
   * The world called `name`, created if there is none. Throws IncompatibleSaveError if it was
   * written in a newer format than SAVE_FORMAT.
   */
  openWorld(name: string, settings?: Record<string, unknown>): Promise<WorldRecord>;
  listWorlds(): Promise<WorldRecord[]>;

  // ---- Paper and the transaction log ------------------------------------------------------------

  balance(worldId: string, playerId: string, resource?: LedgerResource): Promise<number>;
  /** The balance change and its log row in one transaction, at most once per key. */
  applyTransaction(tx: TransactionInput): Promise<TransactionResult>;
  transactions(worldId: string, playerId: string, limit?: number): Promise<TransactionRecord[]>;
  /** The player's paper and its saved limits, or null if they have never had any (a new player). */
  economy(worldId: string, playerId: string): Promise<EconomyRecord | null>;
  /** Saves the capacity and protected reserve with the balance (the paper itself only changes through the ledger). */
  setEconomyLimits(worldId: string, playerId: string, capacity: number, protectedPaper: number): Promise<void>;

  // ---- What travels with the player (v0.0.12) ---------------------------------------------------

  /** The player's planes that still exist (not destroyed). */
  aircraft(worldId: string, playerId: string): Promise<AircraftRecord[]>;
  /**
   * The player's planes as they are now: those listed are written, every other plane of theirs
   * that still existed is destroyed (lost since the last save). Destroyed is final.
   */
  saveAircraft(worldId: string, playerId: string, alive: AircraftRecord[]): Promise<void>;
  progress(worldId: string, playerId: string): Promise<ProgressRecord | null>;
  saveProgress(worldId: string, playerId: string, record: ProgressRecord): Promise<void>;
  /** Writes a mission's outcome once: false if that card's outcome was already written. */
  recordMission(worldId: string, playerId: string, outcome: MissionOutcome): Promise<boolean>;
  /** Records a raid or a kill (ids are player UUIDs). Writing the same record id twice changes nothing. */
  addPvpRecord(worldId: string, record: PvpRecord): Promise<void>;
  /** Raids and kills the player took part in (either side) since `since`, oldest first, by public id. */
  pvpRecords(worldId: string, playerId: string, since: Date): Promise<PvpRecord[]>;
  /**
   * Gives the player `username` if nobody else has it (ignoring case) and they haven't changed it
   * within `cooldownSeconds` (a first username is never held back). The caller checks the rules.
   */
  setUsername(playerId: string, username: string, cooldownSeconds: number): Promise<UsernameResult>;
  /** First-time tips the player has seen (ids), across every world and computer. */
  tips(playerId: string): Promise<string[]>;
  setTips(playerId: string, tips: string[]): Promise<void>;

  // ---- Merit and ranks (v0.0.17) -----------------------------------------------------------------

  /** Awards Merit once per key (a repeat changes nothing). */
  awardMerit(award: MeritAward): Promise<MeritResult>;
  /** The player's total Merit: the sum of their ledger. */
  merit(playerId: string): Promise<number>;
  /** The player's latest awards, newest first (for the admin endpoint). */
  meritHistory(playerId: string, limit?: number): Promise<MeritRecord[]>;
  /** What the player has equipped, as saved (checked by the caller), or null. */
  rankPrefs(playerId: string): Promise<Record<string, unknown> | null>;
  setRankPrefs(playerId: string, prefs: Record<string, unknown>): Promise<void>;

  // ---- Portable bases (v0.0.12) -----------------------------------------------------------------
  //
  // A base belongs to the player, not to a desk. A room places it (taking a lease on it), saves it
  // while the player plays (renewing the lease), and packs it when they leave. Only the holder can
  // save or pack; a lease that runs out (a crashed server) lets anyone place it again.

  /** The player's base as last saved, and where it stands (null: never placed). */
  base(playerId: string): Promise<BaseRecord | null>;
  /**
   * Places the player's base for `holder` on `territoryId` for `leaseSeconds`, unless another
   * holder has it with a live lease. Placing again for the same holder renews it.
   */
  placeBase(playerId: string, holder: string, territoryId: string, leaseSeconds: number): Promise<PlaceResult>;
  /** Saves the base and renews the lease, only if `holder` still holds it. False: it doesn't. */
  saveBase(playerId: string, holder: string, state: BaseState, leaseSeconds: number): Promise<boolean>;
  /** Saves the base for the last time and lets go of it, only if `holder` holds it. */
  packBase(playerId: string, holder: string, state: BaseState): Promise<boolean>;
  /**
   * Lets go of the base without saving it (its saved state stays): only if `holder` holds it, or
   * whoever does when no holder is given (the developer's way out).
   */
  releaseBase(playerId: string, holder?: string): Promise<boolean>;

  // ---- Sessions (v0.0.13) -----------------------------------------------------------------------

  /** Writes the session as it stands (the first call creates it). */
  recordSession(record: SessionRecord): Promise<void>;
  /** Sessions in any of `statuses` (all of them without), newest first. */
  sessionRecords(statuses?: SessionRecordStatus[]): Promise<SessionRecord[]>;

  // ---- Playtest feedback (v0.0.14) ----------------------------------------------------------------

  addFeedback(entry: NewFeedback): Promise<void>;
  /** Every entry since `since` (all of them without it), oldest first. */
  feedback(since?: Date): Promise<FeedbackRecord[]>;

  // ---- Health -----------------------------------------------------------------------------------

  /** True if the store can be reached right now. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** A feedback entry is within the table's rules (both stores check, as PostgreSQL's constraints do). */
export function checkFeedback(f: NewFeedback): void {
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(f.category)) throw new Error(`bad feedback category "${f.category}"`);
  if (f.body.length === 0 || f.body.length > 4000 || (f.repro?.length ?? 0) > 4000) throw new Error('feedback text must be 1 to 4000 characters');
  if (f.rating !== null && !(Number.isInteger(f.rating) && f.rating >= 1 && f.rating <= 5)) throw new Error('feedback rating must be 1 to 5');
}

const BUILDING_KINDS: ReadonlySet<string> = new Set(['turret', 'launcher', 'radar', 'workshop', 'storage']);

/** Shared validation: a base's shape, before either store writes it. */
export function checkBaseState(state: BaseState): void {
  if (!Number.isSafeInteger(state.storeHealth) || state.storeHealth < 0) throw new Error(`base store health must be a whole number ≥ 0, not ${state.storeHealth}`);
  const slots = new Set<string>();
  for (const b of state.buildings) {
    if (typeof b.slot !== 'string' || !/^[A-Za-z0-9-]{1,32}$/.test(b.slot)) throw new Error(`bad building slot "${b.slot}"`);
    if (slots.has(b.slot)) throw new Error(`two buildings in slot "${b.slot}"`);
    slots.add(b.slot);
    if (!BUILDING_KINDS.has(b.kind)) throw new Error(`bad building kind "${b.kind}"`);
    if (!Number.isSafeInteger(b.level) || b.level < 1 || b.level > 10) throw new Error(`bad building level ${b.level}`);
    if (!Number.isSafeInteger(b.health) || b.health < 0) throw new Error(`bad building health ${b.health}`);
  }
}

/** Shared validation: a transaction's shape, before either store touches it. */
export function checkTransaction(tx: TransactionInput): void {
  if (!Number.isSafeInteger(tx.amount)) throw new Error(`transaction amount must be a whole number, not ${tx.amount}`);
  if (typeof tx.key !== 'string' || tx.key.length === 0 || tx.key.length > 200) throw new Error('transaction key must be 1 to 200 characters');
  if (typeof tx.kind !== 'string' || tx.kind.length === 0 || tx.kind.length > 40) throw new Error('transaction kind must be 1 to 40 characters');
  if (tx.resource !== undefined && !LEDGER_RESOURCES.includes(tx.resource)) throw new Error(`transaction resource must be paper, ink or rubber, not ${String(tx.resource)}`);
}

/** Shared validation: saved paper limits. */
export function checkLimits(capacity: number, protectedPaper: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error(`capacity must be a whole number ≥ 0, not ${capacity}`);
  if (!Number.isSafeInteger(protectedPaper) || protectedPaper < 0) throw new Error(`protected paper must be a whole number ≥ 0, not ${protectedPaper}`);
}

const AIRCRAFT_STATUSES: ReadonlySet<string> = new Set(['ready', 'airborne', 'damaged', 'in-repair']);

/** Shared validation: planes as they are saved. */
export function checkAircraft(alive: AircraftRecord[]): void {
  const ids = new Set<string>();
  for (const a of alive) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id)) throw new Error(`bad aircraft id "${a.id}"`);
    if (ids.has(a.id)) throw new Error(`aircraft ${a.id} listed twice`);
    ids.add(a.id);
    if (typeof a.type !== 'string' || !/^[a-z]{1,32}$/.test(a.type)) throw new Error(`bad aircraft type "${a.type}"`);
    if (!AIRCRAFT_STATUSES.has(a.status)) throw new Error(`bad aircraft status "${a.status}"`);
    if (!Number.isSafeInteger(a.health) || a.health < 0) throw new Error(`bad aircraft health ${a.health}`);
  }
}

/** Shared validation: tip ids. */
export function cleanTips(tips: string[]): string[] {
  return [...new Set(tips.filter((t) => typeof t === 'string' && /^[a-z0-9-]{1,40}$/.test(t)))].slice(0, 100);
}

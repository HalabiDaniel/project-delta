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
}

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
}

export interface TransactionRecord extends Required<Omit<TransactionInput, 'reference'>> {
  reference: string | null;
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

  balance(worldId: string, playerId: string): Promise<number>;
  /** The balance change and its log row in one transaction, at most once per key. */
  applyTransaction(tx: TransactionInput): Promise<TransactionResult>;
  transactions(worldId: string, playerId: string, limit?: number): Promise<TransactionRecord[]>;

  // ---- Health -----------------------------------------------------------------------------------

  /** True if the store can be reached right now. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Shared validation: a transaction's shape, before either store touches it. */
export function checkTransaction(tx: TransactionInput): void {
  if (!Number.isSafeInteger(tx.amount)) throw new Error(`transaction amount must be a whole number, not ${tx.amount}`);
  if (typeof tx.key !== 'string' || tx.key.length === 0 || tx.key.length > 200) throw new Error('transaction key must be 1 to 200 characters');
  if (typeof tx.kind !== 'string' || tx.kind.length === 0 || tx.kind.length > 40) throw new Error('transaction kind must be 1 to 40 characters');
}

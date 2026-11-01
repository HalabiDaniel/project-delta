import { randomUUID } from 'node:crypto';
import {
  checkTransaction,
  IncompatibleSaveError,
  SAVE_FORMAT,
  type InviteRecord,
  type InviteRefusal,
  type NewInvite,
  type NewPlayer,
  type PlayerRecord,
  type Store,
  type TokenOrigin,
  type TransactionInput,
  type TransactionRecord,
  type TransactionResult,
  type WorldRecord,
} from './Store';

interface TokenRow {
  playerId: string;
  origin: TokenOrigin;
  revoked: boolean;
  lastUsedAt: Date;
}

interface TransferRow {
  playerId: string;
  expiresAt: Date;
  used: boolean;
}

/**
 * The store in this process's memory: same rules as PgStore, nothing survives a restart. Used by
 * `npm run server` without DATABASE_URL and by tests that don't need PostgreSQL. Every method is
 * synchronous inside, so two calls can't interleave halfway (JavaScript's single thread gives the
 * same all-or-nothing behaviour PgStore gets from transactions).
 */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly players = new Map<string, PlayerRecord>();
  private readonly tokens = new Map<string, TokenRow>();
  private readonly transfers = new Map<string, TransferRow>();
  private readonly invites = new Map<string, InviteRecord & { codeHash: string }>();
  private readonly worlds = new Map<string, WorldRecord>();
  private readonly balances = new Map<string, number>();
  private readonly log: TransactionRecord[] = [];
  private readonly keys = new Set<string>();
  /** Tests can make the store "newer" than the code to check refusals. */
  worldFormatOverride: number | null = null;

  async createPlayer(player: NewPlayer, tokenHash: string, origin: TokenOrigin): Promise<PlayerRecord> {
    return this.addPlayer(player, tokenHash, origin);
  }

  async redeemInvite(codeHash: string, player: NewPlayer, tokenHash: string): Promise<PlayerRecord | InviteRefusal> {
    const invite = [...this.invites.values()].find((i) => i.codeHash === codeHash);
    if (!invite) return 'unknown';
    if (invite.revoked) return 'revoked';
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return 'expired';
    if (invite.uses >= invite.maxUses) return 'used-up';
    const record = this.addPlayer(player, tokenHash, 'invite');
    invite.uses++;
    return record;
  }

  private addPlayer(player: NewPlayer, tokenHash: string, origin: TokenOrigin): PlayerRecord {
    if (this.players.has(player.id)) throw new Error('duplicate player id');
    if ([...this.players.values()].some((p) => p.publicId === player.publicId)) throw new Error('duplicate public id');
    if (this.tokens.has(tokenHash)) throw new Error('duplicate token');
    const now = new Date();
    const record: PlayerRecord = { ...player, createdAt: now, lastSeenAt: now, revoked: false };
    this.players.set(player.id, record);
    this.tokens.set(tokenHash, { playerId: player.id, origin, revoked: false, lastUsedAt: now });
    return { ...record };
  }

  async playerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    const token = this.tokens.get(tokenHash);
    if (!token || token.revoked) return null;
    const player = this.players.get(token.playerId);
    if (!player) return null;
    token.lastUsedAt = new Date();
    return { ...player };
  }

  async playerById(id: string): Promise<PlayerRecord | null> {
    const p = this.players.get(id);
    return p ? { ...p } : null;
  }

  async findPlayers(query: string): Promise<PlayerRecord[]> {
    return [...this.players.values()].filter((p) => p.id === query || p.publicId === query || p.name === query).map((p) => ({ ...p }));
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    return [...this.players.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => ({ ...p }));
  }

  async rename(playerId: string, name: string): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.name = name;
  }

  async touch(playerId: string): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.lastSeenAt = new Date();
  }

  async setRevoked(playerId: string, revoked: boolean): Promise<boolean> {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.revoked = revoked;
    return true;
  }

  async revokeTokens(playerId: string): Promise<number> {
    let n = 0;
    for (const t of this.tokens.values()) {
      if (t.playerId !== playerId || t.revoked) continue;
      t.revoked = true;
      n++;
    }
    return n;
  }

  async createTransferCode(playerId: string, codeHash: string, expiresAt: Date): Promise<void> {
    if (!this.players.has(playerId)) throw new Error('unknown player');
    if (this.transfers.has(codeHash)) throw new Error('duplicate code');
    this.transfers.set(codeHash, { playerId, expiresAt, used: false });
  }

  async redeemTransferCode(codeHash: string, tokenHash: string): Promise<PlayerRecord | null> {
    const t = this.transfers.get(codeHash);
    if (!t || t.used || t.expiresAt.getTime() <= Date.now()) return null;
    const player = this.players.get(t.playerId);
    if (!player || player.revoked) return null;
    if (this.tokens.has(tokenHash)) throw new Error('duplicate token');
    t.used = true;
    this.tokens.set(tokenHash, { playerId: player.id, origin: 'transfer', revoked: false, lastUsedAt: new Date() });
    return { ...player };
  }

  async createInvite(invite: NewInvite): Promise<InviteRecord> {
    if ([...this.invites.values()].some((i) => i.codeHash === invite.codeHash)) throw new Error('duplicate invite code');
    const record = { id: invite.id, codeHash: invite.codeHash, label: invite.label, maxUses: invite.maxUses, uses: 0, createdAt: new Date(), expiresAt: invite.expiresAt, revoked: false };
    this.invites.set(invite.id, record);
    return publicInvite(record);
  }

  async listInvites(): Promise<InviteRecord[]> {
    return [...this.invites.values()].map(publicInvite);
  }

  async revokeInvite(id: string): Promise<boolean> {
    const i = this.invites.get(id);
    if (!i) return false;
    i.revoked = true;
    return true;
  }

  async openWorld(name: string, settings: Record<string, unknown> = {}): Promise<WorldRecord> {
    let world = [...this.worlds.values()].find((w) => w.name === name);
    if (!world) {
      world = { id: randomUUID(), name, format: SAVE_FORMAT, createdAt: new Date(), settings: { ...settings } };
      this.worlds.set(world.id, world);
    }
    const format = this.worldFormatOverride ?? world.format;
    if (format > SAVE_FORMAT) throw new IncompatibleSaveError(name, format, SAVE_FORMAT);
    return { ...world, settings: { ...world.settings } };
  }

  async listWorlds(): Promise<WorldRecord[]> {
    return [...this.worlds.values()].map((w) => ({ ...w }));
  }

  async balance(worldId: string, playerId: string): Promise<number> {
    return this.balances.get(`${worldId}/${playerId}`) ?? 0;
  }

  async applyTransaction(tx: TransactionInput): Promise<TransactionResult> {
    checkTransaction(tx);
    const at = `${tx.worldId}/${tx.playerId}`;
    const balance = this.balances.get(at) ?? 0;
    if (this.keys.has(`${tx.worldId}/${tx.key}`)) return { status: 'duplicate', balance };
    if (balance + tx.amount < 0) return { status: 'insufficient', balance };
    const after = balance + tx.amount;
    this.balances.set(at, after);
    this.keys.add(`${tx.worldId}/${tx.key}`);
    this.log.push({ worldId: tx.worldId, playerId: tx.playerId, key: tx.key, kind: tx.kind, amount: tx.amount, reason: tx.reason, reference: tx.reference ?? null, balanceAfter: after, createdAt: new Date() });
    return { status: 'applied', balance: after };
  }

  async transactions(worldId: string, playerId: string, limit = 100): Promise<TransactionRecord[]> {
    return this.log
      .filter((t) => t.worldId === worldId && t.playerId === playerId)
      .slice(-limit)
      .reverse()
      .map((t) => ({ ...t }));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

function publicInvite(i: InviteRecord & { codeHash: string }): InviteRecord {
  return { id: i.id, label: i.label, maxUses: i.maxUses, uses: i.uses, createdAt: i.createdAt, expiresAt: i.expiresAt, revoked: i.revoked };
}

import { randomUUID } from 'node:crypto';
import { Database, type Queryable, type Row } from '../db/Database';
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

const PLAYER_COLUMNS = 'p.id, p.public_id, p.display_name, p.created_at, p.last_seen_at, p.revoked_at';
const INVITE_COLUMNS = 'id, label, max_uses, uses, created_at, expires_at, revoked_at';

/** The store in PostgreSQL. Every multi-step change runs in one transaction. */
export class PgStore implements Store {
  readonly kind = 'postgres' as const;

  constructor(readonly db: Database) {}

  // ---- Players and devices ----------------------------------------------------------------------

  async createPlayer(player: NewPlayer, tokenHash: string, origin: TokenOrigin): Promise<PlayerRecord> {
    return this.db.transaction((tx) => insertPlayer(tx, player, tokenHash, origin, null));
  }

  async redeemInvite(codeHash: string, player: NewPlayer, tokenHash: string): Promise<PlayerRecord | InviteRefusal> {
    return this.db.transaction(async (tx) => {
      // Lock the invite row: two people redeeming the last use at once can't both get in.
      const { rows } = await tx.query(`select ${INVITE_COLUMNS} from invites where code_hash = $1 for update`, [codeHash]);
      if (rows.length === 0) return 'unknown' as const;
      const invite = toInvite(rows[0]);
      if (invite.revoked) return 'revoked' as const;
      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return 'expired' as const;
      if (invite.uses >= invite.maxUses) return 'used-up' as const;
      await tx.query('update invites set uses = uses + 1 where id = $1', [invite.id]);
      return insertPlayer(tx, player, tokenHash, 'invite', invite.id);
    });
  }

  async playerByToken(tokenHash: string): Promise<PlayerRecord | null> {
    const { rows } = await this.db.query(
      `update player_tokens t set last_used_at = now()
         from players p
        where t.token_hash = $1 and t.revoked_at is null and p.id = t.player_id
        returning ${PLAYER_COLUMNS}`,
      [tokenHash],
    );
    return rows.length > 0 ? toPlayer(rows[0]) : null;
  }

  async playerById(id: string): Promise<PlayerRecord | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.db.query(`select ${PLAYER_COLUMNS} from players p where p.id = $1`, [id]);
    return rows.length > 0 ? toPlayer(rows[0]) : null;
  }

  async findPlayers(query: string): Promise<PlayerRecord[]> {
    const { rows } = await this.db.query(
      `select ${PLAYER_COLUMNS} from players p
        where ($1::uuid is not null and p.id = $1::uuid) or p.public_id = $2 or p.display_name = $2
        order by p.created_at`,
      [isUuid(query) ? query : null, query],
    );
    return rows.map(toPlayer);
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    const { rows } = await this.db.query(`select ${PLAYER_COLUMNS} from players p order by p.created_at`);
    return rows.map(toPlayer);
  }

  async rename(playerId: string, name: string): Promise<void> {
    await this.db.query('update players set display_name = $2 where id = $1', [playerId, name]);
  }

  async touch(playerId: string): Promise<void> {
    await this.db.query('update players set last_seen_at = now() where id = $1', [playerId]);
  }

  async setRevoked(playerId: string, revoked: boolean): Promise<boolean> {
    if (!isUuid(playerId)) return false;
    const { rowCount } = await this.db.query(`update players set revoked_at = ${revoked ? 'coalesce(revoked_at, now())' : 'null'} where id = $1`, [playerId]);
    return (rowCount ?? 0) > 0;
  }

  async revokeTokens(playerId: string): Promise<number> {
    if (!isUuid(playerId)) return 0;
    const { rowCount } = await this.db.query('update player_tokens set revoked_at = now() where player_id = $1 and revoked_at is null', [playerId]);
    return rowCount ?? 0;
  }

  // ---- Transfer codes ---------------------------------------------------------------------------

  async createTransferCode(playerId: string, codeHash: string, expiresAt: Date, by: 'player' | 'admin'): Promise<void> {
    await this.db.query('insert into transfer_codes (code_hash, player_id, created_by, expires_at) values ($1, $2, $3, $4)', [codeHash, playerId, by, expiresAt]);
  }

  async redeemTransferCode(codeHash: string, tokenHash: string): Promise<PlayerRecord | null> {
    return this.db.transaction(async (tx) => {
      // Marking it used in the same statement that checks it: of two simultaneous attempts, one wins.
      const { rows } = await tx.query(
        `update transfer_codes c set used_at = now()
           from players p
          where c.code_hash = $1 and c.used_at is null and c.expires_at > now()
            and p.id = c.player_id and p.revoked_at is null
          returning ${PLAYER_COLUMNS}`,
        [codeHash],
      );
      if (rows.length === 0) return null;
      const player = toPlayer(rows[0]);
      await tx.query(`insert into player_tokens (token_hash, player_id, origin) values ($1, $2, 'transfer')`, [tokenHash, player.id]);
      return player;
    });
  }

  // ---- Invites ----------------------------------------------------------------------------------

  async createInvite(invite: NewInvite): Promise<InviteRecord> {
    const { rows } = await this.db.query(
      `insert into invites (id, code_hash, label, max_uses, expires_at) values ($1, $2, $3, $4, $5) returning ${INVITE_COLUMNS}`,
      [invite.id, invite.codeHash, invite.label, invite.maxUses, invite.expiresAt],
    );
    return toInvite(rows[0]);
  }

  async listInvites(): Promise<InviteRecord[]> {
    const { rows } = await this.db.query(`select ${INVITE_COLUMNS} from invites order by created_at`);
    return rows.map(toInvite);
  }

  async revokeInvite(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rowCount } = await this.db.query('update invites set revoked_at = coalesce(revoked_at, now()) where id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // ---- Worlds -----------------------------------------------------------------------------------

  async openWorld(name: string, settings: Record<string, unknown> = {}): Promise<WorldRecord> {
    await this.db.query(`insert into worlds (id, name, format, settings) values ($1, $2, $3, $4) on conflict (name) do nothing`, [randomUUID(), name, SAVE_FORMAT, JSON.stringify(settings)]);
    const { rows } = await this.db.query('select id, name, format, created_at, settings from worlds where name = $1', [name]);
    const world = toWorld(rows[0]);
    if (world.format > SAVE_FORMAT) throw new IncompatibleSaveError(name, world.format, SAVE_FORMAT);
    return world;
  }

  async listWorlds(): Promise<WorldRecord[]> {
    const { rows } = await this.db.query('select id, name, format, created_at, settings from worlds order by created_at');
    return rows.map(toWorld);
  }

  // ---- Paper and the transaction log ------------------------------------------------------------

  async balance(worldId: string, playerId: string): Promise<number> {
    const { rows } = await this.db.query<{ paper: string }>('select paper from balances where world_id = $1 and player_id = $2', [worldId, playerId]);
    return rows.length > 0 ? Number(rows[0].paper) : 0;
  }

  async applyTransaction(t: TransactionInput): Promise<TransactionResult> {
    checkTransaction(t);
    return this.db.transaction(async (tx) => {
      await tx.query('insert into balances (world_id, player_id) values ($1, $2) on conflict do nothing', [t.worldId, t.playerId]);
      // The balance row is the lock: changes to one player's paper happen one after another.
      const locked = await tx.query<{ paper: string }>('select paper from balances where world_id = $1 and player_id = $2 for update', [t.worldId, t.playerId]);
      const balance = Number(locked.rows[0].paper);
      // Seen this key before? (Checked after the lock: a racing twin has committed or rolled back by now.)
      const seen = await tx.query('select 1 from transactions where world_id = $1 and idem_key = $2', [t.worldId, t.key]);
      if (seen.rows.length > 0) return { status: 'duplicate' as const, balance };
      const after = balance + t.amount;
      if (after < 0) return { status: 'insufficient' as const, balance };
      // The unique (world_id, idem_key) constraint is the last word: a twin for another player
      // with the same key would fail here and roll the whole change back.
      await tx.query(
        `insert into transactions (world_id, player_id, idem_key, kind, amount, balance_after, reason, reference)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [t.worldId, t.playerId, t.key, t.kind, t.amount, after, t.reason, t.reference ?? null],
      );
      await tx.query('update balances set paper = $3, updated_at = now() where world_id = $1 and player_id = $2', [t.worldId, t.playerId, after]);
      return { status: 'applied' as const, balance: after };
    });
  }

  async transactions(worldId: string, playerId: string, limit = 100): Promise<TransactionRecord[]> {
    const { rows } = await this.db.query(
      `select world_id, player_id, idem_key, kind, amount, balance_after, reason, reference, created_at
         from transactions where world_id = $1 and player_id = $2 order by id desc limit $3`,
      [worldId, playerId, limit],
    );
    return rows.map((r) => ({
      worldId: String(r.world_id),
      playerId: String(r.player_id),
      key: String(r.idem_key),
      kind: String(r.kind),
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      reason: String(r.reason),
      reference: r.reference === null ? null : String(r.reference),
      createdAt: r.created_at as Date,
    }));
  }

  // ---- Health -----------------------------------------------------------------------------------

  ping(): Promise<boolean> {
    return this.db.ping();
  }

  close(): Promise<void> {
    return this.db.close();
  }
}

async function insertPlayer(tx: Queryable, player: NewPlayer, tokenHash: string, origin: TokenOrigin, inviteId: string | null): Promise<PlayerRecord> {
  const { rows } = await tx.query(
    `insert into players as p (id, public_id, display_name) values ($1, $2, $3) returning ${PLAYER_COLUMNS}`,
    [player.id, player.publicId, player.name],
  );
  await tx.query('insert into player_tokens (token_hash, player_id, origin, invite_id) values ($1, $2, $3, $4)', [tokenHash, player.id, origin, inviteId]);
  return toPlayer(rows[0]);
}

function toPlayer(r: Row): PlayerRecord {
  return {
    id: String(r.id),
    publicId: String(r.public_id),
    name: String(r.display_name),
    createdAt: r.created_at as Date,
    lastSeenAt: r.last_seen_at as Date,
    revoked: r.revoked_at !== null,
  };
}

function toInvite(r: Row): InviteRecord {
  return {
    id: String(r.id),
    label: String(r.label),
    maxUses: Number(r.max_uses),
    uses: Number(r.uses),
    createdAt: r.created_at as Date,
    expiresAt: (r.expires_at as Date | null) ?? null,
    revoked: r.revoked_at !== null,
  };
}

function toWorld(r: Row): WorldRecord {
  return { id: String(r.id), name: String(r.name), format: Number(r.format), createdAt: r.created_at as Date, settings: (r.settings as Record<string, unknown>) ?? {} };
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

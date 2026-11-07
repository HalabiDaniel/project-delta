import { randomUUID } from 'node:crypto';
import type { FeedbackCategory } from '../../src/net/protocol';
import { Database, type Queryable, type Row } from '../db/Database';
import {
  BASE_FORMAT,
  checkAircraft,
  checkBaseState,
  cleanTips,
  checkLimits,
  checkTransaction,
  checkMerit,
  type MeritAward,
  type MeritRecord,
  type MeritResult,
  IncompatibleBaseError,
  IncompatibleSaveError,
  SAVE_FORMAT,
  type AircraftRecord,
  checkFeedback,
  type FeedbackRecord,
  type NewFeedback,
  type BasePlacement,
  type MissionOutcome,
  type ProgressRecord,
  type PvpRecord,
  cleanDesks,
  type SessionRecord,
  type SessionRecordStatus,
  type UsernameResult,
  type BaseRecord,
  type BaseState,
  type EconomyRecord,
  type InviteRecord,
  type InviteRefusal,
  type NewInvite,
  type NewPlayer,
  type PlaceResult,
  type PlayerRecord,
  type Store,
  type TokenOrigin,
  type TransactionInput,
  type LedgerResource,
  type TransactionRecord,
  type TransactionResult,
  type WorldRecord,
} from './Store';

const PLAYER_COLUMNS = 'p.id, p.public_id, p.display_name, p.created_at, p.last_seen_at, p.revoked_at, p.username, p.username_changed_at';
const INVITE_COLUMNS = 'id, label, max_uses, uses, created_at, expires_at, revoked_at';

/** The balances column of a resource (never from player input: only these three). */
function columnOf(resource: LedgerResource): 'paper' | 'ink' | 'rubber' {
  if (resource !== 'paper' && resource !== 'ink' && resource !== 'rubber') throw new Error(`unknown resource ${String(resource)}`);
  return resource;
}

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
        where ($1::uuid is not null and p.id = $1::uuid) or p.public_id = $2 or p.display_name = $2 or lower(p.username) = lower($2)
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

  async tutorial(playerId: string): Promise<unknown> {
    if (!isUuid(playerId)) return null;
    const { rows } = await this.db.query('select tutorial from players where id = $1', [playerId]);
    const t = rows[0]?.tutorial as Record<string, unknown> | undefined;
    return t && Object.keys(t).length > 0 ? t : null;
  }

  async setTutorial(playerId: string, record: Record<string, unknown>): Promise<void> {
    if (!isUuid(playerId)) return;
    await this.db.query('update players set tutorial = $2::jsonb where id = $1', [playerId, JSON.stringify(record)]);
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

  async balance(worldId: string, playerId: string, resource: LedgerResource = 'paper'): Promise<number> {
    const column = columnOf(resource);
    const { rows } = await this.db.query<{ amount: string | null }>(`select ${column} as amount from balances where world_id = $1 and player_id = $2`, [worldId, playerId]);
    return rows.length > 0 ? Number(rows[0].amount ?? 0) : 0;
  }

  async applyTransaction(t: TransactionInput): Promise<TransactionResult> {
    checkTransaction(t);
    return this.db.transaction(async (tx) => {
      await tx.query('insert into balances (world_id, player_id) values ($1, $2) on conflict do nothing', [t.worldId, t.playerId]);
      // The balance row is the lock: changes to one player's paper happen one after another.
      const resource = t.resource ?? 'paper';
      const column = columnOf(resource);
      const locked = await tx.query<{ amount: string | null }>(`select ${column} as amount from balances where world_id = $1 and player_id = $2 for update`, [t.worldId, t.playerId]);
      const balance = Number(locked.rows[0].amount ?? 0);
      // Seen this key before? (Checked after the lock: a racing twin has committed or rolled back by now.)
      const seen = await tx.query('select 1 from transactions where world_id = $1 and idem_key = $2', [t.worldId, t.key]);
      if (seen.rows.length > 0) return { status: 'duplicate' as const, balance };
      const after = balance + t.amount;
      if (after < 0) return { status: 'insufficient' as const, balance };
      // The unique (world_id, idem_key) constraint is the last word: a twin for another player
      // with the same key would fail here and roll the whole change back.
      await tx.query(
        `insert into transactions (world_id, player_id, idem_key, kind, amount, balance_after, reason, reference, resource)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [t.worldId, t.playerId, t.key, t.kind, t.amount, after, t.reason, t.reference ?? null, resource],
      );
      await tx.query(`update balances set ${column} = $3, updated_at = now() where world_id = $1 and player_id = $2`, [t.worldId, t.playerId, after]);
      return { status: 'applied' as const, balance: after };
    });
  }

  async transactions(worldId: string, playerId: string, limit = 100): Promise<TransactionRecord[]> {
    const { rows } = await this.db.query(
      `select world_id, player_id, idem_key, kind, amount, balance_after, reason, reference, resource, created_at
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
      resource: String(r.resource) as LedgerResource,
      createdAt: r.created_at as Date,
    }));
  }

  async economy(worldId: string, playerId: string): Promise<EconomyRecord | null> {
    if (!isUuid(playerId)) return null;
    const { rows } = await this.db.query('select paper, capacity, protected, ink, rubber from balances where world_id = $1 and player_id = $2', [worldId, playerId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return { paper: Number(r.paper), capacity: Number(r.capacity), protected: Number(r.protected), ink: r.ink === null ? null : Number(r.ink), rubber: r.rubber === null ? null : Number(r.rubber) };
  }

  async setEconomyLimits(worldId: string, playerId: string, capacity: number, protectedPaper: number): Promise<void> {
    checkLimits(capacity, protectedPaper);
    await this.db.query(
      `insert into balances (world_id, player_id, capacity, protected) values ($1, $2, $3, $4)
       on conflict (world_id, player_id) do update set capacity = excluded.capacity, protected = excluded.protected, updated_at = now()`,
      [worldId, playerId, capacity, protectedPaper],
    );
  }

  // ---- What travels with the player -------------------------------------------------------------

  async aircraft(worldId: string, playerId: string): Promise<AircraftRecord[]> {
    if (!isUuid(playerId)) return [];
    const { rows } = await this.db.query(
      `select id, type, status, health, loadout from aircraft where world_id = $1 and player_id = $2 and status <> 'destroyed' order by created_at, id`,
      [worldId, playerId],
    );
    return rows.map((r) => ({ id: String(r.id), type: String(r.type), status: r.status as AircraftRecord['status'], health: Number(r.health), loadout: (r.loadout as Record<string, unknown>) ?? {} }));
  }

  async saveAircraft(worldId: string, playerId: string, alive: AircraftRecord[]): Promise<void> {
    checkAircraft(alive);
    await this.db.transaction(async (tx) => {
      // Lost since the last save: destroyed, for good (the trigger keeps them so).
      await tx.query(
        `update aircraft set status = 'destroyed', destroyed_at = now(), updated_at = now()
          where world_id = $1 and player_id = $2 and status <> 'destroyed' and not (id = any($3::uuid[]))`,
        [worldId, playerId, alive.map((a) => a.id)],
      );
      for (const a of alive) {
        // A plane id belongs to one player in one world: another's row is never overwritten.
        const { rowCount } = await tx.query(
          `insert into aircraft as x (id, world_id, player_id, type, status, health, loadout) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
           on conflict (id) do update set type = excluded.type, status = excluded.status, health = excluded.health, loadout = excluded.loadout, updated_at = now()
            where x.world_id = excluded.world_id and x.player_id = excluded.player_id`,
          [a.id, worldId, playerId, a.type, a.status, a.health, JSON.stringify(a.loadout)],
        );
        if ((rowCount ?? 0) === 0) throw new Error(`aircraft ${a.id} belongs to someone else`);
      }
    });
  }

  async progress(worldId: string, playerId: string): Promise<ProgressRecord | null> {
    if (!isUuid(playerId)) return null;
    const { rows } = await this.db.query('select stats, director, garage, profile, protect_until, shield_until from progress where world_id = $1 and player_id = $2', [worldId, playerId]);
    if (rows.length === 0) return null;
    const director = rows[0].director as Record<string, unknown> | null;
    return {
      stats: (rows[0].stats as Record<string, number>) ?? {},
      director: director && Object.keys(director).length > 0 ? director : null,
      garage: (rows[0].garage as Record<string, unknown>) ?? {},
      profile: rows[0].profile && Object.keys(rows[0].profile as object).length > 0 ? rows[0].profile : null,
      protectUntil: (rows[0].protect_until as Date | null) ?? null,
      shieldUntil: (rows[0].shield_until as Date | null) ?? null,
    };
  }

  async saveProgress(worldId: string, playerId: string, record: ProgressRecord): Promise<void> {
    await this.db.query(
      `insert into progress (world_id, player_id, stats, director, garage, protect_until, shield_until, profile) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb)
       on conflict (world_id, player_id) do update set stats = excluded.stats, director = excluded.director, garage = excluded.garage,
         protect_until = excluded.protect_until, shield_until = excluded.shield_until,
         profile = case when excluded.profile = '{}'::jsonb then progress.profile else excluded.profile end, updated_at = now()`,
      [worldId, playerId, JSON.stringify(record.stats), JSON.stringify(record.director ?? {}), JSON.stringify(record.garage), record.protectUntil ?? null, record.shieldUntil ?? null, JSON.stringify(record.profile ?? {})],
    );
  }

  async recordMission(worldId: string, playerId: string, o: MissionOutcome): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `insert into missions (id, world_id, player_id, template, state, spec, resolved_at, outcome, reward)
       values ($1, $2, $3, $4, $5, $6::jsonb, now(), $7, $8) on conflict (id) do nothing`,
      [o.id, worldId, playerId, o.template, o.state, JSON.stringify(o.spec), o.outcome, o.reward],
    );
    return (rowCount ?? 0) > 0;
  }

  async addPvpRecord(worldId: string, r: PvpRecord): Promise<void> {
    // The record's id lives in `data`; one already written is left alone.
    await this.db.query(
      `insert into pvp_records (world_id, kind, attacker_id, victim_id, success, at, data)
       select $1, $2, $3, $4, $5, $6, jsonb_build_object('id', $7::text)
        where not exists (select 1 from pvp_records where world_id = $1 and data ->> 'id' = $7::text)`,
      [worldId, r.kind, r.attacker, r.victim, r.success, r.at, r.id],
    );
  }

  async pvpRecords(worldId: string, playerId: string, since: Date): Promise<PvpRecord[]> {
    if (!isUuid(playerId)) return [];
    const { rows } = await this.db.query(
      `select r.data ->> 'id' as id, r.kind, a.public_id as attacker, v.public_id as victim, r.success, r.at
         from pvp_records r join players a on a.id = r.attacker_id join players v on v.id = r.victim_id
        where r.world_id = $1 and (r.attacker_id = $2 or r.victim_id = $2) and r.at >= $3
        order by r.at, r.id`,
      [worldId, playerId, since],
    );
    return rows.map((r) => ({ id: String(r.id), kind: r.kind as PvpRecord['kind'], attacker: String(r.attacker), victim: String(r.victim), success: r.success === true, at: r.at as Date }));
  }

  async setUsername(playerId: string, username: string, cooldownSeconds: number): Promise<UsernameResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query('select username, username_changed_at from players where id = $1 for update', [playerId]);
        if (rows.length === 0) throw new Error(`no player ${playerId}`);
        const current = rows[0].username as string | null;
        if (current === username) return 'same' as const;
        const changed = rows[0].username_changed_at as Date | null;
        if (current !== null && changed && Date.now() - changed.getTime() < cooldownSeconds * 1000 && current.toLowerCase() !== username.toLowerCase()) return 'cooldown' as const;
        const taken = await tx.query('select 1 from players where lower(username) = lower($1) and id <> $2', [username, playerId]);
        if (taken.rows.length > 0) return 'taken' as const;
        await tx.query('update players set username = $2, display_name = $2, username_changed_at = now() where id = $1', [playerId, username]);
        return 'ok' as const;
      });
    } catch (error) {
      // Two players asking for the same name at once: the unique index decides.
      if ((error as { code?: string }).code === '23505') return 'taken';
      throw error;
    }
  }

  async tips(playerId: string): Promise<string[]> {
    if (!isUuid(playerId)) return [];
    const { rows } = await this.db.query('select tips from players where id = $1', [playerId]);
    const t = rows[0]?.tips;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
  }

  async setTips(playerId: string, tips: string[]): Promise<void> {
    if (!isUuid(playerId)) return;
    await this.db.query('update players set tips = $2::jsonb where id = $1', [playerId, JSON.stringify(cleanTips(tips))]);
  }

  // ---- Merit and ranks (v0.0.17) -----------------------------------------------------------------

  async awardMerit(a: MeritAward): Promise<MeritResult> {
    checkMerit(a);
    if (!isUuid(a.playerId)) throw new Error(`no player ${a.playerId}`);
    // The unique (player_id, idem_key) constraint decides: a racing twin inserts nothing.
    const inserted = await this.db.query(
      `insert into merit_ledger (player_id, idem_key, source, amount, reason) values ($1, $2, $3, $4, $5)
       on conflict (player_id, idem_key) do nothing returning id`,
      [a.playerId, a.key, a.source, a.amount, a.reason],
    );
    const total = await this.merit(a.playerId);
    return { status: inserted.rows.length > 0 ? 'applied' : 'duplicate', total };
  }

  async merit(playerId: string): Promise<number> {
    if (!isUuid(playerId)) return 0;
    const { rows } = await this.db.query<{ total: string | null }>('select sum(amount) as total from merit_ledger where player_id = $1', [playerId]);
    return Number(rows[0]?.total ?? 0);
  }

  async meritHistory(playerId: string, limit = 100): Promise<MeritRecord[]> {
    if (!isUuid(playerId)) return [];
    const { rows } = await this.db.query('select idem_key, source, amount, reason, created_at from merit_ledger where player_id = $1 order by id desc limit $2', [playerId, limit]);
    return rows.map((r) => ({ playerId, key: String(r.idem_key), source: String(r.source), amount: Number(r.amount), reason: String(r.reason), createdAt: r.created_at as Date }));
  }

  async rankPrefs(playerId: string): Promise<Record<string, unknown> | null> {
    if (!isUuid(playerId)) return null;
    const { rows } = await this.db.query('select rank_prefs from players where id = $1', [playerId]);
    const p = rows[0]?.rank_prefs;
    return p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0 ? (p as Record<string, unknown>) : null;
  }

  async setRankPrefs(playerId: string, prefs: Record<string, unknown>): Promise<void> {
    if (!isUuid(playerId)) return;
    await this.db.query('update players set rank_prefs = $2::jsonb where id = $1', [playerId, JSON.stringify(prefs)]);
  }

  // ---- Portable bases ---------------------------------------------------------------------------

  async base(playerId: string): Promise<BaseRecord | null> {
    if (!isUuid(playerId)) return null;
    return readBase(this.db, playerId);
  }

  async placeBase(playerId: string, holder: string, territoryId: string, leaseSeconds: number): Promise<PlaceResult> {
    return this.db.transaction(async (tx) => {
      // Taken only if nobody holds it, the same holder does, or the holder's lease ran out. The
      // upsert's condition is checked on the locked row, so two rooms placing at once can't both win.
      const { rows } = await tx.query(
        `insert into bases as b (player_id, placed_by, placed_on, placed_at, lease_until)
              values ($1, $2, $3, now(), now() + make_interval(secs => $4))
         on conflict (player_id) do update
                 set placed_by = excluded.placed_by, placed_on = excluded.placed_on,
                     placed_at = case when b.placed_by = excluded.placed_by and b.placed_on = excluded.placed_on then b.placed_at else now() end,
                     lease_until = excluded.lease_until
               where b.placed_by is null or b.placed_by = excluded.placed_by or b.lease_until <= now()
         returning player_id`,
        [playerId, holder, territoryId, leaseSeconds],
      );
      const record = await readBase(tx, playerId);
      if (!record) throw new Error(`base of ${playerId} vanished while it was placed`);
      if (rows.length === 0) return { status: 'elsewhere' as const, placement: record.placement! };
      return { status: 'placed' as const, state: record.state };
    });
  }

  async saveBase(playerId: string, holder: string, state: BaseState, leaseSeconds: number): Promise<boolean> {
    checkBaseState(state);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `update bases set lease_until = now() + make_interval(secs => $3) where player_id = $1 and placed_by = $2 returning player_id`,
        [playerId, holder, leaseSeconds],
      );
      if (rows.length === 0) return false;
      await writeBase(tx, playerId, state);
      return true;
    });
  }

  async packBase(playerId: string, holder: string, state: BaseState): Promise<boolean> {
    checkBaseState(state);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `update bases set placed_by = null, placed_on = null, placed_at = null, lease_until = null where player_id = $1 and placed_by = $2 returning player_id`,
        [playerId, holder],
      );
      if (rows.length === 0) return false;
      await writeBase(tx, playerId, state);
      return true;
    });
  }

  async releaseBase(playerId: string, holder?: string): Promise<boolean> {
    if (!isUuid(playerId)) return false;
    const { rowCount } = await this.db.query(
      `update bases set placed_by = null, placed_on = null, placed_at = null, lease_until = null
        where player_id = $1 and placed_by is not null and ($2::text is null or placed_by = $2)`,
      [playerId, holder ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  // ---- Sessions (v0.0.13) -----------------------------------------------------------------------

  async recordSession(r: SessionRecord): Promise<void> {
    await this.db.query(
      `insert into sessions (id, title, capacity, status, peak_players, created_at, started_at, ends_at, ended_at, desks)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do update set title = excluded.title, capacity = excluded.capacity, status = excluded.status,
         peak_players = greatest(sessions.peak_players, excluded.peak_players), started_at = excluded.started_at,
         ends_at = excluded.ends_at, ended_at = excluded.ended_at, desks = excluded.desks`,
      [r.id, r.title, r.capacity, r.status, r.peakPlayers, r.createdAt, r.startedAt, r.endsAt, r.endedAt, JSON.stringify(cleanDesks(r.desks))],
    );
  }

  async sessionRecords(statuses?: SessionRecordStatus[]): Promise<SessionRecord[]> {
    const { rows } = statuses
      ? await this.db.query('select * from sessions where status = any($1::text[]) order by created_at desc, id', [statuses])
      : await this.db.query('select * from sessions order by created_at desc, id');
    return rows.map((r) => ({
      id: String(r.id), title: String(r.title), capacity: Number(r.capacity), status: r.status as SessionRecordStatus, peakPlayers: Number(r.peak_players),
      createdAt: r.created_at as Date, startedAt: (r.started_at as Date | null) ?? null, endsAt: (r.ends_at as Date | null) ?? null, endedAt: (r.ended_at as Date | null) ?? null,
      desks: cleanDesks(r.desks),
    }));
  }

  // ---- Playtest feedback (v0.0.14) ----------------------------------------------------------------

  async addFeedback(f: NewFeedback): Promise<void> {
    checkFeedback(f);
    await this.db.query(
      `insert into feedback (world_id, player_id, category, body, repro, rating, context) values ($1, $2, $3, $4, $5, $6, $7)`,
      [f.worldId, f.playerId, f.category, f.body, f.repro, f.rating, JSON.stringify(f.context)],
    );
  }

  async feedback(since?: Date): Promise<FeedbackRecord[]> {
    const { rows } = await this.db.query(
      `select f.*, coalesce(p.username, p.display_name) as player_name
         from feedback f left join players p on p.id = f.player_id
        where $1::timestamptz is null or f.created_at >= $1
        order by f.created_at, f.id`,
      [since ?? null],
    );
    return rows.map((r) => ({
      id: Number(r.id), worldId: (r.world_id as string | null) ?? null, playerId: (r.player_id as string | null) ?? null, playerName: (r.player_name as string | null) ?? null,
      category: r.category as FeedbackCategory, body: String(r.body), repro: (r.repro as string | null) ?? null, rating: r.rating === null ? null : Number(r.rating),
      context: (r.context as Record<string, unknown>) ?? {}, createdAt: r.created_at as Date,
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
    username: r.username === null || r.username === undefined ? null : String(r.username),
    usernameChangedAt: (r.username_changed_at as Date | null) ?? null,
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

async function readBase(q: Queryable, playerId: string): Promise<BaseRecord | null> {
  const { rows } = await q.query('select * from bases where player_id = $1', [playerId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  const format = Number(r.format);
  if (format > BASE_FORMAT) throw new IncompatibleBaseError(playerId, format);
  const placement: BasePlacement | null = r.placed_by === null ? null : { holder: String(r.placed_by), territoryId: String(r.placed_on), leaseUntil: r.lease_until as Date };
  let state: BaseState | null = null;
  if (r.store_health !== null) {
    const b = await q.query('select slot, kind, level, health, data from base_buildings where player_id = $1 order by slot', [playerId]);
    state = {
      storeHealth: Number(r.store_health),
      stats: (r.stats as Record<string, unknown>) ?? {},
      buildings: b.rows.map((x) => ({ slot: String(x.slot), kind: x.kind as BaseState['buildings'][number]['kind'], level: Number(x.level), health: Number(x.health), data: (x.data as Record<string, unknown>) ?? {} })),
    };
  }
  return { playerId, state, placement, updatedAt: r.updated_at as Date };
}

/** Replaces the saved base (inside the caller's transaction, after it checked who holds it). */
async function writeBase(tx: Queryable, playerId: string, state: BaseState): Promise<void> {
  await tx.query('update bases set format = $2, store_health = $3, stats = $4::jsonb, updated_at = now() where player_id = $1', [playerId, BASE_FORMAT, state.storeHealth, JSON.stringify(state.stats)]);
  await tx.query('delete from base_buildings where player_id = $1', [playerId]);
  for (const b of state.buildings) {
    await tx.query('insert into base_buildings (player_id, slot, kind, level, health, data) values ($1, $2, $3, $4, $5, $6::jsonb)', [playerId, b.slot, b.kind, b.level, b.health, JSON.stringify(b.data)]);
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

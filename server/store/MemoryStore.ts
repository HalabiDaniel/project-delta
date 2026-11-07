import { randomUUID } from 'node:crypto';
import {
  checkAircraft,
  checkBaseState,
  cleanTips,
  checkLimits,
  checkTransaction,
  checkMerit,
  type MeritAward,
  type MeritRecord,
  type MeritResult,
  IncompatibleSaveError,
  SAVE_FORMAT,
  type AircraftRecord,
  checkFeedback,
  type FeedbackRecord,
  type NewFeedback,
  type BaseRecord,
  type MissionOutcome,
  type ProgressRecord,
  type PvpRecord,
  cleanDesks,
  type SessionRecord,
  type SessionRecordStatus,
  type UsernameResult,
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

/** Paper keeps the original key ("world/player"); ink and rubber balls add the resource. */
function balanceKey(worldId: string, playerId: string, resource: LedgerResource): string {
  return resource === 'paper' ? `${worldId}/${playerId}` : `${worldId}/${playerId}/${resource}`;
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
  private readonly limits = new Map<string, { capacity: number; protected: number }>();
  private readonly log: TransactionRecord[] = [];
  private readonly keys = new Set<string>();
  private readonly tutorials = new Map<string, Record<string, unknown>>();
  private readonly bases = new Map<string, BaseRecord>();
  /** Every plane ever saved, by id, with its owner and whether it was destroyed. */
  private readonly planes = new Map<string, AircraftRecord & { at: string; destroyed: boolean }>();
  private readonly progresses = new Map<string, ProgressRecord>();
  private readonly outcomes = new Map<string, MissionOutcome & { at: string }>();
  private readonly tipsOf = new Map<string, string[]>();
  private readonly meritRows: MeritRecord[] = [];
  private readonly meritKeys = new Set<string>();
  private readonly prefs = new Map<string, Record<string, unknown>>();
  private readonly pvp: Array<PvpRecord & { worldId: string }> = [];
  private readonly sessionRows = new Map<string, SessionRecord>();
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
    const record: PlayerRecord = { ...player, createdAt: now, lastSeenAt: now, revoked: false, username: null, usernameChangedAt: null };
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
    const lower = query.toLowerCase();
    return [...this.players.values()].filter((p) => p.id === query || p.publicId === query || p.name === query || p.username?.toLowerCase() === lower).map((p) => ({ ...p }));
  }

  async listPlayers(): Promise<PlayerRecord[]> {
    return [...this.players.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => ({ ...p }));
  }

  async rename(playerId: string, name: string): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.name = name;
  }

  async tutorial(playerId: string): Promise<unknown> {
    const t = this.tutorials.get(playerId);
    return t ? { ...t } : null;
  }

  async setTutorial(playerId: string, record: Record<string, unknown>): Promise<void> {
    if (this.players.has(playerId)) this.tutorials.set(playerId, { ...record });
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

  async balance(worldId: string, playerId: string, resource: LedgerResource = 'paper'): Promise<number> {
    return this.balances.get(balanceKey(worldId, playerId, resource)) ?? 0;
  }

  async applyTransaction(tx: TransactionInput): Promise<TransactionResult> {
    checkTransaction(tx);
    const resource = tx.resource ?? 'paper';
    const at = balanceKey(tx.worldId, tx.playerId, resource);
    const balance = this.balances.get(at) ?? 0;
    if (this.keys.has(`${tx.worldId}/${tx.key}`)) return { status: 'duplicate', balance };
    if (balance + tx.amount < 0) return { status: 'insufficient', balance };
    const after = balance + tx.amount;
    this.balances.set(at, after);
    this.keys.add(`${tx.worldId}/${tx.key}`);
    this.log.push({ worldId: tx.worldId, playerId: tx.playerId, key: tx.key, kind: tx.kind, amount: tx.amount, reason: tx.reason, reference: tx.reference ?? null, resource, balanceAfter: after, createdAt: new Date() });
    return { status: 'applied', balance: after };
  }

  async transactions(worldId: string, playerId: string, limit = 100): Promise<TransactionRecord[]> {
    return this.log
      .filter((t) => t.worldId === worldId && t.playerId === playerId)
      .slice(-limit)
      .reverse()
      .map((t) => ({ ...t }));
  }

  async economy(worldId: string, playerId: string): Promise<EconomyRecord | null> {
    const at = `${worldId}/${playerId}`;
    if (!this.balances.has(at) && !this.limits.has(at)) return null;
    const l = this.limits.get(at) ?? { capacity: 0, protected: 0 };
    const ink = this.balances.get(balanceKey(worldId, playerId, 'ink'));
    const rubber = this.balances.get(balanceKey(worldId, playerId, 'rubber'));
    return { paper: this.balances.get(at) ?? 0, capacity: l.capacity, protected: l.protected, ink: ink ?? null, rubber: rubber ?? null };
  }

  async setEconomyLimits(worldId: string, playerId: string, capacity: number, protectedPaper: number): Promise<void> {
    checkLimits(capacity, protectedPaper);
    const at = `${worldId}/${playerId}`;
    if (!this.balances.has(at)) this.balances.set(at, 0);
    this.limits.set(at, { capacity, protected: protectedPaper });
  }

  // ---- What travels with the player -------------------------------------------------------------

  async aircraft(worldId: string, playerId: string): Promise<AircraftRecord[]> {
    const at = `${worldId}/${playerId}`;
    return [...this.planes.values()].filter((p) => p.at === at && !p.destroyed).map(({ at: _a, destroyed: _d, ...a }) => structuredClone(a));
  }

  async saveAircraft(worldId: string, playerId: string, alive: AircraftRecord[]): Promise<void> {
    checkAircraft(alive);
    const at = `${worldId}/${playerId}`;
    for (const a of alive) {
      const known = this.planes.get(a.id);
      if (known && (known.at !== at || known.destroyed)) throw new Error(`aircraft ${a.id} was destroyed and cannot be restored`);
    }
    const listed = new Set(alive.map((a) => a.id));
    for (const p of this.planes.values()) if (p.at === at && !p.destroyed && !listed.has(p.id)) p.destroyed = true;
    for (const a of alive) this.planes.set(a.id, { ...structuredClone(a), at, destroyed: false });
  }

  async progress(worldId: string, playerId: string): Promise<ProgressRecord | null> {
    const p = this.progresses.get(`${worldId}/${playerId}`);
    return p ? structuredClone(p) : null;
  }

  async saveProgress(worldId: string, playerId: string, record: ProgressRecord): Promise<void> {
    if (!this.players.has(playerId)) throw new Error(`no player ${playerId}`);
    const before = this.progresses.get(`${worldId}/${playerId}`);
    // As PgStore: a record without a profile keeps the one saved before.
    const profile = record.profile ?? before?.profile ?? null;
    this.progresses.set(`${worldId}/${playerId}`, structuredClone({ ...record, profile, protectUntil: record.protectUntil ?? null, shieldUntil: record.shieldUntil ?? null }));
  }

  async recordMission(worldId: string, playerId: string, outcome: MissionOutcome): Promise<boolean> {
    if (this.outcomes.has(outcome.id)) return false;
    this.outcomes.set(outcome.id, { ...structuredClone(outcome), at: `${worldId}/${playerId}` });
    return true;
  }

  async addPvpRecord(worldId: string, record: PvpRecord): Promise<void> {
    if (this.pvp.some((r) => r.id === record.id)) return;
    this.pvp.push({ ...record, at: new Date(record.at), worldId });
  }

  async pvpRecords(worldId: string, playerId: string, since: Date): Promise<PvpRecord[]> {
    const pub = (id: string) => this.players.get(id)?.publicId ?? id;
    return this.pvp
      .filter((r) => r.worldId === worldId && (r.attacker === playerId || r.victim === playerId) && r.at.getTime() >= since.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((r) => ({ id: r.id, kind: r.kind, attacker: pub(r.attacker), victim: pub(r.victim), success: r.success, at: new Date(r.at) }));
  }

  async setUsername(playerId: string, username: string, cooldownSeconds: number): Promise<UsernameResult> {
    const p = this.players.get(playerId);
    if (!p) throw new Error(`no player ${playerId}`);
    if (p.username === username) return 'same';
    const lower = username.toLowerCase();
    if ([...this.players.values()].some((o) => o.id !== playerId && o.username?.toLowerCase() === lower)) return 'taken';
    if (p.username !== null && p.usernameChangedAt && Date.now() - p.usernameChangedAt.getTime() < cooldownSeconds * 1000 && p.username.toLowerCase() !== lower) return 'cooldown';
    p.username = username;
    p.name = username;
    p.usernameChangedAt = new Date();
    return 'ok';
  }

  async tips(playerId: string): Promise<string[]> {
    return [...(this.tipsOf.get(playerId) ?? [])];
  }

  async setTips(playerId: string, tips: string[]): Promise<void> {
    if (this.players.has(playerId)) this.tipsOf.set(playerId, cleanTips(tips));
  }

  // ---- Merit and ranks (v0.0.17) -----------------------------------------------------------------

  async awardMerit(a: MeritAward): Promise<MeritResult> {
    checkMerit(a);
    if (!this.players.has(a.playerId)) throw new Error(`no player ${a.playerId}`);
    const k = `${a.playerId}|${a.key}`;
    if (this.meritKeys.has(k)) return { status: 'duplicate', total: await this.merit(a.playerId) };
    this.meritKeys.add(k);
    this.meritRows.push({ ...a, createdAt: new Date() });
    return { status: 'applied', total: await this.merit(a.playerId) };
  }

  async merit(playerId: string): Promise<number> {
    let total = 0;
    for (const r of this.meritRows) if (r.playerId === playerId) total += r.amount;
    return total;
  }

  async meritHistory(playerId: string, limit = 100): Promise<MeritRecord[]> {
    return this.meritRows.filter((r) => r.playerId === playerId).reverse().slice(0, limit).map((r) => ({ ...r }));
  }

  async rankPrefs(playerId: string): Promise<Record<string, unknown> | null> {
    const p = this.prefs.get(playerId);
    return p ? structuredClone(p) : null;
  }

  async setRankPrefs(playerId: string, prefs: Record<string, unknown>): Promise<void> {
    if (this.players.has(playerId)) this.prefs.set(playerId, structuredClone(prefs));
  }

  // ---- Portable bases ---------------------------------------------------------------------------

  async base(playerId: string): Promise<BaseRecord | null> {
    const b = this.bases.get(playerId);
    return b ? copyBase(b) : null;
  }

  async placeBase(playerId: string, holder: string, territoryId: string, leaseSeconds: number): Promise<PlaceResult> {
    if (!this.players.has(playerId)) throw new Error(`no player ${playerId}`);
    let b = this.bases.get(playerId);
    if (!b) {
      b = { playerId, state: null, placement: null, updatedAt: new Date() };
      this.bases.set(playerId, b);
    }
    const p = b.placement;
    if (p && p.holder !== holder && p.leaseUntil.getTime() > Date.now()) return { status: 'elsewhere', placement: { ...p } };
    b.placement = { holder, territoryId, leaseUntil: new Date(Date.now() + leaseSeconds * 1000) };
    return { status: 'placed', state: b.state ? copyState(b.state) : null };
  }

  async saveBase(playerId: string, holder: string, state: BaseState, leaseSeconds: number): Promise<boolean> {
    checkBaseState(state);
    const b = this.bases.get(playerId);
    if (!b?.placement || b.placement.holder !== holder) return false;
    b.placement.leaseUntil = new Date(Date.now() + leaseSeconds * 1000);
    b.state = copyState(state);
    b.updatedAt = new Date();
    return true;
  }

  async packBase(playerId: string, holder: string, state: BaseState): Promise<boolean> {
    checkBaseState(state);
    const b = this.bases.get(playerId);
    if (!b?.placement || b.placement.holder !== holder) return false;
    b.placement = null;
    b.state = copyState(state);
    b.updatedAt = new Date();
    return true;
  }

  async releaseBase(playerId: string, holder?: string): Promise<boolean> {
    const b = this.bases.get(playerId);
    if (!b?.placement || (holder !== undefined && b.placement.holder !== holder)) return false;
    b.placement = null;
    return true;
  }

  async recordSession(record: SessionRecord): Promise<void> {
    const before = this.sessionRows.get(record.id);
    this.sessionRows.set(record.id, { ...copySession(record), createdAt: before ? new Date(before.createdAt) : new Date(record.createdAt), peakPlayers: Math.max(before?.peakPlayers ?? 0, record.peakPlayers) });
  }

  async sessionRecords(statuses?: SessionRecordStatus[]): Promise<SessionRecord[]> {
    return [...this.sessionRows.values()]
      .filter((r) => !statuses || statuses.includes(r.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copySession);
  }

  private readonly feedbackRows: FeedbackRecord[] = [];

  async addFeedback(entry: NewFeedback): Promise<void> {
    checkFeedback(entry);
    const player = entry.playerId ? this.players.get(entry.playerId) : undefined;
    this.feedbackRows.push({ ...entry, context: { ...entry.context }, id: this.feedbackRows.length + 1, playerName: player ? (player.username ?? player.name) : null, createdAt: new Date() });
  }

  async feedback(since?: Date): Promise<FeedbackRecord[]> {
    return this.feedbackRows.filter((f) => !since || f.createdAt >= since).map((f) => ({ ...f, context: { ...f.context } }));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

function copySession(r: SessionRecord): SessionRecord {
  const d = (x: Date | null) => (x ? new Date(x) : null);
  return { ...r, createdAt: new Date(r.createdAt), startedAt: d(r.startedAt), endsAt: d(r.endsAt), endedAt: d(r.endedAt), desks: cleanDesks(r.desks) };
}

function publicInvite(i: InviteRecord & { codeHash: string }): InviteRecord {
  return { id: i.id, label: i.label, maxUses: i.maxUses, uses: i.uses, createdAt: i.createdAt, expiresAt: i.expiresAt, revoked: i.revoked };
}

function copyState(s: BaseState): BaseState {
  return structuredClone(s);
}

function copyBase(b: BaseRecord): BaseRecord {
  return { playerId: b.playerId, state: b.state ? copyState(b.state) : null, placement: b.placement ? { ...b.placement, leaseUntil: new Date(b.placement.leaseUntil) } : null, updatedAt: new Date(b.updatedAt) };
}

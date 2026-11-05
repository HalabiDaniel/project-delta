import { Room, type Client, type Deferred } from '@colyseus/core';
import {
  CLOSE_SESSION_ENDED,
  CLOSE_TAKEN_OVER,
  EMOTES,
  SESSION_STATUSES,
  NET,
  PROTOCOL_VERSION,
  cleanName,
  parseCommand,
  unpackFrames,
  type Emote,
  type JoinOptions,
  type NetEvent,
  type ResultLineDTO,
  type SessionResultsDTO,
  type TransferDTO,
  type UsernameDTO,
  type WelcomeDTO,
} from '../src/net/protocol';
import { AiState, InstallationState, PHASES, PLANE_STATUSES, PlaneState, PlayerState, TerritoryState, WorldState, INSTALLATION_STATES } from '../src/net/schema';
import { foldPose } from '../src/systems/GameState';
import { parseTutorial } from '../src/progress/Tutorial';
import { refusal, type Authenticated } from './identity/Identity';
import { economyWorld, services } from './services';
import type { AircraftRecord, EconomyRecord, PlayerRecord, ProgressRecord, PvpRecord } from './store/Store';
import { USERNAME, USERNAME_PROBLEMS, suggestUsername, usernameProblem } from '../src/net/Username';
import { ECONOMY, PVP, SESSION } from '../src/config';
import { SESSION_KEY, ensureSpare, mayClose, register, unregister, type SessionHandle } from './sessions/directory';
import { SessionClock, spokenTime, type SessionSummary } from './sessions/rules';
import type { SessionRecord } from './store/Store';
import type { PaperChange } from './world/Paper';
import { randomUUID } from 'node:crypto';
import { BASE_SAVE_EVERY, BaseKeeper, SERVER_INSTANCE } from './world/BaseKeeper';
import { fromBaseState, toBaseState } from './world/bases';
import { planesFrom, progressFrom } from './world/carry';
import { ServerWorld, type ServerWorldOptions } from './world/ServerWorld';

/** A session's settings, given by the server only (a client can't create a room). */
export interface RoomOptions extends ServerWorldOptions {
  /** Proves the server opened it (directory.ts). */
  sessionKey?: string;
  /** Shown in the session list. */
  title?: string;
  /** The session's settings where they differ from SESSION (tests and tools: short, small sessions). */
  session?: Partial<SessionSettings>;
}

/** What a session runs by (SESSION's values unless the server says otherwise). */
export interface SessionSettings {
  length: number;
  capacity: number;
  emptyClose: number;
  resultsHold: number;
}

export type { JoinOptions };

/** What Colyseus keeps about a session (the lobby reads the directory instead). */
export interface RoomMetadata {
  title: string;
  claimed: number;
  free: number;
}

/** Sessions opened by this process, for their titles ("Classroom 3"). */
let opened = 0;

/** How far back raids and kills are loaded for a placed player (s): as far as any rule looks. */
const PVP_MEMORY = Math.max(PVP.farmWindow, PVP.pairCooldown, PVP.killWindow);

/** The longest real time one simulation callback may catch up on (a stalled event loop doesn't snowball). */
const MAX_CATCH_UP = 0.25;
/** A player may ask for a transfer code this often (seconds). */
const TRANSFER_COOLDOWN = 10;
/** Connections beyond the player cap, so a returning player can take over their own seat in a full room. */
const SPARE_SEATS = 4;

/**
 * A classroom session over Colyseus: up to eight players in one shared world. The room is the
 * network edge only. It turns messages into frames and commands for the ServerWorld (which owns
 * every rule), runs the world at a fixed 60 Hz, copies what everyone may see into the schema state
 * before each patch (20 Hz), and sends each player their private state, their own plane's
 * authoritative flight and the events of the last patch.
 *
 * Identity (v0.0.10): who a connection is comes from `onAuth`, which checks the browser's device
 * token (or an invite or transfer code) with the identity service. In the world, players are known
 * by their stable public id, never by the Colyseus session id, which only names one connection.
 * One player has at most one connection: a newer one (another tab, a refresh that beat the old
 * connection's timeout, another room on this server) takes over and the older one is closed with
 * CLOSE_TAKEN_OVER.
 *
 * Connections: a player whose connection drops keeps their place, territory and plane for
 * NET.reconnectGrace seconds (their plane flies on straight ahead); a browser refresh comes back
 * with Colyseus's reconnection token, or with the device token as the same player. A player who
 * leaves (or doesn't come back in time) is removed: their base comes down and the territory is
 * free again.
 *
 * Portable bases (v0.0.12): a base belongs to the player. Claiming places the player's saved base
 * (or a new player's starting base) on a random free desk; the room saves every base standing in it
 * every BASE_SAVE_EVERY seconds and packs it when its player leaves for good. The store's lease
 * keeps a base in one place at a time (see BaseKeeper).
 */
export class WorldRoom extends Room<{ state: WorldState; metadata: RoomMetadata }> implements SessionHandle {
  /** Every player in a room on this server, and which room: one connection per player, process-wide. */
  static readonly presence = new Map<string, WorldRoom>();

  maxClients = SESSION.capacity + SPARE_SEATS;
  /** This session's length, capacity and timers. */
  settings: SessionSettings = { length: SESSION.length, capacity: SESSION.capacity, emptyClose: SESSION.emptyClose, resultsHold: SESSION.resultsHold };
  /** Input frames come about 60 times a second; anything far beyond that is abuse. */
  maxMessagesPerSecond = 240;
  world!: ServerWorld;
  private accumulator = 0;
  private pingTimer = 0;
  private readonly pings = new Map<string, number>();
  /** Connection (session id) → player (public id), for every connection, current or stale. */
  private readonly sessions = new Map<string, string>();
  /** Player (public id) → their current connection's session id. */
  private readonly current = new Map<string, string>();
  /** Dropped connections waiting to reconnect, by session id. */
  private readonly waiting = new Map<string, Deferred<Client>>();
  /** Player (public id) → their account. */
  readonly accounts = new Map<string, PlayerRecord>();
  private readonly transferAt = new Map<string, number>();
  private readonly tutorialSavedAt = new Map<string, number>();
  /** First-time tips each player has seen (by account), loaded with their tutorial. */
  private readonly tips = new Map<string, Set<string>>();
  /**
   * What the next welcome says, per connection: sent when the client says hello (messages sent
   * during onJoin arrive before the client can listen for them).
   */
  private readonly greetings = new Map<string, { reconnected: boolean; token: string | null; note?: string | null }>();
  /** Why the username a joining player asked for wasn't given, until their welcome. */
  private readonly usernameNotes = new Map<string, string | null>();
  private readonly usernameAt = new Map<string, number>();
  /** Every player this room has known: public id → account id (for raids and kills with someone who left). */
  private readonly known = new Map<string, string>();
  /** Places, saves and packs this room's bases in the store. */
  private keeper!: BaseKeeper;
  /** Players whose base is being loaded, and the desks held for them meanwhile. */
  private readonly placing = new Map<string, string>();
  private saveTimer = BASE_SAVE_EVERY;
  /** The economy world's id, once a base has been placed. */
  private worldId: string | null = null;

  // ---- The session (v0.0.13) --------------------------------------------------------------------
  /** The session's time: started by the first player, warnings, joining closing, the end. */
  hour!: SessionClock;
  private title = 'Classroom';
  private readonly createdAt = new Date();
  /** When the last player left (clock time), while nobody is here. */
  private emptySince: number | null = null;
  private peak = 0;
  private sessionTimer = 0;
  /** The results card's lines of players who left before the end. */
  private readonly departed = new Map<string, ResultLineDTO>();
  /** Paper each player earned in this session (credits only). */
  private readonly earned = new Map<string, number>();
  /** The results, once the session has ended. */
  results: SessionResultsDTO | null = null;

  onCreate(options: RoomOptions = {}): void {
    // Sessions are opened by the server alone: its seed, protection time and length are its own.
    if (options.sessionKey !== SESSION_KEY) throw new Error('Sessions are opened by the server. Use Quick join or pick one from the list.');
    // An empty session stays up for a while (SESSION.emptyClose), so it closes itself.
    this.autoDispose = false;
    for (const [k, v] of Object.entries(options.session ?? {})) if (k in this.settings && typeof v === 'number' && v > 0) this.settings[k as keyof SessionSettings] = v;
    this.maxClients = this.settings.capacity + SPARE_SEATS;
    this.hour = new SessionClock(this.settings.length);
    this.title = cleanName(options.title, `Classroom ${++opened}`);
    this.emptySince = Date.now();
    register(this.roomId, this);
    this.world = new ServerWorld(options);
    this.keeper = new BaseKeeper(() => services().store, `${SERVER_INSTANCE}/${this.roomId}`);
    this.state = new WorldState();
    for (const t of this.world.territories) {
      const ts = new TerritoryState();
      ts.threat = t.threat;
      ts.claimable = this.world.shared.claimable.includes(t.id);
      this.state.territories.set(t.id, ts);
    }
    this.setPatchRate(NET.patchMs);
    void this.setMetadata({ title: this.title, claimed: 0, free: this.world.shared.claimable.length });
    this.recordSession();
    console.log(`[room ${this.roomId}] session "${this.title}" opened (${this.hour.length} s, ${this.settings.capacity} players)`);
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / NET.tickRate);

    this.onMessage('in', (client, data: unknown) => {
      const id = this.idOf(client);
      if (id) this.world.input(id, unpackFrames(data));
    });
    this.onMessage('claim', (client, data: unknown) => {
      const territory = typeof (data as { t?: unknown })?.t === 'string' ? (data as { t: string }).t : '';
      void this.placeBase(client, territory);
    });
    this.onMessage('cmd', (client, data: unknown) => {
      const id = this.idOf(client);
      if (!id) return;
      const cmd = parseCommand(data);
      if (cmd) this.world.command(id, cmd);
      // Answer at once, so buttons feel immediate.
      this.sendPrivate(client, false);
    });
    this.onMessage('emote', (client, data: unknown) => {
      const id = this.idOf(client);
      const e = (data as { e?: unknown })?.e;
      if (id && EMOTES.includes(e as Emote)) this.world.emote(id, e as Emote);
    });
    this.onMessage('pong', (client, data: unknown) => {
      const id = this.idOf(client);
      const sent = id ? this.pings.get(id) : undefined;
      if (!id || sent === undefined || (data as { n?: unknown })?.n !== sent) return;
      this.world.setRtt(id, (performance.now() - sent) / 1000);
    });
    this.onMessage('hello', (client) => this.welcome(client));
    this.onMessage('transfer', (client) => void this.sendTransferCode(client));
    this.onMessage('tutorial', (client, data: unknown) => void this.saveTutorial(client, data));
    this.onMessage('tip', (client, data: unknown) => void this.saveTip(client, data));
    this.onMessage('username', (client, data: unknown) => void this.setUsername(client, data));
    this.onMessage('*', () => {
      // Unknown message types are ignored.
    });
  }

  /** Who is connecting: their device token (or code) checked by the identity service. */
  async onAuth(_client: Client, options: Partial<JoinOptions>): Promise<Authenticated> {
    if (options?.v !== PROTOCOL_VERSION) throw refusal(`This server speaks protocol ${PROTOCOL_VERSION}; reload the page.`);
    if (this.results) throw refusal('This session has ended. Join the next one.');
    const auth = await services().identity.authenticate({ token: options.token, code: options.code, name: cleanName(options.name) });
    const refused = this.seatRefusal(auth.player.publicId);
    if (refused) throw refusal(refused);
    this.usernameNotes.set(auth.player.publicId, await this.chooseUsername(auth.player, options.username ?? options.name));
    return auth;
  }

  /**
   * The username the player asked for, if they may have it: their first one (which they need before
   * their base is placed), or a change (once a week). Returns why not, or null. A name that breaks
   * the rules is tried once more cleaned up ("Bo<script>" → "Boscript"), as the lobby would.
   */
  private async chooseUsername(player: PlayerRecord, raw: unknown): Promise<string | null> {
    const typed = typeof raw === 'string' ? raw.trim() : '';
    if (!typed) return player.username ? null : USERNAME_PROBLEMS.length;
    const wanted = usernameProblem(typed) === null ? typed : suggestUsername(cleanName(typed, ''));
    if (!wanted) return player.username ? null : USERNAME_PROBLEMS[usernameProblem(typed) ?? 'characters'];
    if (player.username === wanted) return null;
    try {
      const result = await services().store.setUsername(player.id, wanted, USERNAME.cooldown);
      if (result === 'ok' || result === 'same') {
        player.username = wanted;
        player.name = wanted;
        return null;
      }
      return USERNAME_PROBLEMS[result];
    } catch (error) {
      console.warn(`[room ${this.roomId}] could not set the username of ${player.publicId}:`, error);
      return "Your username couldn't be saved right now. Try again in a moment.";
    }
  }

  /** A player choosing their username in the room (they had none yet, or it was refused). */
  private async setUsername(client: Client, data: unknown): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    if (!id || !account) return;
    const typed = (data as { name?: unknown } | null)?.name;
    const now = performance.now();
    if (now - (this.usernameAt.get(id) ?? -Infinity) < 500) return;
    this.usernameAt.set(id, now);
    const reply = (error: string | null) => client.send('username', { ok: error === null, username: account.username, error } satisfies UsernameDTO);
    if (typeof typed !== 'string') return reply(USERNAME_PROBLEMS.length);
    const name = typed.trim();
    const problem = usernameProblem(name);
    if (problem) return reply(USERNAME_PROBLEMS[problem]);
    const error = await this.chooseUsername(account, name);
    if (!error) this.renamed(id, account);
    reply(error);
  }

  /** Everyone sees the player by their (new) username. */
  private renamed(id: string, account: PlayerRecord): void {
    this.world.rename(id, account.name);
    const ps = this.state.players.get(id);
    if (ps) ps.name = account.name;
  }

  onJoin(client: Client, _options: Partial<JoinOptions>, auth: Authenticated): void {
    const { player } = auth;
    const id = player.publicId;
    const returning = this.world.pilots.get(id);
    // Checked again here: two new players may have passed onAuth at the same moment.
    const refused = this.seatRefusal(id);
    if (refused) throw refusal(refused);
    // The same player in another room on this server leaves it; in this room, the older connection is closed.
    const elsewhere = WorldRoom.presence.get(id);
    if (elsewhere && elsewhere !== this) elsewhere.takeOver(id, true);
    this.takeOver(id, false);
    WorldRoom.presence.set(id, this);
    this.sessions.set(client.sessionId, id);
    this.current.set(id, client.sessionId);
    this.accounts.set(id, player);
    this.known.set(id, player.id);
    let ps = this.state.players.get(id);
    if (returning) {
      this.world.rename(id, player.name);
      this.world.setConnected(id, true);
    } else {
      const pilot = this.world.join(id, player.name);
      ps = new PlayerState();
      ps.colour = pilot.colour;
      this.state.players.set(id, ps);
    }
    if (ps) {
      ps.name = player.name;
      ps.connected = true;
    }
    this.greetings.set(client.sessionId, { reconnected: !!returning, token: auth.token, note: this.usernameNotes.get(id) ?? null });
    this.usernameNotes.delete(id);
    // The first player starts the session's hour.
    if (!this.hour.started) this.hour.start(Date.now());
    this.emptySince = null;
    this.peak = Math.max(this.peak, this.world.pilots.size);
    this.departed.delete(id);
    this.recordSession();
    ensureSpare();
    console.log(`[room ${this.roomId}] ${player.name} (${id}) joined via ${auth.via}${returning ? ', back to their seat' : ''}`);
  }

  onDrop(client: Client): void {
    const id = this.idOf(client);
    // A connection that was taken over gets no grace: its player is already elsewhere.
    if (!id) return;
    this.world.setConnected(id, false);
    const ps = this.state.players.get(id);
    if (ps) ps.connected = false;
    const deferred = this.allowReconnection(client, NET.reconnectGrace);
    this.waiting.set(client.sessionId, deferred);
    deferred.catch(() => undefined);
  }

  onReconnect(client: Client): void {
    this.waiting.delete(client.sessionId);
    const id = this.idOf(client);
    if (!id) {
      client.leave(CLOSE_TAKEN_OVER, 'Opened in another tab');
      return;
    }
    this.world.setConnected(id, true);
    const ps = this.state.players.get(id);
    if (ps) ps.connected = true;
    // The SDK's own reconnection keeps the client's listeners: it can be welcomed at once.
    this.greetings.set(client.sessionId, { reconnected: true, token: null });
    this.welcome(client);
  }

  /** Tells a client who it is (and hands over a newly issued device token, once). */
  private welcome(client: Client): void {
    const id = this.idOf(client);
    if (!id) return;
    const greeting = this.greetings.get(client.sessionId);
    this.greetings.delete(client.sessionId);
    const account = this.accounts.get(id);
    const welcome: WelcomeDTO = { id, name: account?.name ?? '', tick: NET.tickRate, reconnected: greeting?.reconnected ?? true, username: account?.username ?? null, usernameNote: greeting?.note ?? null, title: this.title };
    if (greeting?.token) welcome.token = greeting.token;
    client.send('welcome', welcome);
    this.sendPrivate(client, true);
    void this.sendTutorial(client);
  }

  /** The player's tutorial progress, kept on their record (v0.0.11): null for a new player. */
  private async sendTutorial(client: Client): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    if (!account) return;
    try {
      const [record, tips] = await Promise.all([services().store.tutorial(account.id).then(parseTutorial), services().store.tips(account.id)]);
      this.tips.set(account.id, new Set(tips));
      client.send('tutorial', { t: record, tips });
    } catch (error) {
      console.warn(`[room ${this.roomId}] could not load the tutorial of ${id}:`, error);
    }
  }

  /** A client's tutorial progress: checked, then kept on the player's record. */
  private async saveTutorial(client: Client, data: unknown): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    const record = parseTutorial((data as { t?: unknown } | null)?.t);
    if (!account || !record) return;
    const last = this.tutorialSavedAt.get(account.id) ?? 0;
    // Clients send at most one a second (debounced); anything much faster is noise.
    if (performance.now() - last < 250) return;
    this.tutorialSavedAt.set(account.id, performance.now());
    try {
      await services().store.setTutorial(account.id, { ...record });
    } catch (error) {
      console.warn(`[room ${this.roomId}] could not save the tutorial of ${id}:`, error);
    }
  }

  /** A first-time tip the player has now seen, kept on their record. */
  private async saveTip(client: Client, data: unknown): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    const tip = (data as { id?: unknown } | null)?.id;
    const seen = account ? this.tips.get(account.id) : undefined;
    if (!account || !seen || typeof tip !== 'string' || !/^[a-z0-9-]{1,40}$/.test(tip) || seen.has(tip) || seen.size >= 100) return;
    seen.add(tip);
    try {
      await services().store.setTips(account.id, [...seen]);
    } catch (error) {
      console.warn(`[room ${this.roomId}] could not save the tips of ${id}:`, error);
    }
  }

  onLeave(client: Client): void {
    this.waiting.delete(client.sessionId);
    this.greetings.delete(client.sessionId);
    const id = this.idOf(client);
    this.sessions.delete(client.sessionId);
    // A stale connection (taken over) leaving changes nothing.
    if (!id) return;
    this.current.delete(id);
    if (WorldRoom.presence.get(id) === this) WorldRoom.presence.delete(id);
    this.removePlayer(id);
  }

  async onDispose(): Promise<void> {
    unregister(this.roomId);
    for (const [id, room] of WorldRoom.presence) if (room === this) WorldRoom.presence.delete(id);
    if (!this.results) this.hour.status = 'ended';
    this.recordSession(new Date());
    ensureSpare();
    // Anyone still here (a shutdown) has their plane brought home and their base packed before the room goes.
    this.world.wrapUp();
    for (const id of [...this.world.pilots.keys()]) this.removePlayer(id);
    await this.keeper.settle();
  }

  // ---- Portable bases ---------------------------------------------------------------------------

  /**
   * The player's base onto a desk: a random free one (or `wanted`, where the server lets clients
   * choose). Loaded from the store first; a base the store can't load is never replaced by a fresh
   * one, the player is asked to try again.
   */
  private async placeBase(client: Client, wanted: string): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    if (!id || !account || this.placing.has(id)) return;
    const reply = (territory: string, error: string | null) => client.send('claimed', { ok: error === null, territory, error });
    if (this.results || !this.world.pilots.has(id)) return reply(wanted, 'This session has ended.');
    const taken = new Set(this.placing.values());
    let desk: string;
    if (services().chooseDesk) {
      const refused = this.world.claimRefusal(id, wanted) ?? (taken.has(wanted) ? 'taken' : null);
      if (refused) return reply(wanted, refused);
      desk = wanted;
    } else {
      const refused = this.world.pilots.get(id)?.home ? 'already claimed' : null;
      if (refused) return reply(wanted, refused);
      const free = this.world.freeDesks().filter((t) => !taken.has(t));
      if (free.length === 0) return reply(wanted, 'no free desk');
      desk = free[Math.floor(Math.random() * free.length)];
    }
    // Everyone sees players by their username, so it comes first.
    if (!account.username) return reply(desk, 'Choose a username first.');
    this.placing.set(id, desk);
    try {
      const worldId = await economyWorld();
      const placed = await this.keeper.place(account.id, desk);
      if (placed.status === 'elsewhere') {
        console.warn(`[room ${this.roomId}] base of ${id} is still held by ${placed.placement.holder}`);
        return reply(desk, 'Your base is still in another classroom. Try again in a minute.');
      }
      // Everything else the player carries, read after every earlier write for them has landed.
      let economy: EconomyRecord | null;
      let planes: AircraftRecord[];
      let progress: ProgressRecord | null;
      let pvp: PvpRecord[];
      const since = new Date(Date.now() - PVP_MEMORY * 1000);
      try {
        [economy, planes, progress, pvp] = await this.keeper.queue(account.id, (store) =>
          Promise.all([store.economy(worldId, account.id), store.aircraft(worldId, account.id), store.progress(worldId, account.id), store.pvpRecords(worldId, account.id, since)]),
        );
      } catch (error) {
        await this.keeper.release(account.id);
        throw error;
      }
      // Gone while the base loaded (left, or a newer connection took over): let it go again.
      if (this.idOf(client) !== id || this.world.claimRefusal(id, desk) !== null) {
        await this.keeper.release(account.id);
        return;
      }
      const save = placed.state ? fromBaseState(placed.state) : null;
      const stint = randomUUID();
      // The raids and kills the rules still look at (cooldowns, the repeat rule, the kill window).
      this.world.rememberPvp(pvp.map((r) => ({ id: r.id, kind: r.kind, attacker: r.attacker, victim: r.victim, success: r.success, at: r.at.getTime() })));
      const protection = progress ? { protectUntil: progress.protectUntil?.getTime() ?? null, shieldUntil: progress.shieldUntil?.getTime() ?? null } : undefined;
      const error = this.world.claim(id, desk, save, { paper: economy?.paper ?? null, stint, planes: planesFrom(planes), ...progressFrom(progress), protection });
      if (error) {
        await this.keeper.release(account.id);
        return reply(desk, error);
      }
      this.worldId = worldId;
      // A new player's starting paper is the first entry in their log (once, whatever happens).
      if (!economy) {
        this.writePaper(id, account.id, stint, [{ key: `start:${account.id}`, kind: 'reward', amount: ECONOMY.startingPaper, reason: 'Starting paper' }]);
      }
      // A new player's starting base is saved at once.
      if (!save) this.saveBase(id);
      reply(desk, null);
      this.sendPrivate(client, true);
      void this.refreshMetadata();
      console.log(`[room ${this.roomId}] ${account.name} (${id}): ${save ? 'base placed' : 'new base'} on ${desk}`);
    } catch (error) {
      console.error(`[room ${this.roomId}] could not load the base of ${id}:`, error);
      reply(desk, "Your base couldn't be loaded right now. Try again in a moment.");
    } finally {
      this.placing.delete(id);
    }
  }

  /** Sends every waiting paper change to the ledger, player by player, in order. */
  private flushPaper(): void {
    for (const id of this.world.paperWaiting()) {
      const account = this.accounts.get(id);
      const changes = this.world.takePaper(id);
      if (!account) continue;
      if (changes.length > 0) this.writePaper(id, account.id, this.world.stintOf(id), changes);
      this.writeOutcomes(id, account.id);
    }
    this.writePvp();
  }

  /** Raids and kills between players, kept for the rules that outlive a session. */
  private writePvp(): void {
    const worldId = this.worldId;
    const events = this.world.takePvp();
    if (!worldId) return;
    for (const e of events) {
      const attacker = this.known.get(e.attacker);
      const victim = this.known.get(e.victim);
      if (!attacker || !victim) continue;
      const record: PvpRecord = { id: e.id, kind: e.kind, attacker, victim, success: e.success, at: new Date(e.at) };
      this.keeper.queue(attacker, (store) => store.addPvpRecord(worldId, record)).catch((error) => console.error(`[room ${this.roomId}] could not record ${e.kind} ${e.id}:`, error));
    }
  }

  /**
   * Paper changes into the ledger. The world has already made them; one the store refuses (a key
   * already applied, or a debit the balance can't cover) is undone in the world, so the world
   * always follows the store.
   */
  private writePaper(id: string, playerId: string, stint: string | null, changes: PaperChange[]): void {
    const worldId = this.worldId;
    if (!worldId) return;
    for (const c of changes) {
      if (c.amount > 0) this.earned.set(id, (this.earned.get(id) ?? 0) + c.amount);
      this.keeper
        .queue(playerId, (store) => store.applyTransaction({ worldId, playerId, key: c.key, kind: c.kind, amount: c.amount, reason: c.reason }))
        .then(
          (result) => {
            if (result.status === 'applied') return;
            console.warn(`[room ${this.roomId}] ledger ${result.status} for ${id}: ${c.key} (${c.amount})`);
            // Only the same placement is corrected: a later one loaded the store's balance itself.
            if (stint !== null && this.world.stintOf(id) === stint) this.world.adjustPaper(id, -c.amount);
          },
          (error) => console.error(`[room ${this.roomId}] could not write ${c.key} for ${id}:`, error),
        );
    }
  }

  /** Saves a player's base as it stands now (renewing the room's lease on it). */
  private saveBase(id: string): void {
    const account = this.accounts.get(id);
    const save = this.world.baseSave(id);
    if (!account || !save) return;
    this.saveLimits(id, account.id);
    this.saveCarry(id, account.id, this.world.aircraftSave(id), this.world.progressSave(id));
    this.keeper.save(account.id, toBaseState(save)).then(
      (ok) => {
        if (!ok) console.warn(`[room ${this.roomId}] the base of ${id} is no longer held by this room; not saved`);
      },
      (error) => console.error(`[room ${this.roomId}] could not save the base of ${id}:`, error),
    );
  }

  /** The player a connection speaks for, if it is still their current connection. */
  idOf(client: Pick<Client, 'sessionId'>): string | null {
    const id = this.sessions.get(client.sessionId);
    return id !== undefined && this.current.get(id) === client.sessionId ? id : null;
  }

  /** The connection a player is on right now (null while they are away). */
  clientOf(id: string): Client | null {
    const sid = this.current.get(id);
    return sid ? (this.clients.getById(sid) ?? null) : null;
  }

  /**
   * A newer connection of player `id` replaces their current one here: the old connection is
   * closed (or its wait for a reconnection cancelled). `moved`: they went to another room, so
   * they leave this one entirely.
   */
  takeOver(id: string, moved: boolean): void {
    const sid = this.current.get(id);
    if (sid === undefined) return;
    this.current.delete(id);
    const waiting = this.waiting.get(sid);
    if (waiting) {
      this.waiting.delete(sid);
      waiting.reject(new Error('taken over'));
    } else {
      this.clients.getById(sid)?.leave(CLOSE_TAKEN_OVER, moved ? 'You joined another classroom' : 'Opened in another tab');
    }
    if (moved) {
      if (WorldRoom.presence.get(id) === this) WorldRoom.presence.delete(id);
      this.removePlayer(id);
    }
  }

  /** The player's planes and progress, as they stand. */
  private saveCarry(id: string, playerId: string, aircraft: AircraftRecord[] | null, progress: ProgressRecord | null): void {
    const worldId = this.worldId;
    if (!worldId) return;
    if (aircraft) {
      this.keeper.queue(playerId, (store) => store.saveAircraft(worldId, playerId, aircraft)).catch((error) => console.error(`[room ${this.roomId}] could not save the planes of ${id}:`, error));
    }
    if (progress) {
      this.keeper.queue(playerId, (store) => store.saveProgress(worldId, playerId, progress)).catch((error) => console.error(`[room ${this.roomId}] could not save the progress of ${id}:`, error));
    }
  }

  /** Missions flown to the end, each written once (its card id is the key). */
  private writeOutcomes(id: string, playerId: string): void {
    const worldId = this.worldId;
    const outcomes = this.world.takeOutcomes(id);
    if (!worldId) return;
    for (const o of outcomes) {
      this.keeper
        .queue(playerId, (store) => store.recordMission(worldId, playerId, o))
        .then((fresh) => {
          if (!fresh) console.warn(`[room ${this.roomId}] mission ${o.id} of ${id} was already recorded`);
        })
        .catch((error) => console.error(`[room ${this.roomId}] could not record mission ${o.id} of ${id}:`, error));
    }
  }

  /** The player's capacity and protected reserve, saved with their balance. */
  private saveLimits(id: string, playerId: string): void {
    const worldId = this.worldId;
    const limits = this.world.paperLimits(id);
    if (!worldId || !limits) return;
    this.keeper
      .queue(playerId, (store) => store.setEconomyLimits(worldId, playerId, limits.capacity, limits.protected))
      .catch((error) => console.error(`[room ${this.roomId}] could not save the paper limits of ${id}:`, error));
  }

  private removePlayer(id: string): void {
    const account = this.accounts.get(id);
    // Their line on the results card stays (they played in this session).
    const line = this.lineFor(id);
    if (line) this.departed.set(id, { ...line, present: false });
    if (account) this.saveLimits(id, account.id);
    const stint = this.world.stintOf(id);
    const packed = this.world.remove(id);
    // What their last moments changed reaches the store before the base is packed.
    if (account) {
      this.writePaper(id, account.id, stint, this.world.takePaper(id));
      this.writeOutcomes(id, account.id);
      const departure = this.world.takeDeparture(id);
      if (departure) this.saveCarry(id, account.id, departure.aircraft, departure.progress);
    }
    if (account && packed) {
      this.keeper.pack(account.id, toBaseState(packed)).then(
        (ok) => {
          if (!ok) console.warn(`[room ${this.roomId}] the base of ${id} was no longer held by this room; not packed`);
        },
        (error) => console.error(`[room ${this.roomId}] could not pack the base of ${id}:`, error),
      );
    }
    // A raid or kill in their last moments goes to the store too.
    this.writePvp();
    this.state.players.delete(id);
    this.state.planes.delete(id);
    this.pings.delete(id);
    this.accounts.delete(id);
    if (account) this.tips.delete(account.id);
    this.transferAt.delete(id);
    void this.refreshMetadata();
    if (this.world.pilots.size === 0 && this.emptySince === null) this.emptySince = Date.now();
    if (!this.results) {
      this.recordSession();
      ensureSpare();
    }
  }

  /** A one-time code for moving this player to another computer (the pause menu). */
  private async sendTransferCode(client: Client): Promise<void> {
    const id = this.idOf(client);
    const account = id ? this.accounts.get(id) : undefined;
    if (!id || !account) return;
    const now = performance.now() / 1000;
    if (now - (this.transferAt.get(id) ?? -Infinity) < TRANSFER_COOLDOWN) return;
    this.transferAt.set(id, now);
    try {
      const { code, expiresAt } = await services().identity.transferCode(account.id, 'player');
      const dto: TransferDTO = { code, expires: Math.round((expiresAt.getTime() - Date.now()) / 1000) };
      client.send('transfer', dto);
    } catch (error) {
      console.error(`[room ${this.roomId}] transfer code for ${id} failed: ${(error as Error).message}`);
      client.send('transfer', { code: '', expires: 0 } satisfies TransferDTO);
    }
  }

  /** Real time passed: as many fixed steps as it holds. */
  update(seconds: number): void {
    this.accumulator = Math.min(this.accumulator + seconds, MAX_CATCH_UP);
    while (this.accumulator >= NET.step) {
      this.world.step(NET.step);
      this.accumulator -= NET.step;
    }
    this.flushPaper();
    this.sessionTimer -= seconds;
    if (this.sessionTimer <= 0) {
      this.sessionTimer = 0.25;
      this.updateSession(Date.now());
    }
    this.saveTimer -= seconds;
    if (this.saveTimer <= 0) {
      this.saveTimer = BASE_SAVE_EVERY;
      for (const [id, p] of this.world.pilots) if (p.base) this.saveBase(id);
    }
    this.pingTimer -= seconds;
    if (this.pingTimer <= 0) {
      this.pingTimer = NET.pingInterval;
      for (const client of this.clients) {
        const id = this.idOf(client);
        if (!id) continue;
        const n = performance.now();
        this.pings.set(id, n);
        client.send('ping', { n });
      }
    }
  }

  /** Before each patch: the schema catches up with the world, and everyone gets their messages. */
  onBeforePatch(): void {
    this.syncState();
    const events = this.world.drainEvents();
    for (const client of this.clients) {
      const id = this.idOf(client);
      if (!id) continue;
      const own = this.world.ownFor(id);
      if (own) client.send('own', own);
      this.sendPrivate(client, false);
      const mine: NetEvent[] = [];
      for (const o of events) {
        if (o.to !== undefined && o.to !== id) continue;
        if (o.except === id) continue;
        mine.push(o.e);
      }
      if (mine.length > 0) client.send('ev', mine);
    }
  }

  private sendPrivate(client: Client, full: boolean): void {
    const id = this.idOf(client);
    const me = id ? this.world.privateFor(id, full) : null;
    if (me) client.send('me', me);
  }

  /** Copies what everyone may see into the schema (Colyseus sends only what changed). */
  syncState(): void {
    const { world, state } = this;
    state.time = world.time;
    state.tick = world.tick;
    state.left = Math.ceil(this.hour.left(Date.now()));
    state.session = SESSION_STATUSES.indexOf(this.hour.status);
    for (const [id, p] of world.pilots) {
      const ps = state.players.get(id);
      if (!ps) continue;
      ps.territory = p.home?.id ?? '';
      ps.connected = p.connected;
      ps.protect = Math.max(0, Math.ceil(p.protectUntil - world.time));
      ps.shield = Math.max(0, Math.ceil(p.shieldUntil - world.time));
      ps.kills = p.stats.kills;
      ps.deaths = p.stats.deaths;
      ps.assists = p.stats.assists;
      ps.raids = p.stats.raids;
      ps.defends = p.stats.defends;
      ps.missions = p.stats.missions;
      ps.score = p.stats.score;
      ps.ping = Math.round(p.rtt * 1000);
      ps.phase = Math.max(0, PHASES.indexOf(p.state?.phase ?? 'desk'));
      const m = p.flight.model;
      const visible = m.status !== 'hidden' && !(m.status === 'crashed' && world.time - p.crashedAt > 0.5);
      if (!visible) {
        state.planes.delete(id);
        continue;
      }
      let plane = state.planes.get(id);
      if (!plane) {
        plane = new PlaneState();
        state.planes.set(id, plane);
      }
      plane.kind = m.spec.id;
      plane.status = PLANE_STATUSES.indexOf(m.status);
      plane.x = m.position.x;
      plane.y = m.position.y;
      plane.z = m.position.z;
      plane.yaw = m.yaw;
      plane.pitch = m.pitch;
      plane.roll = m.roll;
      plane.speed = m.speed;
      plane.hp = Math.round((p.state?.durability?.fraction ?? 1) * 255);
      plane.boost = m.boost.active;
      plane.fold = Math.round((p.state?.phase === 'building' ? foldPose(p.state.buildProgress, p.state.buildKind) : 1) * 255);
      // Bombs hang under the plane once it is loaded at take-off, as on the pilot's own screen.
      const phase = p.state?.phase;
      plane.bombs = phase === 'flying' || phase === 'landed' ? (p.state?.bombsLoaded ?? 0) : 0;
      plane.emergency = p.state?.emergency ?? false;
    }
    // AI aircraft.
    const seen = new Set<string>();
    for (const a of world.air.aircraft) {
      if (!a.alive) continue;
      seen.add(a.id);
      let s = state.ai.get(a.id);
      if (!s) {
        s = new AiState();
        s.kind = a.spec.id;
        s.role = a.role;
        s.side = a.side;
        state.ai.set(a.id, s);
      }
      const m = a.model;
      s.x = m.position.x;
      s.y = m.position.y;
      s.z = m.position.z;
      s.yaw = m.yaw;
      s.pitch = m.pitch;
      s.roll = m.roll;
      s.hp = Math.round(a.durability.fraction * 255);
      s.target = a.targetId ?? '';
      s.attacking = a.attacking;
      s.leaving = a.leaving;
    }
    for (const id of [...state.ai.keys()]) if (!seen.has(id)) state.ai.delete(id);
    // Installations.
    const standing = new Set<string>();
    for (const i of world.network.installations) {
      standing.add(i.id);
      let s = state.installations.get(i.id);
      if (!s) {
        s = new InstallationState();
        s.kind = i.spec.kind;
        const owner = world.ownerOfInstallation(i.id);
        s.owner = owner?.id ?? '';
        s.slot = owner ? (owner.base?.keyOf(i.id) ?? '') : '';
        state.installations.set(i.id, s);
      }
      s.level = i.spec.level ?? 1;
      s.hp = Math.round(i.durability.fraction * 255);
      s.state = INSTALLATION_STATES.indexOf(i.state);
      s.yaw = i.yaw;
      s.pitch = i.pitch;
      s.lock = Math.round(Math.max(0, Math.min(1, i.lock)) * 255);
      s.target = i.engaged ? (i.targetId ?? '') : '';
    }
    for (const id of [...state.installations.keys()]) if (!standing.has(id)) state.installations.delete(id);
    // Territories.
    for (const t of world.territories) {
      const ts = state.territories.get(t.id);
      if (!ts) continue;
      const owner = world.owners.get(t.id) ?? '';
      const p = owner ? world.pilots.get(owner) : undefined;
      ts.owner = owner;
      ts.label = world.deskName(t.id);
      ts.threat = t.threat;
      ts.safe = !!p && (!p.connected || world.time < p.protectUntil || world.time < p.shieldUntil);
      ts.alert = !!owner && !!world.attacks.on(owner);
    }
  }

  private async refreshMetadata(): Promise<void> {
    if (this.results) return;
    const claimed = this.world.owners.size;
    await this.setMetadata({ title: this.title, claimed, free: this.world.shared.claimable.length - claimed });
  }

  // ---- The session (v0.0.13) --------------------------------------------------------------------

  /** Why player `id` can't take a seat now (null: they can). Players already in it always can. */
  private seatRefusal(id: string): string | null {
    if (this.results) return 'This session has ended. Join the next one.';
    if (this.world.pilots.has(id)) return null;
    if (this.hour.status !== 'open') return 'This session is about to end. Join another one.';
    if (this.world.pilots.size >= this.settings.capacity) return `This session is full (${this.settings.capacity} players).`;
    return null;
  }

  /** What the directory and the lobby know about this session. */
  summary(_now: number): SessionSummary {
    return {
      id: this.roomId,
      title: this.title,
      players: this.world.pilots.size,
      capacity: this.settings.capacity,
      startedAt: this.hour.startedAt,
      endsAt: this.hour.endsAt,
      length: this.hour.length,
      status: this.hour.status,
    };
  }

  /** The session's clock: warnings, joining closing, the end; an empty session closing. */
  private updateSession(now: number): void {
    for (const e of this.hour.update(now)) {
      if (e.kind === 'warning') {
        this.world.emit({ t: 'news', text: `The session ends in ${spokenTime(e.seconds)}`, tone: 'info' });
        for (const p of this.world.pilots.values()) this.world.note(p, 'clock', 'Session ends', spokenTime(e.seconds), 'warn');
        console.log(`[room ${this.roomId}] session ends in ${e.seconds} s`);
      } else if (e.kind === 'closing') {
        this.recordSession();
        ensureSpare(now);
        console.log(`[room ${this.roomId}] joining closed`);
      } else {
        this.endSession(null);
      }
    }
    if (!this.results && this.emptySince !== null && this.world.pilots.size === 0 && this.placing.size === 0 && now - this.emptySince >= this.settings.emptyClose * 1000) {
      if (mayClose(this.roomId, now)) {
        console.log(`[room ${this.roomId}] empty for ${this.settings.emptyClose} s: closing`);
        void this.disconnect();
      } else {
        // The spare everyone needs: it waits on, and its own clock hasn't started.
        this.emptySince = now;
      }
    }
  }

  /** A player's line on the results card, from what they did in this session. */
  private lineFor(id: string): ResultLineDTO | null {
    const p = this.world.pilots.get(id);
    if (!p) return null;
    const s = p.stats;
    return { id, name: p.name, colour: p.colour, placing: 0, score: s.score, kills: s.kills, deaths: s.deaths, raids: s.raids, missions: s.missions, paper: this.earned.get(id) ?? 0, present: true };
  }

  /**
   * The end of the session (or of the server: `reason` says why): raids and missions in flight are
   * settled, planes in the air go home, every base is packed, and everyone gets the results card.
   * The connections close `resultsHold` seconds later.
   */
  endSession(reason: string | null): SessionResultsDTO {
    if (this.results) return this.results;
    this.hour.status = 'ended';
    void this.lock();
    this.world.wrapUp();
    this.flushPaper();
    const lines = new Map(this.departed);
    for (const id of this.world.pilots.keys()) {
      const line = this.lineFor(id);
      if (line) lines.set(id, line);
    }
    for (const id of [...this.world.pilots.keys()]) this.removePlayer(id);
    // What everyone earned, now that their last paper changes are counted.
    for (const line of lines.values()) line.paper = this.earned.get(line.id) ?? 0;
    const ranked = [...lines.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || b.paper - a.paper || a.name.localeCompare(b.name));
    ranked.forEach((l, i) => (l.placing = i > 0 && ranked[i - 1].score === l.score && ranked[i - 1].kills === l.kills ? ranked[i - 1].placing : i + 1));
    const played = this.hour.startedAt === null ? 0 : Math.round((Date.now() - this.hour.startedAt) / 1000);
    this.results = { title: this.title, played, lines: ranked, reason };
    this.broadcast('results', this.results);
    this.recordSession(new Date());
    ensureSpare();
    console.log(`[room ${this.roomId}] session ended${reason ? ` (${reason})` : ''}: ${ranked.length} players`);
    this.clock.setTimeout(() => void this.disconnect(CLOSE_SESSION_ENDED), this.settings.resultsHold * 1000);
    return this.results;
  }

  /** The session as the database keeps it. */
  private recordSession(endedAt: Date | null = null): void {
    const record: SessionRecord = {
      id: this.roomId,
      title: this.title,
      capacity: this.settings.capacity,
      createdAt: this.createdAt,
      startedAt: this.hour.startedAt === null ? null : new Date(this.hour.startedAt),
      endsAt: this.hour.endsAt === null ? null : new Date(this.hour.endsAt),
      endedAt,
      status: this.hour.status,
      peakPlayers: this.peak,
    };
    services()
      .store.recordSession(record)
      .catch((error) => console.error(`[room ${this.roomId}] could not record the session:`, error));
  }
}

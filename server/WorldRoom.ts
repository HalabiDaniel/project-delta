import { Room, type Client, type Deferred } from '@colyseus/core';
import {
  CLOSE_TAKEN_OVER,
  EMOTES,
  NET,
  PROTOCOL_VERSION,
  cleanName,
  parseCommand,
  unpackFrames,
  type Emote,
  type JoinOptions,
  type NetEvent,
  type TransferDTO,
  type WelcomeDTO,
} from '../src/net/protocol';
import { AiState, InstallationState, PHASES, PLANE_STATUSES, PlaneState, PlayerState, TerritoryState, WorldState, INSTALLATION_STATES } from '../src/net/schema';
import { refusal, type Authenticated } from './identity/Identity';
import { services } from './services';
import type { PlayerRecord } from './store/Store';
import { ServerWorld, type ServerWorldOptions } from './world/ServerWorld';

export interface RoomOptions extends ServerWorldOptions {
  /** Shown in the room list. */
  title?: string;
}

export type { JoinOptions };

/** What the room list shows about a session. */
export interface RoomMetadata {
  title: string;
  claimed: number;
  free: number;
}

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
 * free again (persistence of territories comes in the next phases of v0.0.10).
 */
export class WorldRoom extends Room<{ state: WorldState; metadata: RoomMetadata }> {
  /** Every player in a room on this server, and which room: one connection per player, process-wide. */
  static readonly presence = new Map<string, WorldRoom>();

  maxClients = NET.maxPlayers + SPARE_SEATS;
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
  /**
   * What the next welcome says, per connection: sent when the client says hello (messages sent
   * during onJoin arrive before the client can listen for them).
   */
  private readonly greetings = new Map<string, { reconnected: boolean; token: string | null }>();

  onCreate(options: RoomOptions = {}): void {
    this.world = new ServerWorld(options);
    this.state = new WorldState();
    for (const t of this.world.territories) {
      const ts = new TerritoryState();
      ts.threat = t.threat;
      ts.claimable = this.world.shared.claimable.includes(t.id);
      this.state.territories.set(t.id, ts);
    }
    this.setPatchRate(NET.patchMs);
    void this.setMetadata({ title: cleanName(options.title, 'Classroom'), claimed: 0, free: this.world.shared.claimable.length });
    this.setSimulationInterval((ms) => this.update(ms / 1000), 1000 / NET.tickRate);

    this.onMessage('in', (client, data: unknown) => {
      const id = this.idOf(client);
      if (id) this.world.input(id, unpackFrames(data));
    });
    this.onMessage('claim', (client, data: unknown) => {
      const id = this.idOf(client);
      if (!id) return;
      const territory = typeof (data as { t?: unknown })?.t === 'string' ? (data as { t: string }).t : '';
      const error = this.world.claim(id, territory);
      client.send('claimed', { ok: error === null, territory, error });
      if (error === null) {
        this.sendPrivate(client, true);
        void this.refreshMetadata();
      }
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
    this.onMessage('*', () => {
      // Unknown message types are ignored.
    });
  }

  /** Who is connecting: their device token (or code) checked by the identity service. */
  async onAuth(_client: Client, options: Partial<JoinOptions>): Promise<Authenticated> {
    if (options?.v !== PROTOCOL_VERSION) throw refusal(`This server speaks protocol ${PROTOCOL_VERSION}; reload the page.`);
    const auth = await services().identity.authenticate({ token: options.token, code: options.code, name: cleanName(options.name) });
    if (!this.world.pilots.has(auth.player.publicId) && this.world.pilots.size >= NET.maxPlayers) throw refusal(`This classroom is full (${NET.maxPlayers} players).`);
    return auth;
  }

  onJoin(client: Client, _options: Partial<JoinOptions>, auth: Authenticated): void {
    const { player } = auth;
    const id = player.publicId;
    const returning = this.world.pilots.get(id);
    // Checked again here: two new players may have passed onAuth at the same moment.
    if (!returning && this.world.pilots.size >= NET.maxPlayers) throw refusal(`This classroom is full (${NET.maxPlayers} players).`);
    // The same player in another room on this server leaves it; in this room, the older connection is closed.
    const elsewhere = WorldRoom.presence.get(id);
    if (elsewhere && elsewhere !== this) elsewhere.takeOver(id, true);
    this.takeOver(id, false);
    WorldRoom.presence.set(id, this);
    this.sessions.set(client.sessionId, id);
    this.current.set(id, client.sessionId);
    this.accounts.set(id, player);
    let ps = this.state.players.get(id);
    if (returning) {
      returning.name = player.name;
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
    this.greetings.set(client.sessionId, { reconnected: !!returning, token: auth.token });
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
    const welcome: WelcomeDTO = { id, name: this.accounts.get(id)?.name ?? '', tick: NET.tickRate, reconnected: greeting?.reconnected ?? true };
    if (greeting?.token) welcome.token = greeting.token;
    client.send('welcome', welcome);
    this.sendPrivate(client, true);
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

  onDispose(): void {
    for (const [id, room] of WorldRoom.presence) if (room === this) WorldRoom.presence.delete(id);
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

  private removePlayer(id: string): void {
    this.world.remove(id);
    this.state.players.delete(id);
    this.state.planes.delete(id);
    this.pings.delete(id);
    this.accounts.delete(id);
    this.transferAt.delete(id);
    void this.refreshMetadata();
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
      plane.fold = Math.round((p.state?.phase === 'building' ? p.state.buildProgress : 1) * 255);
      plane.bombs = p.state?.bombsLoaded ?? 0;
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
      ts.threat = t.threat;
      ts.safe = !!p && (!p.connected || world.time < p.protectUntil || world.time < p.shieldUntil);
      ts.alert = !!owner && !!world.attacks.on(owner);
    }
  }

  private async refreshMetadata(): Promise<void> {
    const claimed = this.world.owners.size;
    await this.setMetadata({ title: this.metadata?.title ?? 'Classroom', claimed, free: this.world.shared.claimable.length - claimed });
  }
}

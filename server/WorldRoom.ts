import { Room, type Client } from '@colyseus/core';
import { EMOTES, NET, PROTOCOL_VERSION, cleanName, parseCommand, unpackFrames, type Emote, type NetEvent } from '../src/net/protocol';
import { AiState, InstallationState, PHASES, PLANE_STATUSES, PlaneState, PlayerState, TerritoryState, WorldState, INSTALLATION_STATES } from '../src/net/schema';
import { ServerWorld, type ServerWorldOptions } from './world/ServerWorld';

export interface RoomOptions extends ServerWorldOptions {
  /** Shown in the room list. */
  title?: string;
}

export interface JoinOptions {
  name?: string;
  v?: number;
}

/** What the room list shows about a session. */
export interface RoomMetadata {
  title: string;
  claimed: number;
  free: number;
}

/** The longest real time one simulation callback may catch up on (a stalled event loop doesn't snowball). */
const MAX_CATCH_UP = 0.25;

/**
 * A classroom session over Colyseus: up to eight players in one shared world. The room is the
 * network edge only. It turns messages into frames and commands for the ServerWorld (which owns
 * every rule), runs the world at a fixed 60 Hz, copies what everyone may see into the schema state
 * before each patch (20 Hz), and sends each player their private state, their own plane's
 * authoritative flight and the events of the last patch.
 *
 * Connections: a player whose connection drops keeps their place, territory and plane for
 * NET.reconnectGrace seconds (their plane flies on straight ahead); a browser refresh reconnects
 * with the stored token. A player who leaves (or doesn't come back in time) is removed: their base
 * comes down and the territory is free again.
 */
export class WorldRoom extends Room<{ state: WorldState; metadata: RoomMetadata }> {
  maxClients = NET.maxPlayers;
  /** Input frames come about 60 times a second; anything far beyond that is abuse. */
  maxMessagesPerSecond = 240;
  world!: ServerWorld;
  private accumulator = 0;
  private pingTimer = 0;
  private readonly pings = new Map<string, number>();

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

    this.onMessage('in', (client, data: unknown) => this.world.input(client.sessionId, unpackFrames(data)));
    this.onMessage('claim', (client, data: unknown) => {
      const territory = typeof (data as { t?: unknown })?.t === 'string' ? (data as { t: string }).t : '';
      const error = this.world.claim(client.sessionId, territory);
      client.send('claimed', { ok: error === null, territory, error });
      if (error === null) {
        this.sendPrivate(client, true);
        void this.refreshMetadata();
      }
    });
    this.onMessage('cmd', (client, data: unknown) => {
      const cmd = parseCommand(data);
      if (cmd) this.world.command(client.sessionId, cmd);
      // Answer at once, so buttons feel immediate.
      this.sendPrivate(client, false);
    });
    this.onMessage('emote', (client, data: unknown) => {
      const e = (data as { e?: unknown })?.e;
      if (EMOTES.includes(e as Emote)) this.world.emote(client.sessionId, e as Emote);
    });
    this.onMessage('pong', (client, data: unknown) => {
      const sent = this.pings.get(client.sessionId);
      if (sent === undefined || (data as { n?: unknown })?.n !== sent) return;
      this.world.setRtt(client.sessionId, (performance.now() - sent) / 1000);
    });
    this.onMessage('*', () => {
      // Unknown message types are ignored.
    });
  }

  onAuth(_client: Client, options: JoinOptions): boolean {
    if (options?.v !== PROTOCOL_VERSION) throw new Error(`This server speaks protocol ${PROTOCOL_VERSION}; reload the page.`);
    return true;
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const pilot = this.world.join(client.sessionId, cleanName(options.name));
    const ps = new PlayerState();
    ps.name = pilot.name;
    ps.colour = pilot.colour;
    this.state.players.set(client.sessionId, ps);
    client.send('welcome', { id: client.sessionId, tick: NET.tickRate });
    this.sendPrivate(client, true);
  }

  onDrop(client: Client): void {
    this.world.setConnected(client.sessionId, false);
    const ps = this.state.players.get(client.sessionId);
    if (ps) ps.connected = false;
    this.allowReconnection(client, NET.reconnectGrace);
  }

  onReconnect(client: Client): void {
    this.world.setConnected(client.sessionId, true);
    const ps = this.state.players.get(client.sessionId);
    if (ps) ps.connected = true;
    client.send('welcome', { id: client.sessionId, tick: NET.tickRate, reconnected: true });
    this.sendPrivate(client, true);
  }

  onLeave(client: Client): void {
    this.world.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.planes.delete(client.sessionId);
    this.pings.delete(client.sessionId);
    void this.refreshMetadata();
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
        const n = performance.now();
        this.pings.set(client.sessionId, n);
        client.send('ping', { n });
      }
    }
  }

  /** Before each patch: the schema catches up with the world, and everyone gets their messages. */
  onBeforePatch(): void {
    this.syncState();
    const events = this.world.drainEvents();
    for (const client of this.clients) {
      const id = client.sessionId;
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
    const me = this.world.privateFor(client.sessionId, full);
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

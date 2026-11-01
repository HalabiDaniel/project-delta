import { Client, type Room } from '@colyseus/sdk';
import { CLOSE_TAKEN_OVER, PROTOCOL_VERSION, ROOM, packFrames, type Command, type Emote, type InputFrame, type JoinOptions, type TransferDTO, type WelcomeDTO } from '../net/protocol';
import { WorldState } from '../net/schema';

/**
 * offline      – not in a session.
 * connecting   – joining one.
 * connected    – in it.
 * reconnecting – the connection dropped; trying to get back in (the server keeps our place).
 * lost         – gave up, or the server closed the session.
 */
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

export interface RoomListing {
  roomId: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  metadata?: { title?: string; claimed?: number; free?: number };
}

const RESUME_KEY = 'paperwars.mp.resume';
/** The device token, per server: it is how the server recognises this browser's player. */
const TOKEN_KEY = 'paperwars.mp.token';
/** A stored reconnection token is only worth trying this long after it was saved (the server's grace). */
const RESUME_WINDOW_MS = 55_000;

/**
 * The browser's side of the connection: lists, creates and joins classroom sessions, keeps the
 * connection status, resumes a session after a page refresh (the reconnection token is kept in
 * session storage), measures the round trip, and sends input frames, commands and emotes.
 *
 * Identity (v0.0.10): the server hands out a device token on the first join and the browser keeps
 * it in local storage (one per server). Every later join presents it, so the same player comes
 * back after a refresh, a closed browser or a server restart. A typed code (an invite for the
 * first join, or a transfer code from another computer) is sent once with the next join.
 */
export class NetClient {
  readonly sdk: Client;
  room: Room<unknown, WorldState> | null = null;
  status: ConnectionStatus = 'offline';
  /** Round trip in milliseconds, measured by pinging the room. */
  rtt = 0;
  /** Why the last connection ended, for the lobby. */
  lastError: string | null = null;
  private readonly statusListeners: Array<(s: ConnectionStatus) => void> = [];
  private pinger: ReturnType<typeof setInterval> | null = null;
  readonly sent = { frames: 0, messages: 0 };
  /** An invite or transfer code to present with the next join (from the lobby or ?invite=). */
  code: string | null = null;
  /** The last transfer code the server gave us, for the pause menu. */
  transfer: (TransferDTO & { at: number }) | null = null;

  constructor(readonly endpoint: string = NetClient.defaultEndpoint()) {
    this.sdk = new Client(endpoint);
    const invite = new URLSearchParams(window.location.search).get('invite');
    if (invite) this.code = invite;
  }

  /** Whether this browser has been given a pass by this server. */
  get hasToken(): boolean {
    return this.token !== null;
  }

  private get token(): string | null {
    try {
      return localStorage.getItem(`${TOKEN_KEY}@${this.endpoint}`);
    } catch {
      return null;
    }
  }

  private set token(value: string | null) {
    try {
      if (value) localStorage.setItem(`${TOKEN_KEY}@${this.endpoint}`, value);
      else localStorage.removeItem(`${TOKEN_KEY}@${this.endpoint}`);
    } catch {
      // Storage blocked: this browser will need a code next time.
    }
  }

  /** What every join sends: the protocol version, the name, and who we are. */
  private joinOptions(name: string, extra: Partial<JoinOptions> = {}): JoinOptions {
    const options: JoinOptions = { v: PROTOCOL_VERSION, name, ...extra };
    const token = this.token;
    if (token) options.token = token;
    if (this.code) options.code = this.code;
    return options;
  }

  /** Asks the server for a one-time code that lets another computer play as us. */
  requestTransfer(): void {
    this.room?.send('transfer');
  }

  /** ?server=wss://host:port in the address, else the page's host on port 2567. */
  static defaultEndpoint(): string {
    const given = new URLSearchParams(window.location.search).get('server');
    if (given) return given;
    const secure = window.location.protocol === 'https:';
    return `${secure ? 'wss' : 'ws'}://${window.location.hostname || 'localhost'}:2567`;
  }

  onStatus(listener: (s: ConnectionStatus) => void): void {
    this.statusListeners.push(listener);
  }

  /** The sessions on the server (the HTTP endpoint next to the WebSocket one). */
  async list(): Promise<RoomListing[]> {
    const url = this.endpoint.replace(/^ws/, 'http').replace(/\/$/, '') + '/rooms';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Server answered ${response.status}`);
    return (await response.json()) as RoomListing[];
  }

  async create(title: string, name: string): Promise<Room<unknown, WorldState>> {
    return this.enter(() => this.sdk.create(ROOM, this.joinOptions(name, { title }), WorldState));
  }

  async join(roomId: string, name: string): Promise<Room<unknown, WorldState>> {
    return this.enter(() => this.sdk.joinById(roomId, this.joinOptions(name), WorldState));
  }

  async quickJoin(name: string): Promise<Room<unknown, WorldState>> {
    return this.enter(() => this.sdk.joinOrCreate(ROOM, this.joinOptions(name, { title: 'Classroom' }), WorldState));
  }

  /** Back into the session this tab was in before a refresh, if it is still waiting for us. */
  async resume(): Promise<Room<unknown, WorldState> | null> {
    let saved: { token: string; at: number } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved || Date.now() - saved.at > RESUME_WINDOW_MS) return null;
    try {
      const code = this.code;
      const room = await this.enter(() => this.sdk.reconnect(saved!.token, WorldState));
      // A resumed session didn't use the code: keep it for the next join.
      this.code = code;
      return room;
    } catch {
      this.forget();
      return null;
    }
  }

  /** Leaves the session for good: the server frees our territory. */
  async leave(): Promise<void> {
    this.forget();
    const room = this.room;
    this.room = null;
    if (room) await room.leave(true).catch(() => undefined);
    this.setStatus('offline');
  }

  sendFrames(frames: readonly InputFrame[]): void {
    if (!this.room || this.status !== 'connected' || frames.length === 0) return;
    this.room.send('in', packFrames(frames));
    this.sent.frames += frames.length;
    this.sent.messages++;
  }

  command(cmd: Command): void {
    this.room?.send('cmd', cmd);
  }

  claim(territoryId: string): void {
    this.room?.send('claim', { t: territoryId });
  }

  emote(e: Emote): void {
    this.room?.send('emote', { e });
  }

  private async enter(open: () => Promise<Room<unknown, WorldState>>): Promise<Room<unknown, WorldState>> {
    this.setStatus('connecting');
    try {
      const room = await open();
      // The code did its job (a used code would only be refused next time).
      this.code = null;
      this.bind(room);
      return room;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.setStatus('lost');
      throw error;
    }
  }

  private bind(room: Room<unknown, WorldState>): void {
    this.room = room;
    this.lastError = null;
    // Reconnect quickly and keep trying for most of the server's grace period.
    room.reconnection.minUptime = 1000;
    room.reconnection.maxRetries = 20;
    room.reconnection.maxDelay = 3000;
    this.remember(room);
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => {
      this.remember(room);
      this.setStatus('connected');
      room.send('hello');
    });
    room.onLeave((code, reason) => {
      if (this.room !== room) return;
      this.room = null;
      if (code === CLOSE_TAKEN_OVER) this.forget();
      if (code !== 4000) this.lastError = reason ? String(reason) : `Disconnected (${code})`;
      this.stopPinging();
      this.setStatus(code === 4000 ? 'offline' : 'lost');
    });
    room.onError((code, message) => {
      this.lastError = message ?? `Error ${code}`;
    });
    // The server pings us to measure the round trip itself (for lag compensation): answer at once.
    room.onMessage('ping', (m: { n: number }) => room.send('pong', m));
    // Who we are, and a new device token to keep when one was issued.
    room.onMessage('welcome', (m: WelcomeDTO) => {
      if (m.token) this.token = m.token;
    });
    room.onMessage('transfer', (m: TransferDTO) => {
      this.transfer = m.code ? { ...m, at: Date.now() } : null;
    });
    // Ready to listen: the server answers with the welcome and our full private state.
    room.send('hello');
    this.stopPinging();
    this.pinger = setInterval(() => {
      if (this.status === 'connected') room.ping((ms) => (this.rtt = ms));
    }, 2000);
    room.ping((ms) => (this.rtt = ms));
    this.setStatus('connected');
  }

  private remember(room: Room<unknown, WorldState>): void {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ token: room.reconnectionToken, at: Date.now() }));
    } catch {
      // Storage blocked: a refresh just starts over.
    }
  }

  /** Keeps the resume token fresh while we're connected (call now and then). */
  touch(): void {
    if (this.room && this.status === 'connected') this.remember(this.room);
  }

  private forget(): void {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // ignore
    }
  }

  private stopPinging(): void {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}

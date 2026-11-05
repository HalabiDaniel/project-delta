import { Client, type Room } from '@colyseus/sdk';
import { CLOSE_RESTARTING, CLOSE_SESSION_ENDED, CLOSE_TAKEN_OVER, PROTOCOL_VERSION, packFrames, type Command, type Emote, type InputFrame, type JoinOptions, type QuickJoinDTO, type SessionListing, type TransferDTO, type WelcomeDTO } from '../net/protocol';
import { WorldState } from '../net/schema';

/**
 * offline      – not in a session.
 * connecting   – joining one.
 * connected    – in it.
 * reconnecting – the connection dropped; trying to get back in (the server keeps our place).
 * lost         – gave up, or the server closed the session.
 */
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'lost';

export type { SessionListing };

const RESUME_KEY = 'paperwars.mp.resume';
/** The session this tab was last in, for rejoining it after a server restart (v0.0.13). */
const SESSION_KEY = 'paperwars.mp.session';
/** A restarted server holds each player's desk this long (SESSION.restoreWindow), less a margin. */
const REJOIN_WINDOW_MS = 280_000;
/** The device token, per server: it is how the server recognises this browser's player. */
const TOKEN_KEY = 'paperwars.mp.token';
/** A stored reconnection token is only worth trying this long after it was saved (the server's grace). */
const RESUME_WINDOW_MS = 55_000;

/**
 * The browser's side of the connection: lists and joins classroom sessions (the server opens them,
 * v0.0.13: quick join asks it which one to join), keeps the
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
  /** The server said it is restarting (or the connection broke): the session is worth rejoining. */
  restarting = false;
  private readonly statusListeners: Array<(s: ConnectionStatus) => void> = [];
  private pinger: ReturnType<typeof setInterval> | null = null;
  readonly sent = { frames: 0, messages: 0 };
  /** An invite or transfer code to present with the next join (from the lobby or ?invite=). */
  code: string | null = null;
  /** The last transfer code the server gave us, for the pause menu. */
  transfer: (TransferDTO & { at: number }) | null = null;
  private readonly tutorialListeners: Array<(record: unknown) => void> = [];
  /** First-time tips this player has already seen (kept on their record on the server). */
  readonly tipsSeen = new Set<string>();

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
    const options: JoinOptions = { v: PROTOCOL_VERSION, name, username: name, ...extra };
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

  /**
   * The player's tutorial progress, which the server sends right after the welcome (listened for
   * here, before the hello, so it can't arrive before anyone listens).
   */
  onTutorial(listener: (record: unknown) => void): void {
    this.tutorialListeners.push(listener);
  }

  /** Asks for a username (the first one, or another after one was refused). */
  chooseUsername(name: string): void {
    this.room?.send('username', { name });
  }

  /** A first-time tip was shown: the server keeps it, so it isn't shown again on any computer. */
  sawTip(id: string): void {
    if (this.tipsSeen.has(id)) return;
    this.tipsSeen.add(id);
    this.room?.send('tip', { id });
  }

  /** Keeps the player's tutorial progress on their record on the server. */
  saveTutorial(record: unknown): void {
    this.room?.send('tutorial', { t: record });
  }

  onStatus(listener: (s: ConnectionStatus) => void): void {
    this.statusListeners.push(listener);
  }

  /** The HTTP side of the server (next to the WebSocket one). */
  private get http(): string {
    return this.endpoint.replace(/^ws/, 'http').replace(/\/$/, '');
  }

  /** The sessions on the server. Also measures the round trip to it (`rtt`), for the list. */
  async list(): Promise<SessionListing[]> {
    const started = performance.now();
    const response = await fetch(`${this.http}/sessions`);
    if (!response.ok) throw new Error(`Server answered ${response.status}`);
    const list = (await response.json()) as SessionListing[];
    if (!this.room) this.rtt = Math.round(performance.now() - started);
    return list;
  }

  async join(id: string, name: string): Promise<Room<unknown, WorldState>> {
    return this.enter(() => this.sdk.joinById(id, this.joinOptions(name), WorldState));
  }

  /**
   * The session the server picks (the busiest one with space, or a new one), joined. Two players
   * taking the last desk at once: the one refused asks again and is sent elsewhere.
   */
  async quickJoin(name: string): Promise<Room<unknown, WorldState>> {
    return this.enter(async () => {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${this.http}/sessions/quick`, { method: 'POST' });
        const body = (await response.json().catch(() => ({}))) as Partial<QuickJoinDTO> & { error?: string };
        if (!response.ok || !body.id) throw new Error(body.error ?? `Server answered ${response.status}`);
        try {
          return await this.sdk.joinById(body.id, this.joinOptions(name), WorldState);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt >= 3 || !/full|about to end|has ended|locked|not found/i.test(message)) throw error;
        }
      }
    });
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
      // A restarted server doesn't know the reconnection token, but reopens the session for a while.
      const session = this.lastSession();
      if (!session) return null;
      try {
        return await this.join(session, '');
      } catch {
        return null;
      }
    }
  }

  /** The session this tab was in, if it ended recently enough to be rejoined after a restart. */
  lastSession(): string | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { id: string; at: number } | null;
      return saved && Date.now() - saved.at < REJOIN_WINDOW_MS ? saved.id : null;
    } catch {
      return null;
    }
  }

  /**
   * Back into the session we were in after the server restarted: tries every few seconds while the
   * server comes back (it holds our desk for a few minutes). False if it couldn't.
   */
  async rejoin(name: string, until: number = Date.now() + 120_000): Promise<boolean> {
    const id = this.lastSession();
    while (id && Date.now() < until) {
      try {
        await this.join(id, name);
        this.restarting = false;
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The server is up and the session isn't coming back: stop.
        if (/not found|has ended|full|about to end/i.test(message)) break;
        this.setStatus('reconnecting');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    this.restarting = false;
    this.lastError = 'The session could not be rejoined after the restart.';
    this.setStatus('lost');
    return false;
  }

  /** Leaves the session for good: the server frees our territory. */
  async leave(): Promise<void> {
    this.forget();
    this.forgetSession();
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
      const message = explain(error instanceof Error ? error.message : String(error), this.endpoint);
      this.lastError = message;
      this.setStatus('lost');
      throw new Error(message);
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
      if (code === CLOSE_TAKEN_OVER || code === CLOSE_SESSION_ENDED) {
        this.forget();
        this.forgetSession();
      }
      // A restart (said, or a connection that broke and couldn't be resumed): worth rejoining.
      this.restarting = code === CLOSE_RESTARTING || (code !== 4000 && code !== CLOSE_TAKEN_OVER && code !== CLOSE_SESSION_ENDED && this.lastSession() !== null);
      // The end of a session is no error: the results card is up.
      const clean = code === 4000 || code === CLOSE_SESSION_ENDED;
      if (!clean) this.lastError = reason ? String(reason) : `Disconnected (${code})`;
      this.stopPinging();
      this.setStatus(clean ? 'offline' : 'lost');
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
    room.onMessage('tutorial', (m: { t?: unknown; tips?: unknown }) => {
      if (Array.isArray(m?.tips)) for (const t of m.tips) if (typeof t === 'string') this.tipsSeen.add(t);
      for (const l of this.tutorialListeners) l(m?.t ?? null);
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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: room.roomId, at: Date.now() }));
    } catch {
      // Storage blocked: a refresh just starts over.
    }
  }

  /** Keeps the resume token fresh while we're connected (call now and then). */
  touch(): void {
    if (this.room && this.status === 'connected') this.remember(this.room);
  }

  private forgetSession(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
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

/**
 * What went wrong, for a person (v0.0.13): the server's own refusals are already plain ("This
 * session is full", "This server speaks protocol 4; reload the page", "Your pass was withdrawn");
 * the transport's are not.
 */
export function explain(message: string, endpoint: string): string {
  if (/failed to fetch|fetch failed|networkerror|econnrefused|failed to connect|load failed/i.test(message)) return `Can't reach the server at ${endpoint}. It may be down or restarting; try again in a moment.`;
  if (/room ".*" not found|not found/i.test(message)) return 'That session has closed. Pick another one or use Quick join.';
  if (/is locked/i.test(message)) return 'That session is full or about to end. Pick another one or use Quick join.';
  if (/seat reservation expired/i.test(message)) return 'Joining took too long. Try again.';
  return message;
}

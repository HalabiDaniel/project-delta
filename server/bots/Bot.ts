import { Client, type Room } from '@colyseus/sdk';
import { Vec3 } from 'playcanvas';
import { predictImpact } from '../../src/aircraft/Bomb';
import { wrapAngle, yawFromDirection } from '../../src/aircraft/FlightModel';
import { AIRCRAFT, PLANE, type AircraftId } from '../../src/config';
import { Predictor } from '../../src/net/Prediction';
import { NET, NEUTRAL_FRAME, PROTOCOL_VERSION, ROOM, packFrames, type InputFrame, type MeDTO, type NetEvent, type OwnFlight, type WelcomeDTO } from '../../src/net/protocol';
import { WorldState, signedAngle } from '../../src/net/schema';
import { sharedWorld } from '../../src/net/World';

/** Delay and jitter applied to everything a bot sends and receives (simulated network), in ms. */
export interface NetConditions {
  latency: number;
  jitter: number;
  /** Stalls per second: everything held back an extra 150–400 ms (a TCP retransmission after a lost packet). */
  stall: number;
}

export interface BotStats {
  bytesIn: number;
  messagesIn: number;
  framesSent: number;
  reconciles: number;
  corrections: number;
  maxError: number;
  sumError: number;
  hitsDealt: number;
  kills: number;
  deaths: number;
  serverInputs: [number, number, number, number];
  reconnects: number;
}

const shared = sharedWorld();

/**
 * A headless player for load tests: a real Colyseus client that joins, claims a desk, folds a
 * fighter and flies it with the same input frames and client prediction the browser uses. It
 * hunts the nearest other plane and fires when it has a shot, and otherwise circles the classroom.
 * Everything it sends and receives can be delayed and jittered to simulate a poor network.
 */
export class Bot {
  room: Room<unknown, WorldState> | null = null;
  /** Our public player id (from the welcome message), and the device token we were given. */
  id = '';
  token: string | null = null;
  readonly predictor = new Predictor(AIRCRAFT.falcon);
  readonly priv: MeDTO = {};
  readonly stats: BotStats = { bytesIn: 0, messagesIn: 0, framesSent: 0, reconciles: 0, corrections: 0, maxError: 0, sumError: 0, hitsDealt: 0, kills: 0, deaths: 0, serverInputs: [0, 0, 0, 0], reconnects: 0 };
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private outbox: InputFrame[] = [];
  private actionAt = 0;
  private home: string | null = null;
  private stopped = false;

  constructor(
    readonly sdk: Client,
    readonly name: string,
    readonly aircraft: AircraftId = 'falcon',
    readonly net: NetConditions = { latency: 0, jitter: 0, stall: 0 },
    /** hunter: dogfights. raider: takes raid cards against other players and bombs their bases. */
    readonly role: 'hunter' | 'raider' = 'hunter',
  ) {}

  async join(): Promise<void> {
    const room = await this.sdk.joinOrCreate(ROOM, { name: this.name, v: PROTOCOL_VERSION, ...(this.token ? { token: this.token } : {}) }, WorldState);
    this.attach(room);
    await this.welcomed();
    this.timer = setInterval(() => this.loop(), 1000 / NET.tickRate);
    this.last = performance.now();
  }

  /** Drops the connection without leaving (a lost network), then resumes with the token. */
  async dropAndResume(): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    const token = room.reconnectionToken;
    const id = this.id;
    this.id = '';
    room.reconnection.enabled = false;
    room.removeAllListeners();
    (room.connection as unknown as { transport: { ws: { close(): void } } }).transport.ws.close();
    this.room = null;
    await new Promise((r) => setTimeout(r, 500));
    const back = await this.sdk.reconnect(token, WorldState);
    this.attach(back);
    await this.welcomed();
    this.stats.reconnects++;
    return this.id === id;
  }

  async leave(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.room?.leave(true).catch(() => undefined);
  }

  private attach(room: Room<unknown, WorldState>): void {
    this.room = room;
    const ws = (room.connection as unknown as { transport: { ws: { addEventListener?: (t: string, f: (e: { data: ArrayBuffer | Buffer }) => void) => void; on?: (t: string, f: (d: Buffer) => void) => void } } }).transport.ws;
    const count = (size: number) => {
      this.stats.bytesIn += size;
      this.stats.messagesIn++;
    };
    if (ws.addEventListener) ws.addEventListener('message', (e) => count((e.data as ArrayBuffer).byteLength ?? (e.data as Buffer).length ?? 0));
    else ws.on?.('message', (d) => count(d.length));
    room.onMessage('me', (m: MeDTO) => this.later(() => Object.assign(this.priv, m)));
    room.onMessage('own', (m: OwnFlight) => this.later(() => this.onOwn(m)));
    room.onMessage('ev', (events: NetEvent[]) =>
      this.later(() => {
        for (const e of events) {
          if (e.t === 'dmg' && e.by === this.id) this.stats.hitsDealt++;
          if (e.t === 'kill' && e.killer === this.id) this.stats.kills++;
          if (e.t === 'kill' && e.victim === this.id) this.stats.deaths++;
        }
      }),
    );
    room.onMessage('ping', (m: { n: number }) => this.send(() => room.send('pong', m)));
    room.onMessage('claimed', () => undefined);
    room.onMessage('welcome', (m: WelcomeDTO) => {
      this.id = m.id;
      if (m.token) this.token = m.token;
      this.onWelcome?.();
    });
  }

  private onWelcome: (() => void) | null = null;

  /** Resolves once the server has told us who we are. */
  private welcomed(): Promise<void> {
    this.room?.send('hello');
    if (this.id && this.room) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout);
        this.onWelcome = null;
        resolve();
      };
      const timeout = setTimeout(done, 5000);
      this.onWelcome = done;
    });
  }

  private onOwn(own: OwnFlight): void {
    if (this.predictor.model.status !== 'flying' && this.predictor.model.status !== 'rolling') {
      this.predictor.model.setAircraft(AIRCRAFT[this.aircraft]);
    }
    const error = this.predictor.reconcile(own, this.world());
    this.stats.serverInputs = own.inputs;
    this.stats.reconciles++;
    this.stats.sumError += error;
    this.stats.maxError = Math.max(this.stats.maxError, error);
    if (error > 0.05) this.stats.corrections++;
  }

  private world() {
    const home = shared.territories.find((t) => t.id === this.home) ?? null;
    return { home, territories: shared.territories, solids: [] };
  }

  /** Runs `f` after the simulated receive delay (in order, as TCP delivers). */
  private later(f: () => void): void {
    this.deliver(this.inbound, f);
  }

  private send(f: () => void): void {
    this.deliver(this.outbound, f);
  }

  private readonly inbound = new Link();
  private readonly outbound = new Link();

  /**
   * A WebSocket is TCP: messages are delayed but never reordered, and a stall (a lost packet being
   * resent) holds up everything behind it. `stall` is how many such stalls a second, on average.
   */
  private deliver(link: Link, f: () => void): void {
    const { latency, jitter, stall } = this.net;
    if (latency <= 0 && jitter <= 0 && stall <= 0) {
      f();
      return;
    }
    const now = performance.now();
    let d = latency / 2 + (Math.random() * 2 - 1) * (jitter / 2);
    const since = Math.min(1, (now - link.lastSent) / 1000);
    link.lastSent = now;
    if (stall > 0 && Math.random() < stall * since) d += 150 + Math.random() * 250;
    link.push(Math.max(now + Math.max(0, d), link.lastAt), f);
  }

  private loop(): void {
    const room = this.room;
    if (!room || this.stopped) return;
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - this.last) / 1000, 1);
    this.last = now;
    this.act(room, now);
    while (this.acc >= NET.step) {
      this.acc -= NET.step;
      const frame = { ...this.controls(room), seq: ++this.seq };
      this.predictor.apply(frame, this.world());
      this.outbox.push(frame);
    }
    if (this.outbox.length > 0) {
      const frames = this.outbox.splice(0);
      this.stats.framesSent += frames.length;
      for (let i = 0; i < frames.length; i += NET.framesPerMessage) {
        const chunk = packFrames(frames.slice(i, i + NET.framesPerMessage));
        this.send(() => this.room?.send('in', chunk));
      }
    }
  }

  /** Claim, fold, launch, and after a crash or a landing, go round again. */
  private act(room: Room<unknown, WorldState>, now: number): void {
    if (now < this.actionAt) return;
    this.actionAt = now + 500;
    const state = room.state;
    if (!this.priv.territory) {
      const free = [...state.territories.entries()].find(([, t]) => t.claimable && !t.owner);
      if (free) room.send('claim', { t: free[0] });
      return;
    }
    this.home = this.priv.territory;
    switch (this.priv.phase) {
      case 'desk': {
        let plane = this.aircraft;
        if (this.role === 'raider') {
          // Wait for a raid card, pick it and a bomber.
          const raid = (this.priv.offers ?? []).findIndex((c) => c.pvp?.kind === 'raid');
          if (raid < 0) break;
          if (this.priv.selected !== raid) {
            room.send('cmd', { a: 'select', i: raid });
            break;
          }
          plane = 'widewing';
        }
        if (this.priv.garage?.chosen !== plane) room.send('cmd', { a: 'aircraft', id: plane });
        else room.send('cmd', { a: 'build' });
        break;
      }
      case 'ready':
        room.send('cmd', { a: 'launch' });
        break;
      case 'debrief':
      case 'crashed':
        room.send('cmd', { a: 'continue' });
        break;
      case 'landed':
        room.send('cmd', { a: 'takeoff' });
        break;
      default:
        break;
    }
  }

  /** Steer towards the nearest other plane (or round the classroom) and fire when lined up. */
  private controls(room: Room<unknown, WorldState>): Omit<InputFrame, 'seq'> {
    const m = this.predictor.model;
    if (m.status !== 'flying') return NEUTRAL_FRAME;
    const bomb = this.role === 'raider' ? this.priv.mission?.spec.objectives.find((o) => o.kind === 'bomb') : undefined;
    if (bomb && bomb.kind === 'bomb' && this.priv.progress?.status === 'active') return this.bombRun(bomb.zone.x, bomb.zone.z);
    const p = m.position;
    let tx = Math.cos(performance.now() / 9000) * 90;
    let tz = Math.sin(performance.now() / 9000) * 90;
    let ty = 32;
    let best = Infinity;
    room.state.planes.forEach((plane, id) => {
      if (id === this.id || plane.status !== 2) return;
      const d = Math.hypot(plane.x - p.x, plane.y - p.y, plane.z - p.z);
      if (d < best && d < 160) {
        best = d;
        tx = plane.x;
        ty = Math.max(14, plane.y);
        tz = plane.z;
        void signedAngle;
      }
    });
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dz = tz - p.z;
    const yaw = yawFromDirection(dx, dz);
    const pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(dy, Math.hypot(dx, dz))));
    const mx = Math.max(-40, Math.min(40, wrapAngle(m.aimYaw - yaw) / PLANE.mouseSensitivity));
    const my = Math.max(-40, Math.min(40, (m.aimPitch - pitch) / PLANE.mouseSensitivity));
    const lined = Math.abs(wrapAngle(m.yaw - yaw)) < 0.18 && Math.abs(m.pitch - pitch) < 0.2;
    return { ...NEUTRAL_FRAME, mx, my, throttle: best < 30 ? -1 : 1, fire: best < 75 && lined && !process.env.NOFIRE };
  }

  /** Straight at the target, low and slow, letting go when the ball would land on it. */
  private bombRun(x: number, z: number): Omit<InputFrame, 'seq'> {
    const m = this.predictor.model;
    const p = m.position;
    const yaw = yawFromDirection(x - p.x, z - p.z);
    const pitch = Math.max(-0.35, Math.min(0.35, (16 - p.y) * 0.05));
    const mx = Math.max(-40, Math.min(40, wrapAngle(m.aimYaw - yaw) / PLANE.mouseSensitivity));
    const my = Math.max(-40, Math.min(40, (m.aimPitch - pitch) / PLANE.mouseSensitivity));
    const v = m.getVelocity(this.velocity);
    const hit = predictImpact(p, v, 0);
    const now = performance.now();
    const release = Math.hypot(hit.x - x, hit.z - z) < 3 && now - this.droppedAt > 1500;
    if (release) this.droppedAt = now;
    return { ...NEUTRAL_FRAME, mx, my, throttle: -1, bomb: release };
  }

  private droppedAt = 0;
  private readonly velocity = new Vec3();
}

/** One direction of a simulated connection: deliveries strictly in order, each no earlier than its time. */
class Link {
  lastSent = performance.now();
  lastAt = 0;
  private readonly queue: Array<{ at: number; f: () => void }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(at: number, f: () => void): void {
    this.lastAt = at;
    this.queue.push({ at, f });
    if (!this.timer) this.schedule();
  }

  private schedule(): void {
    const next = this.queue[0];
    if (!next) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => {
      const now = performance.now();
      while (this.queue.length > 0 && this.queue[0].at <= now + 0.5) this.queue.shift()!.f();
      this.schedule();
    }, Math.max(0, next.at - performance.now()));
  }
}

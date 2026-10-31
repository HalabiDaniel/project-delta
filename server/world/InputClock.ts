import { NET, type InputFrame } from '../../src/net/protocol';

/** How long (seconds) the queue must stay longer than it needs to before the extra is trimmed. */
const TRIM_WINDOW = 0.5;
/** Frames worth keeping queued to ride out ordinary jitter. */
const TRIM_KEEP = 2;

/**
 * One player's input frames on the server, and their clock. The server owes each player one
 * simulation step per 1/60 s of real time and pays it with the next frame the player sent, so a
 * plane advances exactly as fast as real time however the frames arrive:
 *
 * - Frames that arrive in a burst wait in the queue and are used one per step owed.
 * - A client that sends more frames than real time allows (a speed hack, or a clock running fast)
 *   only fills the queue; a queue that stays longer than jitter needs is trimmed.
 * - A client that goes quiet (a lag spike, a sleeping tab, a lost connection) is waited for up to
 *   NET.stallTimeout; after that the server flies the plane on by itself, straight ahead with the
 *   guns quiet, until frames come again.
 *
 * `lastSeq` is the frame the plane's state now reflects, which the client reconciles against.
 */
export class InputClock {
  readonly queue: InputFrame[] = [];
  /** Simulation time owed to this player, seconds. */
  private owed = 0;
  /** The shortest the queue has been during the current trim window, and how long that has run. */
  private shortest = Infinity;
  private window = 0;
  lastSeq = 0;
  /** Counters for the network panel and the load test. */
  received = 0;
  applied = 0;
  autoSteps = 0;
  dropped = 0;

  /** Frames that just arrived. Repeats and frames older than what was applied are ignored. */
  receive(frames: readonly InputFrame[]): void {
    for (const f of frames) {
      const newest = this.queue.length > 0 ? this.queue[this.queue.length - 1].seq : this.lastSeq;
      if (f.seq <= newest) continue;
      this.queue.push(f);
      this.received++;
    }
    while (this.queue.length > NET.inputQueueMax) {
      this.lastSeq = this.queue.shift()!.seq;
      this.dropped++;
    }
  }

  /**
   * Real time `dt` has passed: the steps to simulate now, each with its frame (or null for a
   * step the server flies by itself because the player has gone quiet).
   */
  advance(dt: number): Array<InputFrame | null> {
    this.owed = Math.min(this.owed + dt, NET.stallTimeout + NET.clockSlack);
    const steps: Array<InputFrame | null> = [];
    // A little tolerance so floating point never makes a step wait a whole tick.
    while (this.owed >= NET.step - 1e-9) {
      const frame = this.queue.shift();
      if (frame) {
        this.lastSeq = frame.seq;
        this.applied++;
        steps.push(frame);
      } else if (this.owed > NET.stallTimeout) {
        this.autoSteps++;
        steps.push(null);
      } else {
        break;
      }
      this.owed -= NET.step;
    }
    this.trim(dt);
    return steps;
  }

  /** Seconds the player is behind (waiting for frames). */
  get waiting(): number {
    return this.queue.length === 0 ? this.owed : 0;
  }

  /** Drops frames the queue has carried for no reason: they only add delay. */
  private trim(dt: number): void {
    this.shortest = Math.min(this.shortest, this.queue.length);
    this.window += dt;
    if (this.window < TRIM_WINDOW) return;
    const extra = this.shortest - TRIM_KEEP;
    for (let i = 0; i < extra; i++) {
      this.lastSeq = this.queue.shift()!.seq;
      this.dropped++;
    }
    this.shortest = Infinity;
    this.window = 0;
  }
}

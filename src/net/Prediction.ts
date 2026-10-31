import type { Collider } from '../combat/Collision';
import type { AircraftSpec } from '../config';
import type { Territory } from '../world/Territory';
import { PilotFlight } from './PilotFlight';
import type { InputFrame, OwnFlight } from './protocol';

/** The world the pilot's plane flies through, as the prediction sees it. */
export interface PredictionWorld {
  home: Territory | null;
  territories: readonly Territory[];
  solids: readonly Collider[];
}

/**
 * Client-side prediction for the pilot's own plane. Every fixed step the game samples the
 * controls into a numbered frame, flies it at once (no waiting for the server) and keeps it until
 * the server confirms it. When the server's state for the plane arrives, the prediction rewinds to
 * it and replays the frames the server hasn't applied yet; the difference from where the plane was
 * drawn is returned so the camera and model can ease it away instead of snapping.
 */
export class Predictor {
  readonly flight: PilotFlight;
  /** Frames flown locally, not yet confirmed by the server. */
  readonly pending: InputFrame[] = [];
  /** Range left, as predicted (the server's figure replaces it on every reconciliation). */
  range = Infinity;
  private seq = 0;
  /** Reconciliations, and how many of them moved the plane noticeably (for the network panel). */
  corrections = 0;
  reconciles = 0;
  lastError = 0;

  constructor(spec: AircraftSpec) {
    this.flight = new PilotFlight(spec);
  }

  get model() {
    return this.flight.model;
  }

  /** The next frame number. */
  nextSeq(): number {
    return ++this.seq;
  }

  /** Flies one frame now and remembers it until the server confirms it. */
  apply(frame: InputFrame, world: PredictionWorld): ReturnType<PilotFlight['step']> {
    this.pending.push(frame);
    // Keep at most a few seconds: frames the server never confirms are of no use.
    if (this.pending.length > 600) this.pending.splice(0, this.pending.length - 600);
    return this.fly(frame, world);
  }

  /**
   * The server's state for the plane after frame `own.seq`: rewind to it, drop the frames it has
   * applied and replay the rest. Returns how far the plane moved compared to the prediction.
   */
  reconcile(own: OwnFlight, world: PredictionWorld): number {
    const m = this.model;
    const bx = m.position.x;
    const by = m.position.y;
    const bz = m.position.z;
    if (!m.loadState(own.flight)) return 0;
    this.flight.setBoundary(own.boundary, own.countdown);
    this.range = own.range;
    while (this.pending.length > 0 && this.pending[0].seq <= own.seq) this.pending.shift();
    for (const frame of this.pending) this.fly(frame, world);
    const error = Math.hypot(m.position.x - bx, m.position.y - by, m.position.z - bz);
    this.reconciles++;
    if (error > 0.05) this.corrections++;
    this.lastError = error;
    return error;
  }

  /** Forget everything unconfirmed (a new sortie, a new plane). */
  reset(): void {
    this.pending.length = 0;
    this.range = Infinity;
  }

  private fly(frame: InputFrame, world: PredictionWorld): ReturnType<PilotFlight['step']> {
    const before = this.model.position.clone();
    const result = this.flight.step(frame, world.home, world.territories, world.solids, this.range <= 0);
    if (result?.outcome === 'flying') this.range = Math.max(0, this.range - before.distance(this.model.position));
    return result;
  }
}

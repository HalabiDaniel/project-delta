import { FlightModel, clamp, yawFromDirection, type FlightResult } from '../aircraft/FlightModel';
import type { Collider } from '../combat/Collision';
import type { AircraftSpec } from '../config';
import { Boundary, type BoundaryState } from '../systems/Boundary';
import type { Territory } from '../world/Territory';
import { NET, type InputFrame } from './protocol';

/** The autopilot cruises home at this height (as in single-player). */
const AUTOPILOT_ALTITUDE = 22;

/**
 * One player's flight as a fixed-step simulation: the same FlightModel single-player flies, plus
 * the airspace boundary and its autopilot, driven by numbered input frames. The server runs it
 * to decide where every plane really is; the pilot's own game runs the very same steps ahead of
 * the server (prediction) and rewinds to the server's state when it arrives (reconciliation).
 * Given the same state and frames, both get the same flight.
 */
export class PilotFlight {
  readonly model: FlightModel;
  readonly boundary = new Boundary();

  constructor(spec: AircraftSpec) {
    this.model = new FlightModel(spec);
  }

  /**
   * One step with `frame`'s controls. Flying: steer, move, collide (the result says what was hit
   * and whether it touched down or fell into the void). Rolling: brake along `home`. Otherwise
   * nothing moves. `gliding`: out of range, the plane can only glide.
   */
  step(frame: Omit<InputFrame, 'seq'>, home: Territory | null, territories: readonly Territory[], solids: readonly Collider[], gliding: boolean): FlightResult | null {
    const m = this.model;
    if (m.status === 'rolling' && home) {
      m.rollout(NET.step, home);
      return null;
    }
    if (m.status !== 'flying') return null;
    const state = this.boundary.update(NET.step, m.position.x, m.position.z);
    const p = m.position;
    const autopilot =
      state === 'autopilot' && home
        ? { yaw: yawFromDirection(home.x - p.x, home.z - p.z), pitch: clamp((AUTOPILOT_ALTITUDE - p.y) * 0.04, -0.35, 0.35) }
        : null;
    return m.fly(
      NET.step,
      {
        mouseDX: frame.mx,
        mouseDY: frame.my,
        throttle: frame.throttle,
        bank: frame.bank,
        boost: frame.boost,
        autoLevel: frame.autoLevel,
        autopilot,
        gliding,
      },
      territories,
      solids,
    );
  }

  /** The boundary as the server had it (part of reconciliation). */
  setBoundary(state: BoundaryState, countdown: number): void {
    this.boundary.state = state;
    this.boundary.countdown = countdown;
  }
}

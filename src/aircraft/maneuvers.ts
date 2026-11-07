import { AIRCRAFT, MANEUVER, MANEUVERS, MANEUVER_ORDER, type AircraftId, type AircraftSpec, type FlightProfile, type ManeuverId } from '../config';

/**
 * v0.0.16: the automatic maneuvers as authored tracks. A track says, over the move's normalised
 * time u (0 → 1), how the nose turns relative to the plane (pitch, roll and yaw in its own frame),
 * how fast it flies, and how much "grip" it has: how quickly the direction of travel follows the
 * nose. Low grip is what makes the Crane Flip look right: the nose spins over while the plane keeps
 * sliding along its old path.
 *
 * Tracks are data, not physics. Every rotation is given as a total angle spread over part of the
 * move with a smooth ease, and each step applies the exact share of it between the step's start
 * and end, so a move always turns by exactly its angles whatever the step length: every machine
 * (the pilot's game, the server and the AI) flies it identically and it always ends level.
 *
 * The diagrams in docs/roadmap/v0.0.16-maneuvers/ show each move.
 */

export type Axis = 'pitch' | 'roll' | 'yaw';

/** A turn of `angle` radians (positive: nose up, roll left, yaw left) eased over u ∈ [from, to]. */
export interface TrackTurn {
  axis: Axis;
  angle: number;
  from: number;
  to: number;
  /** Multiply by the move's side (+1 left, -1 right): the moves that go left or right. */
  sided?: boolean;
}

export interface TrackContext {
  /** Speed when the move started. */
  entry: number;
  flight: FlightProfile;
}

export interface Track {
  turns: readonly TrackTurn[];
  /** Speed (m/s) at u. Starts at the entry speed so nothing jumps. */
  speed(u: number, c: TrackContext): number;
  /** How fast the direction of travel follows the nose (1/s) at u. */
  grip(u: number): number;
  /** Extra sideways velocity (m/s, towards the move's side) at u: the Slip Roll's shove. */
  shove?(u: number): number;
  /**
   * A corkscrew around the flight path: radius (m) and turns over the move, as an extra velocity
   * circling the direction of travel (the Spiral Drill).
   */
  helix?: { radius: number; turns: number; from: number; to: number };
}

const TAU = Math.PI * 2;
const HIGH_GRIP = 30;

/** 0 → 1 smoothly over [a, b]. */
export function smoothstep(u: number, a: number, b: number): number {
  if (u <= a) return 0;
  if (u >= b) return 1;
  const x = (u - a) / (b - a);
  return x * x * (3 - 2 * x);
}

/**
 * The share of a turn done by u when it is eased over [a, b]: the integral of a raised-cosine rate,
 * so the turn starts and ends with no jerk.
 */
export function easedShare(u: number, a: number, b: number): number {
  if (u <= a) return 0;
  if (u >= b) return 1;
  const x = (u - a) / (b - a);
  return x - Math.sin(TAU * x) / TAU;
}

/** 0 → 1 → 0 over [a, b], peaking in the middle. */
export function bump(u: number, a: number, b: number): number {
  if (u <= a || u >= b) return 0;
  const x = (u - a) / (b - a);
  return Math.sin(Math.PI * x) ** 2;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const top = (f: FlightProfile) => f.maxSpeed + f.boostSpeed;

export const TRACKS: Record<ManeuverId, Track> = {
  // Kulbit: a full nose-over-tail flip while sliding on, out slow on the same heading.
  craneFlip: {
    turns: [{ axis: 'pitch', angle: TAU, from: 0.03, to: 0.97 }],
    speed: (u, c) => {
      const slow = c.flight.minSpeed * 0.55;
      const out = c.flight.minSpeed * 1.05;
      return lerp(lerp(c.entry, slow, smoothstep(u, 0, 0.45)), out, smoothstep(u, 0.6, 1));
    },
    grip: (u) => (u > 0.03 && u < 0.92 ? 0.3 : HIGH_GRIP),
  },
  // Immelmann: half loop up, then a half roll upright.
  foldBack: {
    turns: [
      { axis: 'pitch', angle: Math.PI, from: 0, to: 0.72 },
      { axis: 'roll', angle: Math.PI, from: 0.72, to: 1, sided: true },
    ],
    speed: (u, c) => lerp(c.entry, Math.max(c.flight.minSpeed, c.entry * 0.82), smoothstep(u, 0, 0.72)),
    grip: () => HIGH_GRIP,
  },
  // Split-S: half roll onto the back, then a half loop down.
  diveFold: {
    turns: [
      { axis: 'roll', angle: Math.PI, from: 0, to: 0.25, sided: true },
      { axis: 'pitch', angle: Math.PI, from: 0.25, to: 1 },
    ],
    speed: (u, c) => lerp(c.entry, Math.min(top(c.flight), Math.max(c.entry * 1.3, c.flight.cruiseSpeed * 1.2)), smoothstep(u, 0.25, 1)),
    grip: () => HIGH_GRIP,
  },
  // A full aileron roll with a sideways shove.
  slipRoll: {
    turns: [{ axis: 'roll', angle: TAU, from: 0.05, to: 0.95, sided: true }],
    speed: (u, c) => c.entry + c.flight.boostSpeed * 0.3 * bump(u, 0, 1),
    grip: () => HIGH_GRIP,
    shove: (u) => MANEUVER.slipShove * bump(u, 0.02, 0.98),
  },
  // Boosted pop-up: nose up, a full roll on the climb, level off higher.
  updraftRoll: {
    turns: [
      { axis: 'pitch', angle: 0.35, from: 0, to: 0.3 },
      { axis: 'roll', angle: TAU, from: 0.3, to: 0.72, sided: true },
      { axis: 'pitch', angle: -0.35, from: 0.7, to: 1 },
    ],
    speed: (u, c) => c.entry + c.flight.boostSpeed * 0.8 * bump(u, 0, 0.85),
    grip: () => HIGH_GRIP,
  },
  // Hammerhead: straight up, hang, pivot on a wingtip, straight down and pull out the other way.
  paperHang: {
    turns: [
      { axis: 'pitch', angle: Math.PI / 2, from: 0, to: 0.24 },
      { axis: 'yaw', angle: Math.PI, from: 0.4, to: 0.62, sided: true },
      { axis: 'pitch', angle: Math.PI / 2, from: 0.74, to: 1 },
    ],
    speed: (u, c) => {
      const hang = c.flight.minSpeed * 0.15;
      return lerp(lerp(c.entry, hang, smoothstep(u, 0.05, 0.4)), c.flight.cruiseSpeed * 1.1, smoothstep(u, 0.62, 0.95));
    },
    grip: (u) => (u > 0.4 && u < 0.66 ? 1.5 : HIGH_GRIP),
  },
  // Rolling dive: nose down, two rolls with the path corkscrewing, pull back level.
  spiralDrill: {
    turns: [
      { axis: 'pitch', angle: -0.4, from: 0, to: 0.16 },
      { axis: 'roll', angle: 2 * TAU, from: 0.12, to: 0.86, sided: true },
      { axis: 'pitch', angle: 0.4, from: 0.84, to: 1 },
    ],
    speed: (u, c) => lerp(c.entry, Math.min(top(c.flight), Math.max(c.entry * 1.25, c.flight.cruiseSpeed)), smoothstep(u, 0, 0.8)),
    grip: () => HIGH_GRIP,
    helix: { radius: 3.5, turns: 2, from: 0.12, to: 0.86 },
  },
  // Flat 180°: the tail swings round while the plane drifts, then it boosts away.
  paperPivot: {
    turns: [{ axis: 'yaw', angle: Math.PI, from: 0.04, to: 0.66, sided: true }],
    speed: (u, c) => lerp(lerp(c.entry, c.flight.minSpeed * 0.5, smoothstep(u, 0, 0.5)), c.entry + c.flight.boostSpeed * 0.6, smoothstep(u, 0.62, 1)),
    grip: (u) => (u < 0.66 ? 0.4 : 8),
  },
};

/** The maneuvers a design can carry (none for bombers). */
export function maneuversFor(spec: Pick<AircraftSpec, 'maneuvers'>): readonly ManeuverId[] {
  return spec.maneuvers;
}

export function canCarry(spec: Pick<AircraftSpec, 'maneuvers'>, id: ManeuverId | null | undefined): id is ManeuverId {
  return !!id && spec.maneuvers.includes(id);
}

/** What goes in the slot when the pilot has not chosen yet (or chose something this design lacks). */
export function defaultManeuver(spec: Pick<AircraftSpec, 'maneuvers'>, wanted?: ManeuverId | null): ManeuverId | null {
  if (canCarry(spec, wanted)) return wanted;
  return spec.maneuvers[0] ?? null;
}

/** The next (or previous) maneuver in the design's set, for the pad picker. */
export function cycleManeuver(spec: Pick<AircraftSpec, 'maneuvers'>, current: ManeuverId | null, dir: 1 | -1): ManeuverId | null {
  const set = spec.maneuvers;
  if (set.length === 0) return null;
  const i = current ? set.indexOf(current) : -1;
  if (i < 0) return set[0];
  return set[(i + dir + set.length) % set.length];
}

/** Every design that can carry a maneuver (garage card and tests). */
export function designsWith(id: ManeuverId): AircraftId[] {
  return (Object.keys(AIRCRAFT) as AircraftId[]).filter((a) => AIRCRAFT[a].maneuvers.includes(id));
}

/**
 * Seconds a move takes on this plane: nimbler planes fly it faster, and a badly damaged one slower
 * (`handling` < 1, as for its normal handling).
 */
export function maneuverDuration(id: ManeuverId, flight: FlightProfile, handling = 1): number {
  const agility = Math.pow(MANEUVER.referenceTurnRate / flight.maxTurnRate, MANEUVER.agilityScale);
  return (MANEUVERS[id].duration * agility) / Math.max(0.4, handling);
}

/** Index in MANEUVER_ORDER, for snapshots and the network (-1 for none). */
export function maneuverIndex(id: ManeuverId | null): number {
  return id ? MANEUVER_ORDER.indexOf(id) : -1;
}

export function maneuverAt(index: number): ManeuverId | null {
  return MANEUVER_ORDER[index] ?? null;
}

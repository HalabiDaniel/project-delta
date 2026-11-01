/**
 * Analog stick maths for controller play: dead zones, response curves, smoothing, and the
 * translation of a stick into the flight model's aim. Everything here is pure, so it is tested
 * without a browser and behaves the same in single-player and multiplayer.
 *
 * The flight model steers by moving an aim direction (the "mouse-aim" style). A stick is not a
 * mouse, so it does not push the aim around like one: the left stick's x sets how far the aim
 * leads the nose sideways (hold it and the plane keeps turning, let go and it straightens out),
 * while its y moves the aim's pitch at a rate (so a climb holds when the stick is released, and
 * the usual auto-level eases it back after a moment). The result is expressed as the mouse
 * movement that would have produced it, so the flight model, the server and the prediction all
 * stay exactly as they are and a controller can do nothing a mouse can't.
 */

export interface Stick {
  x: number;
  y: number;
}

export interface PadTuning {
  /** Radial dead zone of the sticks (0–1 of full deflection). */
  deadZone: number;
  /** Per-axis dead zone, applied after the radial one, so a slightly-off-centre push stays straight. */
  axisDeadZone: number;
  /** Response exponent: 1 is linear, higher gives finer control near the centre. */
  curve: number;
  /** Flight stick sensitivity multiplier (Low 0.75, Medium 1, High 1.3). */
  sensitivity: number;
  /** Camera (right stick) sensitivity multiplier. */
  lookSensitivity: number;
  /** Pull back to climb (flight-sim style) instead of push up to climb. */
  invertY: boolean;
  /** Smoothing time constant for the steering stick, seconds (0 = none). */
  smoothing: number;
}

export const PAD_DEFAULTS: PadTuning = {
  deadZone: 0.16,
  axisDeadZone: 0.06,
  curve: 1.6,
  sensitivity: 1,
  lookSensitivity: 1,
  invertY: false,
  smoothing: 0.05,
};

/** Flight constants for stick steering. */
export const STICK = {
  /** At full sideways deflection the aim leads the nose by this share of PLANE.maxAimLead. */
  yawLeadShare: 0.85,
  /** Aim pitch rate at full vertical deflection, rad/s. */
  pitchRate: 1.15,
  /** Triggers count as pressed beyond this. */
  triggerThreshold: 0.35,
  /** Camera look range at full deflection: sideways and vertical, radians. */
  lookYaw: 2.6,
  lookPitch: 0.6,
  /** How fast the camera follows the right stick and recentres when it is released (1/s). */
  lookRate: 7,
  /** Menu navigation from the stick: first repeat after, then every (seconds). */
  navDelay: 0.38,
  navRepeat: 0.13,
  /** Stick deflection that counts as a menu direction. */
  navThreshold: 0.55,
} as const;

/** Aim assistance for stick steering against aircraft (an input-level pull, not a bigger hitbox). */
export const PAD_ASSIST = {
  /** Targets inside this cone around the aim are helped. */
  cone: 7 * (Math.PI / 180),
  /** Further than this (metres) nothing is helped. */
  range: 140,
  /** Steering sensitivity near a target is reduced to this share (aim "friction"). */
  slowdown: 0.6,
  /** Pull towards the target, rad/s at the cone's centre, fading to 0 at its edge. */
  pull: 0.35,
} as const;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Radial dead zone with rescaling: inside `dead` the stick reads zero, beyond it the magnitude is
 * remapped to 0–1 so there is no jump at the edge. Magnitudes past 1 (square gates) are clamped.
 */
export function radialDeadZone(s: Stick, dead: number): Stick {
  const m = Math.hypot(s.x, s.y);
  if (m <= dead || m === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dead) / (1 - dead));
  return { x: (s.x / m) * scaled, y: (s.y / m) * scaled };
}

/** Per-axis dead zone with rescaling, for a single axis. */
export function axisDeadZone(v: number, dead: number): number {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  return Math.sign(v) * Math.min(1, (a - dead) / (1 - dead));
}

/** Response curve on the stick's magnitude, keeping its direction. */
export function responseCurve(s: Stick, exponent: number): Stick {
  const m = Math.hypot(s.x, s.y);
  if (m === 0) return { x: 0, y: 0 };
  const shaped = Math.pow(Math.min(1, m), exponent);
  return { x: (s.x / m) * shaped, y: (s.y / m) * shaped };
}

/** A stick as the game should read it: radial and per-axis dead zones, then the response curve. */
export function shapeStick(raw: Stick, t: Pick<PadTuning, 'deadZone' | 'axisDeadZone' | 'curve'>): Stick {
  const r = radialDeadZone(raw, t.deadZone);
  const a = { x: axisDeadZone(r.x, t.axisDeadZone), y: axisDeadZone(r.y, t.axisDeadZone) };
  return responseCurve(a, t.curve);
}

/** Exponential smoothing towards `target` with time constant `tau` (seconds). */
export function smooth(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a %= twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

/** What stick steering needs to know about the plane. */
export interface AimState {
  yaw: number;
  aimYaw: number;
  aimPitch: number;
}

export interface FlightLimits {
  maxAimLead: number;
  mouseSensitivity: number;
}

/**
 * The mouse movement (pixels) that moves the aim where the stick wants it this step.
 * x: the aim's lead off the nose follows the stick (positive x is right, which is negative yaw).
 * y: the aim's pitch moves at a rate (up on the stick climbs, unless inverted).
 * `assist` adds a pull towards a target and scales the stick's authority near one.
 */
export function stickToMouse(
  stick: Stick,
  aim: AimState,
  limits: FlightLimits,
  dt: number,
  tuning: Pick<PadTuning, 'sensitivity' | 'invertY'>,
  assist: AssistNudge | null = null,
): { dx: number; dy: number } {
  const authority = tuning.sensitivity * (assist ? assist.scale : 1);
  const lead = clamp(stick.x * authority, -1, 1) * STICK.yawLeadShare * limits.maxAimLead;
  let wantYaw = aim.yaw - lead;
  if (assist) wantYaw += assist.yaw * dt;
  const dYaw = wrapAngle(wantYaw - aim.aimYaw);
  const up = tuning.invertY ? stick.y : -stick.y;
  let dPitch = up * STICK.pitchRate * authority * dt;
  if (assist) dPitch += assist.pitch * dt;
  // The flight model does aimYaw -= dx * k and aimPitch -= dy * k.
  return { dx: -dYaw / limits.mouseSensitivity, dy: -dPitch / limits.mouseSensitivity };
}

export interface AssistTarget {
  x: number;
  y: number;
  z: number;
}

export interface AssistNudge {
  /** Pull, rad/s, on the aim's yaw and pitch. */
  yaw: number;
  pitch: number;
  /** Stick authority multiplier (≤ 1). */
  scale: number;
}

/**
 * Aim help for stick steering: the nearest aircraft inside a small cone around the aim slows the
 * stick a little and pulls the aim gently towards it. Nothing changes about hits themselves, so a
 * controller player gains steadiness, not reach. Null when no target is close to the aim.
 */
export function padAimAssist(
  from: AssistTarget,
  aimYaw: number,
  aimPitch: number,
  targets: readonly AssistTarget[],
): AssistNudge | null {
  let best: { dy: number; dp: number; off: number } | null = null;
  for (const t of targets) {
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const dz = t.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1 || dist > PAD_ASSIST.range) continue;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.asin(clamp(dy / dist, -1, 1));
    const dYaw = wrapAngle(yaw - aimYaw);
    const dPitch = pitch - aimPitch;
    const off = Math.hypot(dYaw * Math.cos(aimPitch), dPitch);
    if (off > PAD_ASSIST.cone) continue;
    if (!best || off < best.off) best = { dy: dYaw, dp: dPitch, off };
  }
  if (!best) return null;
  const strength = 1 - best.off / PAD_ASSIST.cone;
  const len = best.off || 1;
  return {
    yaw: (best.dy / len) * PAD_ASSIST.pull * strength,
    pitch: (best.dp / len) * PAD_ASSIST.pull * strength,
    scale: 1 - (1 - PAD_ASSIST.slowdown) * strength,
  };
}

/** Which way a stick or D-pad points for menu navigation, if it points anywhere. */
export type NavDirection = 'up' | 'down' | 'left' | 'right';

export function stickDirection(s: Stick, threshold: number = STICK.navThreshold): NavDirection | null {
  if (Math.hypot(s.x, s.y) < threshold) return null;
  return Math.abs(s.x) > Math.abs(s.y) ? (s.x > 0 ? 'right' : 'left') : s.y > 0 ? 'down' : 'up';
}

/**
 * Auto-repeat for a held menu direction: fires on the first frame, then after `delay`, then every
 * `repeat` seconds. Returns the direction to move this frame, if any.
 */
export class NavRepeater {
  private dir: NavDirection | null = null;
  private wait = 0;

  update(dir: NavDirection | null, dt: number): NavDirection | null {
    if (dir !== this.dir) {
      this.dir = dir;
      this.wait = STICK.navDelay;
      return dir;
    }
    if (!dir) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait += STICK.navRepeat;
    return dir;
  }
}

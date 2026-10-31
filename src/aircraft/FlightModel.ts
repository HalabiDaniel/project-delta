import { Vec3 } from 'playcanvas';
import { sphereContact, type Collider, type Contact } from '../combat/Collision';
import { handlingFactor, wobbleAmount } from '../combat/Damage';
import { DAMAGE, LANDING, PLANE, WORLD, type AircraftSpec, type FlightProfile } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import { Boost } from './Boost';
import { assessTouchdown, type TouchdownCheck, type TouchdownState } from './Landing';

/**
 * hidden  – no plane exists (at the desk with an empty pad).
 * parked  – on the launch pad: being folded, waiting to launch, or recovered and waiting for a refit.
 * flying  – airborne and steerable.
 * rolling – touched down at home and braking along the platform.
 * stopped – came to rest after landing.
 * crashed – destroyed; the wreck is no longer drawn.
 */
export type AircraftStatus = 'hidden' | 'parked' | 'flying' | 'rolling' | 'stopped' | 'crashed';

export type FlightOutcome = 'flying' | 'touchdown' | 'void';

/**
 * Something the plane flew into this step. The plane has already been pushed clear and deflected;
 * the game decides what the hit costs from the closing speed (the speed straight into the surface).
 */
export type Collision =
  | { kind: 'platform'; id: string; closing: number }
  | { kind: 'object'; id: string; closing: number }
  /** Came down on the home runway outside the landing limits, and bounced. */
  | { kind: 'rough-landing'; id: string; closing: number; state: TouchdownState; check: TouchdownCheck };

export interface FlightResult {
  outcome: FlightOutcome;
  collisions: Collision[];
}

export interface FlightControls {
  /** Mouse movement since the last frame, in pixels. */
  mouseDX: number;
  mouseDY: number;
  /** +1 speed up (W), -1 slow down (S). */
  throttle: number;
  /** +1 bank left (A), -1 bank right (D). */
  bank: number;
  /** Shift held. */
  boost: boolean;
  /** Ease the aim back to level flight while the mouse is idle. Off on the landing approach. */
  autoLevel: boolean;
  /** When set, the autopilot flies this heading and pitch and the player's steering is ignored. */
  autopilot: { yaw: number; pitch: number } | null;
  /** Out of range: the plane can only glide, with no boost and no climbing. */
  gliding: boolean;
  /**
   * Steering given as a direction to fly instead of mouse movement: how AI pilots fly. Unlike the
   * autopilot it leaves the boost alone.
   */
  aim?: { yaw: number; pitch: number } | null;
}

/**
 * The aircraft's movement, steering, launch, landing and collisions, with no rendering. It flies
 * "mouse-aim" style: the controls move an aim direction and the plane chases it. To turn, the plane
 * first rolls into a bank and the heading follows the bank, which gives turns a little inertia and
 * lets the wings level out on their own when the turn is done. Flight is still arcade: no stalls
 * and artificial lift, so the plane goes where it is pointed, but climbing bleeds a little speed and
 * diving adds some. How fast, nimble and heavy it is comes entirely from the design's FlightProfile.
 *
 * The player's plane and every AI plane fly through this same model: the player's controls come
 * from the mouse and keyboard, an AI pilot's from its own decisions.
 */
export class FlightModel {
  status: AircraftStatus = 'hidden';
  readonly position = new Vec3();
  /** Position at the start of the last flight step, for ring and airspace checks. */
  readonly prevPosition = new Vec3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  /** The speed the throttle sets. The actual speed settles on it (plus any boost). */
  throttleSpeed = 0;
  aimYaw = 0;
  aimPitch = 0;
  /** The last touchdown's assessment, so a hard landing can say what went wrong. */
  lastTouchdown: TouchdownCheck | null = null;
  readonly boost = new Boost(1, 1);
  /** The platform it may land on; every other platform is only something to fly into. */
  homeId = '';

  private airborneTime = 0;
  private idleTime = 0;
  private pitchRate = 0;
  private bounceGrace = 0;
  private handling = 1;
  private wobble = 0;
  private readonly fwd = new Vec3();

  constructor(private design: AircraftSpec) {
    this.setAircraft(design);
  }

  get spec(): AircraftSpec {
    return this.design;
  }

  get flight(): FlightProfile {
    return this.design.flight;
  }

  /** Swaps in another design's handling and boost. */
  setAircraft(spec: AircraftSpec): void {
    this.design = spec;
    this.boost.duration = spec.flight.boostDuration;
    this.boost.cooldown = spec.flight.boostCooldown;
    this.boost.reset();
  }

  /** Health 1 → 0: below a threshold the plane gets harder to fly. */
  setHealth(healthFraction: number): void {
    this.handling = handlingFactor(healthFraction);
    this.wobble = wobbleAmount(healthFraction);
  }

  /** Puts the plane on the launch pad. */
  park(position: Point3, yaw: number, homeId: string): void {
    this.status = 'parked';
    this.homeId = homeId;
    this.position.set(position.x, position.y, position.z);
    this.prevPosition.copy(this.position);
    this.yaw = this.aimYaw = yaw;
    this.pitch = this.aimPitch = 0;
    this.roll = 0;
    this.speed = 0;
  }

  /** From the launch pad, or from wherever the plane stopped after landing: a short automatic climb-out. */
  launch(): void {
    if (this.status !== 'parked' && this.status !== 'stopped') return;
    const f = this.flight;
    this.status = 'flying';
    this.airborneTime = 0;
    this.idleTime = 0;
    this.speed = this.throttleSpeed = f.cruiseSpeed;
    // Climb out at launchPitch, then level off unless the player has aimed elsewhere meanwhile.
    this.pitch = PLANE.launchPitch;
    this.pitchRate = 0;
    this.aimYaw = this.yaw;
    this.aimPitch = 0;
    this.roll = 0;
    this.bounceGrace = 0;
    this.lastTouchdown = null;
    this.boost.reset();
  }

  /**
   * Puts the plane straight into the air, already flying at `speed` (cruise by default), with no
   * climb-out and no platform to land on: AI aircraft begin at a safe altitude.
   */
  spawn(at: Point3, yaw: number, speed: number = this.flight.cruiseSpeed, pitch = 0): void {
    this.status = 'flying';
    this.homeId = '';
    this.position.set(at.x, at.y, at.z);
    this.prevPosition.copy(this.position);
    this.yaw = this.aimYaw = yaw;
    this.pitch = this.aimPitch = pitch;
    this.roll = 0;
    this.pitchRate = 0;
    this.speed = this.throttleSpeed = speed;
    this.airborneTime = PLANE.launchGrace;
    this.idleTime = 0;
    this.bounceGrace = 0;
    this.lastTouchdown = null;
    this.boost.reset();
  }

  fly(dt: number, controls: FlightControls, territories: readonly Territory[], obstacles: readonly Collider[]): FlightResult {
    const collisions: Collision[] = [];
    if (this.status !== 'flying') return { outcome: 'flying', collisions };
    const f = this.flight;
    this.prevPosition.copy(this.position);
    this.airborneTime += dt;
    this.bounceGrace = Math.max(0, this.bounceGrace - dt);
    const climbingOut = this.airborneTime < PLANE.launchGrace;

    // Aim: the mouse and A/D move where the plane wants to go, unless the autopilot or an AI pilot has it.
    const autopilot = controls.autopilot;
    const steer = autopilot ?? controls.aim ?? null;
    if (steer) {
      this.aimYaw = steer.yaw;
      this.aimPitch = steer.pitch;
      this.idleTime = 0;
    } else {
      this.idleTime = controls.mouseDX !== 0 || controls.mouseDY !== 0 ? 0 : this.idleTime + dt;
      this.aimYaw -= controls.mouseDX * PLANE.mouseSensitivity;
      this.aimPitch -= controls.mouseDY * PLANE.mouseSensitivity;
      this.aimYaw += controls.bank * PLANE.keyTurnRate * dt;
      // Automatic levelling: a climb or dive the player has let go of eases back to level flight.
      if (controls.autoLevel && this.idleTime > PLANE.autoLevelDelay) this.aimPitch *= Math.exp(-PLANE.autoLevelRate * dt);
    }
    this.aimYaw = this.yaw + clamp(wrapAngle(this.aimYaw - this.yaw), -PLANE.maxAimLead, PLANE.maxAimLead);
    this.aimPitch = clamp(this.aimPitch, -PLANE.maxPitch, PLANE.maxPitch);

    let targetPitch = climbingOut ? PLANE.launchPitch : this.aimPitch;
    // Out of range the plane can only glide.
    if (controls.gliding && !climbingOut) targetPitch = Math.min(targetPitch, -PLANE.glideAngle);
    // Level off smoothly near the ceiling.
    const headroom = (WORLD.ceilingY - this.position.y) / 5;
    targetPitch = Math.min(targetPitch, PLANE.maxPitch * clamp(headroom, -1, 1));

    // Turning: the wings roll towards the bank the wanted turn needs, and the heading follows the
    // bank. When the nose reaches the aim, the wanted bank drops to zero and the wings level out.
    // A badly damaged plane responds more slowly and its wings wobble.
    const turnRate = f.maxTurnRate * this.handling;
    const wantYawRate = clamp(wrapAngle(this.aimYaw - this.yaw) * f.aimGain, -turnRate, turnRate);
    const wobble = this.wobble * (Math.sin(this.airborneTime * 7.1) + 0.6 * Math.sin(this.airborneTime * 3.3));
    const targetRoll = (wantYawRate / f.maxTurnRate) * f.maxBank + wobble;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-f.rollResponse * this.handling * dt));
    this.yaw = wrapAngle(this.yaw + (this.roll / f.maxBank) * f.maxTurnRate * dt);
    const wantPitchRate = clamp((targetPitch - this.pitch) * f.aimGain, -f.maxPitchRate, f.maxPitchRate);
    this.pitchRate += (wantPitchRate - this.pitchRate) * (1 - Math.exp(-f.pitchResponse * dt));
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -PLANE.maxPitch, PLANE.maxPitch);

    // Speed: settle on the throttle setting (plus boost); climbing costs speed, diving adds it.
    this.boost.update(dt, controls.boost && !autopilot && !controls.gliding);
    const topThrottle = controls.gliding ? f.cruiseSpeed : f.maxSpeed;
    this.throttleSpeed = clamp(this.throttleSpeed + controls.throttle * f.throttleAccel * dt, f.minSpeed, topThrottle);
    const targetSpeed = this.throttleSpeed + (this.boost.active ? f.boostSpeed : 0);
    const response = this.boost.active ? f.boostResponse : f.speedResponse;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-response * dt)) - Math.sin(this.pitch) * f.pitchSpeedEffect * dt;
    this.speed = clamp(this.speed, f.minSpeed, f.maxSpeed + f.boostSpeed);

    const forward = forwardFromAngles(this.yaw, this.pitch, this.fwd);
    this.position.add(forward.mulScalar(this.speed * dt));

    if (this.position.y < WORLD.voidY) return { outcome: 'void', collisions };

    const r = f.collisionRadius;
    for (const territory of territories) {
      const home = territory.id === this.homeId;
      if (home && (climbingOut || this.bounceGrace > 0)) continue;
      const { x, y, z } = this.position;
      const contact = sphereContact(x, y, z, r, territory.shape);
      if (!contact) continue;
      // Coming down onto the top of the home platform is a landing attempt.
      if (home && contact.ny > 0.7 && territory.containsXZ(x, z, -1) && this.prevPosition.y > territory.top + 0.3) {
        const state = this.touchdownState();
        this.lastTouchdown = assessTouchdown(state);
        if (this.lastTouchdown.ok) {
          this.status = 'rolling';
          this.position.y = territory.top + PLANE.parkedHeight;
          return { outcome: 'touchdown', collisions };
        }
        collisions.push({ kind: 'rough-landing', id: territory.id, closing: Math.max(0, state.sink), state, check: this.lastTouchdown });
        this.deflect(contact);
        // Bounce back up and climb away rather than slamming into the runway again.
        this.pitch = Math.max(this.pitch, DAMAGE.bouncePitch);
        this.aimPitch = Math.max(this.aimPitch, this.pitch);
        this.bounceGrace = DAMAGE.bounceGrace;
        continue;
      }
      collisions.push({ kind: 'platform', id: territory.id, closing: this.deflect(contact) });
    }
    for (const obstacle of obstacles) {
      for (const shape of obstacle.shapes) {
        const contact = sphereContact(this.position.x, this.position.y, this.position.z, r, shape);
        if (!contact) continue;
        collisions.push({ kind: 'object', id: obstacle.id, closing: this.deflect(contact) });
        break;
      }
    }
    return { outcome: 'flying', collisions };
  }

  /**
   * Pushes the plane clear of a surface and turns its heading away from it, keeping some of the
   * speed along the surface. Returns the closing speed (how fast it was flying into the surface).
   */
  private deflect(contact: Contact): number {
    const n = contact;
    this.position.x += n.nx * (n.depth + 0.02);
    this.position.y += n.ny * (n.depth + 0.02);
    this.position.z += n.nz * (n.depth + 0.02);
    const fwd = forwardFromAngles(this.yaw, this.pitch, this.fwd);
    const dot = fwd.x * n.nx + fwd.y * n.ny + fwd.z * n.nz;
    if (dot >= 0) return 0;
    const closing = -dot * this.speed;
    const k = dot * (1 + DAMAGE.bounce);
    fwd.set(fwd.x - n.nx * k, fwd.y - n.ny * k, fwd.z - n.nz * k).normalize();
    this.yaw = yawFromDirection(fwd.x, fwd.z);
    this.pitch = clamp(Math.asin(clamp(fwd.y, -1, 1)), -PLANE.maxPitch, PLANE.maxPitch);
    this.pitchRate = 0;
    this.aimYaw = this.yaw;
    this.aimPitch = this.pitch;
    // A head-on hit loses half the speed; a glancing one hardly any.
    this.speed = Math.max(this.flight.minSpeed, this.speed * (1 + 0.5 * dot));
    return closing;
  }

  /** Brakes along the home platform after touchdown. Returns true once the plane has stopped. */
  rollout(dt: number, home: Territory): boolean {
    if (this.status !== 'rolling') return this.status === 'stopped';
    this.speed = Math.max(0, this.speed - LANDING.rolloutDecel * dt);
    const k = 1 - Math.exp(-8 * dt);
    this.pitch += (0 - this.pitch) * k;
    this.roll += (0 - this.roll) * k;
    this.aimYaw = this.yaw;
    this.aimPitch = 0;
    this.position.x += -Math.sin(this.yaw) * this.speed * dt;
    this.position.z += -Math.cos(this.yaw) * this.speed * dt;
    // Never roll off the edge: brake hard at the rim instead.
    const limit = home.half - 2;
    const cx = clamp(this.position.x, home.x - limit, home.x + limit);
    const cz = clamp(this.position.z, home.z - limit, home.z + limit);
    if (cx !== this.position.x || cz !== this.position.z) this.speed = 0;
    this.position.set(cx, home.top + PLANE.parkedHeight, cz);
    if (this.speed <= 0) this.status = 'stopped';
    return this.status === 'stopped';
  }

  /** Seconds since launch. */
  get airborneFor(): number {
    return this.airborneTime;
  }

  /** Speed, sink rate and bank: what decides whether a touchdown is a landing. */
  touchdownState(): TouchdownState {
    return { speed: this.speed, sink: -Math.sin(this.pitch) * this.speed, roll: this.roll };
  }

  crash(): void {
    this.status = 'crashed';
    this.boost.reset();
  }

  hide(): void {
    this.status = 'hidden';
    this.boost.reset();
  }

  getForward(out: Vec3): Vec3 {
    return forwardFromAngles(this.yaw, this.pitch, out);
  }

  getAimDirection(out: Vec3): Vec3 {
    return forwardFromAngles(this.aimYaw, this.aimPitch, out);
  }

  getVelocity(out: Vec3): Vec3 {
    return this.getForward(out).mulScalar(this.status === 'flying' || this.status === 'rolling' ? this.speed : 0);
  }

  /**
   * A point given in the plane's own frame (nose along -Z, +Y up, +X the right wing) in the world,
   * turned by the plane's yaw, pitch and bank the same way its model is drawn.
   */
  toWorld(lx: number, ly: number, lz: number, out: Point3): Point3 {
    // Bank about the nose axis, then pitch about the wing axis, then yaw about the vertical.
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const x1 = lx * cr - ly * sr;
    const y1 = lx * sr + ly * cr;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const y2 = y1 * cp - lz * sp;
    const z2 = y1 * sp + lz * cp;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    out.x = this.position.x + x1 * cy + z2 * sy;
    out.y = this.position.y + y2;
    out.z = this.position.z - x1 * sy + z2 * cy;
    return out;
  }
}

/** Unit vector the nose points along. Yaw 0 faces -Z; positive yaw turns left, positive pitch climbs. */
export function forwardFromAngles(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Yaw that faces along the horizontal direction (dx, dz). */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a %= twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

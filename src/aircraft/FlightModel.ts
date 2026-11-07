import { Vec3 } from 'playcanvas';
import { sphereContact, type Collider, type Contact } from '../combat/Collision';
import { handlingFactor, wobbleAmount } from '../combat/Damage';
import { ACRO, DAMAGE, LANDING, MANEUVER, MANEUVERS, PLANE, WORLD, type AircraftSpec, type FlightProfile, type ManeuverId } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import { Boost, type BoostState } from './Boost';
import { assessTouchdown, type TouchdownCheck, type TouchdownState } from './Landing';
import { TRACKS, canCarry, easedShare, maneuverAt, maneuverDuration, maneuverIndex, type Track } from './maneuvers';

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

const STATUSES: readonly AircraftStatus[] = ['hidden', 'parked', 'flying', 'rolling', 'stopped', 'crashed'];
const BOOST_STATES: readonly BoostState[] = ['ready', 'active', 'cooldown'];

/**
 * Everything that decides the next flight step, as plain numbers (see FlightModel.saveState). The
 * multiplayer server sends its copy to the pilot's game, which rewinds to it and replays the inputs
 * the server hasn't seen yet.
 */
export type FlightSnapshot = number[];
/** Length of a FlightSnapshot (23 until v0.0.16 added the maneuver and loop state). */
export const FLIGHT_SNAPSHOT_SIZE = 39;

/**
 * Why the Maneuver key did nothing (the HUD says so):
 * none     – this plane has no maneuver in its slot (bombers have none).
 * cooldown – the last one is still folding back in.
 * slow     – not fast enough for this move.
 * low      – the move would go too low (towards the classroom floor).
 * room     – something is in the way of the move's path.
 * busy     – already in a move, a loop, or the climb-out or autopilot has the controls.
 */
export type ManeuverRefusal = 'none' | 'cooldown' | 'slow' | 'low' | 'room' | 'busy';

/**
 * normal – mouse-aim flight with the pitch limit.
 * track  – flying an automatic maneuver.
 * loop   – a manual loop: the pilot pulled past the pitch limit and the nose is free.
 */
export type FlightMode = 'normal' | 'track' | 'loop';

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
  /**
   * Steering given as a direction to fly instead of mouse movement: how AI pilots fly. Unlike the
   * autopilot it leaves the boost alone.
   */
  aim?: { yaw: number; pitch: number } | null;
  /** The Maneuver key was pressed this step (v0.0.16): fly the move in the slot. */
  maneuver?: boolean;
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

  /**
   * v0.0.16: the automatic maneuver in the plane's slot, set before take-off (at the pad); null
   * for none. Only a move the design can carry counts.
   */
  maneuverSlot: ManeuverId | null = null;
  /** Seconds until the slot's move can be flown again. */
  maneuverCooldown = 0;
  /** The move being flown, or null. */
  activeManeuver: ManeuverId | null = null;
  /** Why the last press of the Maneuver key did nothing, and for how much longer the HUD says so. */
  lastRefusal: ManeuverRefusal | null = null;
  refusalTime = 0;

  private airborneTime = 0;
  private idleTime = 0;
  // ---- Maneuver track state
  private trackTime = 0;
  private trackDuration = 1;
  /** +1 the move goes left, -1 right. */
  private trackSide = 1;
  private trackEntry = 0;
  /** Direction of travel while the nose is free (it can differ from the nose: grip). */
  private readonly vdir = new Vec3(0, 0, -1);
  // ---- Manual loop state
  private loopMode = 0;
  private loopDemand = 0;
  private loopYawDemand = 0;
  private loopIdle = 0;
  /** Extra mouse pull past the pitch limit, building up to a loop. */
  private loopPull = 0;
  /** +1 the last loop pulled the nose up (over the top), -1 pushed it down. */
  private loopDir = 1;
  private readonly rot = new Float64Array(9);
  private readonly tmpPos = new Vec3();
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
    this.resetManeuvers();
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
    this.resetManeuvers();
  }

  /** No move or loop in progress, the slot's move ready (each take-off starts with it ready). */
  resetManeuvers(): void {
    this.activeManeuver = null;
    this.maneuverCooldown = 0;
    this.lastRefusal = null;
    this.refusalTime = 0;
    this.loopMode = 0;
    this.loopPull = 0;
    this.loopDemand = 0;
    this.loopYawDemand = 0;
    this.loopIdle = 0;
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
    this.resetManeuvers();
  }

  fly(dt: number, controls: FlightControls, territories: readonly Territory[], obstacles: readonly Collider[]): FlightResult {
    const collisions: Collision[] = [];
    if (this.status !== 'flying') return { outcome: 'flying', collisions };
    const f = this.flight;
    this.prevPosition.copy(this.position);
    this.airborneTime += dt;
    this.bounceGrace = Math.max(0, this.bounceGrace - dt);
    const climbingOut = this.airborneTime < PLANE.launchGrace;
    this.maneuverCooldown = Math.max(0, this.maneuverCooldown - (this.activeManeuver ? 0 : dt));
    this.refusalTime = Math.max(0, this.refusalTime - dt);
    if (this.refusalTime === 0) this.lastRefusal = null;
    if (controls.maneuver) this.tryManeuver(controls, climbingOut, territories, obstacles);

    if (this.activeManeuver || this.loopMode !== 0) {
      this.flyFree(dt, controls);
      return this.afterMove(collisions, territories, obstacles, climbingOut);
    }

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
      // Pulling (or pushing) on past the pitch limit lifts it: a manual loop (v0.0.16).
      const over = this.aimPitch > PLANE.maxPitch ? this.aimPitch - PLANE.maxPitch : this.aimPitch < -PLANE.maxPitch ? this.aimPitch + PLANE.maxPitch : 0;
      const atLimit = Math.abs(this.pitch) > PLANE.maxPitch - 3 * DEG && Math.sign(this.pitch) === Math.sign(over);
      this.loopPull = this.loopPull * Math.exp(-2 * dt) + (atLimit ? over : 0);
      if (!climbingOut && this.aerobatic && Math.abs(this.loopPull) > ACRO.loopEntry) {
        this.startLoop(Math.sign(this.loopPull));
        this.flyFree(dt, controls);
        return this.afterMove(collisions, territories, obstacles, climbingOut);
      }
    }
    this.aimYaw = this.yaw + clamp(wrapAngle(this.aimYaw - this.yaw), -PLANE.maxAimLead, PLANE.maxAimLead);
    this.aimPitch = clamp(this.aimPitch, -PLANE.maxPitch, PLANE.maxPitch);

    let targetPitch = climbingOut ? PLANE.launchPitch : this.aimPitch;
    // Level off smoothly near the ceiling.
    const headroom = (WORLD.ceilingY - this.position.y) / 5;
    targetPitch = Math.min(targetPitch, PLANE.maxPitch * clamp(headroom, -1, 1));

    // Turning: the wings roll towards the bank the wanted turn needs, and the heading follows the
    // bank. When the nose reaches the aim, the wanted bank drops to zero and the wings level out.
    // A badly damaged plane responds more slowly and its wings wobble.
    // Slower turns tighter (v0.0.16): braking in a turn out-turns a plane at full speed.
    const agility = 1 + ACRO.slowTurnBonus * this.slowness();
    const turnRate = f.maxTurnRate * this.handling * agility;
    const wantYawRate = clamp(wrapAngle(this.aimYaw - this.yaw) * f.aimGain, -turnRate, turnRate);
    const wobble = this.wobble * (Math.sin(this.airborneTime * 7.1) + 0.6 * Math.sin(this.airborneTime * 3.3));
    const targetRoll = (wantYawRate / (f.maxTurnRate * agility)) * f.maxBank + wobble;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-f.rollResponse * this.handling * dt));
    this.yaw = wrapAngle(this.yaw + (this.roll / f.maxBank) * f.maxTurnRate * agility * dt);
    const pitchRate = f.maxPitchRate * agility;
    const wantPitchRate = clamp((targetPitch - this.pitch) * f.aimGain, -pitchRate, pitchRate);
    this.pitchRate += (wantPitchRate - this.pitchRate) * (1 - Math.exp(-f.pitchResponse * dt));
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -PLANE.maxPitch, PLANE.maxPitch);

    this.updateSpeed(dt, controls, !!autopilot);
    const forward = forwardFromAngles(this.yaw, this.pitch, this.fwd);
    this.position.add(forward.mulScalar(this.speed * dt));
    this.sink(dt);
    return this.afterMove(collisions, territories, obstacles, climbingOut);
  }

  /**
   * Speed: settle on the throttle setting (plus boost); climbing costs speed, diving adds it. Holding
   * S with the throttle already at the bottom opens the air brake (v0.0.16), well below minSpeed.
   */
  private updateSpeed(dt: number, controls: FlightControls, autopilot: boolean): void {
    const f = this.flight;
    this.boost.update(dt, controls.boost && !autopilot);
    const braking = controls.throttle < 0 && this.throttleSpeed <= f.minSpeed && !autopilot && !this.boost.active;
    this.throttleSpeed = clamp(this.throttleSpeed + controls.throttle * f.throttleAccel * dt, f.minSpeed, f.maxSpeed);
    const targetSpeed = braking ? f.minSpeed * ACRO.airbrakeFloor : this.throttleSpeed + (this.boost.active ? f.boostSpeed : 0);
    const response = this.boost.active ? f.boostResponse : braking ? ACRO.airbrakeResponse : f.speedResponse;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-response * dt)) - Math.sin(this.pitch) * f.pitchSpeedEffect * dt;
    this.speed = clamp(this.speed, f.minSpeed * ACRO.airbrakeFloor, f.maxSpeed + f.boostSpeed);
  }

  /** 0 at cruise speed and above → 1 at the air-brake floor: how much slower than cruise the plane is. */
  private slowness(): number {
    const f = this.flight;
    const floor = f.minSpeed * ACRO.airbrakeFloor;
    const k = clamp((f.cruiseSpeed - this.speed) / Math.max(1e-6, f.cruiseSpeed - floor), 0, 1);
    return k * k;
  }

  /** Below minSpeed (air brake, the top of a hang) the plane mushes down a little. */
  private sink(dt: number): void {
    const f = this.flight;
    if (this.speed >= f.minSpeed) return;
    const floor = f.minSpeed * ACRO.airbrakeFloor;
    this.position.y -= ACRO.slowSink * clamp((f.minSpeed - this.speed) / Math.max(1e-6, f.minSpeed - floor), 0, 1) * dt;
  }

  /** Fighters, multiroles and recon planes: the ones that can loop and fly maneuvers. */
  get aerobatic(): boolean {
    return this.design.role !== 'bomber';
  }

  /** What the flight is doing now. */
  get mode(): FlightMode {
    return this.activeManeuver ? 'track' : this.loopMode !== 0 ? 'loop' : 'normal';
  }

  /** The move in progress, as a share of its length (0 when none). */
  get maneuverProgress(): number {
    return this.activeManeuver ? clamp(this.trackTime / this.trackDuration, 0, 1) : 0;
  }

  /** The slot's move is ready (1) or folding back in (0 → 1). */
  get maneuverReadiness(): number {
    const id = this.slottedManeuver;
    if (!id) return 0;
    return 1 - clamp(this.maneuverCooldown / MANEUVERS[id].cooldown, 0, 1);
  }

  /** The slot's maneuver, if the design can carry it. */
  get slottedManeuver(): ManeuverId | null {
    return canCarry(this.design, this.maneuverSlot) && this.aerobatic ? this.maneuverSlot : null;
  }

  /** Why the slot's move can't be started right now, or null if it can (apart from the path check). */
  maneuverBlocker(controls: Pick<FlightControls, 'autopilot'> = { autopilot: null }): ManeuverRefusal | null {
    const id = this.slottedManeuver;
    if (!id) return 'none';
    if (this.status !== 'flying' || this.activeManeuver || this.loopMode !== 0 || controls.autopilot || this.airborneTime < PLANE.launchGrace) return 'busy';
    const spec = MANEUVERS[id];
    if (this.maneuverCooldown > 0) return 'cooldown';
    const f = this.flight;
    if ((this.speed - f.minSpeed) / (f.maxSpeed - f.minSpeed) < spec.minEntry - 1e-9) return 'slow';
    return null;
  }

  /** The Maneuver key: start the slot's move, or say why not. */
  private tryManeuver(controls: FlightControls, climbingOut: boolean, territories: readonly Territory[], obstacles: readonly Collider[]): void {
    let reason = this.maneuverBlocker(controls);
    if (!reason && climbingOut) reason = 'busy';
    const id = this.slottedManeuver;
    if (!reason && id) {
      const side = controls.bank > 0 ? 1 : controls.bank < 0 ? -1 : this.roll < -0.05 ? -1 : 1;
      reason = this.clearance(id, side, territories, obstacles);
      if (!reason) {
        this.startTrack(id, side);
        return;
      }
    }
    if (reason) {
      this.lastRefusal = reason;
      this.refusalTime = MANEUVER.refusalTime;
    }
  }

  private startTrack(id: ManeuverId, side: number): void {
    this.activeManeuver = id;
    this.trackTime = 0;
    this.trackDuration = maneuverDuration(id, this.flight, this.handling);
    this.trackSide = side;
    this.trackEntry = this.speed;
    forwardFromAngles(this.yaw, this.pitch, this.vdir);
    this.loopMode = 0;
    this.loopPull = 0;
  }

  /**
   * Flies the move's path ahead of time (with no collisions) to check it is clear: nothing in the
   * way and not too low. The flight is put back exactly as it was afterwards.
   */
  private clearance(id: ManeuverId, side: number, territories: readonly Territory[], obstacles: readonly Collider[]): ManeuverRefusal | null {
    const saved = this.saveState();
    const lastRefusal = this.lastRefusal;
    const refusalTime = this.refusalTime;
    this.startTrack(id, side);
    const step = MANEUVER.clearanceStep;
    const r = this.flight.collisionRadius + MANEUVER.clearanceMargin;
    const none: FlightControls = { mouseDX: 0, mouseDY: 0, throttle: 0, bank: 0, boost: false, autoLevel: false, autopilot: null };
    let reason: ManeuverRefusal | null = null;
    while (this.activeManeuver && !reason) {
      this.flyFree(step, none);
      const { x, y, z } = this.position;
      if (y < WORLD.voidY + MANEUVER.floorMargin) reason = 'low';
      for (const t of territories) {
        if (reason) break;
        if (t.id === this.homeId && this.bounceGrace > 0) continue;
        if (sphereContact(x, y, z, r, t.shape)) reason = 'room';
      }
      for (const o of obstacles) {
        if (reason) break;
        for (const shape of o.shapes) if (sphereContact(x, y, z, r, shape)) { reason = 'room'; break; }
      }
    }
    this.loadState(saved);
    this.lastRefusal = lastRefusal;
    this.refusalTime = refusalTime;
    return reason;
  }

  private startLoop(dir: number): void {
    this.loopMode = 1;
    this.loopDir = dir;
    this.loopDemand = dir * ACRO.loopDemandMax * 0.6;
    this.loopYawDemand = 0;
    this.loopIdle = 0;
    this.loopPull = 0;
    forwardFromAngles(this.yaw, this.pitch, this.vdir);
  }

  /**
   * The nose is free (a maneuver or a manual loop): orientation is a rotation matrix built from the
   * yaw, pitch and bank, turned in the plane's own frame and read back, so it passes cleanly through
   * vertical and upside down.
   */
  private flyFree(dt: number, controls: FlightControls): void {
    const f = this.flight;
    const R = this.rot;
    eulerToMatrix(this.yaw, this.pitch, this.roll, R);
    let grip = Infinity;
    let side = 0;
    let helixDelta: Vec3 | null = null;
    const track: Track | null = this.activeManeuver ? TRACKS[this.activeManeuver] : null;
    let finished = false;
    if (track) {
      const u0 = clamp(this.trackTime / this.trackDuration, 0, 1);
      this.trackTime += dt;
      const u1 = clamp(this.trackTime / this.trackDuration, 0, 1);
      for (const turn of track.turns) {
        const d = turn.angle * (turn.sided ? this.trackSide : 1) * (easedShare(u1, turn.from, turn.to) - easedShare(u0, turn.from, turn.to));
        if (d !== 0) rotateLocal(R, turn.axis, d);
      }
      this.boost.update(dt, false);
      this.speed = track.speed(u1, { entry: this.trackEntry, flight: f });
      grip = track.grip(u1);
      side = track.shove ? track.shove(u1) * this.trackSide : 0;
      if (track.helix) helixDelta = this.helixStep(track.helix, u0, u1);
      finished = u1 >= 1;
    } else {
      this.loopStep(dt, controls, R);
      // Loops keep the normal speed rules (the air brake and the boost included).
      this.updateSpeed(dt, controls, false);
    }
    matrixToEuler(R, this);
    // The direction of travel follows the nose as fast as the grip allows.
    const nx = -R[2], ny = -R[5], nz = -R[8];
    if (grip === Infinity) this.vdir.set(nx, ny, nz);
    else {
      const k = 1 - Math.exp(-grip * dt);
      this.vdir.set(this.vdir.x + (nx - this.vdir.x) * k, this.vdir.y + (ny - this.vdir.y) * k, this.vdir.z + (nz - this.vdir.z) * k).normalize();
    }
    this.position.x += this.vdir.x * this.speed * dt;
    this.position.y += this.vdir.y * this.speed * dt;
    this.position.z += this.vdir.z * this.speed * dt;
    if (side !== 0) {
      // Sideways in the horizontal plane, towards the move's side (left = +1).
      const yaw = this.yaw;
      this.position.x += -Math.cos(yaw) * side * dt;
      this.position.z += Math.sin(yaw) * side * dt;
    }
    if (helixDelta) this.position.add(helixDelta);
    if (!track) this.sink(dt);
    if (finished) this.endTrack();
  }

  /** The Spiral Drill's corkscrew: how far the helix offset moved between u0 and u1. */
  private helixStep(h: NonNullable<Track['helix']>, u0: number, u1: number): Vec3 {
    const at = (u: number, out: Vec3) => {
      const env = Math.sin(Math.PI * clamp((u - h.from) / (h.to - h.from), 0, 1));
      const a = Math.PI * 2 * h.turns * clamp((u - h.from) / (h.to - h.from), 0, 1) * this.trackSide;
      // Two directions square to the travel direction: across it horizontally, and "up" from it.
      const v = this.vdir;
      let ex = -v.z, ez = v.x;
      const l = Math.hypot(ex, ez) || 1;
      ex /= l; ez /= l;
      const ux = -ez * v.y, uy = ez * v.x - ex * v.z, uz = ex * v.y;
      const r = h.radius * env;
      return out.set(r * (Math.cos(a) * ex + Math.sin(a) * ux) - r * ex * env, r * Math.sin(a) * uy, r * (Math.cos(a) * ez + Math.sin(a) * uz) - r * ez * env);
    };
    const a = at(u0, new Vec3());
    const b = at(u1, this.tmpPos);
    return b.sub(a);
  }

  /** The end of a move: back to normal flight on the new heading. */
  private endTrack(): void {
    this.activeManeuver = null;
    this.maneuverCooldown = this.slottedManeuver ? MANEUVERS[this.slottedManeuver].cooldown : 0;
    this.handBack();
  }

  /**
   * Back to normal mouse-aim flight. The aim is rewritten to where the nose now points, so the plane
   * does not swing back to where the mouse aimed before a reversal, and the throttle is set to the
   * speed the plane has.
   */
  private handBack(): void {
    const f = this.flight;
    this.loopMode = 0;
    this.loopPull = 0;
    this.pitch = clamp(this.pitch, -PLANE.maxPitch, PLANE.maxPitch);
    this.aimYaw = this.yaw;
    this.aimPitch = this.pitch;
    this.pitchRate = 0;
    this.idleTime = 0;
    this.throttleSpeed = clamp(this.speed, f.minSpeed, f.maxSpeed);
    forwardFromAngles(this.yaw, this.pitch, this.vdir);
  }

  /**
   * A manual loop. The pull (mouse back, or the stick held back) keeps the nose turning in the
   * plane's own frame; A/D roll it. Let go and the plane carries on over the top (or through the
   * bottom) until its nose is within the normal pitch limit, rolls itself upright and hands back.
   */
  private loopStep(dt: number, controls: FlightControls, R: Float64Array): void {
    const f = this.flight;
    const sens = PLANE.mouseSensitivity;
    const pullIn = -controls.mouseDY * sens;
    this.loopDemand = clamp(this.loopDemand + pullIn, -ACRO.loopDemandMax, ACRO.loopDemandMax);
    this.loopYawDemand = clamp(this.loopYawDemand - controls.mouseDX * sens, -ACRO.loopDemandMax, ACRO.loopDemandMax);
    const rate = f.maxPitchRate * ACRO.loopRate * this.handling;
    if (Math.abs(this.loopDemand) > 0.02) {
      this.loopIdle = 0;
      this.loopMode = 1;
      this.loopDir = Math.sign(this.loopDemand);
    } else this.loopIdle += dt;
    if (this.loopIdle > ACRO.loopIdle) this.loopMode = 2;

    if (this.loopMode === 1) {
      const q = Math.sign(this.loopDemand) * rate * Math.min(1, Math.abs(this.loopDemand) / 0.12);
      rotateLocal(R, 'pitch', q * dt);
      // The pull is used up as the nose turns, slowly: holding the mouse back keeps the loop going.
      this.loopDemand -= Math.sign(this.loopDemand) * Math.min(Math.abs(this.loopDemand), Math.abs(q) * dt * ACRO.loopDemandUse);
    } else {
      // Recovering: carry on the way it was going until the nose is back within the pitch limit,
      // then roll upright and hand back.
      const pitch = Math.asin(clamp(-R[5], -1, 1));
      if (Math.abs(pitch) > PLANE.maxPitch - 2 * DEG) rotateLocal(R, 'pitch', this.loopDir * rate * dt);
      else {
        const roll = Math.atan2(R[3], R[4]);
        const step = ACRO.loopRecoverRate * dt;
        if (Math.abs(roll) > step) rotateLocal(R, 'roll', -Math.sign(roll) * step);
        else {
          rotateLocal(R, 'roll', -roll);
          matrixToEuler(R, this);
          this.handBack();
          return;
        }
      }
    }
    if (controls.bank !== 0) rotateLocal(R, 'roll', controls.bank * ACRO.loopRollRate * dt);
    const yawRate = clamp(this.loopYawDemand * f.aimGain, -f.maxTurnRate, f.maxTurnRate);
    if (yawRate !== 0) {
      rotateLocal(R, 'yaw', yawRate * dt);
      this.loopYawDemand -= yawRate * dt;
    }
  }

  /**
   * Ends a maneuver or a loop on the spot (something was hit, or the wheels touched): the plane comes
   * out the right way up along its direction of travel.
   */
  private dropFreeMode(): void {
    if (!this.activeManeuver && this.loopMode === 0) return;
    if (this.activeManeuver) {
      this.activeManeuver = null;
      this.maneuverCooldown = this.slottedManeuver ? MANEUVERS[this.slottedManeuver].cooldown : 0;
    }
    const v = this.vdir;
    this.yaw = yawFromDirection(v.x, v.z);
    this.pitch = Math.asin(clamp(v.y, -1, 1));
    this.roll = 0;
    this.handBack();
  }

  /** Bounds and collisions after the plane has moved this step. */
  private afterMove(collisions: Collision[], territories: readonly Territory[], obstacles: readonly Collider[], climbingOut: boolean): FlightResult {
    if (this.position.y < WORLD.voidY) return { outcome: 'void', collisions };

    const r = this.flight.collisionRadius;
    for (const territory of territories) {
      const home = territory.id === this.homeId;
      if (home && (climbingOut || this.bounceGrace > 0)) continue;
      const { x, y, z } = this.position;
      const contact = sphereContact(x, y, z, r, territory.shape);
      if (!contact) continue;
      // Coming down onto the top of the home platform is a landing attempt.
      if (home && contact.ny > 0.7 && territory.containsXZ(x, z, -1) && this.prevPosition.y > territory.top + 0.3) {
        this.dropFreeMode();
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
    // Hitting something ends a maneuver or a loop, with the normal impact rules.
    this.dropFreeMode();
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

  /**
   * The complete flight state as numbers: status, position, previous position, attitude, speeds,
   * aim, boost and the hidden steering state. Restoring it and repeating the same controls gives
   * exactly the same flight.
   */
  saveState(out: FlightSnapshot = []): FlightSnapshot {
    const p = this.position;
    const q = this.prevPosition;
    out.length = 0;
    out.push(
      STATUSES.indexOf(this.status), p.x, p.y, p.z, q.x, q.y, q.z,
      this.yaw, this.pitch, this.roll, this.speed, this.throttleSpeed, this.aimYaw, this.aimPitch,
      BOOST_STATES.indexOf(this.boost.state), this.boost.remaining,
      this.airborneTime, this.idleTime, this.pitchRate, this.bounceGrace, this.handling, this.wobble,
      this.lastTouchdown ? 1 : 0,
      maneuverIndex(this.maneuverSlot), maneuverIndex(this.activeManeuver), this.trackTime, this.trackDuration, this.trackSide, this.trackEntry,
      this.vdir.x, this.vdir.y, this.vdir.z, this.maneuverCooldown,
      this.loopMode, this.loopDemand, this.loopYawDemand, this.loopIdle, this.loopPull, this.loopDir,
    );
    return out;
  }

  /** Puts the flight back as `saveState` recorded it. Returns false (and changes nothing) if it isn't one. */
  loadState(s: readonly number[]): boolean {
    if (s.length !== FLIGHT_SNAPSHOT_SIZE || s.some((v) => !Number.isFinite(v))) return false;
    this.status = STATUSES[s[0]] ?? 'hidden';
    this.position.set(s[1], s[2], s[3]);
    this.prevPosition.set(s[4], s[5], s[6]);
    this.yaw = s[7];
    this.pitch = s[8];
    this.roll = s[9];
    this.speed = s[10];
    this.throttleSpeed = s[11];
    this.aimYaw = s[12];
    this.aimPitch = s[13];
    this.boost.restore(BOOST_STATES[s[14]] ?? 'ready', s[15]);
    this.airborneTime = s[16];
    this.idleTime = s[17];
    this.pitchRate = s[18];
    this.bounceGrace = s[19];
    this.handling = s[20];
    this.wobble = s[21];
    if (s[22] === 0) this.lastTouchdown = null;
    this.maneuverSlot = maneuverAt(s[23]);
    this.activeManeuver = maneuverAt(s[24]);
    this.trackTime = s[25];
    this.trackDuration = s[26] > 0 ? s[26] : 1;
    this.trackSide = s[27];
    this.trackEntry = s[28];
    this.vdir.set(s[29], s[30], s[31]);
    this.maneuverCooldown = s[32];
    this.loopMode = s[33];
    this.loopDemand = s[34];
    this.loopYawDemand = s[35];
    this.loopIdle = s[36];
    this.loopPull = s[37];
    this.loopDir = s[38];
    return true;
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
    this.resetManeuvers();
  }

  hide(): void {
    this.status = 'hidden';
    this.boost.reset();
    this.resetManeuvers();
  }

  getForward(out: Vec3): Vec3 {
    return forwardFromAngles(this.yaw, this.pitch, out);
  }

  getAimDirection(out: Vec3): Vec3 {
    return forwardFromAngles(this.aimYaw, this.aimPitch, out);
  }

  getVelocity(out: Vec3): Vec3 {
    // In a maneuver the plane can travel one way with its nose another (the Crane Flip's slide).
    if (this.status === 'flying' && (this.activeManeuver || this.loopMode !== 0)) return out.copy(this.vdir).mulScalar(this.speed);
    return this.getForward(out).mulScalar(this.status === 'flying' || this.status === 'rolling' ? this.speed : 0);
  }

  /**
   * The heading the chase camera should sit behind: the nose's heading in normal flight; during a
   * maneuver or a loop, the heading of travel, which stays steady when the nose points straight up
   * or the plane is upside down.
   */
  get cameraYaw(): number {
    if (this.activeManeuver || this.loopMode !== 0) {
      const v = this.vdir;
      if (Math.hypot(v.x, v.z) > 0.2) return yawFromDirection(v.x, v.z);
      return this.aimYaw;
    }
    return this.yaw;
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

const DEG = Math.PI / 180;

/**
 * The plane's orientation as a 3×3 matrix (row-major), in the order the model is drawn: yaw about
 * the vertical, then pitch about the wing axis, then bank about the nose axis. Its columns are the
 * plane's right wing, up and tail directions in the world.
 */
export function eulerToMatrix(yaw: number, pitch: number, roll: number, out: Float64Array): Float64Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  out[0] = cy * cr + sy * sp * sr; out[1] = -cy * sr + sy * sp * cr; out[2] = sy * cp;
  out[3] = cp * sr; out[4] = cp * cr; out[5] = -sp;
  out[6] = -sy * cr + cy * sp * sr; out[7] = sy * sr + cy * sp * cr; out[8] = cy * cp;
  return out;
}

/** Reads yaw, pitch and bank back from an orientation matrix (pitch within ±90°, any bank). */
export function matrixToEuler(m: Float64Array, out: { yaw: number; pitch: number; roll: number }): void {
  const sp = clamp(-m[5], -1, 1);
  out.pitch = Math.asin(sp);
  if (Math.abs(sp) < 0.999999) {
    out.yaw = Math.atan2(m[2], m[8]);
    out.roll = Math.atan2(m[3], m[4]);
  } else {
    // Straight up or down: yaw and bank are the same turn; keep the bank at zero.
    out.yaw = Math.atan2(-m[6], m[0]);
    out.roll = 0;
  }
}

/**
 * Turns the orientation in the plane's own frame: pitch (+ nose up) about the wing axis, roll
 * (+ left wing down... i.e. a bank to the left) about the nose axis, yaw (+ nose left) about the
 * plane's vertical axis.
 */
export function rotateLocal(m: Float64Array, axis: 'pitch' | 'roll' | 'yaw', angle: number): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  // Columns i and j of m are rotated into each other (right-multiplying by a rotation about the third axis).
  const [i, j] = axis === 'pitch' ? [1, 2] : axis === 'roll' ? [0, 1] : [2, 0];
  for (let row = 0; row < 3; row++) {
    const a = m[row * 3 + i], b = m[row * 3 + j];
    m[row * 3 + i] = a * c + b * s;
    m[row * 3 + j] = b * c - a * s;
  }
}

export interface Attitude {
  yaw: number;
  pitch: number;
  roll: number;
}

const qa = new Float64Array(4);
const qb = new Float64Array(4);
const qm = new Float64Array(9);

/** The attitude as a unit quaternion (x, y, z, w), in the order the model is drawn: yaw, pitch, bank. */
function attitudeQuat(a: Attitude, out: Float64Array): Float64Array {
  const hy = a.yaw / 2, hp = a.pitch / 2, hr = a.roll / 2;
  const cy = Math.cos(hy), sy = Math.sin(hy), cp = Math.cos(hp), sp = Math.sin(hp), cr = Math.cos(hr), sr = Math.sin(hr);
  // q = qYaw(about Y) · qPitch(about X) · qRoll(about Z)
  const x1 = sp, w1 = cp; // qPitch
  // qYaw · qPitch
  const ax = cy * x1, ay = sy * w1, az = -sy * x1, aw = cy * w1;
  // · qRoll (0, 0, sr, cr)
  out[0] = ax * cr + ay * sr;
  out[1] = ay * cr - ax * sr;
  out[2] = aw * sr + az * cr;
  out[3] = aw * cr - az * sr;
  return out;
}

/**
 * v0.0.16: the attitude a share `k` of the way from `a` to `b`, along the shortest rotation. Angle
 * by angle interpolation cuts corners when a plane flips through vertical (its yaw and bank both
 * jump by half a turn there); this does not.
 */
export function interpolateAttitude(a: Attitude, b: Attitude, k: number, out: Attitude): Attitude {
  attitudeQuat(a, qa);
  attitudeQuat(b, qb);
  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number, wb: number;
  if (dot > 0.9995) {
    wa = 1 - k;
    wb = k * sign;
  } else {
    const th = Math.acos(Math.min(1, dot));
    const s = Math.sin(th);
    wa = Math.sin((1 - k) * th) / s;
    wb = (Math.sin(k * th) / s) * sign;
  }
  let x = qa[0] * wa + qb[0] * wb, y = qa[1] * wa + qb[1] * wb, z = qa[2] * wa + qb[2] * wb, w = qa[3] * wa + qb[3] * wb;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  qm[0] = 1 - 2 * (y * y + z * z); qm[1] = 2 * (x * y - z * w); qm[2] = 2 * (x * z + y * w);
  qm[3] = 2 * (x * y + z * w); qm[4] = 1 - 2 * (x * x + z * z); qm[5] = 2 * (y * z - x * w);
  qm[6] = 2 * (x * z - y * w); qm[7] = 2 * (y * z + x * w); qm[8] = 1 - 2 * (x * x + y * y);
  matrixToEuler(qm, out);
  return out;
}

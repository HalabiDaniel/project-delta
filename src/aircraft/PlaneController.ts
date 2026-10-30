import * as pc from 'playcanvas';
import { BOMB, BOOST, LANDING, PALETTE, PLANE, WORLD } from '../config';
import type { Territory } from '../world/Territory';
import { Boost } from './Boost';
import { buildPaperBallMesh, createPaperMaterial, falconMaterials, FoldableFalcon, WINGTIP } from './FalconModel';
import { assessTouchdown, type TouchdownCheck, type TouchdownState } from './Landing';

/**
 * hidden  – no plane exists (at the desk with an empty hangar).
 * parked  – on the launch pad: being folded, waiting to launch, or recovered and waiting for a refit.
 * flying  – airborne and steerable.
 * rolling – touched down at home and braking along the platform.
 * stopped – came to rest after landing.
 * crashed – destroyed; the wreck is no longer drawn.
 */
export type AircraftStatus = 'hidden' | 'parked' | 'flying' | 'rolling' | 'stopped' | 'crashed';

export type FlightOutcome = 'flying' | 'touchdown' | 'hard-landing' | 'crashed-impact' | 'crashed-void';

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
}

const RAD_TO_DEG = 180 / Math.PI;

/** Where the carried paper balls hang: under the spine, then under each wing root. */
const BOMB_SLOTS: Array<[number, number, number]> = [
  [0, -BOMB.hangOffset, 0.15],
  [-0.5, -BOMB.hangOffset + 0.12, 0.45],
  [0.5, -BOMB.hangOffset + 0.12, 0.45],
];

/**
 * The aircraft: movement, steering, launch, landing and crash. It flies "mouse-aim" style: the
 * mouse moves an aim direction and the plane chases it. To turn, the plane first rolls into a bank
 * and the heading follows the bank, which gives turns a little inertia and lets the wings level
 * out on their own when the turn is done. Flight is still arcade: no stalls and artificial lift,
 * so the plane goes where it is pointed, but climbing bleeds a little speed and diving adds some.
 */
export class PlaneController {
  readonly root: pc.Entity;
  readonly model: FoldableFalcon;
  private readonly carriedBombs: pc.Entity[] = [];
  readonly boost = new Boost();

  status: AircraftStatus = 'hidden';
  readonly position = new pc.Vec3();
  /** Position at the start of the last flight step, for ring and airspace checks. */
  readonly prevPosition = new pc.Vec3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  /** The speed W and S set. The actual speed settles on it (plus any boost). */
  throttleSpeed: number = PLANE.cruiseSpeed;
  aimYaw = 0;
  aimPitch = 0;
  /** The last touchdown's assessment, so a hard landing can say what went wrong. */
  lastTouchdown: TouchdownCheck | null = null;
  /** The platform the plane last crashed into. */
  lastImpactId: string | null = null;

  private homeId = '';
  private airborneTime = 0;
  private idleTime = 0;
  private pitchRate = 0;
  private readonly rotation = new pc.Quat();
  private readonly qYaw = new pc.Quat();
  private readonly qPitch = new pc.Quat();
  private readonly qRoll = new pc.Quat();

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('plane');
    this.model = new FoldableFalcon(
      app.graphicsDevice,
      falconMaterials(new pc.Color(...PALETTE.planeAccent)),
      PLANE.parkedHeight - 0.07,
    );
    this.root.addChild(this.model.entity);

    const ballMesh = buildPaperBallMesh(app.graphicsDevice, BOMB.radius);
    const ballMaterial = createPaperMaterial(new pc.Color(...PALETTE.paperBall));
    for (const [x, y, z] of BOMB_SLOTS) {
      const ball = new pc.Entity('carried-bomb');
      ball.addComponent('render', { meshInstances: [new pc.MeshInstance(ballMesh, ballMaterial)], castShadows: true });
      ball.setLocalPosition(x, y, z);
      ball.enabled = false;
      this.root.addChild(ball);
      this.carriedBombs.push(ball);
    }

    this.root.enabled = false;
    app.root.addChild(this.root);
  }

  /** Puts the plane on the launch pad. `fold` 0 is a flat sheet, 1 the finished plane. */
  park(position: pc.Vec3, yaw: number, homeId: string, fold = 1): void {
    this.status = 'parked';
    this.homeId = homeId;
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.yaw = this.aimYaw = yaw;
    this.pitch = this.aimPitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.root.enabled = true;
    this.model.setFold(fold);
    this.applyTransform();
  }

  setFold(t: number): void {
    this.model.setFold(t);
  }

  /** Shows how many bombs the plane is carrying (up to three). */
  setBombs(count: number): void {
    this.carriedBombs.forEach((ball, i) => (ball.enabled = i < count));
  }

  launch(): void {
    if (this.status !== 'parked') return;
    this.status = 'flying';
    this.airborneTime = 0;
    this.idleTime = 0;
    this.speed = this.throttleSpeed = PLANE.cruiseSpeed;
    // Climb out at launchPitch, then level off unless the player has aimed elsewhere meanwhile.
    this.pitch = PLANE.launchPitch;
    this.pitchRate = 0;
    this.aimPitch = 0;
    this.lastTouchdown = null;
    this.lastImpactId = null;
    this.boost.reset();
    this.model.setFold(1);
  }

  fly(dt: number, controls: FlightControls, territories: readonly Territory[]): FlightOutcome {
    if (this.status !== 'flying') return 'flying';
    this.prevPosition.copy(this.position);
    this.airborneTime += dt;
    const climbingOut = this.airborneTime < PLANE.launchGrace;

    // Aim: the mouse and A/D move where the plane wants to go, unless the autopilot has it.
    const autopilot = controls.autopilot;
    if (autopilot) {
      this.aimYaw = autopilot.yaw;
      this.aimPitch = autopilot.pitch;
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
    // Level off smoothly near the ceiling.
    const headroom = (WORLD.ceilingY - this.position.y) / 5;
    targetPitch = Math.min(targetPitch, PLANE.maxPitch * clamp(headroom, -1, 1));

    // Turning: the wings roll towards the bank the wanted turn needs, and the heading follows the
    // bank. When the nose reaches the aim, the wanted bank drops to zero and the wings level out.
    const wantYawRate = clamp(wrapAngle(this.aimYaw - this.yaw) * PLANE.aimGain, -PLANE.maxTurnRate, PLANE.maxTurnRate);
    const targetRoll = (wantYawRate / PLANE.maxTurnRate) * PLANE.maxBank;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-PLANE.rollResponse * dt));
    this.yaw = wrapAngle(this.yaw + (this.roll / PLANE.maxBank) * PLANE.maxTurnRate * dt);
    const wantPitchRate = clamp((targetPitch - this.pitch) * PLANE.aimGain, -PLANE.maxPitchRate, PLANE.maxPitchRate);
    this.pitchRate += (wantPitchRate - this.pitchRate) * (1 - Math.exp(-PLANE.pitchResponse * dt));
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -PLANE.maxPitch, PLANE.maxPitch);

    // Speed: settle on the throttle setting (plus boost); climbing costs speed, diving adds it.
    this.boost.update(dt, controls.boost && !autopilot);
    this.throttleSpeed = clamp(this.throttleSpeed + controls.throttle * PLANE.throttleAccel * dt, PLANE.minSpeed, PLANE.maxSpeed);
    const targetSpeed = this.throttleSpeed + (this.boost.active ? BOOST.speed : 0);
    const response = this.boost.active ? BOOST.response : PLANE.speedResponse;
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-response * dt)) - Math.sin(this.pitch) * PLANE.pitchSpeedEffect * dt;
    this.speed = clamp(this.speed, PLANE.minSpeed, PLANE.maxSpeed + BOOST.speed);

    const forward = forwardFromAngles(this.yaw, this.pitch, tmpForward);
    this.position.add(forward.mulScalar(this.speed * dt));
    this.applyTransform();

    if (this.position.y < WORLD.voidY) return 'crashed-void';
    const { x, y, z } = this.position;
    for (const territory of territories) {
      if (climbingOut && territory.id === this.homeId) continue;
      if (!territory.intersectsSphere(x, y, z, PLANE.collisionRadius)) continue;
      // Coming down onto the top of the home platform is a landing attempt; anything else is a crash.
      if (territory.id === this.homeId && territory.containsXZ(x, z, -1) && this.prevPosition.y > territory.top + 0.3) {
        this.lastTouchdown = assessTouchdown(this.touchdownState());
        if (!this.lastTouchdown.ok) return 'hard-landing';
        this.status = 'rolling';
        this.position.y = territory.top + PLANE.parkedHeight;
        this.applyTransform();
        return 'touchdown';
      }
      this.lastImpactId = territory.id;
      return 'crashed-impact';
    }
    return 'flying';
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
    this.applyTransform();
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

  /** Where carried bomb `slot` hangs, in world space. With n bombs aboard, slots 0…n-1 are filled. */
  getBombPosition(out: pc.Vec3, slot: number): pc.Vec3 {
    return out.copy(this.carriedBombs[clamp(slot, 0, this.carriedBombs.length - 1)].getPosition());
  }

  /** World positions of both wingtips' trailing corners. */
  getWingtips(left: pc.Vec3, right: pc.Vec3): void {
    const m = this.root.getWorldTransform();
    m.transformPoint(tmpLocal.set(-WINGTIP[0], WINGTIP[1], WINGTIP[2]), right);
    m.transformPoint(tmpLocal.set(WINGTIP[0], WINGTIP[1], WINGTIP[2]), left);
  }

  crash(): void {
    this.status = 'crashed';
    this.root.enabled = false;
    this.boost.reset();
  }

  hide(): void {
    this.status = 'hidden';
    this.root.enabled = false;
    this.boost.reset();
  }

  getForward(out: pc.Vec3): pc.Vec3 {
    return forwardFromAngles(this.yaw, this.pitch, out);
  }

  getAimDirection(out: pc.Vec3): pc.Vec3 {
    return forwardFromAngles(this.aimYaw, this.aimPitch, out);
  }

  getVelocity(out: pc.Vec3): pc.Vec3 {
    return this.getForward(out).mulScalar(this.status === 'flying' || this.status === 'rolling' ? this.speed : 0);
  }

  private applyTransform(): void {
    this.qYaw.setFromAxisAngle(pc.Vec3.UP, this.yaw * RAD_TO_DEG);
    this.qPitch.setFromAxisAngle(pc.Vec3.RIGHT, this.pitch * RAD_TO_DEG);
    this.qRoll.setFromAxisAngle(pc.Vec3.BACK, this.roll * RAD_TO_DEG);
    this.rotation.mul2(this.qYaw, this.qPitch).mul(this.qRoll);
    this.root.setPosition(this.position);
    this.root.setRotation(this.rotation);
  }
}

const tmpForward = new pc.Vec3();
const tmpLocal = new pc.Vec3();

/** Unit vector the nose points along. Yaw 0 faces -Z; positive yaw turns left, positive pitch climbs. */
export function forwardFromAngles(yaw: number, pitch: number, out: pc.Vec3): pc.Vec3 {
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

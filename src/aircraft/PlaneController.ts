import * as pc from 'playcanvas';
import { BOMB, PALETTE, PLANE, WORLD } from '../config';
import type { Territory } from '../world/Territory';
import { buildPaperBallMesh, createFalcon, createPaperMaterial } from './FalconModel';

/**
 * hidden  – no plane exists (at the desk before folding, or after returning home).
 * parked  – folded and waiting on the launch pad.
 * flying  – airborne and steerable.
 * crashed – destroyed; the wreck is no longer drawn.
 */
export type AircraftStatus = 'hidden' | 'parked' | 'flying' | 'crashed';

export type FlightOutcome = 'flying' | 'crashed-impact' | 'crashed-void';

export interface FlightControls {
  /** Mouse movement since the last frame, in pixels. */
  mouseDX: number;
  mouseDY: number;
  /** +1 speed up (W), -1 slow down (S). */
  throttle: number;
  /** +1 bank left (A), -1 bank right (D). */
  bank: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * The aircraft: movement, steering, launch and crash. It flies "mouse-aim" style: the mouse moves
 * an aim direction and the plane turns toward it at a limited rate, banking as it goes. Flight is
 * deliberately arcade: constant forward motion, no gravity while flying (artificial lift), so the
 * plane only goes where it is pointed.
 */
export class PlaneController {
  readonly root: pc.Entity;
  private readonly model: pc.Entity;
  private readonly carriedBomb: pc.Entity;

  status: AircraftStatus = 'hidden';
  readonly position = new pc.Vec3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  aimYaw = 0;
  aimPitch = 0;
  hasBomb = false;

  private homeId = '';
  private airborneTime = 0;
  private foldTime = 0;
  private readonly rotation = new pc.Quat();
  private readonly qYaw = new pc.Quat();
  private readonly qPitch = new pc.Quat();
  private readonly qRoll = new pc.Quat();

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('plane');
    this.model = createFalcon(app, new pc.Color(...PALETTE.planeAccent));
    this.root.addChild(this.model);

    this.carriedBomb = new pc.Entity('carried-bomb');
    this.carriedBomb.addComponent('render', {
      meshInstances: [
        new pc.MeshInstance(
          buildPaperBallMesh(app.graphicsDevice, BOMB.radius),
          createPaperMaterial(new pc.Color(...PALETTE.paperBall)),
        ),
      ],
      castShadows: true,
    });
    this.carriedBomb.setLocalPosition(0, -BOMB.hangOffset, 0.15);
    this.root.addChild(this.carriedBomb);

    this.root.enabled = false;
    app.root.addChild(this.root);
  }

  /** Folds a fresh plane on the launch pad, with its single bomb loaded. */
  park(position: pc.Vec3, yaw: number, homeId: string): void {
    this.status = 'parked';
    this.homeId = homeId;
    this.position.copy(position);
    this.yaw = this.aimYaw = yaw;
    this.pitch = this.aimPitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.hasBomb = true;
    this.foldTime = 0;
    this.root.enabled = true;
    this.carriedBomb.enabled = true;
    this.applyTransform();
    this.updateFoldAnimation(0);
  }

  /** Plays the short folding animation while parked. */
  updateParked(dt: number): void {
    if (this.status !== 'parked') return;
    this.updateFoldAnimation(dt);
  }

  launch(): void {
    if (this.status !== 'parked') return;
    this.status = 'flying';
    this.airborneTime = 0;
    this.speed = PLANE.cruiseSpeed;
    // Climb out at launchPitch, then level off unless the player has aimed elsewhere meanwhile.
    this.pitch = PLANE.launchPitch;
    this.aimPitch = 0;
    this.foldTime = PLANE.foldTime;
    this.updateFoldAnimation(0);
  }

  fly(dt: number, controls: FlightControls, territories: readonly Territory[]): FlightOutcome {
    if (this.status !== 'flying') return 'flying';
    this.airborneTime += dt;
    const climbingOut = this.airborneTime < PLANE.launchGrace;

    // Aim: the mouse and A/D move where the plane wants to go.
    this.aimYaw -= controls.mouseDX * PLANE.mouseSensitivity;
    this.aimPitch -= controls.mouseDY * PLANE.mouseSensitivity;
    this.aimYaw += controls.bank * PLANE.keyTurnRate * dt;
    this.aimYaw = this.yaw + clamp(wrapAngle(this.aimYaw - this.yaw), -PLANE.maxAimLead, PLANE.maxAimLead);
    this.aimPitch = clamp(this.aimPitch, -PLANE.maxPitch, PLANE.maxPitch);

    let targetPitch = climbingOut ? PLANE.launchPitch : this.aimPitch;
    // Level off smoothly near the ceiling.
    const headroom = (WORLD.ceilingY - this.position.y) / 5;
    targetPitch = Math.min(targetPitch, PLANE.maxPitch * clamp(headroom, -1, 1));

    // The plane chases the aim at a limited turn rate.
    const yawRate = clamp(wrapAngle(this.aimYaw - this.yaw) * PLANE.aimGain, -PLANE.maxTurnRate, PLANE.maxTurnRate);
    const pitchRate = clamp((targetPitch - this.pitch) * PLANE.aimGain, -PLANE.maxPitchRate, PLANE.maxPitchRate);
    this.yaw = wrapAngle(this.yaw + yawRate * dt);
    this.pitch += pitchRate * dt;
    const targetRoll = (yawRate / PLANE.maxTurnRate) * PLANE.maxBank;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-8 * dt));

    this.speed = clamp(this.speed + controls.throttle * PLANE.throttleAccel * dt, PLANE.minSpeed, PLANE.maxSpeed);

    const forward = forwardFromAngles(this.yaw, this.pitch, tmpForward);
    this.position.add(forward.mulScalar(this.speed * dt));
    this.applyTransform();

    if (this.position.y < WORLD.voidY) return 'crashed-void';
    const { x, y, z } = this.position;
    for (const territory of territories) {
      if (climbingOut && territory.id === this.homeId) continue;
      if (territory.intersectsSphere(x, y, z, PLANE.collisionRadius)) return 'crashed-impact';
    }
    return 'flying';
  }

  /** Detaches the carried bomb. Returns false if it was already dropped. */
  releaseBomb(): boolean {
    if (this.status !== 'flying' || !this.hasBomb) return false;
    this.hasBomb = false;
    this.carriedBomb.enabled = false;
    return true;
  }

  /** Where the carried bomb currently hangs, in world space. */
  getBombPosition(out: pc.Vec3): pc.Vec3 {
    return out.copy(this.carriedBomb.getPosition());
  }

  crash(): void {
    this.status = 'crashed';
    this.root.enabled = false;
  }

  hide(): void {
    this.status = 'hidden';
    this.hasBomb = false;
    this.root.enabled = false;
  }

  getForward(out: pc.Vec3): pc.Vec3 {
    return forwardFromAngles(this.yaw, this.pitch, out);
  }

  getAimDirection(out: pc.Vec3): pc.Vec3 {
    return forwardFromAngles(this.aimYaw, this.aimPitch, out);
  }

  getVelocity(out: pc.Vec3): pc.Vec3 {
    return this.getForward(out).mulScalar(this.status === 'flying' ? this.speed : 0);
  }

  private applyTransform(): void {
    this.qYaw.setFromAxisAngle(pc.Vec3.UP, this.yaw * RAD_TO_DEG);
    this.qPitch.setFromAxisAngle(pc.Vec3.RIGHT, this.pitch * RAD_TO_DEG);
    this.qRoll.setFromAxisAngle(pc.Vec3.BACK, this.roll * RAD_TO_DEG);
    this.rotation.mul2(this.qYaw, this.qPitch).mul(this.qRoll);
    this.root.setPosition(this.position);
    this.root.setRotation(this.rotation);
  }

  private updateFoldAnimation(dt: number): void {
    this.foldTime = Math.min(this.foldTime + dt, PLANE.foldTime);
    const t = this.foldTime / PLANE.foldTime;
    const s = Math.max(0.01, easeOutBack(t));
    this.model.setLocalScale(s, s, s);
    this.model.setLocalEulerAngles(0, (1 - t) * 360, 0);
  }
}

const tmpForward = new pc.Vec3();

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

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

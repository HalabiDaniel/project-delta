import * as pc from 'playcanvas';
import { CAMERA, PALETTE } from '../config';
import { STICK } from '../input/analog';
import type { Territory } from '../world/Territory';
import { forwardFromAngles, type PlaneController } from './PlaneController';

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Third-person camera: frames the launch pad at the desk and follows behind the plane in flight.
 * The follow view trails the plane on a soft spring, leans gently into banked turns and pulls back
 * (and widens) as the plane speeds up, so speed reads without any camera shake.
 */
export class ChaseCamera {
  readonly entity: pc.Entity;
  private readonly pos = new pc.Vec3();
  private readonly look = new pc.Vec3();
  private readonly wantPos = new pc.Vec3();
  private readonly wantLook = new pc.Vec3();
  private readonly dir = new pc.Vec3();
  private roll = 0;
  /** Camera look from the controller's right stick, -1..1 each way (0 = straight behind). */
  private lookX = 0;
  private lookY = 0;

  constructor(app: pc.AppBase) {
    this.entity = new pc.Entity('camera');
    this.entity.addComponent('camera', {
      clearColor: new pc.Color(...PALETTE.sky),
      fov: CAMERA.baseFov,
      nearClip: 0.1,
      farClip: 1000,
    });
    app.root.addChild(this.entity);
  }

  /** Sets the look-around for the next follow update (the stick's eased, recentring value). */
  setLook(look: { x: number; y: number }): void {
    this.lookX = look.x;
    this.lookY = look.y;
  }

  get camera(): pc.CameraComponent {
    return this.entity.camera!;
  }

  /** The resting view at home: behind and above the launch pad, looking out along the runway. */
  updateDesk(dt: number, launch: pc.Vec3, yaw: number, snap = false): void {
    forwardFromAngles(yaw, 0, this.dir);
    // Off to one side a little, so the plane (or its preview) isn't hidden behind its own tail.
    const sideX = -this.dir.z;
    const sideZ = this.dir.x;
    this.wantPos.set(launch.x - this.dir.x * 9 + sideX * 2.5, launch.y + 5, launch.z - this.dir.z * 9 + sideZ * 2.5);
    this.wantLook.set(launch.x + this.dir.x * 14, launch.y + 0.5, launch.z + this.dir.z * 14);
    this.setFov(CAMERA.baseFov, snap ? Infinity : dt);
    this.move(snap ? Infinity : 3, dt, 0);
  }

  /**
   * Base management: high above the home platform and behind it, looking down over the whole base,
   * so every construction slot is in view. Still the normal 3D world, just from higher up.
   */
  updateBase(dt: number, centre: { x: number; z: number }, yaw: number, snap = false): void {
    forwardFromAngles(yaw, 0, this.dir);
    this.wantPos.set(centre.x - this.dir.x * 36, 58, centre.z - this.dir.z * 36);
    this.wantLook.set(centre.x - this.dir.x * 8, 0, centre.z - this.dir.z * 8);
    this.setFov(CAMERA.baseFov, snap ? Infinity : dt);
    this.move(snap ? Infinity : 2.5, dt, 0);
  }

  /**
   * Sits behind and above the plane, looking a little ahead and below it. When `focus` is given
   * (a falling bomb or its impact point) the view rises and pans down to keep it in frame.
   */
  updateFollow(dt: number, plane: PlaneController, territories: readonly Territory[], focus: pc.Vec3 | null): void {
    const p = plane.position;
    const f = plane.flight;
    const speedFrac = clamp((plane.speed - f.minSpeed) / (f.maxSpeed - f.minSpeed), 0, 1);
    const boostFrac = clamp((plane.speed - f.maxSpeed) / f.boostSpeed, 0, 1);
    const boosting = plane.boost.active ? 1 : boostFrac;
    // Bigger planes get a little more room.
    const size = Math.abs(plane.model.shape.wingtip[0]) * plane.model.shape.scale;
    const distance = (CAMERA.distance + CAMERA.speedDistance * speedFrac + CAMERA.boostDistance * boosting) * (0.8 + 0.14 * size);

    // Looking around swings the camera about the plane (right on the stick looks right).
    const looking = Math.min(1, Math.hypot(this.lookX, this.lookY));
    forwardFromAngles(plane.yaw - this.lookX * STICK.lookYaw, plane.pitch * 0.6 - this.lookY * STICK.lookPitch, this.dir);
    this.wantPos.set(
      p.x - this.dir.x * distance,
      p.y - this.dir.y * distance + CAMERA.height,
      p.z - this.dir.z * distance,
    );
    // Never dip inside a platform when climbing away low over one.
    for (const t of territories) {
      if (t.containsXZ(this.wantPos.x, this.wantPos.z, 1) && this.wantPos.y < t.top + 1.5 && this.wantPos.y > t.bottom - 3) {
        this.wantPos.y = t.top + 1.5;
      }
    }
    plane.getForward(this.dir);
    this.wantLook.set(
      p.x + this.dir.x * CAMERA.lookAhead,
      p.y + this.dir.y * CAMERA.lookAhead - CAMERA.lookDrop,
      p.z + this.dir.z * CAMERA.lookAhead,
    );
    // While looking around, keep the plane itself in the middle of the view.
    if (looking > 0.01) this.wantLook.lerp(this.wantLook, p, looking);
    if (focus) {
      this.wantLook.lerp(this.wantLook, focus, CAMERA.bombCamBlend);
      this.wantPos.y += CAMERA.bombCamRise;
    }
    this.setFov(CAMERA.baseFov + CAMERA.speedFov * speedFrac + CAMERA.boostFov * boosting, dt);
    this.move(CAMERA.followStiffness, dt, plane.roll * CAMERA.rollFollow);
  }

  /** Holds position and keeps watching a point (the crash site). */
  updateWatch(dt: number, point: pc.Vec3): void {
    this.wantPos.copy(this.pos);
    this.wantLook.copy(point);
    this.move(3, dt, 0);
  }

  private move(stiffness: number, dt: number, roll: number): void {
    const snap = stiffness === Infinity;
    const k = snap ? 1 : 1 - Math.exp(-stiffness * dt);
    const kLook = snap ? 1 : 1 - Math.exp(-stiffness * 2 * dt);
    this.pos.lerp(this.pos, this.wantPos, k);
    this.look.lerp(this.look, this.wantLook, kLook);
    this.roll += (roll - this.roll) * (snap ? 1 : 1 - Math.exp(-CAMERA.rollStiffness * dt));
    this.entity.setPosition(this.pos);
    this.entity.lookAt(this.look);
    // Lean into the turn: roll about the view axis, the same way the plane banks.
    if (Math.abs(this.roll) > 1e-4) this.entity.rotateLocal(0, 0, this.roll * RAD_TO_DEG);
  }

  private setFov(fov: number, dt: number): void {
    const cam = this.camera;
    cam.fov = dt === Infinity ? fov : cam.fov + (fov - cam.fov) * (1 - Math.exp(-3 * dt));
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

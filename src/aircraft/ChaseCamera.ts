import * as pc from 'playcanvas';
import { CAMERA, PALETTE, PLANE } from '../config';
import type { Territory } from '../world/Territory';
import { forwardFromAngles, type PlaneController } from './PlaneController';

/** Third-person camera: frames the launch pad at the desk and follows behind the plane in flight. */
export class ChaseCamera {
  readonly entity: pc.Entity;
  private readonly pos = new pc.Vec3();
  private readonly look = new pc.Vec3();
  private readonly wantPos = new pc.Vec3();
  private readonly wantLook = new pc.Vec3();
  private readonly dir = new pc.Vec3();

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

  get camera(): pc.CameraComponent {
    return this.entity.camera!;
  }

  /** The resting view at home: behind and above the launch pad, looking out toward the target. */
  updateDesk(dt: number, launch: pc.Vec3, yaw: number, snap = false): void {
    forwardFromAngles(yaw, 0, this.dir);
    this.wantPos.set(launch.x - this.dir.x * 12, launch.y + 9, launch.z - this.dir.z * 12);
    this.wantLook.set(launch.x + this.dir.x * 40, launch.y - 10, launch.z + this.dir.z * 40);
    this.setFov(CAMERA.baseFov);
    this.move(snap ? Infinity : 3, dt);
  }

  /**
   * Sits behind and above the plane, looking a little ahead and below it. When `focus` is given
   * (a falling bomb or its impact point) the view rises and pans down to keep it in frame.
   */
  updateFollow(dt: number, plane: PlaneController, territories: readonly Territory[], focus: pc.Vec3 | null): void {
    const p = plane.position;
    forwardFromAngles(plane.yaw, plane.pitch * 0.6, this.dir);
    this.wantPos.set(
      p.x - this.dir.x * CAMERA.distance,
      p.y - this.dir.y * CAMERA.distance + CAMERA.height,
      p.z - this.dir.z * CAMERA.distance,
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
    if (focus) {
      this.wantLook.lerp(this.wantLook, focus, CAMERA.bombCamBlend);
      this.wantPos.y += CAMERA.bombCamRise;
    }
    const speedFrac = (plane.speed - PLANE.minSpeed) / (PLANE.maxSpeed - PLANE.minSpeed);
    this.setFov(CAMERA.baseFov + CAMERA.speedFov * speedFrac, dt);
    this.move(CAMERA.followStiffness, dt);
  }

  /** Holds position and keeps watching a point (the crash site). */
  updateWatch(dt: number, point: pc.Vec3): void {
    this.wantPos.copy(this.pos);
    this.wantLook.copy(point);
    this.move(3, dt);
  }

  private move(stiffness: number, dt: number): void {
    const k = stiffness === Infinity ? 1 : 1 - Math.exp(-stiffness * dt);
    const kLook = stiffness === Infinity ? 1 : 1 - Math.exp(-stiffness * 2 * dt);
    this.pos.lerp(this.pos, this.wantPos, k);
    this.look.lerp(this.look, this.wantLook, kLook);
    this.entity.setPosition(this.pos);
    this.entity.lookAt(this.look);
  }

  private setFov(fov: number, dt = Infinity): void {
    const cam = this.camera;
    cam.fov = dt === Infinity ? fov : cam.fov + (fov - cam.fov) * (1 - Math.exp(-3 * dt));
  }
}

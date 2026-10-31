import * as pc from 'playcanvas';
import type { Collider } from '../combat/Collision';
import { AIRCRAFT, BOMB, PALETTE, PLANE, type AircraftId, type AircraftSpec, type FlightProfile } from '../config';
import type { Territory } from '../world/Territory';
import type { Boost } from './Boost';
import { FlightModel, type AircraftStatus, type FlightControls, type FlightResult } from './FlightModel';
import type { TouchdownCheck, TouchdownState } from './Landing';
import { buildPaperBallMesh, createPaperMaterial, FoldablePlane, inkBlotMaterial, planeMaterials } from './PlaneModel';
import { PLANE_SHAPES } from './PlaneShapes';
import { outline } from '../render/outline/OutlineRenderer';

export { clamp, forwardFromAngles, wrapAngle, yawFromDirection } from './FlightModel';
export type { AircraftStatus, Collision, FlightControls, FlightOutcome, FlightResult } from './FlightModel';

const RAD_TO_DEG = 180 / Math.PI;

interface Airframe {
  spec: AircraftSpec;
  model: FoldablePlane;
  /** Paper balls hanging under the plane, one per bomb slot. */
  bombs: pc.Entity[];
}

/**
 * The player's aircraft as seen in the scene: the folded-paper model of each design, its bomb rack,
 * and the flight model that moves it (see FlightModel, which AI aircraft fly through too). This
 * class keeps the model's pose in step with the physics and answers where the muzzles, wingtips
 * and tail are.
 */
export class PlaneController {
  readonly root: pc.Entity;
  /** The physics: where the plane is, where it points and how fast it goes. */
  readonly motion: FlightModel;
  private readonly airframes = new Map<AircraftId, Airframe>();
  private airframe: Airframe;
  private readonly rotation = new pc.Quat();
  private readonly qYaw = new pc.Quat();
  private readonly qPitch = new pc.Quat();
  private readonly qRoll = new pc.Quat();

  constructor(app: pc.AppBase, initial: AircraftId = 'falcon') {
    this.root = new pc.Entity('plane');
    const blots = inkBlotMaterial();
    const ballMaterial = createPaperMaterial(new pc.Color(...PALETTE.paperBall));
    const ballMesh = buildPaperBallMesh(app.graphicsDevice, BOMB.kinds.standard.radius);
    for (const spec of Object.values(AIRCRAFT)) {
      const shape = PLANE_SHAPES[spec.id];
      const model = new FoldablePlane(app.graphicsDevice, shape, planeMaterials(PALETTE.paper, spec.accent), PLANE.parkedHeight - 0.07, blots);
      model.entity.enabled = false;
      this.root.addChild(model.entity);
      const scale = BOMB.kinds[spec.bombs.kind].radius / BOMB.kinds.standard.radius;
      const bombs = shape.bombSlots.slice(0, spec.bombs.capacity).map(([x, y, z]) => {
        const ball = new pc.Entity('carried-bomb');
        ball.addComponent('render', { meshInstances: [new pc.MeshInstance(ballMesh, ballMaterial)], castShadows: true });
        ball.setLocalPosition(x, y, z);
        ball.setLocalScale(scale, scale, scale);
        ball.enabled = false;
        this.root.addChild(ball);
        outline(ball, 'hero');
        return ball;
      });
      this.airframes.set(spec.id, { spec, model, bombs });
    }
    this.motion = new FlightModel(AIRCRAFT[initial]);
    this.airframe = this.airframes.get(initial)!;
    this.setAircraft(initial);
    this.root.enabled = false;
    app.root.addChild(this.root);
  }

  get spec(): AircraftSpec {
    return this.airframe.spec;
  }

  get flight(): FlightProfile {
    return this.airframe.spec.flight;
  }

  get model(): FoldablePlane {
    return this.airframe.model;
  }

  get status(): AircraftStatus {
    return this.motion.status;
  }

  get position(): pc.Vec3 {
    return this.motion.position;
  }

  /** Position at the start of the last flight step, for ring and airspace checks. */
  get prevPosition(): pc.Vec3 {
    return this.motion.prevPosition;
  }

  get yaw(): number {
    return this.motion.yaw;
  }

  get pitch(): number {
    return this.motion.pitch;
  }

  get roll(): number {
    return this.motion.roll;
  }

  get speed(): number {
    return this.motion.speed;
  }

  /** The speed W and S set. The actual speed settles on it (plus any boost). */
  get throttleSpeed(): number {
    return this.motion.throttleSpeed;
  }

  get boost(): Boost {
    return this.motion.boost;
  }

  /** The last touchdown's assessment, so a hard landing can say what went wrong. */
  get lastTouchdown(): TouchdownCheck | null {
    return this.motion.lastTouchdown;
  }

  /** Seconds since launch. */
  get airborneFor(): number {
    return this.motion.airborneFor;
  }

  /** Swaps in another design's model, bomb rack and boost. */
  setAircraft(id: AircraftId): void {
    const next = this.airframes.get(id)!;
    if (next !== this.airframe) {
      this.airframe.model.entity.enabled = false;
      for (const ball of this.airframe.bombs) ball.enabled = false;
    }
    this.airframe = next;
    next.model.entity.enabled = true;
    this.motion.setAircraft(next.spec);
  }

  /** Health 1 → 0: the paper crumples and stains, and below a threshold the plane gets harder to fly. */
  setDamage(healthFraction: number): void {
    this.airframe.model.setDamage(healthFraction);
    this.motion.setHealth(healthFraction);
  }

  /** Puts the plane on the launch pad. `fold` 0 is a flat sheet, 1 the finished plane. */
  park(position: pc.Vec3, yaw: number, homeId: string, fold = 1): void {
    this.motion.park(position, yaw, homeId);
    this.root.enabled = true;
    this.airframe.model.setFold(fold);
    this.applyTransform();
  }

  setFold(t: number): void {
    this.airframe.model.setFold(t);
  }

  /** Shows how many bombs the plane is carrying. */
  setBombs(count: number): void {
    this.airframe.bombs.forEach((ball, i) => (ball.enabled = i < count));
  }

  /** From the launch pad, or from wherever the plane stopped after landing: a short automatic climb-out. */
  launch(): void {
    if (this.status !== 'parked' && this.status !== 'stopped') return;
    this.motion.launch();
    this.airframe.model.setFold(1);
  }

  fly(dt: number, controls: FlightControls, territories: readonly Territory[], obstacles: readonly Collider[]): FlightResult {
    const result = this.motion.fly(dt, controls, territories, obstacles);
    this.applyTransform();
    return result;
  }

  /** Brakes along the home platform after touchdown. Returns true once the plane has stopped. */
  rollout(dt: number, home: Territory): boolean {
    const rolling = this.status === 'rolling';
    const stopped = this.motion.rollout(dt, home);
    if (rolling) this.applyTransform();
    return stopped;
  }

  /** Speed, sink rate and bank: what decides whether a touchdown is a landing. */
  touchdownState(): TouchdownState {
    return this.motion.touchdownState();
  }

  /** Where carried bomb `slot` hangs, in world space. With n bombs aboard, slots 0…n-1 are filled. */
  getBombPosition(out: pc.Vec3, slot: number): pc.Vec3 {
    const bombs = this.airframe.bombs;
    if (bombs.length === 0) return out.copy(this.position);
    return out.copy(bombs[Math.min(Math.max(slot, 0), bombs.length - 1)].getPosition());
  }

  /** World position of gun muzzle `barrel`. */
  getMuzzle(out: pc.Vec3, barrel: number): pc.Vec3 {
    const muzzles = this.airframe.model.shape.muzzles;
    const [x, y, z] = muzzles[barrel % muzzles.length];
    return this.root.getWorldTransform().transformPoint(tmpLocal.set(x, y, z), out);
  }

  /** World positions of both wingtips' trailing corners. */
  getWingtips(left: pc.Vec3, right: pc.Vec3): void {
    const shape = this.airframe.model.shape;
    const [x, y, z] = shape.wingtip;
    const s = shape.scale;
    const m = this.root.getWorldTransform();
    m.transformPoint(tmpLocal.set(-x * s, y * s, z * s), right);
    m.transformPoint(tmpLocal.set(x * s, y * s, z * s), left);
  }

  /** World position of the back of the plane, where a damaged plane trails ink. */
  getTail(out: pc.Vec3): pc.Vec3 {
    const shape = this.airframe.model.shape;
    const s = shape.scale;
    return this.root.getWorldTransform().transformPoint(tmpLocal.set(0, shape.tail[1] * s, shape.tail[2] * s), out);
  }

  crash(): void {
    this.motion.crash();
    this.root.enabled = false;
  }

  hide(): void {
    this.motion.hide();
    this.root.enabled = false;
  }

  getForward(out: pc.Vec3): pc.Vec3 {
    return this.motion.getForward(out);
  }

  getAimDirection(out: pc.Vec3): pc.Vec3 {
    return this.motion.getAimDirection(out);
  }

  getVelocity(out: pc.Vec3): pc.Vec3 {
    return this.motion.getVelocity(out);
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

const tmpLocal = new pc.Vec3();

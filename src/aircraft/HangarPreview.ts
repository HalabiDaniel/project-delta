import * as pc from 'playcanvas';
import { AIRCRAFT_ORDER, PALETTE, type AircraftId } from '../config';
import { FoldablePlane } from './PlaneModel';
import { PLANE_SHAPES } from './PlaneShapes';

/** See-through and self-lit: a ghost of the plane, clearly not a real one yet. */
function blueprintMaterial(brightness: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(PALETTE.blueprint[0] * brightness, PALETTE.blueprint[1] * brightness, PALETTE.blueprint[2] * brightness);
  m.opacity = 0.6;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/** Degrees per second the preview turns by itself, and how long it waits after being dragged. */
const SPIN = 40;
const DRAG_HOLD = 2.5;

/**
 * The design chosen in the garage, as a blueprint ghost turning slowly in the air above the launch
 * pad. Dragging with the mouse turns it by hand; it picks up its own turning again after a moment.
 */
export class HangarPreview {
  private readonly root: pc.Entity;
  private readonly models = new Map<AircraftId, FoldablePlane>();
  private shown: AircraftId | null = null;
  private angle = 0;
  private tilt = 8;
  private time = 0;
  private visibility = 0;
  private sinceDrag = Infinity;

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('hangar-preview');
    const materials = { paper: blueprintMaterial(1), accent: blueprintMaterial(0.55) };
    for (const id of AIRCRAFT_ORDER) {
      const model = new FoldablePlane(app.graphicsDevice, PLANE_SHAPES[id], materials);
      model.entity.render!.castShadows = false;
      model.entity.enabled = false;
      this.root.addChild(model.entity);
      this.models.set(id, model);
    }
    this.root.enabled = false;
    app.root.addChild(this.root);
  }

  /** Turns the preview by hand (mouse drag, in pixels). */
  drag(dx: number, dy: number): void {
    this.angle = (this.angle + dx * 0.5) % 360;
    this.tilt = Math.min(50, Math.max(-30, this.tilt + dy * 0.3));
    this.sinceDrag = 0;
  }

  /** `lift` raises the ghost when a real plane is parked on the pad below it. */
  update(dt: number, pad: pc.Vec3, aircraft: AircraftId, visible: boolean, lift = 0): void {
    this.time += dt;
    this.sinceDrag += dt;
    if (this.sinceDrag > DRAG_HOLD) {
      this.angle = (this.angle + dt * SPIN) % 360;
      this.tilt += (8 - this.tilt) * (1 - Math.exp(-2 * dt));
    }
    if (aircraft !== this.shown) {
      if (this.shown) this.models.get(this.shown)!.entity.enabled = false;
      this.models.get(aircraft)!.entity.enabled = true;
      this.shown = aircraft;
      // Pop in again so the switch reads.
      this.visibility = Math.min(this.visibility, 0.4);
    }
    // Grow in and shrink away rather than popping.
    this.visibility += ((visible ? 1 : 0) - this.visibility) * (1 - Math.exp(-8 * dt));
    this.root.enabled = this.visibility > 0.02;
    if (!this.root.enabled) return;
    const s = this.visibility * 1.5;
    this.root.setPosition(pad.x, pad.y + 2.2 + lift + Math.sin(this.time * 1.6) * 0.2, pad.z);
    this.root.setEulerAngles(this.tilt, this.angle, -6);
    this.root.setLocalScale(s, s, s);
  }
}

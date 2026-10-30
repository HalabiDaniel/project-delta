import * as pc from 'playcanvas';
import { PALETTE } from '../config';
import { FoldableFalcon } from './FalconModel';

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

/** The plane you are about to fold, turning slowly in the air above the launch pad. */
export class HangarPreview {
  private readonly root: pc.Entity;
  private readonly model: FoldableFalcon;
  private angle = 0;
  private time = 0;
  private visibility = 0;

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('hangar-preview');
    this.model = new FoldableFalcon(app.graphicsDevice, { paper: blueprintMaterial(1), accent: blueprintMaterial(0.55) });
    this.model.entity.render!.castShadows = false;
    this.root.addChild(this.model.entity);
    this.root.enabled = false;
    app.root.addChild(this.root);
  }

  update(dt: number, pad: pc.Vec3, visible: boolean): void {
    this.time += dt;
    this.angle = (this.angle + dt * 40) % 360;
    // Grow in and shrink away rather than popping.
    this.visibility += ((visible ? 1 : 0) - this.visibility) * (1 - Math.exp(-8 * dt));
    this.root.enabled = this.visibility > 0.02;
    if (!this.root.enabled) return;
    const s = this.visibility * 1.5;
    this.root.setPosition(pad.x, pad.y + 2 + Math.sin(this.time * 1.6) * 0.2, pad.z);
    this.root.setEulerAngles(8, this.angle, -6);
    this.root.setLocalScale(s, s, s);
  }
}

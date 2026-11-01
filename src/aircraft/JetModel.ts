import * as pc from 'playcanvas';
import { CATALOG, type AircraftModelInfo, type ModelStore } from '../assets/CustomModels';
import { AIRCRAFT, PALETTE, type AircraftId } from '../config';
import { FoldablePlane, planeMaterials } from './PlaneModel';
import { PLANE_SHAPES, type PlaneShape, type V3 } from './PlaneShapes';

/**
 * The aircraft models from the Aircraft Lab (v0.0.11): a low-poly paper jet per design, in the
 * Paper skin, with no pencil strokes. They replace the folded stand-ins (FoldablePlane) wherever a
 * plane is drawn; a design whose model hasn't loaded keeps its stand-in.
 *
 * A jet animates itself from its flight state: the all-moving tail planes follow pitch and roll,
 * the Lancer's wings sweep back with speed, the Jumper's nozzles swing down when it flies slowly,
 * the afterburner glows and flickers with throttle and boost, and dashed wind lines stream off the
 * wingtips at speed and in hard turns.
 */

/** Lab models are about 4 long; this brings them to the stand-ins' size (≈ 3.5). */
export const JET_SCALE = 0.9;

/** Paper and trim colours: the skin is tinted with the first, the canopy with the second. */
export interface JetPaint {
  paper: readonly [number, number, number];
  accent: readonly [number, number, number];
}

/** What a plane model needs to know about its flight to animate. */
export interface FlightPose {
  status: string;
  speed: number;
  roll: number;
  pitch: number;
  boost: { active: boolean; level?: number };
}

/** What every plane model offers, folded stand-in or jet. */
export interface PlaneModelView {
  readonly entity: pc.Entity;
  readonly shape: PlaneShape;
  setFold(t: number): void;
  setDamage(healthFraction: number): void;
  /** Animates control surfaces and effects; optional for the stand-ins. */
  animate?(dt: number, pose: FlightPose | null): void;
}

interface JointNode {
  entity: pc.Entity;
  rest: pc.Quat;
  axis: pc.Vec3;
}

interface Burner {
  entity: pc.Entity;
  plume: pc.Entity;
  core: pc.Entity;
  r: number;
}

const DEG = 180 / Math.PI;

export class JetModel implements PlaneModelView {
  readonly entity: pc.Entity;
  readonly shape: PlaneShape;
  /** The model itself, turned to face −Z and scaled; the fold pose moves it. */
  private readonly body: pc.Entity;
  private readonly skins: Array<{ m: pc.StandardMaterial; base: pc.Color }> = [];
  private readonly glows: pc.StandardMaterial[] = [];
  private readonly stab: { l: JointNode | null; r: JointNode | null };
  private readonly sweep: Array<JointNode & { sign: number }> = [];
  private readonly vtol: JointNode[] = [];
  private readonly spin: JointNode | null;
  private readonly burners: Burner[] = [];
  private readonly fx: { plume: pc.StandardMaterial; core: pc.StandardMaterial; wind: pc.StandardMaterial };
  private readonly windLines: pc.Entity[] = [];
  private fold = -1;
  private damage = -1;
  private time = 0;
  private spinAngle = 0;

  constructor(
    template: pc.Entity,
    readonly id: AircraftId,
    readonly info: AircraftModelInfo,
    paint: JetPaint,
    private readonly restDrop = 0,
  ) {
    this.entity = new pc.Entity(`jet-${id}`);
    this.body = new pc.Entity('jet-body');
    this.body.addChild(template);
    template.setLocalEulerAngles(0, 180, 0);
    this.entity.addChild(this.body);
    this.body.setLocalScale(JET_SCALE, JET_SCALE, JET_SCALE);

    // Own copies of the paintable materials: skin and nose tinted with the side's paper, canopy with its trim.
    const own = new Map<pc.Material, pc.StandardMaterial>();
    for (const r of template.findComponents('render') as pc.RenderComponent[]) {
      r.castShadows = true;
      r.receiveShadows = false;
      for (const mi of r.meshInstances) {
        const m = mi.material;
        if (!(m instanceof pc.StandardMaterial)) continue;
        const kind = m.name.startsWith('Skin_') || m.name === 'NoseCone' ? 'skin' : m.name === 'Canopy' ? 'canopy' : m.name === 'Afterburner' ? 'glow' : null;
        if (!kind) continue;
        let c = own.get(m);
        if (!c) {
          c = m.clone() as pc.StandardMaterial;
          c.name = m.name;
          own.set(m, c);
          if (kind === 'skin') {
            const tint = new pc.Color(paint.paper[0], paint.paper[1], paint.paper[2]);
            c.diffuse = tint;
            this.skins.push({ m: c, base: tint.clone() });
          } else if (kind === 'canopy') {
            c.diffuse = new pc.Color(paint.accent[0] * 0.75, paint.accent[1] * 0.75, paint.accent[2] * 0.75);
          } else {
            c.emissiveIntensity = 0;
            this.glows.push(c);
          }
          c.update();
        }
        mi.material = c;
      }
    }

    const joint = (name: string, axis: pc.Vec3): JointNode | null => {
      const e = template.findByName(name) as pc.Entity | null;
      return e ? { entity: e, rest: e.getLocalRotation().clone(), axis } : null;
    };
    this.stab = { l: joint('Stabiliser_L', pc.Vec3.RIGHT), r: joint('Stabiliser_R', pc.Vec3.RIGHT) };
    for (const s of info.sweep) {
      const j = joint(s.node, pc.Vec3.UP);
      if (j) this.sweep.push({ ...j, sign: s.sign });
    }
    for (const n of info.vtol) {
      const j = joint(n, pc.Vec3.RIGHT);
      if (j) this.vtol.push(j);
    }
    this.spin = joint('Gun_Spin', pc.Vec3.BACK);

    // Effects hang off the model in lab coordinates, so they turn and scale with it.
    this.fx = { plume: glow([1, 0.48, 0.12]), core: glow([1, 0.94, 0.78]), wind: windMaterial() };
    const host = (name: string | null) => (name ? ((template.findByName(name) as pc.Entity | null) ?? template) : template);
    for (const n of info.fx?.nozzles ?? []) {
      const e = new pc.Entity('afterburner');
      e.setLocalPosition(n.x, n.y, n.z);
      const plume = cone(this.fx.plume);
      const core = cone(this.fx.core);
      e.addChild(plume);
      e.addChild(core);
      host(n.host).addChild(e);
      this.burners.push({ entity: e, plume, core, r: n.r });
    }
    for (const t of info.fx?.tips ?? []) {
      const e = windLine(this.fx.wind, 2.6, 0.035);
      e.setLocalPosition(t.at[0], t.at[1], t.at[2]);
      host(t.host).addChild(e);
      this.windLines.push(e);
    }

    // Stand-in data (muzzles, bomb racks) with the jet's own wingtips and tail.
    const tip = info.fx?.tips.find((t) => !t.host && t.at[0] > 0) ?? info.fx?.tips[0];
    const tail = info.points.exhaust_point ?? [0, 0, info.min[2]];
    const base = PLANE_SHAPES[id];
    this.shape = {
      ...base,
      scale: JET_SCALE,
      wingtip: tip ? ([-Math.abs(tip.at[0]), tip.at[1], -tip.at[2]] as V3) : [info.min[0], 0, -info.min[2] * 0.6],
      tail: [0, tail[1], -tail[2]],
    };
    this.setFold(1);
    this.setDamage(1);
    this.animate(0, null);
  }

  /**
   * 0 = a flat sheet on the pad, 1 = the finished plane. The jet unfolds from the sheet: it rises
   * from flat while spinning once, its wings spreading, and settles with a small bounce.
   */
  setFold(t: number): void {
    t = Math.min(1, Math.max(0, t));
    if (t === this.fold) return;
    this.fold = t;
    const e = t < 0.8 ? (t / 0.8) ** 2 : 1 + 0.06 * Math.sin(((t - 0.8) / 0.2) * Math.PI);
    const s = JET_SCALE;
    this.body.setLocalScale(s * (0.35 + 0.65 * Math.min(1, e)), s * Math.max(0.03, e), s * (0.55 + 0.45 * Math.min(1, e)));
    this.body.setLocalEulerAngles(0, (1 - Math.min(1, t / 0.8)) * 360, 0);
    this.body.setLocalPosition(0, -this.restDrop * (1 - Math.min(1, e)), 0);
  }

  /** 1 = pristine, 0 = about to fall apart: the paper darkens and stains with ink. */
  setDamage(healthFraction: number): void {
    const d = Math.round((1 - Math.min(1, Math.max(0, healthFraction))) * 10) / 10;
    if (d === this.damage) return;
    this.damage = d;
    const ink = PALETTE.ink;
    for (const { m, base } of this.skins) {
      const k = d * 0.55;
      m.diffuse.set(base.r + (ink[0] - base.r) * k, base.g + (ink[1] - base.g) * k, base.b + (ink[2] - base.b) * k);
      m.update();
    }
  }

  animate(dt: number, pose: FlightPose | null): void {
    this.time += dt;
    const spec = AIRCRAFT[this.id].flight;
    const flying = !!pose && pose.status === 'flying';
    const speed = pose?.speed ?? 0;
    const fast = Math.min(1, Math.max(0, (speed - spec.cruiseSpeed) / Math.max(1, spec.maxSpeed - spec.cruiseSpeed)));
    const boost = pose?.boost.active ? 1 : 0;
    // Afterburner: a low flame in cruise, full with boost or near top speed.
    const burn = flying ? Math.min(1, 0.35 + 0.65 * Math.max(boost, fast)) : 0;
    const t = this.time;
    const flick = 0.85 + Math.sin(t * 37) * 0.08 + Math.sin(t * 23 + 1) * 0.07;
    for (const b of this.burners) {
      b.entity.enabled = burn > 0.01;
      if (!b.entity.enabled) continue;
      const plumeLen = b.r * 7 * (0.5 + 0.5 * burn) * flick;
      b.plume.setLocalScale(b.r * 1.05, b.r * 1.05, plumeLen);
      b.plume.setLocalPosition(0, 0, -plumeLen / 2);
      const coreLen = b.r * 3.8 * (0.9 + Math.sin(t * 41) * 0.12);
      b.core.setLocalScale(b.r * 0.7, b.r * 0.7, coreLen);
      b.core.setLocalPosition(0, 0, -coreLen / 2);
    }
    setOpacity(this.fx.plume, 0.65 * flick * burn);
    setOpacity(this.fx.core, 0.9 * burn);
    for (const g of this.glows) {
      g.emissiveIntensity = flying ? (1.6 + Math.sin(t * 31) * 0.35 + Math.sin(t * 17) * 0.25) * Math.max(0.4, burn) : 0;
      g.update();
    }
    // Wind lines at speed and in hard turns.
    const turn = Math.min(1, Math.abs(pose?.roll ?? 0) / Math.max(0.1, spec.maxBank));
    const wind = flying ? Math.min(1, fast * 1.1 + boost * 0.6 + turn * 0.45) : 0;
    for (const w of this.windLines) w.enabled = wind > 0.02;
    if (wind > 0.02) {
      this.fx.wind.opacity = 0.75 * wind;
      const off = this.fx.wind.opacityMapOffset;
      this.fx.wind.opacityMapOffset = new pc.Vec2(0, (off.y + dt * (1.2 + fast)) % 1);
      this.fx.wind.update();
    }
    // Control surfaces: pitch together, roll opposite.
    const pitchCmd = flying ? Math.max(-0.4, Math.min(0.4, (pose!.pitch ?? 0) * 0.5)) : 0;
    const rollCmd = flying ? Math.max(-0.3, Math.min(0.3, (pose!.roll ?? 0) * 0.35)) : 0;
    turnJoint(this.stab.l, pitchCmd - rollCmd);
    turnJoint(this.stab.r, pitchCmd + rollCmd);
    // Swing wings sweep back with speed.
    const sweep = flying ? Math.min(1, Math.max(0, (speed - spec.cruiseSpeed * 0.9) / Math.max(1, spec.maxSpeed - spec.cruiseSpeed * 0.9))) : 0;
    for (const s of this.sweep) turnJoint(s, s.sign * 1.0 * sweep * sweep * (3 - 2 * sweep));
    // VTOL nozzles swing down when slow (and on the pad).
    const hover = pose ? 1 - Math.min(1, Math.max(0, (speed - spec.minSpeed) / Math.max(1, spec.cruiseSpeed - spec.minSpeed))) : 0;
    for (const n of this.vtol) turnJoint(n, -1.45 * hover);
    if (this.spin && flying) {
      this.spinAngle += dt * 8;
      turnJoint(this.spin, this.spinAngle);
    }
  }
}

const tmpQ = new pc.Quat();
function turnJoint(j: JointNode | null, angle: number): void {
  if (!j) return;
  tmpQ.setFromAxisAngle(j.axis, angle * DEG);
  j.entity.setLocalRotation(tmpQ.mul2(j.rest, tmpQ));
}

function setOpacity(m: pc.StandardMaterial, v: number): void {
  if (Math.abs(m.opacity - v) < 0.01) return;
  m.opacity = v;
  m.update();
}

/** Self-lit flame. Normal blending, not additive: additive vanishes against the bright classroom. */
function glow(color: readonly [number, number, number]): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(color[0], color[1], color[2]);
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.opacity = 0;
  m.update();
  return m;
}

/**
 * A unit cone along Z, centred on its origin, tip towards −Z (back, in the lab's frame). Scale
 * it (radius, radius, length) and move it back half its length to put its base on the nozzle.
 */
function cone(material: pc.Material): pc.Entity {
  const e = new pc.Entity('flame');
  // The primitive cone points up +Y; −90° about X turns its tip to −Z.
  const shape = new pc.Entity('flame-shape');
  shape.addComponent('render', { type: 'cone', material, castShadows: false, receiveShadows: false });
  shape.setLocalEulerAngles(-90, 0, 0);
  e.addChild(shape);
  return e;
}

let dashTexture: pc.Texture | null = null;
function windMaterial(): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.opacity = 0;
  if (dashTexture) {
    // White dashes scrolling back through the opacity.
    m.opacityMap = dashTexture;
    m.opacityMapChannel = 'r';
  }
  m.update();
  return m;
}

/** Dashed streaks along the texture's v (alpha in the red channel). */
export function createWindTexture(device: pc.GraphicsDevice): void {
  if (dashTexture || typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 8, 256);
  let y = 0;
  let r = 2;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  while (y < 256) {
    const l = 30 + rnd() * 60;
    g.fillStyle = `rgba(255,255,255,${0.6 + rnd() * 0.4})`;
    g.fillRect(2, y, 4, l);
    y += l + 20 + rnd() * 50;
  }
  dashTexture = new pc.Texture(device, { width: 8, height: 256, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_REPEAT, mipmaps: true });
  dashTexture.setSource(c);
}

/** Two crossed ribbons running back (−Z) from a wingtip, readable from any angle. */
function windLine(material: pc.Material, len: number, width: number): pc.Entity {
  const root = new pc.Entity('wind-line');
  for (const rz of [0, 90]) {
    const p = new pc.Entity('wind-strip');
    p.addComponent('render', { type: 'plane', material, castShadows: false, receiveShadows: false });
    p.setLocalEulerAngles(0, 0, rz);
    p.setLocalScale(width, 1, len);
    p.setLocalPosition(0, 0, -len / 2);
    root.addChild(p);
  }
  root.enabled = false;
  return root;
}

/**
 * The model to draw for a design: its jet if the model has loaded, otherwise the folded stand-in.
 * `paint` colours it for its side; `restDrop` lowers it while flat on the pad.
 */
export function createPlaneModel(
  device: pc.GraphicsDevice,
  store: ModelStore | null,
  id: AircraftId,
  paint: JetPaint,
  options: { restDrop?: number; blots?: pc.Material | null; outline?: boolean } = {},
): PlaneModelView {
  const info = CATALOG.aircraft[id];
  const template = info && store ? store.instance(info.file) : null;
  if (template && info) {
    createWindTexture(device);
    return new JetModel(template, id, info, paint, options.restDrop ?? 0);
  }
  return new FoldablePlane(device, PLANE_SHAPES[id], planeMaterials(paint.paper, paint.accent), options.restDrop ?? 0, options.blots ?? null, options.outline === false ? null : 'hero');
}

/** Is there a jet model for every design in this build? */
export function jetModelsAvailable(store: ModelStore): boolean {
  return (Object.keys(AIRCRAFT) as AircraftId[]).every((id) => CATALOG.aircraft[id] && store.ready(CATALOG.aircraft[id].file));
}

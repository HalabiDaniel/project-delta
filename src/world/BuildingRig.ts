import * as pc from 'playcanvas';
import { CATALOG, damageState, materialsNamed, setGlow, variantKey, type BuildingModelId, type DamageState, type Joint, type ModelInfo, type ModelStore } from '../assets/CustomModels';

/**
 * A building or defense from the Model Lab (v0.0.11), in cardboard, at one of its three levels
 * and four damage states (none, minor, medium, critical). The rig swaps the model when the level
 * or the damage state changes, and animates it the way the lab does:
 *
 * - turrets turn (Swivel) and elevate (Housing_Pitch) where the rules aim, and their guns recoil
 *   with every shot; rocket launchers turn and tilt their pod (Trunnion_Pitch); radars sweep;
 * - buildings light their windows with a faint flicker, blink their red beacons, open and close
 *   their doors now and then, turn their pumps and radar huts, and fill and drain their ink tanks;
 * - workshop chimneys smoke while they work, and damaged models smoke from their damage points,
 *   thicker and darker as the damage gets worse.
 *
 * Models face +Z in the lab; the rig turns them to face −Z, the game's forward.
 */

export interface RigPose {
  /** Weapon or radar heading relative to the body (radians, the game's yaw convention). */
  yaw: number;
  /** Weapon elevation (radians, positive up). */
  pitch: number;
  /** Seconds since the last shot (recoil), large if none. */
  sinceShot: number;
  /** False once destroyed: lights out, doors still, smoke on. */
  alive: boolean;
}

interface JointRef {
  entity: pc.Entity;
  joint: Joint;
  restPos: pc.Vec3;
  restRot: pc.Quat;
  restScale: pc.Vec3;
}

interface Beacon {
  materials: pc.StandardMaterial[];
  period: number;
  phase: number;
  width: number;
  peak: number;
  idle: number;
}

const DEG = 180 / Math.PI;

export class BuildingRig {
  readonly root: pc.Entity;
  private model: pc.Entity | null = null;
  private info: ModelInfo | null = null;
  private key = '';
  private yawJoint: JointRef | null = null;
  private pitchJoint: JointRef | null = null;
  private recoils: JointRef[] = [];
  private doors: JointRef[] = [];
  private spinners: JointRef[] = [];
  private inks: JointRef[] = [];
  private glass: pc.StandardMaterial[] = [];
  private interior: pc.StandardMaterial[] = [];
  private beacons: Beacon[] = [];
  private smoke: pc.Entity[] = [];
  private time = Math.random() * 20;
  private doorT = 0;
  private light = 0;
  /** Random per building, so doors and beacons don't all move together. */
  private readonly phase = Math.random() * 30;

  constructor(
    private readonly store: ModelStore,
    readonly modelId: BuildingModelId,
  ) {
    this.root = new pc.Entity(`building-${modelId}`);
  }

  /** Is this model loaded, so a rig can show it? */
  static available(store: ModelStore, id: BuildingModelId): boolean {
    const b = CATALOG.buildings[id];
    return !!b && store.ready(b.file);
  }

  get current(): ModelInfo | null {
    return this.info;
  }

  /** Height of the model's top, for labels. */
  get top(): number {
    return this.info ? this.info.max[1] : 2;
  }

  /** The model's own meshes (for ghosting the build preview). */
  get renders(): pc.RenderComponent[] {
    return this.model ? (this.model.findComponents('render') as pc.RenderComponent[]) : [];
  }

  /** Nodes under the model whose names match, e.g. launcher rockets. */
  nodes(pattern: RegExp): pc.Entity[] {
    const out: pc.Entity[] = [];
    this.model?.forEach((e) => {
      if (e instanceof pc.Entity && pattern.test(e.name)) out.push(e);
    });
    return out;
  }

  /** Shows the model for a level and a health share (damage state follows from it). Returns true if it changed. */
  show(level: number, health: number, alive: boolean): boolean {
    const b = CATALOG.buildings[this.modelId];
    const lv = b.levels.includes(level) ? level : b.levels.reduce((best, l) => (Math.abs(l - level) < Math.abs(best - level) ? l : best), b.levels[0]);
    const damage: DamageState = damageState(health, alive);
    const key = variantKey(lv, damage);
    if (key === this.key) return false;
    const model = this.store.instance(b.file, key);
    if (!model) return false;
    this.model?.destroy();
    this.key = key;
    this.model = model;
    this.info = b.variants[key];
    model.setLocalEulerAngles(0, 180, 0);
    model.setLocalPosition(0, 0, 0);
    this.root.addChild(model);
    this.collect(damage);
    return true;
  }

  private collect(damage: DamageState): void {
    const model = this.model!;
    const info = this.info!;
    const ref = (j: Joint): JointRef | null => {
      const e = model.findByName(j.node) as pc.Entity | null;
      return e ? { entity: e, joint: j, restPos: e.getLocalPosition().clone(), restRot: e.getLocalRotation().clone(), restScale: e.getLocalScale().clone() } : null;
    };
    // Several nodes can share a name (two guns' Gun_Recoil): find them all.
    const refs: JointRef[] = [];
    for (const j of info.joints) {
      if (refs.some((r) => r.joint.node === j.node)) continue;
      const all = model.find((e) => e.name === j.node) as pc.Entity[];
      if (all.length > 1) for (const e of all) refs.push({ entity: e, joint: j, restPos: e.getLocalPosition().clone(), restRot: e.getLocalRotation().clone(), restScale: e.getLocalScale().clone() });
      else {
        const r = ref(j);
        if (r) refs.push(r);
      }
    }
    this.yawJoint = refs.find((r) => r.joint.node === 'Swivel') ?? null;
    this.pitchJoint = refs.find((r) => /_Pitch$/.test(r.joint.node)) ?? null;
    this.recoils = refs.filter((r) => r.joint.label === 'Recoil');
    // A critically damaged building's doors are jammed.
    this.doors = damage >= 3 ? [] : refs.filter((r) => r.joint.label === 'Door');
    this.spinners = damage >= 3 ? [] : refs.filter((r) => r.joint.label === 'Spin');
    this.inks = refs.filter((r) => r.joint.label === 'Ink');
    this.glass = info.glass ? materialsNamed(model, info.glass) : [];
    this.interior = info.interior ? materialsNamed(model, info.interior) : [];
    this.beacons = info.beacons.map((b) => ({ ...b, materials: materialsNamed(model, b.material) }));
    // Smoke: light from working chimneys, dark from damage, thicker when critical.
    this.smoke = [];
    for (const name of info.smoke) {
      const p = model.findByName(name) as pc.Entity | null;
      if (p && damage < 3) this.smoke.push(addSmoke(p, 'chimney', this.store.device));
    }
    for (const name of info.damageSmoke) {
      const p = model.findByName(name) as pc.Entity | null;
      if (p) this.smoke.push(addSmoke(p, damage >= 3 ? 'heavy' : 'damage', this.store.device));
    }
  }

  update(dt: number, pose: RigPose): void {
    if (!this.model) return;
    this.time += dt;
    const t = this.time;
    if (this.yawJoint) setRot(this.yawJoint, 'y', pose.yaw);
    if (this.pitchJoint) {
      const j = this.pitchJoint.joint;
      // The lab's pitch joints aim up with negative angles.
      const radar = this.modelId === 'radar';
      const want = radar ? -0.35 + Math.sin(t * 0.6) * 0.3 + Math.sin(t * 0.23) * 0.12 : -pose.pitch;
      setRot(this.pitchJoint, 'x', Math.min(j.max ?? 1, Math.max(j.min ?? -1, want)));
    }
    for (const r of this.recoils) {
      const k = pose.sinceShot;
      const min = r.joint.min ?? -0.2;
      const z = k < 0.05 ? min * (k / 0.05) : k < 0.33 ? min * (1 - (1 - Math.pow(1 - (k - 0.05) / 0.28, 3))) : 0;
      r.entity.setLocalPosition(r.restPos.x, r.restPos.y, r.restPos.z + z);
    }
    // Doors open for a few seconds every so often (deliveries), then roll shut again.
    const cycle = (t + this.phase) % 18;
    const open = pose.alive && cycle > 12 && cycle < 16.5 ? 1 : 0;
    this.doorT += Math.sign(open - this.doorT) * Math.min(Math.abs(open - this.doorT), dt / 1.2);
    const e = this.doorT * this.doorT * (3 - 2 * this.doorT);
    for (const d of this.doors) {
      const j = d.joint;
      if (j.type === 'scale') {
        const s = d.restScale.clone();
        s[j.axis] = d.restScale[j.axis] * (1 - e * (1 - (j.min ?? 0.04)));
        d.entity.setLocalScale(s);
      } else if (j.type === 'translate') {
        const p = d.restPos.clone();
        p[j.axis] += e * (j.min !== undefined && j.min !== 0 ? j.min : (j.max ?? 0));
        d.entity.setLocalPosition(p);
      }
    }
    // Window lights fade on, with a faint warm flicker; out when destroyed.
    const lit = pose.alive ? 1 : 0;
    this.light += Math.sign(lit - this.light) * Math.min(Math.abs(lit - this.light), dt * 2.5);
    const flick = 1 + Math.sin(t * 13) * 0.03 + Math.sin(t * 7.3) * 0.04;
    for (const m of this.glass) setGlow(m, 1.5 * this.light * flick);
    for (const m of this.interior) setGlow(m, 0.45 * this.light * flick);
    for (const b of this.beacons) {
      const u = (((t + b.phase) % b.period) + b.period) % b.period / b.period;
      const v = pose.alive ? (u < b.width ? b.peak * Math.sqrt(1 - u / b.width) : b.idle) : 0;
      for (const m of b.materials) setGlow(m, v);
    }
    for (const s of this.spinners) {
      const j = s.joint;
      s.entity.setLocalRotation(s.restRot);
      s.entity.rotateLocal(j.axis === 'x' ? (j.speed ?? 0.8) * t * DEG : 0, j.axis === 'y' || !j.axis ? (j.speed ?? 0.8) * t * DEG : 0, j.axis === 'z' ? (j.speed ?? 0.8) * t * DEG : 0);
    }
    this.inks.forEach((s, i) => {
      const level = Math.min(1, Math.max(0.05, 0.55 + 0.38 * Math.sin(t * 0.35 + i * 1.7)));
      s.entity.setLocalScale(s.restScale.x, s.restScale.y * level, s.restScale.z);
    });
  }

  destroy(): void {
    this.root.destroy();
  }
}

const tmpQ = new pc.Quat();
function setRot(r: JointRef, axis: 'x' | 'y' | 'z', angle: number): void {
  const v = axis === 'x' ? pc.Vec3.RIGHT : axis === 'y' ? pc.Vec3.UP : pc.Vec3.BACK;
  tmpQ.setFromAxisAngle(v, angle * DEG);
  r.entity.setLocalRotation(tmpQ.mul2(r.restRot, tmpQ));
}

// ---- Smoke ------------------------------------------------------------------------------------

type SmokeKind = 'chimney' | 'damage' | 'heavy';

const SMOKE: Record<SmokeKind, { color: [number, number, number]; rate: number; life: number; size: number; rise: number }> = {
  chimney: { color: [0.74, 0.71, 0.68], rate: 0.16, life: 3.6, size: 0.55, rise: 0.5 },
  damage: { color: [0.36, 0.34, 0.33], rate: 0.16, life: 3, size: 0.6, rise: 0.45 },
  heavy: { color: [0.18, 0.17, 0.16], rate: 0.09, life: 3.4, size: 0.85, rise: 0.55 },
};

let puffTexture: pc.Texture | null = null;

/** A faceted puff (a hexagon in three shades): reads as low-poly smoke from any side. */
function puff(device: pc.GraphicsDevice): pc.Texture {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const pts = Array.from({ length: 6 }, (_, i) => [32 + Math.cos((i / 6) * Math.PI * 2 + 0.3) * 28, 32 + Math.sin((i / 6) * Math.PI * 2 + 0.3) * 28]);
  const shades = ['#ffffff', '#e4e4e4', '#cfcfcf'];
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(pts[i][0], pts[i][1]);
    g.lineTo(pts[(i + 1) % 6][0], pts[(i + 1) % 6][1]);
    g.closePath();
    g.fillStyle = shades[i % 3];
    g.fill();
  }
  puffTexture = new pc.Texture(device, { width: 64, height: 64, mipmaps: true });
  puffTexture.setSource(c);
  return puffTexture;
}

function addSmoke(at: pc.Entity, kind: SmokeKind, device: pc.GraphicsDevice): pc.Entity {
  const s = SMOKE[kind];
  const e = new pc.Entity(`smoke-${kind}`);
  e.addComponent('particlesystem', {
    numParticles: Math.ceil(s.life / s.rate) + 2,
    lifetime: s.life,
    rate: s.rate,
    rate2: s.rate * 1.3,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: 0.06,
    startAngle: 0,
    startAngle2: 360,
    colorMap: puff(device),
    colorGraph: new pc.CurveSet([[0, s.color[0]], [0, s.color[1]], [0, s.color[2]]]),
    velocityGraph: new pc.CurveSet([[0, 0.12], [0, s.rise], [0, 0]]),
    velocityGraph2: new pc.CurveSet([[0, 0.2], [0, s.rise * 1.3], [0, 0.08]]),
    scaleGraph: new pc.Curve([0, s.size * 0.15, 1, s.size]),
    alphaGraph: new pc.Curve([0, 0, 0.1, 0.75, 1, 0]),
    rotationSpeedGraph: new pc.Curve([0, 20]),
    rotationSpeedGraph2: new pc.Curve([0, -20]),
    blendType: pc.BLEND_NORMAL,
    depthWrite: false,
    lighting: false,
    loop: true,
    autoPlay: true,
    preWarm: true,
    sort: pc.PARTICLESORT_NONE,
  });
  at.addChild(e);
  return e;
}

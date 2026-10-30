import * as pc from 'playcanvas';
import { BOOST, PLANE, TRAILS } from '../config';
import type { PlaneController } from './PlaneController';

/** Most samples one ribbon keeps (about one per frame over its lifetime). */
const MAX_SAMPLES = 72;

/** An unlit, see-through white material whose colour and opacity come from the vertices. */
function trailMaterial(): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveVertexColor = true;
  m.opacityVertexColor = true;
  m.opacityVertexColorChannel = 'a';
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/**
 * A thin paper streamer behind one wingtip: a strip of quads through the tip's recent positions,
 * lying flat along the wing so it twists as the plane banks, tapering and fading with age.
 */
class Ribbon {
  readonly entity: pc.Entity;
  private readonly mesh: pc.Mesh;
  private readonly points: pc.Vec3[] = [];
  private readonly sides: pc.Vec3[] = [];
  private readonly ages: number[] = [];
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  private readonly colors = new Float32Array(MAX_SAMPLES * 2 * 4);
  private count = 0;

  constructor(app: pc.AppBase, material: pc.Material) {
    this.mesh = new pc.Mesh(app.graphicsDevice);
    const indices: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < MAX_SAMPLES; i++) {
      this.points.push(new pc.Vec3());
      this.sides.push(new pc.Vec3());
      this.ages.push(0);
    }
    this.mesh.setPositions(this.positions);
    this.mesh.setColors(this.colors, 4);
    this.mesh.setIndices(indices);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    const instance = new pc.MeshInstance(this.mesh, material);
    instance.cull = false; // world-space vertices; the entity stays at the origin
    this.entity = new pc.Entity('wingtip-trail');
    this.entity.addComponent('render', { meshInstances: [instance], castShadows: false, receiveShadows: false });
    app.root.addChild(this.entity);
  }

  /** Ages the trail and, if `point` is given, adds a new sample at the head. */
  update(dt: number, point: pc.Vec3 | null, side: pc.Vec3, strength: number): void {
    for (let i = 0; i < this.count; i++) this.ages[i] += dt;
    while (this.count > 0 && this.ages[this.count - 1] > TRAILS.life) this.count--;
    if (point) {
      // Shift everything back one slot and write the new head at index 0.
      const last = Math.min(this.count, MAX_SAMPLES - 1);
      const recycledPoint = this.points[last];
      const recycledSide = this.sides[last];
      for (let i = last; i > 0; i--) {
        this.points[i] = this.points[i - 1];
        this.sides[i] = this.sides[i - 1];
        this.ages[i] = this.ages[i - 1];
      }
      this.points[0] = recycledPoint.copy(point);
      this.sides[0] = recycledSide.copy(side);
      this.ages[0] = 0;
      this.count = last + 1;
    }
    this.entity.enabled = this.count > 1;
    if (!this.entity.enabled) return;

    const p = this.positions;
    const c = this.colors;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      // Unused samples collapse onto the tail, so they draw nothing.
      const k = Math.min(i, this.count - 1);
      const life = 1 - this.ages[k] / TRAILS.life;
      const half = (TRAILS.width / 2) * life;
      const pt = this.points[k];
      const sd = this.sides[k];
      const alpha = i < this.count ? TRAILS.opacity * strength * life * life : 0;
      p.set([pt.x - sd.x * half, pt.y - sd.y * half, pt.z - sd.z * half, pt.x + sd.x * half, pt.y + sd.y * half, pt.z + sd.z * half], i * 6);
      c.set([1, 1, 1, alpha, 1, 1, 1, alpha], i * 8);
    }
    this.mesh.setPositions(p);
    this.mesh.setColors(c, 4);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  }

  clear(): void {
    this.count = 0;
    this.entity.enabled = false;
  }
}

interface Streak {
  entity: pc.Entity;
  position: pc.Vec3;
}

/**
 * Speed cues: a ribbon behind each wingtip, and faint streaks of wind hanging in the air that the
 * plane rushes past. The streaks are almost invisible at cruise and stand out at top speed and
 * while boosting.
 */
export class FlightTrails {
  private readonly left: Ribbon;
  private readonly right: Ribbon;
  private readonly streaks: Streak[] = [];
  private readonly streakMaterial: pc.StandardMaterial;
  private readonly tipL = new pc.Vec3();
  private readonly tipR = new pc.Vec3();
  private readonly side = new pc.Vec3();
  private readonly fwd = new pc.Vec3();
  private readonly up = new pc.Vec3();
  private readonly rel = new pc.Vec3();
  private streakOpacity = 0;

  constructor(app: pc.AppBase) {
    const material = trailMaterial();
    this.left = new Ribbon(app, material);
    this.right = new Ribbon(app, material);

    this.streakMaterial = new pc.StandardMaterial();
    this.streakMaterial.useLighting = false;
    this.streakMaterial.diffuse = new pc.Color(0, 0, 0);
    this.streakMaterial.emissive = new pc.Color(1, 1, 1);
    this.streakMaterial.blendType = pc.BLEND_NORMAL;
    this.streakMaterial.depthWrite = false;
    this.streakMaterial.opacity = 0;
    this.streakMaterial.update();
    for (let i = 0; i < TRAILS.streakCount; i++) {
      const entity = new pc.Entity('wind-streak');
      entity.addComponent('render', { type: 'box', material: this.streakMaterial, castShadows: false, receiveShadows: false });
      entity.enabled = false;
      app.root.addChild(entity);
      this.streaks.push({ entity, position: new pc.Vec3(Infinity, 0, 0) });
    }
  }

  update(dt: number, plane: PlaneController): void {
    const airborne = plane.status === 'flying';
    const moving = airborne || plane.status === 'rolling';
    plane.getForward(this.fwd);
    this.side.copy(plane.root.right);

    const fast = clamp((plane.speed - PLANE.cruiseSpeed) / (PLANE.maxSpeed + BOOST.speed - PLANE.cruiseSpeed), 0, 1);
    const boosting = plane.boost.active ? 1 : 0;
    // Ribbons: always faintly there in flight, brighter when fast.
    const ribbon = moving ? 0.55 + 0.45 * Math.max(fast, boosting) : 0;
    if (moving) plane.getWingtips(this.tipL, this.tipR);
    this.left.update(dt, moving ? this.tipL : null, this.side, ribbon);
    this.right.update(dt, moving ? this.tipR : null, this.side, ribbon);

    const target = airborne ? TRAILS.streakBase + (TRAILS.streakMax - TRAILS.streakBase) * Math.max(fast, boosting) : 0;
    this.streakOpacity += (target - this.streakOpacity) * (1 - Math.exp(-4 * dt));
    this.updateStreaks(plane);
  }

  clear(): void {
    this.left.clear();
    this.right.clear();
    for (const s of this.streaks) {
      s.entity.enabled = false;
      s.position.set(Infinity, 0, 0);
    }
    this.streakOpacity = 0;
  }

  private updateStreaks(plane: PlaneController): void {
    const visible = this.streakOpacity > 0.01;
    this.streakMaterial.opacity = this.streakOpacity;
    this.streakMaterial.update();
    this.up.copy(plane.root.up);
    const length = 0.6 + plane.speed * 0.09;
    for (const s of this.streaks) {
      if (!visible) {
        s.entity.enabled = false;
        continue;
      }
      // Air stays put; the plane flies past it. Streaks behind the plane are moved up ahead again.
      this.rel.copy(s.position).sub(plane.position);
      const ahead = this.rel.dot(this.fwd);
      const lateral = Math.sqrt(Math.max(0, this.rel.lengthSq() - ahead * ahead));
      if (!Number.isFinite(ahead) || ahead < -4 || ahead > 70 || lateral > 12) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2.5 + Math.random() * 7;
        const dist = 18 + Math.random() * 45;
        s.position
          .copy(plane.position)
          .add(this.rel.copy(this.fwd).mulScalar(dist))
          .add(this.rel.copy(this.side).mulScalar(Math.cos(angle) * radius))
          .add(this.rel.copy(this.up).mulScalar(Math.sin(angle) * radius));
        s.entity.setPosition(s.position);
        s.entity.lookAt(this.rel.copy(s.position).add(this.fwd));
      }
      s.entity.setLocalScale(0.035, 0.035, length);
      s.entity.enabled = true;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

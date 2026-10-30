import * as pc from 'playcanvas';

interface Scrap {
  entity: pc.Entity;
  velocity: pc.Vec3;
  spin: pc.Vec3;
  angles: pc.Vec3;
  life: number;
  maxLife: number;
  size: number;
}

interface Ring {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  life: number;
  maxLife: number;
  radius: number;
}

export type BurstStyle = 'hit' | 'thud' | 'crash' | 'fold';

const STYLES: Record<BurstStyle, { colors: Array<[number, number, number]>; count: number; speed: number; ring: number }> = {
  hit: { colors: [[0.98, 0.97, 0.94], [0.86, 0.15, 0.15], [0.98, 0.56, 0.16], [1, 0.84, 0.2]], count: 36, speed: 14, ring: 9 },
  thud: { colors: [[0.95, 0.93, 0.86], [0.7, 0.7, 0.72]], count: 12, speed: 6, ring: 3 },
  crash: { colors: [[0.97, 0.96, 0.92], [0.2, 0.45, 0.95]], count: 22, speed: 9, ring: 0 },
  fold: { colors: [[0.97, 0.96, 0.92]], count: 10, speed: 3, ring: 0 },
};

/** Short-lived paper-scrap bursts and shock rings for impacts, crashes and folding. */
export class Effects {
  private readonly scraps: Scrap[] = [];
  private readonly rings: Ring[] = [];
  private readonly materials = new Map<string, pc.StandardMaterial>();

  constructor(private readonly app: pc.AppBase) {}

  burst(position: pc.Vec3, style: BurstStyle): void {
    const { colors, count, speed, ring } = STYLES[style];
    for (let i = 0; i < count; i++) {
      const entity = new pc.Entity('scrap');
      entity.addComponent('render', {
        type: 'box',
        material: this.material(colors[i % colors.length]),
        castShadows: false,
      });
      const size = 0.25 + Math.random() * 0.35;
      entity.setLocalScale(size, size * 0.15, size);
      entity.setPosition(position);
      this.app.root.addChild(entity);
      const a = Math.random() * Math.PI * 2;
      const up = 0.6 + Math.random();
      const s = speed * (0.4 + Math.random() * 0.6);
      const maxLife = 0.7 + Math.random() * 0.6;
      this.scraps.push({
        entity,
        velocity: new pc.Vec3(Math.cos(a) * s, up * s * 0.8, Math.sin(a) * s),
        spin: new pc.Vec3(rand(-720, 720), rand(-720, 720), rand(-720, 720)),
        angles: new pc.Vec3(rand(0, 360), rand(0, 360), rand(0, 360)),
        life: maxLife,
        maxLife,
        size,
      });
    }
    if (ring > 0) this.ring(position, ring, colors[1] ?? colors[0]);
  }

  update(dt: number): void {
    for (let i = this.scraps.length - 1; i >= 0; i--) {
      const s = this.scraps[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.entity.destroy();
        this.scraps.splice(i, 1);
        continue;
      }
      s.velocity.y -= 18 * dt;
      s.velocity.mulScalar(Math.exp(-1.5 * dt));
      const p = s.entity.getPosition();
      s.entity.setPosition(p.x + s.velocity.x * dt, p.y + s.velocity.y * dt, p.z + s.velocity.z * dt);
      s.angles.set(s.angles.x + s.spin.x * dt, s.angles.y + s.spin.y * dt, s.angles.z + s.spin.z * dt);
      s.entity.setEulerAngles(s.angles);
      const k = Math.min(1, s.life / (s.maxLife * 0.5));
      s.entity.setLocalScale(s.size * k, s.size * 0.15 * k, s.size * k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.entity.destroy();
        r.material.destroy();
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const radius = r.radius * (0.2 + 0.8 * Math.sqrt(t));
      r.entity.setLocalScale(radius * 2, 0.05, radius * 2);
      r.material.opacity = 0.7 * (1 - t);
      r.material.update();
    }
  }

  private ring(position: pc.Vec3, radius: number, color: [number, number, number]): void {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = new pc.Color(...color);
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.opacity = 0.7;
    material.update();
    const entity = new pc.Entity('shock-ring');
    entity.addComponent('render', { type: 'cylinder', material, castShadows: false });
    entity.setPosition(position.x, position.y + 0.05, position.z);
    this.app.root.addChild(entity);
    this.rings.push({ entity, material, life: 0.6, maxLife: 0.6, radius });
  }

  private material(color: [number, number, number]): pc.StandardMaterial {
    const key = color.join(',');
    let material = this.materials.get(key);
    if (!material) {
      material = new pc.StandardMaterial();
      material.diffuse = new pc.Color(...color);
      material.cull = pc.CULLFACE_NONE;
      material.update();
      this.materials.set(key, material);
    }
    return material;
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

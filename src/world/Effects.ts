import * as pc from 'playcanvas';
import { buildPaperBallMesh, createPaperMaterial } from '../aircraft/PlaneModel';
import { PALETTE } from '../config';
import { outline } from '../render/outline/OutlineRenderer';

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

interface Splat {
  entity: pc.Entity;
  material: pc.StandardMaterial;
  life: number;
  maxLife: number;
}

/** A destroyed plane, crumpled into a ball, tumbling down and bouncing on whatever it lands on. */
interface Wreck {
  entity: pc.Entity;
  velocity: pc.Vec3;
  spin: pc.Vec3;
  angles: pc.Vec3;
  life: number;
  size: number;
  bounces: number;
}

interface Puff {
  entity: pc.Entity;
  velocity: pc.Vec3;
  life: number;
  maxLife: number;
  size: number;
}

export type BurstStyle = 'hit' | 'thud' | 'crash' | 'fold' | 'ring' | 'dust' | 'ink' | 'cardboard' | 'blast' | 'enemy-ink' | 'wreck';

/** Height of the ground under (x, z), or null over a gap. */
export type GroundFn = (x: number, z: number) => number | null;

type Color3 = readonly [number, number, number];

const STYLES: Record<BurstStyle, { colors: readonly Color3[]; count: number; speed: number; ring: number }> = {
  hit: { colors: [[0.98, 0.97, 0.94], [0.86, 0.15, 0.15], [0.98, 0.56, 0.16], [1, 0.84, 0.2]], count: 36, speed: 14, ring: 9 },
  thud: { colors: [[0.95, 0.93, 0.86], [0.7, 0.7, 0.72]], count: 12, speed: 6, ring: 3 },
  crash: { colors: [[0.97, 0.96, 0.92], [0.2, 0.45, 0.95]], count: 22, speed: 9, ring: 0 },
  fold: { colors: [[0.97, 0.96, 0.92]], count: 10, speed: 3, ring: 0 },
  ring: { colors: [[0.98, 0.97, 0.94], [0.18, 0.66, 0.32], [1, 0.55, 0.1]], count: 18, speed: 7, ring: 0 },
  dust: { colors: [[0.97, 0.96, 0.92], [0.82, 0.84, 0.88]], count: 8, speed: 3, ring: 0 },
  ink: { colors: [PALETTE.inkShot, PALETTE.ink], count: 5, speed: 4, ring: 0 },
  cardboard: { colors: [PALETTE.cardboard, PALETTE.cardboardDark, PALETTE.tape], count: 26, speed: 10, ring: 6 },
  blast: { colors: [[1, 1, 1], [1, 0.62, 0.15], [0.86, 0.15, 0.12], [0.25, 0.24, 0.22]], count: 28, speed: 12, ring: 5 },
  'enemy-ink': { colors: [PALETTE.enemyInk, PALETTE.ink], count: 5, speed: 4, ring: 0 },
  wreck: { colors: [PALETTE.defense, PALETTE.defenseDark, PALETTE.cardboard, PALETTE.paper], count: 34, speed: 11, ring: 7 },
};

const PUFF_COLORS: Array<[number, number, number]> = [[1, 1, 1], [1, 0.93, 0.55], [1, 0.62, 0.2]];

/**
 * Short-lived effects: paper-scrap bursts and shock rings for impacts, crashes and folding, a
 * cartoon puff cloud for bomb hits, ink splats that stain the platform for a few seconds, ink
 * specks where rounds land, and crumpled wrecks of destroyed planes.
 */
export class Effects {
  private readonly scraps: Scrap[] = [];
  private readonly rings: Ring[] = [];
  private readonly splats: Splat[] = [];
  private readonly puffs: Puff[] = [];
  private readonly wrecks: Wreck[] = [];
  private readonly materials = new Map<string, pc.StandardMaterial>();
  private readonly splatMeshes: pc.Mesh[];
  private readonly ballMesh: pc.Mesh;
  private splatLayer = 0;

  constructor(
    private readonly app: pc.AppBase,
    private readonly ground: GroundFn = () => null,
  ) {
    this.splatMeshes = [0, 1, 2, 3].map(() => buildSplatMesh(app.graphicsDevice));
    this.ballMesh = buildPaperBallMesh(app.graphicsDevice, 1);
    // PlayCanvas destroys a mesh when the last mesh instance using it is destroyed. Splats and
    // wrecks come and go, so hold a reference to keep these shared meshes alive for the next ones.
    for (const mesh of [...this.splatMeshes, this.ballMesh]) mesh.incRefCount();
  }

  /** An ink round landing: a few specks, and a small stain if it hit the ground. */
  inkHit(position: pc.Vec3, onGround: boolean): void {
    this.burst(position, 'ink');
    if (onGround) this.splat(position, 0.55, PALETTE.inkShot, 4);
  }

  /**
   * A plane destroyed: it bursts into stylised paper scraps in its own colours, and what is left
   * crumples into a ball that tumbles on along its flight path, bounces and rolls to a stop.
   */
  wreck(position: pc.Vec3, velocity: pc.Vec3, accent: Color3, size = 1, paper: Color3 = PALETTE.paper): void {
    this.burstColors(position, [paper, accent, paper], 34, 10);
    this.puff(position, 0.5);
    const entity = new pc.Entity('wreck');
    const material = createPaperMaterial(new pc.Color(paper[0], paper[1], paper[2]));
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ballMesh, material)], castShadows: true });
    const accentBall = new pc.Entity('wreck-accent');
    accentBall.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ballMesh, this.material(accent))], castShadows: false });
    accentBall.setLocalPosition(0.35, 0.2, 0.1);
    accentBall.setLocalScale(0.6, 0.6, 0.6);
    entity.addChild(accentBall);
    entity.setPosition(position);
    const s = 0.55 * size;
    entity.setLocalScale(s, s, s);
    this.app.root.addChild(entity);
    // The crumpled ball is drawn in pencil like the plane it was (when outlines are on); its
    // strokes go with it when it is destroyed. Short-lived scraps and puffs stay unoutlined.
    outline(entity, 'prop');
    this.wrecks.push({
      entity,
      velocity: new pc.Vec3().copy(velocity).mulScalar(0.45),
      spin: new pc.Vec3(rand(-540, 540), rand(-540, 540), rand(-540, 540)),
      angles: new pc.Vec3(),
      life: 4,
      size: s,
      bounces: 0,
    });
  }

  /**
   * A bomb impact: on target, a big paper burst, a cartoon explosion and a splash of ink; on a
   * platform, a thud of scraps and a smaller grey splat.
   */
  bombImpact(position: pc.Vec3, onTarget: boolean): void {
    this.burst(position, onTarget ? 'hit' : 'thud');
    this.puff(position, onTarget ? 1 : 0.45);
    this.splat(position, onTarget ? 4 : 2.2, onTarget ? [0.12, 0.14, 0.32] : [0.45, 0.47, 0.52]);
  }

  /** A rocket bursting, or an installation going up: scraps, a shock ring and a cartoon cloud. */
  explosion(position: pc.Vec3, scale = 1, style: BurstStyle = 'blast'): void {
    this.burst(position, style);
    this.puff(position, scale);
  }

  /** Enemy ink striking something: magenta specks, and a stain if it hit the ground. */
  enemyInkHit(position: pc.Vec3, onGround: boolean): void {
    this.burst(position, 'enemy-ink');
    if (onGround) this.splat(position, 0.5, PALETTE.enemyInk, 3);
  }

  burst(position: pc.Vec3, style: BurstStyle): void {
    const { colors, count, speed, ring } = STYLES[style];
    this.burstColors(position, colors, count, speed, style === 'ink' || style === 'enemy-ink' ? 0.35 : 1);
    if (ring > 0) this.ring(position, ring, colors[1] ?? colors[0]);
  }

  private burstColors(position: pc.Vec3, colors: readonly Color3[], count: number, speed: number, sizeScale = 1): void {
    for (let i = 0; i < count; i++) {
      const entity = new pc.Entity('scrap');
      entity.addComponent('render', {
        type: 'box',
        material: this.material(colors[i % colors.length]),
        castShadows: false,
      });
      const size = (0.25 + Math.random() * 0.35) * sizeScale;
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
  }

  update(dt: number): void {
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.life -= dt;
      if (w.life <= 0) {
        w.entity.destroy();
        this.wrecks.splice(i, 1);
        continue;
      }
      w.velocity.y -= 22 * dt;
      const p = w.entity.getPosition();
      let x = p.x + w.velocity.x * dt, y = p.y + w.velocity.y * dt, z = p.z + w.velocity.z * dt;
      const floor = this.ground(x, z);
      if (floor !== null && y < floor + w.size && p.y >= floor + w.size - 0.05) {
        // Bounce, losing most of the energy each time, then roll to a stop.
        y = floor + w.size;
        w.velocity.y = Math.abs(w.velocity.y) * 0.35;
        w.velocity.x *= 0.6;
        w.velocity.z *= 0.6;
        w.spin.mulScalar(0.6);
        w.bounces++;
        if (w.bounces === 1) this.burst(w.entity.getPosition(), 'dust');
      }
      w.entity.setPosition(x, y, z);
      w.angles.add(w.spin.clone().mulScalar(dt));
      w.entity.setEulerAngles(w.angles);
      const k = Math.min(1, w.life / 0.6);
      w.entity.setLocalScale(w.size * k, w.size * k, w.size * k);
    }
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
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.entity.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.maxLife;
      // Pop up fast, then shrink away while drifting upwards.
      const k = t < 0.18 ? easeOut(t / 0.18) : 1 - easeIn((t - 0.18) / 0.82);
      const pos = p.entity.getPosition();
      p.entity.setPosition(pos.x + p.velocity.x * dt, pos.y + p.velocity.y * dt, pos.z + p.velocity.z * dt);
      const size = Math.max(0.001, p.size * k);
      p.entity.setLocalScale(size, size, size);
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.entity.destroy();
        s.material.destroy();
        this.splats.splice(i, 1);
        continue;
      }
      const age = s.maxLife - s.life;
      // Splash outwards quickly, then fade over the last two seconds.
      const grow = Math.min(1, age / 0.18);
      s.entity.setLocalScale(grow, 1, grow);
      s.material.opacity = 0.85 * Math.min(1, s.life / 2);
      s.material.update();
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

  /** A cluster of round cartoon smoke balls. */
  private puff(position: pc.Vec3, scale: number): void {
    const count = Math.round(4 + 5 * scale);
    for (let i = 0; i < count; i++) {
      const entity = new pc.Entity('puff');
      entity.addComponent('render', { type: 'sphere', material: this.material(PUFF_COLORS[i % PUFF_COLORS.length], true), castShadows: false });
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6 * scale;
      entity.setPosition(position.x + Math.cos(a) * r, position.y + 0.6 + Math.random() * 1.2 * scale, position.z + Math.sin(a) * r);
      entity.setLocalScale(0.001, 0.001, 0.001);
      this.app.root.addChild(entity);
      const maxLife = 0.6 + Math.random() * 0.35;
      this.puffs.push({
        entity,
        velocity: new pc.Vec3(Math.cos(a) * 1.5, 1.5 + Math.random() * 2, Math.sin(a) * 1.5),
        life: maxLife,
        maxLife,
        size: (1.2 + Math.random() * 1.4) * scale,
      });
    }
  }

  /** A flat, ragged blot of ink lying on the surface. */
  private splat(position: pc.Vec3, size: number, color: Color3, life = 8): void {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(...color);
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = 0.5;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.opacity = 0.85;
    material.update();
    const mesh = this.splatMeshes[Math.floor(Math.random() * this.splatMeshes.length)];
    const blot = new pc.Entity('ink-splat');
    blot.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
    // Each new splat sits a hair above the last, so overlapping ones don't flicker.
    this.splatLayer = (this.splatLayer + 1) % 20;
    const holder = new pc.Entity('ink-splat-holder');
    holder.setPosition(position.x, position.y + 0.05 + this.splatLayer * 0.002, position.z);
    holder.setEulerAngles(0, Math.random() * 360, 0);
    blot.setLocalScale(size, 1, size);
    holder.addChild(blot);
    holder.setLocalScale(0.001, 1, 0.001);
    this.app.root.addChild(holder);
    this.splats.push({ entity: holder, material, life, maxLife: life });
  }

  private ring(position: pc.Vec3, radius: number, color: Color3): void {
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

  private material(color: Color3, glow = false): pc.StandardMaterial {
    const key = `${color.join(',')}${glow ? ':glow' : ''}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new pc.StandardMaterial();
      material.diffuse = new pc.Color(...color);
      // Glowing puffs stay bright on the shadowed side too: cartoon smoke, not real smoke.
      if (glow) material.emissive = new pc.Color(color[0] * 0.55, color[1] * 0.55, color[2] * 0.55);
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

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

/**
 * A unit-radius ink blot in the XZ plane: a ragged disc with a few droplets flung around it.
 * Each call makes a different one.
 */
function buildSplatMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const disc = (cx: number, cz: number, radius: number, sides: number, ragged: number) => {
    const centre = positions.length / 3;
    positions.push(cx, 0, cz);
    normals.push(0, 1, 0);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const r = radius * (1 - ragged / 2 + Math.random() * ragged);
      positions.push(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      normals.push(0, 1, 0);
      // Wound to face up.
      indices.push(centre, centre + 1 + ((i + 1) % sides), centre + 1 + i);
    }
  };
  disc(0, 0, 0.62, 18, 0.45);
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.65 + Math.random() * 0.35;
    disc(Math.cos(a) * d, Math.sin(a) * d, 0.05 + Math.random() * 0.1, 7, 0.3);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

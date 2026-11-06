import * as pc from 'playcanvas';
import { PALETTE } from '../config';
import type { PlaneShape, V3 } from './PlaneShapes';

export interface PlaneMaterials {
  paper: pc.Material;
  accent: pc.Material;
}

export function createPaperMaterial(color: pc.Color, gloss = 0.15): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.gloss = gloss;
  material.useMetalness = true;
  material.metalness = 0;
  // Paper is a single sheet: draw and light both sides.
  material.cull = pc.CULLFACE_NONE;
  material.twoSidedLighting = true;
  material.update();
  return material;
}

export function planeMaterials(paper: readonly [number, number, number], accent: readonly [number, number, number]): PlaneMaterials {
  return {
    paper: createPaperMaterial(new pc.Color(paper[0], paper[1], paper[2])),
    accent: createPaperMaterial(new pc.Color(accent[0], accent[1], accent[2])),
  };
}

/** The halves stand almost upright when folded in half; the accents sit a touch further in so they never z-fight the wings. */
const STAND_UP = { paper: Math.PI / 2 - 0.1, accent: Math.PI / 2 - 0.05 };

/** Ink blots that appear on the paper as the plane is damaged. */
const BLOTS = 10;
/** How far vertices are pushed about when the plane is fully crumpled, relative to its size. */
const CRUMPLE = 0.075;

interface FoldPart {
  mesh: pc.Mesh;
  final: number[];
  positions: Float32Array;
  normals: Float32Array;
  standUp: number;
  /** Lift above the sheet while flat, so the accents lie on top of the wings instead of inside them. */
  lift: number;
}

interface Blot {
  entity: pc.Entity;
  /** Triangle (first vertex index into the paper part's arrays) and where in it. */
  tri: number;
  u: number;
  v: number;
}

/**
 * A paper plane with a folding animation. `setFold(t)` poses it anywhere between a flat sheet of
 * paper (t = 0), folded in half along the centre crease with both halves standing up (t = 0.5),
 * and the finished plane with its wings folded down (t = 1). Each vertex rotates about the centre
 * crease, so the sheet really folds instead of morphing. `setDamage` crumples the paper and
 * spatters it with ink as the plane loses health.
 */
export class FoldablePlane {
  readonly entity: pc.Entity;
  private readonly parts: FoldPart[];
  private readonly blots: Blot[] = [];
  private fold = -1;
  private crumple = 0;
  private visibleBlots = 0;
  private readonly size: number;

  /**
   * @param restDrop How far to lower the model while it lies flat, so the sheet rests on the
   * ground instead of floating at the finished plane's height.
   */
  constructor(
    device: pc.GraphicsDevice,
    readonly shape: PlaneShape,
    materials: PlaneMaterials,
    private readonly restDrop = 0,
    blotMaterial: pc.Material | null = null,
  ) {
    const paper = [...shape.paper.left, ...mirror(shape.paper.left), ...shape.paper.centre];
    const accent = [...shape.accent.left, ...mirror(shape.accent.left), ...shape.accent.centre];
    this.parts = [this.part(device, paper, STAND_UP.paper, 0), this.part(device, accent, STAND_UP.accent, 0.004)];
    this.size = Math.abs(shape.wingtip[0]) * shape.scale;
    this.entity = new pc.Entity('paper-plane');
    this.entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.parts[0].mesh, materials.paper), new pc.MeshInstance(this.parts[1].mesh, materials.accent)],
      castShadows: true,
      receiveShadows: false,
    });
    if (blotMaterial) this.createBlots(device, blotMaterial);
    this.setFold(1);
  }

  setFold(t: number): void {
    t = Math.min(1, Math.max(0, t));
    if (t === this.fold) return;
    this.fold = t;
    this.rebuild();
  }

  /** 1 = pristine, 0 = about to fall apart. Crumples the paper and reveals ink blots. */
  setDamage(healthFraction: number): void {
    const damage = 1 - Math.min(1, Math.max(0, healthFraction));
    const crumple = Math.round(damage * 20) / 20; // only rebuild in visible steps
    const blots = Math.round(damage * BLOTS);
    if (crumple === this.crumple && blots === this.visibleBlots) return;
    this.crumple = crumple;
    this.visibleBlots = blots;
    this.rebuild();
  }

  private rebuild(): void {
    const t = this.fold;
    // 0 → 0.42: both halves rise along the crease. 0.55 → 1: the wings fold back down, with a little bounce.
    const rise = smoothstep(t / 0.42);
    const down = t <= 0.55 ? 0 : easeOutBack((t - 0.55) / 0.45);
    const amount = this.crumple * CRUMPLE * this.size;
    for (const part of this.parts) {
      const { final, positions } = part;
      for (let i = 0; i < final.length; i += 3) {
        const x = final[i], y = final[i + 1], z = final[i + 2];
        if (Math.abs(x) < 1e-6) {
          // On the crease (nose, spine, keel): rises out of the sheet as it is folded.
          positions[i] = 0;
          positions[i + 1] = y * rise;
        } else {
          const r = Math.hypot(x, y);
          const finalAngle = Math.atan2(y, Math.abs(x));
          const angle = part.standUp * rise + (finalAngle - part.standUp * rise) * down;
          positions[i] = Math.sign(x) * r * Math.cos(angle);
          positions[i + 1] = r * Math.sin(angle) + part.lift * (1 - rise);
        }
        positions[i + 2] = z;
        if (amount > 0) {
          // Keyed by the vertex's final position, so corners shared by several triangles move together.
          positions[i] += amount * noise(x, y, z, 1) * (Math.abs(x) < 1e-6 ? 0 : 1);
          positions[i + 1] += amount * noise(x, y, z, 2);
          positions[i + 2] += amount * 0.5 * noise(x, y, z, 3);
        }
      }
      faceNormals(positions, part.normals);
      part.mesh.setPositions(positions);
      part.mesh.setNormals(part.normals);
      part.mesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    this.entity.setLocalPosition(0, -this.restDrop * (1 - rise), 0);
    this.placeBlots();
  }

  private part(device: pc.GraphicsDevice, triangles: V3[][], standUp: number, lift: number): FoldPart {
    const final: number[] = [];
    const s = this.shape.scale;
    for (const tri of triangles) for (const p of tri) final.push(p[0] * s, p[1] * s, p[2] * s);
    return {
      mesh: new pc.Mesh(device),
      final,
      positions: new Float32Array(final.length),
      normals: new Float32Array(final.length),
      standUp,
      lift,
    };
  }

  /** Picks spots on the larger, mostly flat paper triangles; deterministic so a plane always splats the same way. */
  private createBlots(device: pc.GraphicsDevice, material: pc.Material): void {
    const paper = this.parts[0];
    const candidates: number[] = [];
    for (let i = 0; i < paper.final.length; i += 9) {
      const area = triangleArea(paper.final, i);
      if (area > 0.05) candidates.push(i);
    }
    if (candidates.length === 0) return;
    const mesh = buildBlotMesh(device);
    for (let k = 0; k < BLOTS; k++) {
      const tri = candidates[(k * 7 + 3) % candidates.length];
      let u = hash(k, 1) * 0.8 + 0.1;
      let v = hash(k, 2) * 0.8 + 0.1;
      if (u + v > 0.95) [u, v] = [0.95 - v, 0.95 - u];
      const entity = new pc.Entity('ink-blot');
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: false });
      const size = 0.1 + hash(k, 3) * 0.12;
      entity.setLocalScale(size, 1, size);
      entity.enabled = false;
      this.entity.addChild(entity);
      this.blots.push({ entity, tri, u: Math.max(0.02, u), v: Math.max(0.02, v) });
    }
  }

  private placeBlots(): void {
    const finished = this.fold >= 1;
    const p = this.parts[0].positions;
    this.blots.forEach((blot, k) => {
      const show = finished && k < this.visibleBlots;
      blot.entity.enabled = show;
      if (!show) return;
      const i = blot.tri;
      const w = 1 - blot.u - blot.v;
      let nx = 0, ny = 0, nz = 0;
      {
        const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
        const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
        nx = uy * vz - uz * vy;
        ny = uz * vx - ux * vz;
        nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        // Always on the upper side of the sheet, where the player sees it.
        const flip = ny < 0 ? -1 : 1;
        nx = (nx / len) * flip;
        ny = (ny / len) * flip;
        nz = (nz / len) * flip;
      }
      const lift = 0.012;
      tmpPos.set(
        p[i] * w + p[i + 3] * blot.u + p[i + 6] * blot.v + nx * lift,
        p[i + 1] * w + p[i + 4] * blot.u + p[i + 7] * blot.v + ny * lift,
        p[i + 2] * w + p[i + 5] * blot.u + p[i + 8] * blot.v + nz * lift,
      );
      blot.entity.setLocalPosition(tmpPos);
      // Turn the blot's up (+Y) onto the surface normal.
      tmpAxis.set(nz, 0, -nx); // up × n
      const axisLen = tmpAxis.length();
      if (axisLen < 1e-5) tmpQuat.set(0, 0, 0, 1);
      else tmpQuat.setFromAxisAngle(tmpAxis.mulScalar(1 / axisLen), (Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI);
      blot.entity.setLocalRotation(tmpQuat);
    });
  }
}

const tmpPos = new pc.Vec3();
const tmpAxis = new pc.Vec3();
const tmpQuat = new pc.Quat();

const mirror = (tris: V3[][]): V3[][] => tris.map((tri) => tri.map(([x, y, z]) => [-x, y, z] as V3).reverse());

/** A smooth-looking pseudo-random value in -1…1 for a point, per channel. */
function noise(x: number, y: number, z: number, channel: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + channel * 19.19) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

function hash(k: number, channel: number): number {
  const v = Math.sin(k * 91.7 + channel * 47.3) * 24634.6345;
  return v - Math.floor(v);
}

function triangleArea(p: ArrayLike<number>, i: number): number {
  const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
  const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** Writes one face normal per triangle (following the winding) into all three of its vertices. */
function faceNormals(positions: ArrayLike<number>, out: Float32Array): void {
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 9; k += 3) {
      out[i + k] = nx / len;
      out[i + k + 1] = ny / len;
      out[i + k + 2] = nz / len;
    }
  }
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

/** Dark, slightly glossy ink for blots on damaged paper. */
export function inkBlotMaterial(): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(...PALETTE.ink);
  m.gloss = 0.5;
  m.useMetalness = true;
  m.metalness = 0;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/** A unit-radius ragged disc in the XZ plane, facing up. */
function buildBlotMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const indices: number[] = [];
  const sides = 11;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = 0.7 + 0.3 * hash(i, 9);
    positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    normals.push(0, 1, 0);
    indices.push(0, 1 + ((i + 1) % sides), 1 + i);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Builds a faceted mesh: each triangle gets its own vertices and a face normal, which gives the
 * crisp folded-paper look. Normals follow the winding; materials use two-sided lighting, so either
 * side of a sheet is lit correctly.
 */
export function buildFlatMesh(
  device: pc.GraphicsDevice,
  triangles: ReadonlyArray<ReadonlyArray<V3>>,
  scale = 1,
): pc.Mesh {
  const positions: number[] = [];
  for (const tri of triangles) for (const p of tri) positions.push(p[0] * scale, p[1] * scale, p[2] * scale);
  const normals = new Float32Array(positions.length);
  faceNormals(positions, normals);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** A lumpy low-poly sphere that reads as a crumpled paper ball. */
export function buildPaperBallMesh(device: pc.GraphicsDevice, radius: number): pc.Mesh {
  const sphere = new pc.SphereGeometry({ radius, latitudeBands: 5, longitudeBands: 7 });
  const p = sphere.positions;
  const indices = sphere.indices as number[];
  // Deterministic dents keyed by position, so vertices shared along seams move together.
  const dent = (x: number, y: number, z: number) =>
    1 + 0.13 * Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * Math.cos(x * 4.1 - z * 7.3);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const triangles: V3[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const tri: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = indices[i + k] * 3;
      const x = p[j], y = p[j + 1], z = p[j + 2];
      const s = dent(round(x), round(y), round(z));
      tri.push([x * s, y * s, z * s]);
    }
    triangles.push(tri);
  }
  return buildFlatMesh(device, triangles);
}

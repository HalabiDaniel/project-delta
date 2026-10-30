import * as pc from 'playcanvas';
import { PALETTE } from '../config';

/**
 * Temporary geometric stand-in for public/models/falcon.glb: a low-poly folded-paper fighter with
 * swept delta wings, a raised central fold, a keel underneath and two canted tails, loosely
 * following the F-35-shaped Falcon concept. Built from a handful of flat-shaded triangles so
 * every fold catches the light differently.
 *
 * Model space: nose points down -Z (PlayCanvas forward), +Y up, +X to the right wing.
 */

type V3 = readonly [number, number, number];

/** Overall scale applied to the vertex data below (base length ≈ 2.7 units). */
export const FALCON_SCALE = 1.3;

const N: V3 = [0, 0.06, -1.5]; // nose
const M: V3 = [0, 0.16, -0.15]; // high point of the central fold
const C: V3 = [0, 0.12, 1.15]; // tail end of the central fold
const K1: V3 = [0, -0.16, -0.7]; // keel, front
const K2: V3 = [0, -0.26, 0.85]; // keel, rear

// Left-hand points; the right side is mirrored.
const SHOULDER: V3 = [-0.26, 0.03, -0.55];
const WING_ROOT_LEAD: V3 = [-0.34, 0.02, -0.1];
const WING_TIP_LEAD: V3 = [-1.15, 0.16, 0.5];
const WING_TIP_TRAIL: V3 = [-1.1, 0.16, 0.74];
const WING_ROOT_TRAIL: V3 = [-0.36, 0.03, 0.62];
const STAB_TIP: V3 = [-0.74, 0.07, 1.12];
const STAB_ROOT_TRAIL: V3 = [-0.3, 0.04, 1.22];
const FIN_BASE_FRONT: V3 = [-0.24, 0.07, 0.5];
const FIN_BASE_BACK: V3 = [-0.27, 0.07, 1.08];
const FIN_TOP_BACK: V3 = [-0.52, 0.58, 1.14];
const FIN_TOP_FRONT: V3 = [-0.47, 0.58, 0.88];

const LEFT_BODY: V3[][] = [
  [N, SHOULDER, M],
  [SHOULDER, WING_ROOT_LEAD, M],
  [M, WING_ROOT_LEAD, WING_ROOT_TRAIL],
  [M, WING_ROOT_TRAIL, C],
  [WING_ROOT_LEAD, WING_TIP_LEAD, WING_TIP_TRAIL],
  [WING_ROOT_LEAD, WING_TIP_TRAIL, WING_ROOT_TRAIL],
];

const LEFT_ACCENT: V3[][] = [
  [WING_ROOT_TRAIL, STAB_TIP, STAB_ROOT_TRAIL],
  [WING_ROOT_TRAIL, STAB_ROOT_TRAIL, C],
  [FIN_BASE_FRONT, FIN_BASE_BACK, FIN_TOP_BACK],
  [FIN_BASE_FRONT, FIN_TOP_BACK, FIN_TOP_FRONT],
];

const KEEL: V3[][] = [
  [N, K1, M],
  [M, K1, K2],
  [M, K2, C],
];

const mirror = (tris: V3[][]): V3[][] =>
  tris.map((tri) => tri.map(([x, y, z]) => [-x, y, z] as V3).reverse());

export interface FalconMaterials {
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

export function falconMaterials(accentColor: pc.Color): FalconMaterials {
  return {
    paper: createPaperMaterial(new pc.Color(...PALETTE.paper)),
    accent: createPaperMaterial(accentColor),
  };
}

/** The halves stand almost upright when folded in half; the tails sit a touch further in so they never z-fight the wings. */
const STAND_UP = { paper: Math.PI / 2 - 0.1, accent: Math.PI / 2 - 0.05 };

interface FoldPart {
  mesh: pc.Mesh;
  final: number[];
  positions: Float32Array;
  normals: Float32Array;
  standUp: number;
  /** Lift above the sheet while flat, so the tails lie on top of the wings instead of inside them. */
  lift: number;
}

/**
 * The Falcon, with a folding animation. `setFold(t)` poses it anywhere between a flat sheet of
 * paper (t = 0), folded in half along the centre crease with both halves standing up (t = 0.5),
 * and the finished plane with its wings folded down (t = 1). Each vertex rotates about the centre
 * crease, so the sheet really folds instead of morphing.
 */
export class FoldableFalcon {
  readonly entity: pc.Entity;
  private readonly parts: FoldPart[];
  private fold = -1;

  /**
   * @param restDrop How far to lower the model while it lies flat, so the sheet rests on the
   * ground instead of floating at the finished plane's height.
   */
  constructor(device: pc.GraphicsDevice, materials: FalconMaterials, private readonly restDrop = 0) {
    const body = [...LEFT_BODY, ...mirror(LEFT_BODY), ...KEEL];
    const accent = [...LEFT_ACCENT, ...mirror(LEFT_ACCENT)];
    this.parts = [
      this.part(device, body, STAND_UP.paper, 0),
      this.part(device, accent, STAND_UP.accent, 0.004),
    ];
    this.entity = new pc.Entity('falcon');
    this.entity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.parts[0].mesh, materials.paper), new pc.MeshInstance(this.parts[1].mesh, materials.accent)],
      castShadows: true,
      receiveShadows: false,
    });
    this.setFold(1);
  }

  setFold(t: number): void {
    t = Math.min(1, Math.max(0, t));
    if (t === this.fold) return;
    this.fold = t;
    // 0 → 0.42: both halves rise along the crease. 0.55 → 1: the wings fold back down, with a little bounce.
    const rise = smoothstep(t / 0.42);
    const down = t <= 0.55 ? 0 : easeOutBack((t - 0.55) / 0.45);
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
      }
      faceNormals(positions, part.normals);
      part.mesh.setPositions(positions);
      part.mesh.setNormals(part.normals);
      part.mesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    this.entity.setLocalPosition(0, -this.restDrop * (1 - rise), 0);
  }

  private part(device: pc.GraphicsDevice, triangles: V3[][], standUp: number, lift: number): FoldPart {
    const final: number[] = [];
    for (const tri of triangles) for (const p of tri) final.push(p[0] * FALCON_SCALE, p[1] * FALCON_SCALE, p[2] * FALCON_SCALE);
    return {
      mesh: new pc.Mesh(device),
      final,
      positions: new Float32Array(final.length),
      normals: new Float32Array(final.length),
      standUp,
      lift,
    };
  }
}

/** Where a wingtip's trailing corner sits on the finished model, for the wingtip trails. */
export const WINGTIP: V3 = [WING_TIP_TRAIL[0] * FALCON_SCALE, WING_TIP_TRAIL[1] * FALCON_SCALE, WING_TIP_TRAIL[2] * FALCON_SCALE];

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

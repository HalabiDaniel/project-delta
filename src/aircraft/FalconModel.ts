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
  paper: pc.StandardMaterial;
  accent: pc.StandardMaterial;
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

/** Builds the Falcon as an entity with paper-white body and coloured tail surfaces. */
export function createFalcon(app: pc.AppBase, accentColor: pc.Color): pc.Entity {
  const materials: FalconMaterials = {
    paper: createPaperMaterial(new pc.Color(...PALETTE.paper)),
    accent: createPaperMaterial(accentColor),
  };
  const body = [...LEFT_BODY, ...mirror(LEFT_BODY), ...KEEL];
  const accent = [...LEFT_ACCENT, ...mirror(LEFT_ACCENT)];

  const entity = new pc.Entity('falcon');
  entity.addComponent('render', {
    meshInstances: [
      new pc.MeshInstance(buildFlatMesh(app.graphicsDevice, body, FALCON_SCALE), materials.paper),
      new pc.MeshInstance(buildFlatMesh(app.graphicsDevice, accent, FALCON_SCALE), materials.accent),
    ],
    castShadows: true,
    receiveShadows: false,
  });
  return entity;
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
  const normals: number[] = [];
  for (const [a, b, c] of triangles) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const p of [a, b, c]) {
      positions.push(p[0] * scale, p[1] * scale, p[2] * scale);
      normals.push(nx / len, ny / len, nz / len);
    }
  }
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

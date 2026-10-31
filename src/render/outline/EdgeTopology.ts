/**
 * Edge extraction for the pencil-outline renderer. Pure geometry: no PlayCanvas, so it runs (and is
 * tested) in Node.
 *
 * A mesh is welded by position (UV seams and flat-shading splits share corners), every triangle
 * edge is collected with the one or two triangles on either side of it, and each edge becomes a
 * stroke: a quad the outline shader widens to a few pixels on screen. The shader decides every
 * frame whether a stroke shows: boundary edges (the rim of a paper sheet) always do, creases do
 * when the fold between their two faces is sharp enough, and smooth edges only on the silhouette,
 * where one face turns towards the camera and the other away from it.
 */

/** How a stroke's two faces are judged in the shader (the `kind` attribute). */
export const EDGE_CLOSED = 0;
export const EDGE_ALWAYS = 1;
export const EDGE_SHEET = 2;

export interface EdgeSource {
  /** xyz per vertex. */
  positions: ArrayLike<number>;
  /** Three vertex indices per triangle; null for a triangle soup (vertices 0-1-2, 3-4-5…). */
  indices?: ArrayLike<number> | null;
  /**
   * The surface is a single sheet drawn from both sides (paper): its faces' winding says nothing
   * about which side the camera sees, so its creases are judged by their fold alone.
   */
  doubleSided?: boolean;
}

export interface EdgeTopology {
  /** Vertex indices of each triangle, three per triangle (degenerate triangles dropped). */
  readonly triangles: Uint32Array;
  /** Per edge: a vertex index at each end (into the source positions). */
  readonly endA: Uint32Array;
  readonly endB: Uint32Array;
  /** Per edge: the triangle on each side; `faceB` is -1 for a boundary edge (only one triangle). */
  readonly faceA: Int32Array;
  readonly faceB: Int32Array;
  /** Per edge: EDGE_CLOSED, EDGE_ALWAYS or EDGE_SHEET. */
  readonly kind: Uint8Array;
  /** Per edge: a stable 0–1 value for stroke irregularity, from the edge's position. */
  readonly seed: Float32Array;
  readonly edgeCount: number;
}

export interface TopologyOptions {
  /** Corners closer than this (relative to the mesh size) are welded together. */
  weld?: number;
  /**
   * Drop edges between faces this close to coplanar (cosine of the fold). They can never be on a
   * silhouette or a crease, e.g. the diagonals of a box face. Only for meshes that don't change
   * shape: a sheet being folded starts flat.
   */
  dropCoplanar?: number | null;
}

/** Corner positions are welded on a grid of this many steps across the mesh. */
const DEFAULT_WELD = 1e-5;

/** Builds the edge list of a triangle mesh. */
export function buildEdgeTopology(source: EdgeSource, options: TopologyOptions = {}): EdgeTopology {
  const p = source.positions;
  const vertexCount = Math.floor(p.length / 3);
  const indexCount = source.indices ? source.indices.length : vertexCount;
  const index = (i: number) => (source.indices ? source.indices[i] : i);

  // Weld: one id per distinct corner position.
  const size = extent(p);
  const step = Math.max(size * (options.weld ?? DEFAULT_WELD), 1e-7);
  const ids = new Map<string, number>();
  const weldId = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(p[v * 3] / step)},${Math.round(p[v * 3 + 1] / step)},${Math.round(p[v * 3 + 2] / step)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    weldId[v] = id;
  }

  // Triangles, without the degenerate ones.
  const tris: number[] = [];
  for (let i = 0; i + 2 < indexCount; i += 3) {
    const a = index(i), b = index(i + 1), c = index(i + 2);
    if (weldId[a] === weldId[b] || weldId[b] === weldId[c] || weldId[a] === weldId[c]) continue;
    if (triangleArea2(p, a, b, c) <= step * step * 1e-3) continue;
    tris.push(a, b, c);
  }
  const triangles = Uint32Array.from(tris);
  const triCount = triangles.length / 3;

  // Edges keyed by their welded ends.
  const welded = ids.size;
  const edges = new Map<number, { a: number; b: number; fa: number; fb: number; many: boolean }>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k];
      const b = triangles[t * 3 + ((k + 1) % 3)];
      const wa = weldId[a], wb = weldId[b];
      const key = wa < wb ? wa * welded + wb : wb * welded + wa;
      const e = edges.get(key);
      if (!e) edges.set(key, { a, b, fa: t, fb: -1, many: false });
      else if (e.fb === -1) e.fb = t;
      else e.many = true;
    }
  }

  const normals = faceNormals(p, triangles);
  const keep: Array<{ a: number; b: number; fa: number; fb: number; kind: number }> = [];
  const drop = options.dropCoplanar ?? null;
  for (const e of edges.values()) {
    let kind = source.doubleSided ? EDGE_SHEET : EDGE_CLOSED;
    if (e.fb === -1 || e.many) kind = EDGE_ALWAYS;
    else if (drop !== null) {
      const cos = normals[e.fa * 3] * normals[e.fb * 3] + normals[e.fa * 3 + 1] * normals[e.fb * 3 + 1] + normals[e.fa * 3 + 2] * normals[e.fb * 3 + 2];
      if (cos >= drop) continue;
    }
    keep.push({ a: e.a, b: e.b, fa: e.fa, fb: e.many ? -1 : e.fb, kind });
  }

  const n = keep.length;
  const topology = {
    triangles,
    endA: new Uint32Array(n),
    endB: new Uint32Array(n),
    faceA: new Int32Array(n),
    faceB: new Int32Array(n),
    kind: new Uint8Array(n),
    seed: new Float32Array(n),
    edgeCount: n,
  };
  keep.forEach((e, i) => {
    topology.endA[i] = e.a;
    topology.endB[i] = e.b;
    topology.faceA[i] = e.fa;
    topology.faceB[i] = e.fb;
    topology.kind[i] = e.kind;
    topology.seed[i] = edgeSeed(p, e.a, e.b);
  });
  return topology;
}

/** One unit normal per triangle (xyz), following its winding; zero for a degenerate one. */
export function faceNormals(p: ArrayLike<number>, triangles: ArrayLike<number>, out?: Float32Array): Float32Array {
  const count = Math.floor(triangles.length / 3);
  const normals = out ?? new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const a = triangles[t * 3] * 3, b = triangles[t * 3 + 1] * 3, c = triangles[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const s = len > 0 ? 1 / len : 0;
    normals[t * 3] = nx * s;
    normals[t * 3 + 1] = ny * s;
    normals[t * 3 + 2] = nz * s;
  }
  return normals;
}

/** Floats per stroke vertex: position 3, other end 3, normal A 3, normal B 3, info 4. */
export const STROKE_FLOATS = 16;
/** Four vertices (a quad) and six indices per edge. */
export const STROKE_VERTICES = 4;
export const STROKE_INDICES = 6;

/** Offsets of each attribute within a stroke vertex. */
export const STROKE_LAYOUT = { position: 0, other: 3, normalA: 6, normalB: 9, info: 12 } as const;

/**
 * Writes the stroke vertices for every edge: four per edge, each holding its own end, the other
 * end, both face normals (B = A on a boundary) and info = (side −1/+1, end 0/1, kind, seed).
 * `transform`, if given, is a column-major 4×4 matrix applied to positions, with `normalMatrix` a
 * column-major 3×3 applied to normals: used to merge several meshes into one.
 */
export function writeStrokes(
  topology: EdgeTopology,
  positions: ArrayLike<number>,
  out: Float32Array,
  offset = 0,
  transform: ArrayLike<number> | null = null,
  normalMatrix: ArrayLike<number> | null = null,
  normalsScratch?: Float32Array,
): void {
  const normals = faceNormals(positions, topology.triangles, normalsScratch);
  const pa = [0, 0, 0], pb = [0, 0, 0], na = [0, 0, 0], nb = [0, 0, 0];
  for (let e = 0; e < topology.edgeCount; e++) {
    point(positions, topology.endA[e], transform, pa);
    point(positions, topology.endB[e], transform, pb);
    normal(normals, topology.faceA[e], normalMatrix, na);
    if (topology.faceB[e] >= 0) normal(normals, topology.faceB[e], normalMatrix, nb);
    else nb[0] = na[0], nb[1] = na[1], nb[2] = na[2];
    const kind = topology.kind[e];
    const seed = topology.seed[e];
    for (let v = 0; v < STROKE_VERTICES; v++) {
      const end = v >> 1; // 0, 0, 1, 1
      const side = v === 0 || v === 3 ? -1 : 1;
      const o = offset + (e * STROKE_VERTICES + v) * STROKE_FLOATS;
      const self = end === 0 ? pa : pb;
      const other = end === 0 ? pb : pa;
      out[o] = self[0]; out[o + 1] = self[1]; out[o + 2] = self[2];
      out[o + 3] = other[0]; out[o + 4] = other[1]; out[o + 5] = other[2];
      out[o + 6] = na[0]; out[o + 7] = na[1]; out[o + 8] = na[2];
      out[o + 9] = nb[0]; out[o + 10] = nb[1]; out[o + 11] = nb[2];
      out[o + 12] = side; out[o + 13] = end; out[o + 14] = kind; out[o + 15] = seed;
    }
  }
}

/** Two triangles per edge quad, `base` being the first vertex of the first edge. */
export function writeStrokeIndices(edgeCount: number, out: Uint32Array | Uint16Array | number[], offset = 0, base = 0): void {
  for (let e = 0; e < edgeCount; e++) {
    const v = base + e * STROKE_VERTICES;
    const o = offset + e * STROKE_INDICES;
    out[o] = v; out[o + 1] = v + 1; out[o + 2] = v + 2;
    out[o + 3] = v; out[o + 4] = v + 2; out[o + 5] = v + 3;
  }
}

function point(p: ArrayLike<number>, v: number, m: ArrayLike<number> | null, out: number[]): void {
  const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
  if (!m) {
    out[0] = x; out[1] = y; out[2] = z;
    return;
  }
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

function normal(n: Float32Array, f: number, m: ArrayLike<number> | null, out: number[]): void {
  const x = n[f * 3], y = n[f * 3 + 1], z = n[f * 3 + 2];
  if (!m) {
    out[0] = x; out[1] = y; out[2] = z;
    return;
  }
  const nx = m[0] * x + m[3] * y + m[6] * z;
  const ny = m[1] * x + m[4] * y + m[7] * z;
  const nz = m[2] * x + m[5] * y + m[8] * z;
  const len = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
}

function extent(p: ArrayLike<number>): number {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.length; i++) {
    if (p[i] < min) min = p[i];
    if (p[i] > max) max = p[i];
  }
  return Number.isFinite(max - min) && max > min ? max - min : 1;
}

function triangleArea2(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** The same edge gets the same seed whichever way round it is listed. */
function edgeSeed(p: ArrayLike<number>, a: number, b: number): number {
  const x = p[a * 3] + p[b * 3], y = p[a * 3 + 1] + p[b * 3 + 1], z = p[a * 3 + 2] + p[b * 3 + 2];
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

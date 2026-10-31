/**
 * Low-poly geometry for the game's own models (stationery, cardboard buildings, landmarks), built
 * in code. Pure: no engine types, so shapes can be tested in Node, merged freely and turned into
 * engine meshes (or exported) later.
 *
 * Every face is flat-shaded (its own corners, one normal), which is the folded-paper look, and
 * gets UVs in metres projected onto its plane: textures from the material library keep the same
 * scale on a pencil and on a desk.
 */

export type Vec3 = [number, number, number];

/** Where a part goes: rotated (degrees, applied X then Y then Z… see `rotation`) then moved. */
export interface Place {
  at?: Vec3;
  /** Euler angles in degrees: pitch about X, yaw about Y, roll about Z. */
  rot?: Vec3;
}

export interface CylinderOptions {
  /** Radius at the top; 0 makes a cone. Defaults to the bottom radius. */
  topRadius?: number;
  sides?: number;
  capTop?: boolean;
  capBottom?: boolean;
  /** Turns the polygon (degrees), e.g. so a hexagonal pencil lies on a flat side. */
  twist?: number;
  /** Smooth side normals (a round can) instead of facets. */
  smooth?: boolean;
}

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  /**
   * A flat convex polygon, corners counter-clockwise seen from the side it faces. UVs are its
   * corners projected on the plane, in metres.
   */
  face(points: readonly Vec3[], place?: Place): this {
    if (points.length < 3) return this;
    const pts = points.map((p) => transformPoint(p, place));
    const n = newell(pts);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return this;
    const [u, v] = planeAxes(n);
    const base = this.vertexCount;
    for (const p of pts) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.uvs.push(dot(p, u), dot(p, v));
    }
    for (let i = 1; i + 1 < pts.length; i++) this.indices.push(base, base + i, base + i + 1);
    return this;
  }

  /** A box of size (x, y, z) centred on its place. */
  box(size: Vec3, place?: Place): this {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const c = (x: number, y: number, z: number): Vec3 => [x * hx, y * hy, z * hz];
    this.face([c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1)], place); // top
    this.face([c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)], place); // bottom
    this.face([c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)], place); // +z
    this.face([c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)], place); // -z
    this.face([c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1)], place); // +x
    this.face([c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)], place); // -x
    return this;
  }

  /**
   * A prism, frustum or cone standing on its place: base at y = 0, top at y = height. Low-poly by
   * default (6 sides, like a pencil).
   */
  cylinder(radius: number, height: number, options: CylinderOptions = {}, place?: Place): this {
    const sides = Math.max(3, options.sides ?? 6);
    const top = options.topRadius ?? radius;
    const twist = ((options.twist ?? 0) * Math.PI) / 180;
    const ring = (r: number, y: number): Vec3[] =>
      Array.from({ length: sides }, (_, i) => {
        const a = twist + (i / sides) * Math.PI * 2;
        return [Math.cos(a) * r, y, -Math.sin(a) * r];
      });
    const lo = ring(radius, 0);
    const hi = ring(top, height);
    if (options.smooth) {
      this.smoothSides(lo, hi, radius, top, height, place);
    } else {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        if (top > 1e-6) this.face([lo[i], lo[j], hi[j], hi[i]], place);
        else this.face([lo[i], lo[j], hi[i]], place);
      }
    }
    if (options.capBottom ?? true) this.face([...lo].reverse(), place);
    if ((options.capTop ?? true) && top > 1e-6) this.face(hi, place);
    return this;
  }

  /** A wedge (triangular prism) of size (x, y, z): the slope rises from -z to +z. */
  wedge(size: Vec3, place?: Place): this {
    const [hx, hy, hz] = [size[0] / 2, size[1], size[2] / 2];
    const a: Vec3 = [-hx, 0, -hz], b: Vec3 = [hx, 0, -hz], c: Vec3 = [hx, 0, hz], d: Vec3 = [-hx, 0, hz];
    const e: Vec3 = [-hx, hy, hz], f: Vec3 = [hx, hy, hz];
    this.face([a, b, c, d], place);
    this.face([d, c, f, e], place);
    this.face([a, e, f, b], place);
    this.face([b, f, c], place);
    this.face([a, d, e], place);
    return this;
  }

  /**
   * A tube standing on its place (base at y = 0): outer and inner walls, rings top and bottom. A
   * tape roll, a pencil cup (with `capBottom` closing the inside too).
   */
  tube(outer: number, inner: number, height: number, options: { sides?: number; capBottom?: boolean } = {}, place?: Place): this {
    const sides = Math.max(3, options.sides ?? 12);
    const at = (r: number, y: number, i: number): Vec3 => {
      const a = (i / sides) * Math.PI * 2;
      return [Math.cos(a) * r, y, -Math.sin(a) * r];
    };
    for (let i = 0; i < sides; i++) {
      const j = i + 1;
      this.face([at(outer, 0, i), at(outer, 0, j), at(outer, height, j), at(outer, height, i)], place);
      this.face([at(inner, 0, j), at(inner, 0, i), at(inner, height, i), at(inner, height, j)], place);
      this.face([at(inner, height, i), at(outer, height, i), at(outer, height, j), at(inner, height, j)], place);
      this.face([at(outer, 0, i), at(inner, 0, i), at(inner, 0, j), at(outer, 0, j)], place);
    }
    if (options.capBottom) {
      const floor = Array.from({ length: sides }, (_, i) => at(inner, height * 0.04, i));
      this.face(floor, place);
    }
    return this;
  }

  /**
   * A crumpled paper ball: an icosahedron split once (80 facets) with every corner pushed in or
   * out a little. The same seed always crumples the same way.
   */
  crumpled(radius: number, seed = 1, place?: Place): this {
    const t = (1 + Math.sqrt(5)) / 2;
    const v: Vec3[] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
      [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map((p) => normalize(p as Vec3));
    const f = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const bump = (p: Vec3): Vec3 => {
      const h = Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719 + seed * 4.1) * 43758.5453;
      const k = radius * (0.82 + 0.3 * (h - Math.floor(h)));
      return [p[0] * k, p[1] * k, p[2] * k];
    };
    const mid = (a: Vec3, b: Vec3) => normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    for (const [a, b, c] of f) {
      const ab = mid(v[a], v[b]), bc = mid(v[b], v[c]), ca = mid(v[c], v[a]);
      for (const tri of [[v[a], ab, ca], [ab, v[b], bc], [ca, bc, v[c]], [ab, bc, ca]]) this.face(tri.map(bump), place);
    }
    return this;
  }

  /**
   * A flat cut-out: a convex polygon in the XY plane (counter-clockwise), `depth` thick along Z,
   * centred on z = 0. Flags, signs, paper shapes.
   */
  extrude(outline: ReadonlyArray<readonly [number, number]>, depth: number, place?: Place): this {
    const h = depth / 2;
    const front = outline.map(([x, y]): Vec3 => [x, y, h]);
    const back = outline.map(([x, y]): Vec3 => [x, y, -h]).reverse();
    this.face(front, place);
    this.face(back, place);
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      this.face([[x0, y0, -h], [x1, y1, -h], [x1, y1, h], [x0, y0, h]], place);
    }
    return this;
  }

  /** Adds everything from another builder, placed. */
  add(other: MeshBuilder, place?: Place): this {
    const base = this.vertexCount;
    for (let i = 0; i < other.vertexCount; i++) {
      const p = transformPoint([other.positions[i * 3], other.positions[i * 3 + 1], other.positions[i * 3 + 2]], place);
      const n = transformDir([other.normals[i * 3], other.normals[i * 3 + 1], other.normals[i * 3 + 2]], place);
      this.positions.push(...p);
      this.normals.push(...n);
      this.uvs.push(other.uvs[i * 2], other.uvs[i * 2 + 1]);
    }
    for (const i of other.indices) this.indices.push(base + i);
    return this;
  }

  /** Axis-aligned bounds, [min, max]. */
  bounds(): [Vec3, Vec3] {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], this.positions[i + k]);
        max[k] = Math.max(max[k], this.positions[i + k]);
      }
    }
    return [min, max];
  }

  private smoothSides(lo: Vec3[], hi: Vec3[], r0: number, r1: number, h: number, place?: Place): void {
    const sides = lo.length;
    const slope = (r0 - r1) / Math.max(h, 1e-6);
    const base = this.vertexCount;
    const circumference = Math.PI * 2 * Math.max(r0, r1);
    for (let i = 0; i <= sides; i++) {
      const k = i % sides;
      for (const [p, y] of [[lo[k], 0], [hi[k], h]] as Array<[Vec3, number]>) {
        const len = Math.hypot(lo[k][0], lo[k][2]) || 1;
        const n = normalize([lo[k][0] / len, slope, lo[k][2] / len]);
        const tp = transformPoint(p, place);
        this.positions.push(...tp);
        this.normals.push(...transformDir(n, place));
        this.uvs.push((i / sides) * circumference, y);
      }
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }
}

// ---- Small vector helpers -------------------------------------------------------------------

/** Rotation matrix rows for Euler degrees: X (pitch) first, then Y (yaw), then Z (roll). */
function rotation(rot: Vec3 | undefined): number[] | null {
  if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) return null;
  const [x, y, z] = rot.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function transformPoint(p: Vec3, place?: Place): Vec3 {
  const r = rotation(place?.rot);
  const q = r ? mul(r, p) : p;
  const t = place?.at ?? [0, 0, 0];
  return [q[0] + t[0], q[1] + t[1], q[2] + t[2]];
}

export function transformDir(d: Vec3, place?: Place): Vec3 {
  const r = rotation(place?.rot);
  return r ? normalize(mul(r, d)) : d;
}

function mul(r: number[], p: Vec3): Vec3 {
  return [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];
}

function newell(pts: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize(n);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Two axes across a plane: world X/Z on floors and ceilings, horizontal/up on walls. */
function planeAxes(n: Vec3): [Vec3, Vec3] {
  if (Math.abs(n[1]) > 0.7) return [[1, 0, 0], [0, 0, n[1] > 0 ? -1 : 1]];
  const u = normalize([-n[2], 0, n[0]]);
  return [u, [0, 1, 0]];
}

import type { Point3 } from '../missions/Mission';

/**
 * Collision shapes for the world: spheres, and boxes that may be turned about the vertical axis.
 * A box's `yaw` follows the scene convention (setEulerAngles(0, yaw, 0)): yaw 0 is axis-aligned,
 * positive yaw turns it to the left as seen from above.
 */
export type Shape =
  | { kind: 'sphere'; x: number; y: number; z: number; r: number }
  | { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number };

/** Where a sphere touches a shape: the unit normal pointing out of the shape, and how deep it sits. */
export interface Contact {
  nx: number;
  ny: number;
  nz: number;
  depth: number;
}

/** Does a sphere overlap the shape, and if so, which way (and how far) must it move to get clear? */
export function sphereContact(cx: number, cy: number, cz: number, r: number, shape: Shape): Contact | null {
  if (shape.kind === 'sphere') {
    const dx = cx - shape.x, dy = cy - shape.y, dz = cz - shape.z;
    const d = Math.hypot(dx, dy, dz);
    const reach = r + shape.r;
    if (d > reach) return null;
    if (d < 1e-9) return { nx: 0, ny: 1, nz: 0, depth: reach };
    return { nx: dx / d, ny: dy / d, nz: dz / d, depth: reach - d };
  }
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  const dx = cx - shape.x, dz = cz - shape.z;
  const lx = dx * c - dz * s;
  const ly = cy - shape.y;
  const lz = dx * s + dz * c;
  let nx = lx - clamp(lx, -shape.hx, shape.hx);
  let ny = ly - clamp(ly, -shape.hy, shape.hy);
  let nz = lz - clamp(lz, -shape.hz, shape.hz);
  const d2 = nx * nx + ny * ny + nz * nz;
  if (d2 > r * r) return null;
  let depth: number;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;
    depth = r - d;
  } else {
    // The centre is inside: leave by the nearest face.
    const px = shape.hx - Math.abs(lx), py = shape.hy - Math.abs(ly), pz = shape.hz - Math.abs(lz);
    nx = ny = nz = 0;
    if (py <= px && py <= pz) {
      ny = ly >= 0 ? 1 : -1;
      depth = py + r;
    } else if (px <= pz) {
      nx = lx >= 0 ? 1 : -1;
      depth = px + r;
    } else {
      nz = lz >= 0 ? 1 : -1;
      depth = pz + r;
    }
  }
  return { nx: nx * c + nz * s, ny, nz: -nx * s + nz * c, depth };
}

/**
 * The first point along the segment a → b where a ball of `radius` touches the shape, as a
 * fraction 0–1 of the way, or null if it never does. A ball that starts inside hits at 0. Boxes
 * are grown by the radius, which is exact on the faces and slightly generous at the corners.
 */
export function segmentHit(a: Point3, b: Point3, radius: number, shape: Shape): number | null {
  if (shape.kind === 'sphere') {
    const R = shape.r + radius;
    const fx = a.x - shape.x, fy = a.y - shape.y, fz = a.z - shape.z;
    const c0 = fx * fx + fy * fy + fz * fz - R * R;
    if (c0 <= 0) return 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const qa = dx * dx + dy * dy + dz * dz;
    if (qa < 1e-12) return null;
    const qb = 2 * (fx * dx + fy * dy + fz * dz);
    const disc = qb * qb - 4 * qa * c0;
    if (disc < 0) return null;
    const t = (-qb - Math.sqrt(disc)) / (2 * qa);
    return t >= 0 && t <= 1 ? t : null;
  }
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  const local = (p: Point3) => {
    const dx = p.x - shape.x, dz = p.z - shape.z;
    return [dx * c - dz * s, p.y - shape.y, dx * s + dz * c];
  };
  const p0 = local(a);
  const p1 = local(b);
  const half = [shape.hx + radius, shape.hy + radius, shape.hz + radius];
  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis++) {
    const d = p1[axis] - p0[axis];
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p0[axis]) > half[axis]) return null;
      continue;
    }
    let t0 = (-half[axis] - p0[axis]) / d;
    let t1 = (half[axis] - p0[axis]) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Distance from a point to the surface of a shape (0 inside it). */
export function distanceToShape(p: Point3, shape: Shape): number {
  if (shape.kind === 'sphere') return Math.max(0, Math.hypot(p.x - shape.x, p.y - shape.y, p.z - shape.z) - shape.r);
  const c = Math.cos(shape.yaw), s = Math.sin(shape.yaw);
  const dx = p.x - shape.x, dz = p.z - shape.z;
  const lx = dx * c - dz * s, ly = p.y - shape.y, lz = dx * s + dz * c;
  return Math.hypot(
    Math.max(0, Math.abs(lx) - shape.hx),
    Math.max(0, Math.abs(ly) - shape.hy),
    Math.max(0, Math.abs(lz) - shape.hz),
  );
}

/** A circle on the ground that covers the shape, for keeping things apart when laying out a level. */
export function footprint(shape: Shape): { x: number; z: number; r: number } {
  return shape.kind === 'sphere'
    ? { x: shape.x, z: shape.z, r: shape.r }
    : { x: shape.x, z: shape.z, r: Math.hypot(shape.hx, shape.hz) };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Something that can be hit, with all its shapes. */
export interface Collider {
  id: string;
  shapes: readonly Shape[];
}

/** The collider a ball moving a → b touches first, and when (0–1 along the segment). */
export function firstHit(a: Point3, b: Point3, radius: number, colliders: readonly Collider[]): { id: string; t: number } | null {
  let best: { id: string; t: number } | null = null;
  for (const collider of colliders) {
    for (const shape of collider.shapes) {
      const t = segmentHit(a, b, radius, shape);
      if (t !== null && (!best || t < best.t)) best = { id: collider.id, t };
    }
  }
  return best;
}

/**
 * Two points each moving in a straight line over one step (a0 → a1 and b0 → b1): the first
 * fraction of the step at which they come within `radius` of each other, or null. Worked out in
 * b's frame, where it is a ball standing still and a moves along a segment.
 */
export function sweepMoving(a0: Point3, a1: Point3, b0: Point3, b1: Point3, radius: number): number | null {
  return segmentHit(
    { x: a0.x - b0.x, y: a0.y - b0.y, z: a0.z - b0.z },
    { x: a1.x - b1.x, y: a1.y - b1.y, z: a1.z - b1.z },
    0,
    { kind: 'sphere', x: 0, y: 0, z: 0, r: radius },
  );
}

/** A sphere that moved from (px, py, pz) to (x, y, z) this step: an aircraft, as rounds see it. */
export interface MovingSphere {
  id: string;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  r: number;
}

/**
 * The moving sphere a ball of `radius` moving a → b this step touches first (both moving at once),
 * and when. `extra` widens every sphere: the aim assistance for rounds against aircraft.
 */
export function firstMovingHit(a: Point3, b: Point3, radius: number, movers: readonly MovingSphere[], extra = 0): { id: string; t: number } | null {
  let best: { id: string; t: number } | null = null;
  for (const m of movers) {
    const t = sweepMoving(a, b, { x: m.px, y: m.py, z: m.pz }, m, radius + m.r + extra);
    if (t !== null && (!best || t < best.t)) best = { id: m.id, t };
  }
  return best;
}

import type { MaterialId } from '../../render/style';
import type { Place, Vec3 } from './MeshBuilder';
import { Model } from './Model';

/**
 * Original low-poly stationery: the props that make a territory read as a desk. Sizes are in
 * metres at the game's scale, where a paper plane is about two metres across, so a pencil is a
 * few metres long. Each builder returns a Model standing on y = 0 at the origin; place it with
 * `Model.add(prop, { at, rot })`.
 */

/**
 * A hexagonal pencil along +Y: eraser and ferrule at the bottom, sharpened tip at the top. Lay
 * it down with `lyingPencil`.
 */
export function pencil(length = 4.2, radius = 0.16, paint: MaterialId = 'pencil/yellow', eraser = true): Model {
  const m = new Model();
  let y = 0;
  if (eraser) {
    m.part('rubber/pink').cylinder(radius * 0.92, 0.26, { sides: 8 });
    m.part('pencil/metal').cylinder(radius * 1.04, 0.3, { sides: 8 }, { at: [0, 0.26, 0] });
    y = 0.56;
  }
  const body = length * 0.8 - y;
  m.part(paint).cylinder(radius, body, { sides: 6, twist: 30 }, { at: [0, y, 0] });
  const wood = length * 0.16;
  m.part('pencil/wood').cylinder(radius, wood, { sides: 6, twist: 30, topRadius: radius * 0.34, capBottom: false }, { at: [0, y + body, 0] });
  m.part('pencil/graphite').cylinder(radius * 0.34, length - y - body - wood, { sides: 6, twist: 30, topRadius: 0, capBottom: false }, { at: [0, y + body + wood, 0] });
  return m;
}

/** A pencil lying on one of its flat sides, pointing along +X from the origin. */
export function lyingPencil(length?: number, radius = 0.16, paint?: MaterialId): Model {
  return new Model().add(pencil(length, radius, paint), { rot: [0, 0, -90], at: [0, radius * Math.cos(Math.PI / 6), 0] });
}

/** A pink rubber with its paper sleeve. */
export function eraser(): Model {
  const m = new Model();
  m.part('rubber/pink').box([1.7, 0.55, 0.85], { at: [0, 0.275, 0] });
  m.part('paper/blue').box([0.95, 0.59, 0.89], { at: [0.25, 0.295, 0] });
  m.part('paper/white').box([0.3, 0.6, 0.9], { at: [0.25, 0.3, 0] });
  return m;
}

/**
 * A wooden ruler along +X with its markings as a separate model (decals: drawn without
 * outlines or shadows).
 */
export function ruler(length = 12, width = 1.1): { body: Model; marks: Model } {
  const body = new Model();
  body.part('wood/ruler').box([length, 0.12, width], { at: [length / 2, 0.06, 0] });
  const marks = new Model();
  for (let x = 0.5, n = 0; x < length - 0.2; x += 0.5, n++) {
    const long = n % 5 === 4;
    marks.part('ink/black').box([0.05, 0.01, long ? 0.42 : 0.22], { at: [x, 0.125, -width / 2 + (long ? 0.24 : 0.14)] });
  }
  return { body, marks };
}

/** A ream of loose sheets, each a little out of line, with a paper band round the middle. */
export function paperStack(sheets = 7, width = 3, depth = 2.2, seed = 1): Model {
  const m = new Model();
  const t = 0.07;
  for (let i = 0; i < sheets; i++) {
    const r = rand(seed * 31 + i);
    m.part('paper/white').box([width, t, depth], { at: [(r - 0.5) * 0.18, t / 2 + i * t, (rand(seed * 17 + i) - 0.5) * 0.14], rot: [0, (r - 0.5) * 7, 0] });
  }
  m.part('paper/blue').box([0.5, sheets * t + 0.02, depth + 0.04], { at: [width * 0.15, (sheets * t) / 2, 0] });
  return m;
}

/** A closed book lying flat: two boards and a spine in `cover`, the pages showing on three sides. */
export function book(width = 4.2, depth = 3.1, height = 0.7, cover: MaterialId = 'paper/red'): Model {
  const m = new Model();
  const board = 0.08;
  m.part(cover).box([width, board, depth], { at: [0, board / 2, 0] });
  m.part(cover).box([width, board, depth], { at: [0, height - board / 2, 0] });
  m.part(cover).box([board, height, depth], { at: [-width / 2 + board / 2, height / 2, 0] });
  m.part('paper/white').box([width - 0.2, height - 2 * board + 0.01, depth - 0.12], { at: [0.04, height / 2, 0] });
  return m;
}

/** Three or four books in a loose pile. */
export function bookStack(seed = 1): Model {
  const m = new Model();
  const covers: MaterialId[] = ['paper/red', 'paper/blue', 'paper/green', 'paper/yellow'];
  let y = 0;
  const count = 3 + Math.floor(rand(seed) * 2);
  for (let i = 0; i < count; i++) {
    const w = 3.6 + rand(seed + i * 3) * 1.2;
    const d = 2.6 + rand(seed + i * 5) * 0.8;
    const h = 0.5 + rand(seed + i * 7) * 0.5;
    m.add(book(w, d, h, covers[(i + seed) % covers.length]), { at: [(rand(seed + i * 11) - 0.5) * 0.5, y, (rand(seed + i * 13) - 0.5) * 0.4], rot: [0, (rand(seed + i * 17) - 0.5) * 24, 0] });
    y += h;
  }
  return m;
}

/** A sticky note with one corner lifting off the desk. */
export function stickyNote(size = 2, color: MaterialId = 'paper/sticky'): Model {
  const m = new Model();
  const s = size / 2;
  const t = 0.03;
  const curl = size * 0.32;
  // The note minus the lifted corner, as a five-sided cut-out lying flat.
  m.part(color).extrude([[-s, -s], [s, -s], [s, s - curl], [s - curl, s], [-s, s]], t, { rot: [-90, 0, 0], at: [0, t / 2, 0] });
  // The corner, folded up along the diagonal (both sides, it is a single sheet).
  const a: Vec3 = [s, t, -(s - curl)];
  const b: Vec3 = [s - curl, t, -s];
  const c: Vec3 = [s - curl * 0.2, t + curl * 0.45, -(s - curl * 0.2)];
  m.part(color).face([a, c, b]);
  m.part(color).face([a, b, c]);
  return m;
}

/** A roll of masking tape standing on its side, the hole showing from above. */
export function tapeRoll(): Model {
  const m = new Model();
  m.part('tape/masking').tube(1, 0.66, 0.7, { sides: 14 });
  m.part('cardboard/side').tube(0.66, 0.56, 0.72, { sides: 14 });
  return m;
}

/** A crumpled ball of paper resting on the desk. */
export function paperBall(radius = 0.9, seed = 1): Model {
  const m = new Model();
  m.part('paper/white').crumpled(radius, seed, { at: [0, radius * 0.85, 0] });
  return m;
}

/** A folded paper pennant on a pencil pole: the territory's colours. */
export function paperFlag(color: MaterialId = 'paper/blue', height = 5.5): Model {
  const m = new Model().add(pencil(height, 0.13, 'pencil/yellow', false));
  const top = height * 0.78;
  // Two halves folded along the middle, like a real paper pennant.
  m.part(color).extrude([[0, 0], [2.2, 0.45], [0, 0.9]], 0.03, { at: [0.12, top - 0.95, 0.02], rot: [0, -12, 0] });
  m.part(color).extrude([[0, 0], [2.2, -0.45], [0, -0.9]], 0.03, { at: [0.12, top + 0.75, -0.02], rot: [0, 12, 0] });
  return m;
}

/** A sheet of paper with a cut-out star on it, for signs and labels. */
export function star(radius = 0.6, color: MaterialId = 'paper/white', depth = 0.03): Model {
  const m = new Model();
  for (let i = 0; i < 5; i++) {
    const a0 = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const tip: [number, number] = [Math.cos(a0) * radius, Math.sin(a0) * radius];
    const left: [number, number] = [Math.cos(a0 + Math.PI / 5) * radius * 0.42, Math.sin(a0 + Math.PI / 5) * radius * 0.42];
    const right: [number, number] = [Math.cos(a0 - Math.PI / 5) * radius * 0.42, Math.sin(a0 - Math.PI / 5) * radius * 0.42];
    m.part(color).extrude([[0, 0], right, tip, left], depth);
  }
  return m;
}

/** Deterministic 0–1 noise for placing things. */
export function rand(n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export type { Place, Vec3 };

import type { Shape } from '../../combat/Collision';
import type { MaterialId } from '../../render/style';
import { transformPoint, type Place, type Vec3 } from './MeshBuilder';
import { Model } from './Model';
import { book, crayon, lyingCrayon, lyingPencil, paperBall, paperFlag, pencil, ruler, shavings, star } from './stationery';

/**
 * A territory's landmark: one big, recognisable silhouette that tells the player where they are
 * from the chase camera at flying height. Each comes with simple collision shapes (spheres and
 * boxes, in the landmark's own space) so flying into it is predictable, and a height kept below
 * the AI pilots' cruising clearance. Client and server both take the shapes from here (through
 * territories/decor.ts), so a landmark is solid in the same place for everyone.
 */
export interface Landmark {
  model: Model;
  /** Flat markings drawn without outlines or shadows. */
  decals: Model;
  colliders: Shape[];
  /** Highest point, metres above the desk. */
  height: number;
}

export type LandmarkId =
  | 'pencilCup'
  | 'pencilBundle'
  | 'tentNotebook'
  | 'eraserStack'
  | 'notebookHill'
  | 'inkBottle'
  | 'cardboardTower'
  | 'rulerBridge'
  | 'paperBin'
  | 'glueBottle'
  | 'citadel'
  | 'crayonBox'
  | 'sharpener'
  | 'compass'
  | 'stapler'
  | 'lunchBox';

export const LANDMARKS: Record<LandmarkId, () => Landmark> = {
  pencilCup,
  pencilBundle,
  tentNotebook,
  eraserStack,
  notebookHill,
  inkBottle,
  cardboardTower,
  rulerBridge,
  paperBin,
  glueBottle,
  citadel,
  crayonBox,
  sharpener,
  compass,
  stapler,
  lunchBox,
};

/** Names for reports and the developer's review. */
export const LANDMARK_NAMES: Record<LandmarkId, string> = {
  pencilCup: 'Pencil cup',
  pencilBundle: 'Bundle of giant pencils',
  tentNotebook: 'Spiral notebook standing like a tent',
  eraserStack: 'Stack of giant erasers',
  notebookHill: 'Hill of notebooks with a flag',
  inkBottle: 'Ink bottle and dip pen in a pool of ink',
  cardboardTower: 'Cardboard tube tower',
  rulerBridge: 'Ruler bridge on eraser piers',
  paperBin: 'Overflowing wastepaper bin',
  glueBottle: 'Glue bottle in a puddle of glue',
  citadel: 'Cardboard citadel with four towers',
  crayonBox: 'Open box of crayons',
  sharpener: 'Pencil sharpener with a pencil in it',
  compass: 'Drawing compass and its circle',
  stapler: 'Open stapler and a staple',
  lunchBox: 'Lunch box, apple and juice box',
};

/** The highest point of a set of shapes. */
function topOf(shapes: readonly Shape[]): number {
  return Math.max(...shapes.map((s) => s.y + (s.kind === 'sphere' ? s.r : s.hy)));
}

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yawDeg = 0): Shape {
  return { kind: 'box', x, y, z, hx, hy, hz, yaw: (yawDeg * Math.PI) / 180 };
}

function sphere(x: number, y: number, z: number, r: number): Shape {
  return { kind: 'sphere', x, y, z, r };
}

/** Spheres of radius `r` along a part's +Y axis from `from` to `to`, placed. */
function along(place: Place, from: number, to: number, r: number, step = r * 2): Shape[] {
  const out: Shape[] = [];
  for (let d = from; d <= to + 1e-6; d += step) {
    const p = transformPoint([0, d, 0], place);
    out.push(sphere(p[0], p[1], p[2], r));
  }
  return out;
}

/** A flat puddle (decal): a few overlapping discs. */
function puddle(decals: Model, material: MaterialId, at: [number, number], radius: number, seed: number): void {
  for (let i = 0; i < 4; i++) {
    const a = seed * 1.7 + i * 1.9;
    const r = radius * (0.45 + 0.15 * ((i * 7 + seed) % 3));
    decals.part(material).cylinder(r, 0.012 + i * 0.002, { sides: 12 }, { at: [at[0] + Math.cos(a) * radius * 0.45, 0, at[1] + Math.sin(a) * radius * 0.45] });
  }
}

/** A giant eraser block with its paper sleeve, standing on its base. */
function bigEraser(model: Model, size: Vec3, rubber: MaterialId, sleeve: MaterialId, place: Place): void {
  const inner = new Model();
  inner.part(rubber).box(size, { at: [0, size[1] / 2, 0] });
  inner.part(sleeve).box([size[0] * 0.5, size[1] + 0.06, size[2] + 0.06], { at: [size[0] * 0.15, size[1] / 2, 0] });
  inner.part('paper/white').box([size[0] * 0.14, size[1] + 0.08, size[2] + 0.08], { at: [size[0] * 0.15, size[1] / 2, 0] });
  model.add(inner, place);
}

/** Pencil Point: six giant pencils standing points-up in a rubber band, two more lying at their feet. */
function pencilBundle(): Landmark {
  const model = new Model();
  const colliders: Shape[] = [];
  const paints: MaterialId[] = ['pencil/yellow', 'paper/red', 'paper/blue', 'paper/green', 'pencil/yellow', 'paper/purple'];
  const lengths = [9.2, 8.1, 8.6, 7.4, 8.9, 7.8];
  let top = 0;
  lengths.forEach((length, i) => {
    const a = (i / lengths.length) * Math.PI * 2;
    const at: Vec3 = i === 0 ? [0, 0, 0] : [Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95];
    model.add(pencil(length, 0.48, paints[i]), { at, rot: [0, i * 23, 0] });
    top = Math.max(top, length);
  });
  model.part('rubber/blue').tube(1.62, 1.42, 0.55, { sides: 12 }, { at: [0, 2.6, 0] });
  model.add(lyingPencil(3.6, 0.45, 'paper/blue'), { at: [0.2, 0, 2.2], rot: [0, -20, 0] });
  model.add(lyingPencil(3.2, 0.45, 'pencil/yellow'), { at: [-0.4, 0, -2.3], rot: [0, 160, 0] });
  colliders.push(box(0, 3.6, 0, 1.5, 3.6, 1.5));
  for (let y = 7.4; y <= top - 0.3; y += 0.8) colliders.push(sphere(0, y, 0, 1.1));
  return { model, decals: new Model(), colliders, height: top };
}

/** Notebook Ridge: a spiral notebook standing open like a tent, with a pencil along its ridge. */
function tentNotebook(): Landmark {
  const model = new Model();
  const width = 5;
  const length = 6;
  const angle = 55;
  const c = Math.cos((angle * Math.PI) / 180);
  const sn = Math.sin((angle * Math.PI) / 180);
  for (const side of [1, -1]) {
    // Each cover leans in from its bottom edge; the pages lie just inside.
    model.part('paper/blue').box([width, 0.14, length], { at: [side * (width / 2) * c, (width / 2) * sn, 0], rot: [0, 0, -side * angle] });
    model.part('paper/notebook').box([width - 0.3, 0.1, length - 0.3], { at: [side * ((width / 2) * c - 0.12 * sn), (width / 2) * sn - 0.12 * c, 0], rot: [0, 0, -side * angle] });
  }
  const ridge = width * sn;
  for (let z = -length / 2 + 0.4; z <= length / 2 - 0.3; z += 0.6) model.part('pencil/metal').tube(0.32, 0.22, 0.12, { sides: 8 }, { at: [0, ridge, z], rot: [90, 0, 0] });
  model.add(lyingPencil(7, 0.36, 'paper/red'), { at: [0, ridge + 0.12, 3.5], rot: [0, 90, 0] });
  const colliders = [box(0, 1.1, 0, 2.4, 1.1, length / 2), box(0, 2.8, 0, 1.4, 0.7, length / 2), box(0, ridge, 0, 0.6, 0.6, length / 2 + 0.4)];
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

/** Eraser Fields: three giant erasers stacked crookedly, the top one standing on its end. */
function eraserStack(): Landmark {
  const model = new Model();
  bigEraser(model, [5.4, 1.8, 2.8], 'rubber/pink', 'paper/blue', { rot: [0, 8, 0] });
  bigEraser(model, [4.4, 1.5, 2.3], 'rubber/blue', 'paper/yellow', { at: [0.2, 1.8, 0.1], rot: [0, -22, 0] });
  bigEraser(model, [4.0, 1.3, 2.0], 'rubber/pink', 'paper/green', { at: [0.35, 5.3, 0], rot: [0, 0, 90] });
  // Crumbs rubbed off.
  for (let i = 0; i < 6; i++) model.part(i % 2 ? 'rubber/pink' : 'rubber/blue').box([0.4, 0.2, 0.25], { at: [3 - (i % 3) * 0.5, 0.1, -2 + i * 0.7], rot: [0, i * 37, 0] });
  const colliders = [box(0, 0.9, 0, 2.7, 0.9, 1.4, 8), box(0.2, 2.55, 0.1, 2.2, 0.75, 1.15, -22), box(-0.3, 5.3, 0, 0.65, 2, 1)];
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

/** Margin Hill: a hill of notebooks getting smaller to the top, a green flag planted on it. */
function notebookHill(): Landmark {
  const model = new Model();
  const colliders: Shape[] = [];
  const layers: Array<[number, number, number, MaterialId, number]> = [
    [6.4, 4.6, 0.9, 'paper/green', 4],
    [5.4, 4.0, 0.8, 'paper/red', -9],
    [4.4, 3.3, 0.8, 'paper/blue', 14],
    [3.4, 2.6, 0.7, 'paper/yellow', -4],
  ];
  let y = 0;
  for (const [w, d, h, cover, yaw] of layers) {
    model.add(book(w, d, h, cover), { at: [0, y, 0], rot: [0, yaw, 0] });
    colliders.push(box(0, y + h / 2, 0, w / 2, h / 2, d / 2, yaw));
    y += h;
  }
  model.add(paperFlag('paper/green', 3.6), { at: [0.3, y, 0.2] });
  colliders.push(sphere(0.3, y + 1.4, 0.2, 0.4), sphere(1.2, y + 2.8, 0.2, 0.8));
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

/** Ink Valley: a squat bottle of ink with a dip pen leaning in it, standing in a pool of spilled ink. */
function inkBottle(): Landmark {
  const model = new Model();
  const decals = new Model();
  model.part('plastic/black').cylinder(2.1, 3.6, { sides: 8 });
  model.part('plastic/black').cylinder(2.1, 1, { sides: 8, topRadius: 0.9 }, { at: [0, 3.6, 0] });
  model.part('plastic/black').cylinder(0.9, 0.6, { sides: 8 }, { at: [0, 4.6, 0] });
  model.part('paper/white').cylinder(2.14, 1.6, { sides: 8 }, { at: [0, 1, 0] });
  model.part('ink/blue').cylinder(2.16, 0.35, { sides: 8 }, { at: [0, 1.6, 0] });
  // The dip pen: its nib in the ink, the holder leaning out over the rim.
  const pen: Place = { at: [0.2, 4, 0.1], rot: [14, 0, -18] };
  model.part('ink/black').cylinder(0.22, 4.6, { sides: 6 }, pen);
  model.part('pencil/metal').cylinder(0.24, 0.8, { sides: 6, topRadius: 0.03 }, { at: transformPoint([0, 0, 0], pen), rot: [14 + 180, 0, 18] });
  puddle(decals, 'ink/blue', [1.6, 1.2], 2.4, 3);
  const colliders = [box(0, 1.8, 0, 2.0, 1.8, 2.0), sphere(0, 4.4, 0, 1.3), ...along(pen, 0.9, 4.6, 0.45, 0.9)];
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Cardboard Fort: a cardboard tube tower with battlements, a door and a red pennant. */
function cardboardTower(): Landmark {
  const model = new Model();
  const decals = new Model();
  const r = 2.6;
  const h = 6.4;
  model.part('cardboard/side').tube(r, r - 0.25, h, { sides: 12, capBottom: true });
  model.part('tape/masking').tube(r + 0.04, r - 0.1, 0.5, { sides: 12 }, { at: [0, 4.2, 0] });
  for (let i = 0; i < 12; i += 2) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    model.part('cardboard/edge').box([1.2, 0.8, 0.3], { at: [Math.cos(a) * (r - 0.12), h + 0.4, -Math.sin(a) * (r - 0.12)], rot: [0, (a * 180) / Math.PI + 90, 0] });
  }
  model.part('cardboard/dark').box([0.1, 2.4, 1.6], { at: [r + 0.02, 1.2, 0] });
  for (const z of [-1.2, 0, 1.2]) decals.part('ink/black').box([0.02, 0.5, 0.06], { at: [r + 0.06, 3.1, z] });
  model.add(paperFlag('paper/red', 2.8), { at: [-r + 0.4, h, 0] });
  const colliders = [box(0, (h + 0.8) / 2, 0, r, (h + 0.8) / 2, r), sphere(-r + 1.4, h + 2.1, 0, 0.8)];
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Ruler Crossing: a ruler laid across two eraser piers, pennants at both ends. */
function rulerBridge(): Landmark {
  const model = new Model();
  const span = 8;
  const deck = 3;
  const colliders: Shape[] = [];
  for (const side of [-1, 1]) {
    const x = side * (span / 2 - 1);
    bigEraser(model, [1.8, deck, 1.8], 'rubber/pink', 'paper/blue', { at: [x, 0, 0] });
    // Pennants fly inwards, over the deck.
    model.add(paperFlag('paper/yellow', 2.8), { at: [side * (span / 2 - 0.4), deck + 0.12, 0.55], rot: [0, side > 0 ? 180 : 0, 0] });
    colliders.push(box(x, deck / 2, 0, 0.9, deck / 2, 0.9), sphere(side * (span / 2 - 1.4), deck + 2.2, 0.55, 0.8));
  }
  const r = ruler(span, 1.6);
  model.add(r.body, { at: [-span / 2, deck, 0] });
  const decals = new Model().add(r.marks, { at: [-span / 2, deck, 0] });
  colliders.push(box(0, deck + 0.06, 0, span / 2, 0.1, 0.8));
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Scrap Corner: a wastepaper bin overflowing with crumpled paper. */
function paperBin(): Landmark {
  const model = new Model();
  const h = 4.6;
  model.part('plastic/blue').tube(2.4, 2.2, h, { sides: 12, capBottom: true });
  model.part('plastic/blue').tube(2.55, 2.2, 0.3, { sides: 12 }, { at: [0, h - 0.3, 0] });
  const colliders: Shape[] = [box(0, h / 2, 0, 2.3, h / 2, 2.3)];
  const balls: Array<[number, number, number, number]> = [
    [0, h + 0.4, 0, 1.2],
    [1.1, h + 0.1, 0.8, 0.9],
    [-1, h + 0.2, -0.6, 1],
    [0.5, h + 1.4, -0.4, 0.8],
  ];
  balls.forEach(([x, y, z, r], i) => {
    model.add(paperBall(r, 11 + i), { at: [x, y - r * 0.85, z] });
    colliders.push(sphere(x, y, z, r * 0.95));
  });
  for (const [x, z, r, seed] of [[2.8, 1, 0.7, 21], [2, -2.2, 0.6, 22], [-2.5, 1.7, 0.65, 23]] as const) model.add(paperBall(r, seed), { at: [x, 0, z] });
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

/** Glue Gulch: a bottle of school glue with an orange nozzle, standing in its own puddle. */
function glueBottle(): Landmark {
  const model = new Model();
  const decals = new Model();
  model.part('plastic/white').cylinder(1.6, 5, { sides: 10, smooth: true });
  model.part('paper/orange').cylinder(1.64, 2.2, { sides: 10, smooth: true }, { at: [0, 1.3, 0] });
  model.add(star(0.7, 'paper/white', 0.04), { at: [1.68, 2.4, 0], rot: [0, 90, 0] });
  model.part('plastic/white').cylinder(1.6, 0.8, { sides: 10, topRadius: 0.6 }, { at: [0, 5, 0] });
  model.part('plastic/orange').cylinder(0.62, 1.2, { sides: 10 }, { at: [0, 5.8, 0] });
  model.part('plastic/orange').cylinder(0.36, 1.3, { sides: 10, topRadius: 0.1 }, { at: [0, 7, 0] });
  puddle(decals, 'plastic/white', [-1.8, 1.3], 1.8, 5);
  const colliders = [box(0, 2.9, 0, 1.55, 2.9, 1.55), sphere(0, 6.4, 0, 0.75), sphere(0, 7.6, 0, 0.5)];
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Paper Citadel: a cardboard keep with battlements, four round towers with red paper roofs, and a flag. */
function citadel(): Landmark {
  const model = new Model();
  const decals = new Model();
  const k = 2;
  const wall = 4.6;
  model.part('cardboard/side').box([k * 2, wall, k * 2], { at: [0, wall / 2, 0] });
  for (const i of [-1, 1]) {
    for (const [x, z] of [[i * 0.9, k - 0.3], [i * 0.9, -k + 0.3], [k - 0.3, i * 0.9], [-k + 0.3, i * 0.9]] as const) {
      model.part('cardboard/edge').box([0.6, 0.6, 0.6], { at: [x, wall + 0.3, z] });
    }
  }
  model.part('cardboard/dark').box([0.08, 2, 1.4], { at: [k + 0.02, 1, 0] });
  const t = 1.9;
  const colliders: Shape[] = [box(0, (wall + 0.6) / 2, 0, k, (wall + 0.6) / 2, k)];
  for (const [x, z] of [[t, t], [-t, t], [-t, -t], [t, -t]] as const) {
    model.part('cardboard/side').cylinder(0.85, 6.2, { sides: 10 }, { at: [x, 0, z] });
    model.part('paper/red').cylinder(1.05, 1.6, { sides: 10, topRadius: 0 }, { at: [x, 6.2, z] });
    decals.part('ink/black').box([0.06, 0.6, 0.3], { at: [x + (x > 0 ? 0.86 : -0.86), 4.4, z] });
    colliders.push(box(x, 3.1, z, 0.85, 3.1, 0.85), sphere(x, 6.8, z, 0.85));
  }
  model.add(paperFlag('paper/red', 3), { at: [0, wall, 0] });
  colliders.push(sphere(1, wall + 2.4, 0, 0.8));
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Crayon Canyon: an open crayon box with crayons of every colour sticking up, two more spilled. */
function crayonBox(): Landmark {
  const model = new Model();
  const w = 4.6;
  const h = 3.2;
  const d = 2.2;
  model.part('paper/yellow').box([w, 0.1, d], { at: [0, 0.05, 0] });
  model.part('paper/yellow').box([w, h, 0.1], { at: [0, h / 2, d / 2] });
  model.part('paper/yellow').box([w, h * 0.8, 0.1], { at: [0, (h * 0.8) / 2, -d / 2] });
  model.part('paper/yellow').box([0.1, h, d], { at: [w / 2, h / 2, 0] });
  model.part('paper/yellow').box([0.1, h, d], { at: [-w / 2, h / 2, 0] });
  model.part('paper/green').box([w + 0.04, 1, 0.04], { at: [0, h * 0.45, d / 2 + 0.05] });
  model.part('paper/green').box([w + 0.04, 1, 0.04], { at: [0, h * 0.4, -d / 2 - 0.05] });
  // The lid, folded open behind.
  model.part('paper/yellow').box([w, 0.1, 1.6], { at: [0, h + 0.5, -d / 2 - 0.45], rot: [-55, 0, 0] });
  const colours: MaterialId[] = ['paper/red', 'paper/blue', 'paper/green', 'paper/purple', 'paper/orange', 'paper/pink', 'paper/yellow', 'ink/black'];
  let top = 0;
  colours.forEach((c, i) => {
    const row = i % 2;
    const x = -w / 2 + 0.55 + Math.floor(i / 2) * 1.05 + row * 0.3;
    const z = row ? 0.45 : -0.45;
    const length = 5 + ((i * 5) % 4) * 0.4;
    model.add(crayon(length, 0.38, c), { at: [x, 0.1, z], rot: [row ? 4 : -4, 0, (i - 3.5) * 1.5] });
    top = Math.max(top, length + 0.1);
  });
  model.add(lyingCrayon(3, 0.38, 'paper/blue'), { at: [-2, 0, 1.7], rot: [0, 8, 0] });
  model.add(lyingCrayon(2.6, 0.38, 'paper/red'), { at: [-0.2, 0, 2.3], rot: [0, -12, 0] });
  const colliders = [box(0, h / 2, 0, w / 2, h / 2, d / 2), box(0, (h + top) / 2, 0, w / 2 - 0.2, (top - h) / 2, 0.85)];
  return { model, decals: new Model(), colliders, height: top };
}

/** Sharpener Point: a metal pencil sharpener with a giant pencil standing in it, shavings all round. */
function sharpener(): Landmark {
  const model = new Model();
  const decals = new Model();
  const block = 2.8;
  model.part('pencil/metal').box([3.6, block, 3], { at: [0, block / 2, 0] });
  // The blade and its screw on the front, grip ribs on the sides.
  model.part('plastic/black').box([2.4, 0.9, 0.08], { at: [0, 2.1, 1.52] });
  model.part('pencil/metal').cylinder(0.2, 0.12, { sides: 8 }, { at: [0.9, 2.1, 1.52], rot: [90, 0, 0] });
  for (const side of [-1, 1]) for (const z of [-1, -0.5, 0, 0.5, 1]) decals.part('ink/black').box([0.04, 2.2, 0.08], { at: [side * 1.82, 1.4, z] });
  // The pencil stands point-down in the hole on top.
  const length = 6.2;
  model.add(pencil(length, 0.55, 'pencil/yellow'), { at: [0, block + length - 1.2, 0], rot: [180, 0, 0] });
  for (const [x, z, seed] of [[2.6, 1.4, 1], [-2.5, 1.9, 2], [2.2, -2.3, 3], [-2.8, -1.4, 4]] as const) model.add(shavings(seed), { at: [x, 0, z] });
  const tip = block + length - 1.2;
  const colliders = [box(0, block / 2, 0, 1.8, block / 2, 1.5), ...along({ at: [0, block, 0] }, 0.6, tip - block - 0.5, 0.62, 1.1)];
  return { model, decals, colliders, height: tip };
}

/** Compass Rise: a drawing compass standing astride the circle it has just drawn. */
function compass(): Landmark {
  const model = new Model();
  const decals = new Model();
  const head = 8;
  const leg = 8.2;
  const spread = 21;
  model.part('pencil/metal').cylinder(0.65, 1.1, { sides: 10 }, { at: [0, head, -0.55], rot: [90, 0, 0] });
  model.part('pencil/metal').cylinder(0.25, 1.3, { sides: 6 }, { at: [0, head + 0.4, 0] });
  model.part('rubber/blue').cylinder(0.32, 0.7, { sides: 6 }, { at: [0, head + 1.2, 0] });
  const legs: Place[] = [];
  for (const side of [-1, 1]) {
    // Each leg hangs down from the head (its +Y turned to point down and out).
    const place: Place = { at: [0, head, 0], rot: [0, 0, 180 + side * spread] };
    legs.push(place);
    const long = side < 0 ? leg * 0.96 : leg * 0.6;
    model.part('pencil/metal').box([0.4, long, 0.55], { at: transformPoint([0, long / 2, 0], place), rot: place.rot });
    if (side < 0) {
      model.part('pencil/graphite').cylinder(0.12, leg - long, { sides: 6, topRadius: 0 }, { at: transformPoint([0, long, 0], place), rot: place.rot });
    } else {
      // The other leg holds a pencil, point down.
      model.part('pencil/metal').box([0.75, 0.5, 0.8], { at: transformPoint([0, long, 0], place), rot: place.rot });
      model.add(pencil(leg * 0.55, 0.3, 'paper/red'), { at: transformPoint([0, leg, 0], place), rot: [0, 0, side * spread] });
    }
  }
  const footA = transformPoint([0, leg, 0], legs[0]);
  const footB = transformPoint([0, leg, 0], legs[1]);
  const reach = Math.abs(footB[0] - footA[0]);
  decals.part('pencil/graphite').tube(reach + 0.05, reach - 0.06, 0.008, { sides: 36 }, { at: [footA[0], 0.01, 0] });
  const colliders = [sphere(0, head + 0.4, 0, 1), ...along(legs[0], 0.9, leg - 0.4, 0.42, 0.9), ...along(legs[1], 0.9, leg - 0.4, 0.42, 0.9)];
  return { model, decals, colliders, height: topOf(colliders) };
}

/** Stapler Bay: a stapler lying open, a giant staple beside it. */
function stapler(): Landmark {
  const model = new Model();
  const len = 6.8;
  model.part('plastic/black').box([len, 0.7, 2], { at: [0, 0.35, 0] });
  model.part('pencil/metal').box([1.4, 0.06, 1.2], { at: [len / 2 - 1, 0.72, 0] });
  // The arm hinges at the back and rises at 28°: its +Y turned towards +X and up.
  const hinge: Place = { at: [-len / 2 + 0.5, 0.9, 0], rot: [0, 0, 28 - 90] };
  const arm = len - 0.4;
  model.part('plastic/red').box([0.9, arm, 1.8], { at: transformPoint([0, arm / 2, 0], hinge), rot: hinge.rot });
  model.part('pencil/metal').box([0.6, arm - 0.4, 1.2], { at: transformPoint([-0.5, arm / 2, 0], hinge), rot: hinge.rot });
  model.part('plastic/black').cylinder(0.5, 2.1, { sides: 8 }, { at: [-len / 2 + 0.5, 0.9, -1.05], rot: [90, 0, 0] });
  // A staple: a flat U of wire.
  for (const [at, size] of [[[0, 0.1, 2.4], [3, 0.2, 0.2]], [[-1.4, 0.1, 1.9], [0.2, 0.2, 1]], [[1.4, 0.1, 1.9], [0.2, 0.2, 1]]] as Array<[Vec3, Vec3]>) {
    model.part('pencil/metal').box(size, { at });
  }
  const colliders = [box(0, 0.4, 0, len / 2, 0.4, 1), ...along(hinge, 0.6, arm, 0.95, 1.2)];
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

/** Back Row: someone's lunch box with an apple and a juice box beside it. */
function lunchBox(): Landmark {
  const model = new Model();
  model.part('plastic/red').box([5, 2.8, 3.2], { at: [0, 1.4, 0] });
  model.part('plastic/white').box([5.1, 0.4, 3.3], { at: [0, 3, 0] });
  model.part('plastic/white').box([0.3, 1, 0.3], { at: [-1.2, 3.7, 0] });
  model.part('plastic/white').box([0.3, 1, 0.3], { at: [1.2, 3.7, 0] });
  model.part('plastic/white').box([2.7, 0.3, 0.4], { at: [0, 4.3, 0] });
  model.part('paper/yellow').box([0.2, 1, 1], { at: [2.56, 1.6, 0] });
  // The apple: a crumpled red ball with a stem and a leaf.
  model.part('paper/red').crumpled(1.1, 31, { at: [-1.6, 1, 2.5] });
  model.part('pencil/wood').cylinder(0.08, 0.5, { sides: 5 }, { at: [-1.6, 1.9, 2.5] });
  model.part('paper/green').extrude([[0, 0], [0.5, 0.2], [0.8, 0], [0.5, -0.2]], 0.03, { at: [-1.55, 2.25, 2.5], rot: [0, 0, 20] });
  // The juice box, its straw poking up.
  model.part('paper/orange').box([1.2, 2.4, 0.9], { at: [1.9, 1.2, 2.3] });
  model.part('paper/white').box([1.22, 0.8, 0.92], { at: [1.9, 1.4, 2.3] });
  model.part('plastic/white').cylinder(0.08, 1.2, { sides: 6 }, { at: [2.2, 2.4, 2.2], rot: [0, 0, -12] });
  const colliders = [box(0, 1.6, 0, 2.55, 1.6, 1.65), box(0, 4, 0, 1.4, 0.45, 0.2), sphere(-1.6, 1, 2.5, 1.05), box(1.9, 1.2, 2.3, 0.6, 1.2, 0.45)];
  return { model, decals: new Model(), colliders, height: topOf(colliders) };
}

interface Stick {
  model: Model;
  /** Where its foot stands inside the cup, and how it leans (degrees about X and Z). */
  at: Vec3;
  lean: [number, number];
  length: number;
  radius: number;
}

/**
 * Home Desk's landmark: a tin can wrapped in blue paper (the player's colour) with a paper star,
 * holding three giant pencils and a ruler that lean out in different directions.
 */
function pencilCup(): Landmark {
  const radius = 2.2;
  const height = 4.6;
  const model = new Model();
  const decals = new Model();
  model.part('pencil/metal').tube(radius, radius - 0.16, height, { sides: 14, capBottom: true });
  // The paper label round the can, and a cut-out star on it.
  model.part('paper/blue').tube(radius + 0.05, radius - 0.02, 2.9, { sides: 14 }, { at: [0, 0.8, 0] });
  for (const side of [1, -1]) model.add(star(0.75, 'paper/yellow', 0.04), { at: [side * (radius + 0.08), 2.25, 0], rot: [0, 90, 0] });

  const sticks: Stick[] = [
    { model: pencil(8.6, 0.42, 'pencil/yellow'), at: [-0.5, 0.3, 0.3], lean: [6, 9], length: 8.6, radius: 0.42 },
    { model: pencil(7.9, 0.4, 'paper/red'), at: [0.6, 0.3, -0.5], lean: [-11, -5], length: 7.9, radius: 0.4 },
    { model: pencil(7.2, 0.4, 'paper/blue'), at: [0.4, 0.3, 0.8], lean: [13, -10], length: 7.2, radius: 0.4 },
  ];
  for (const s of sticks) model.add(s.model, { at: s.at, rot: [s.lean[0], 0, s.lean[1]] });
  // A ruler standing on its end, leaning on the rim.
  const r = ruler(6.5, 0.9);
  const rulerPlace = { at: [-0.9, 0.3, -0.7] as Vec3, rot: [-8, 30, 84] as Vec3 };
  model.add(r.body, rulerPlace);
  decals.add(r.marks, rulerPlace);

  const colliders: Shape[] = [{ kind: 'box', x: 0, y: height / 2, z: 0, hx: radius, hy: height / 2, hz: radius, yaw: 0 }];
  let top = height;
  for (const s of sticks) {
    // Spheres along the part sticking out of the can.
    for (let d = height - 0.3; d <= s.length; d += s.radius * 2.2) {
      const p = transformPoint([0, d, 0], { at: s.at, rot: [s.lean[0], 0, s.lean[1]] });
      colliders.push({ kind: 'sphere', x: p[0], y: p[1], z: p[2], r: s.radius * 1.15 });
      top = Math.max(top, p[1] + s.radius);
    }
  }
  for (let d = 4.5; d <= 6.5; d += 1) {
    const p = transformPoint([d, 0.06, 0], rulerPlace);
    colliders.push({ kind: 'sphere', x: p[0], y: p[1], z: p[2], r: 0.55 });
    top = Math.max(top, p[1] + 0.5);
  }
  return { model, decals, colliders, height: top };
}

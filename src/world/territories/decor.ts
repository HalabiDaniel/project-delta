import { PROPS, type PropId } from '../../assets/manifest';
import type { Collider, Shape } from '../../combat/Collision';
import { BASE, DEFENSES, MISSIONS, TARGETS, WORLD } from '../../config';
import type { MaterialId } from '../../render/style';
import { homeHeading } from '../Grid';
import { transformPoint, type Place } from '../props/MeshBuilder';
import { LANDMARKS, type LandmarkId } from '../props/landmarks';
import type { Territory } from '../Territory';
import { HOME_DESK, THEMES, type Detail, type Placement, type TerritoryLayout, type ThemeId } from './themes';

/**
 * What every desk in the classroom looks like (v0.0.11): its theme, its landmark and a scatter of
 * stationery, as data, plus the collision shapes that follow from it. Pure, so the server and the
 * client build exactly the same shapes from it: a landmark is solid in the same place in
 * single-player, in the client's prediction and in the server's simulation.
 *
 * Every territory can be someone's home in multiplayer, so every layout keeps the home's work
 * areas clear (the runway and take-off path, the construction slots, the paper store, the
 * hangar) as well as a target's (the bullseye in the middle, the AI's installation spots, the
 * practice range). The landmark stands in a corner the AI's defenses and the practice range
 * leave free, and its footprint is handed to the defense layout so nothing is built into it.
 */

export interface TerritoryDecor {
  theme: ThemeId;
  landmark: LandmarkId;
  /** Colored paper comes in several colours. */
  sheet?: MaterialId;
}

/**
 * The assignment of themes and landmarks to the 16 desks, following their names. Proposed to the
 * developer for approval (see the v0.0.11 notes).
 */
export const TERRITORY_DECOR: Record<string, TerritoryDecor> = {
  T1: { theme: 'notebook', landmark: 'pencilCup' },
  T2: { theme: 'graph', landmark: 'pencilBundle' },
  T3: { theme: 'notebook', landmark: 'tentNotebook' },
  T4: { theme: 'colored', landmark: 'eraserStack', sheet: 'paper/pink' },
  T5: { theme: 'notebook', landmark: 'notebookHill' },
  T6: { theme: 'artDesk', landmark: 'inkBottle' },
  T7: { theme: 'cardboard', landmark: 'cardboardTower' },
  T8: { theme: 'graph', landmark: 'rulerBridge' },
  T9: { theme: 'colored', landmark: 'paperBin', sheet: 'paper/yellow' },
  T10: { theme: 'artDesk', landmark: 'glueBottle' },
  T11: { theme: 'cardboard', landmark: 'citadel' },
  T12: { theme: 'artDesk', landmark: 'crayonBox' },
  T13: { theme: 'graph', landmark: 'sharpener' },
  T14: { theme: 'graph', landmark: 'compass' },
  T15: { theme: 'cardboard', landmark: 'stapler' },
  T16: { theme: 'colored', landmark: 'lunchBox', sheet: 'paper/mint' },
};

/** Where landmarks stand: this far from the middle along both axes, in a corner. */
export const LANDMARK_CORNER = 15.5;
/** Runway and take-off path: props keep this far either side of the runway's centre line. */
export const CORRIDOR = WORLD.runwayWidth / 2 + 1.5;
/** Props scattered per territory (before the decoration levels thin them out). */
const SCATTER = 12;
/** Room kept round an AI installation spot: the biggest building's footprint and a margin. */
const INSTALLATION_ROOM = Math.max(...(['turret', 'launcher', 'radar', 'supply'] as const).map((k) => DEFENSES[k].footprint)) + 0.6;

// ---- Frames ----------------------------------------------------------------------------------

/** The direction a territory's u axis points: its runway's heading, were it a home. */
export function territoryFacing(t: { x: number; z: number }): { x: number; z: number } {
  return homeHeading(t);
}

/** The frame's turn about the vertical, degrees (setEulerAngles convention). */
export function frameYaw(facing: { x: number; z: number }): number {
  return (Math.atan2(-facing.z, facing.x) * 180) / Math.PI;
}

/** A point in a territory's (u, v) frame → world x, z. */
export function frameToWorld(t: { x: number; z: number }, facing: { x: number; z: number }, u: number, v: number): { x: number; z: number } {
  const a = (frameYaw(facing) * Math.PI) / 180;
  return { x: t.x + u * Math.cos(a) + v * Math.sin(a), z: t.z - u * Math.sin(a) + v * Math.cos(a) };
}

/** World x, z → a territory's (u, v) frame. */
export function worldToFrame(t: { x: number; z: number }, facing: { x: number; z: number }, x: number, z: number): [number, number] {
  const a = (frameYaw(facing) * Math.PI) / 180;
  const dx = x - t.x;
  const dz = z - t.z;
  return [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
}

/** A shape in a part's space → world space (parts only ever turn about the vertical). */
export function shapeToWorld(shape: Shape, place: Place, t: { x: number; z: number }, facing: { x: number; z: number }): Shape {
  const local = transformPoint([shape.x, shape.y, shape.z], place);
  const p = frameToWorld(t, facing, local[0], local[2]);
  if (shape.kind === 'sphere') return { ...shape, x: p.x, y: local[1], z: p.z };
  const yawDeg = (place.rot?.[1] ?? 0) + frameYaw(facing);
  return { ...shape, x: p.x, y: local[1], z: p.z, yaw: shape.yaw + (yawDeg * Math.PI) / 180 };
}

// ---- What a territory keeps clear ---------------------------------------------------------------

interface Circle {
  u: number;
  v: number;
  r: number;
}

/** The territory's number: T7 → 7. */
function numberOf(id: string): number {
  return Number(id.slice(1)) || 0;
}

/** The corners AI defenses and the practice range use, in world axes (j = 0…3, as Layout/Destructibles number them). */
function cornerSigns(j: number): [number, number] {
  const a = Math.PI / 4 + (j * Math.PI) / 2;
  return [Math.sign(Math.cos(a)), Math.sign(Math.sin(a))];
}

/**
 * The corner a territory's landmark takes, in world axes. Single-player's practice range puts its
 * crates and target board in corners k and k + 2 (k counting the territories after T1); the
 * landmark takes one of the other two.
 */
function landmarkCorner(n: number): number {
  const k = n - 2;
  return (((k + 1 + 2 * (n % 2)) % 4) + 4) % 4;
}

/** Spots the AI's installations may take on this territory (single-player's numbering and multiplayer's). */
function installationSpots(t: Territory, n: number): Array<{ x: number; z: number }> {
  const spots: Array<{ x: number; z: number }> = [];
  for (const k of new Set([n - 2, n - 1].filter((k) => k >= 0))) {
    for (let j = 0; j < 4; j++) {
      const a = Math.PI / 4 + ((j + k) * Math.PI) / 2;
      spots.push({ x: t.x + Math.sign(Math.cos(a)) * (t.half - 4.5), z: t.z + Math.sign(Math.sin(a)) * (t.half - 4.5) });
      const b = ((j + k + 1) * Math.PI) / 2;
      spots.push({ x: t.x + Math.round(Math.cos(b)) * (t.half - 4), z: t.z + Math.round(Math.sin(b)) * (t.half - 4) });
    }
    for (let j = 0; j < 8; j++) {
      const a = ((k * 40 + 22.5 + ((j * 3) % 8) * 45) * Math.PI) / 180;
      spots.push({ x: t.x + Math.cos(a) * 11, z: t.z + Math.sin(a) * 11 });
    }
  }
  return spots;
}

/** Single-player's practice dummies stand on poles round a ring; keep props off their feet. */
function dummySpots(t: Territory, n: number): Array<{ x: number; z: number }> {
  const k = n - 2;
  if (k < 0) return [];
  const turn = (k * 40 * Math.PI) / 180;
  return [0, 1, 2].map((i) => ({ x: t.x + Math.cos(turn + (i * 2 * Math.PI) / 3) * TARGETS.dummyRing, z: t.z + Math.sin(turn + (i * 2 * Math.PI) / 3) * TARGETS.dummyRing }));
}

/** The home's work areas in the frame: construction slots, paper store, hangar. */
export function homeWorkAreas(): Circle[] {
  return [
    ...BASE.slots.map((s) => ({ u: s.at[0], v: s.at[1], r: 2.8 })),
    { u: DEFENSES.home.store[0], v: DEFENSES.home.store[1], r: 2.5 },
    { u: -WORLD.runwayLength / 2 - 1, v: 0, r: 3 },
  ];
}

// ---- Footprints ---------------------------------------------------------------------------------

const footprints = new Map<string, number>();

/** How far a prop reaches from where it stands (its bounds, turned any way). */
export function propReach(id: PropId): number {
  let r = footprints.get(id);
  if (r === undefined) {
    r = 0;
    for (const b of PROPS[id].build().model.parts.values()) {
      if (b.isEmpty) continue;
      const [lo, hi] = b.bounds();
      for (const x of [lo[0], hi[0]]) for (const z of [lo[2], hi[2]]) r = Math.max(r, Math.hypot(x, z));
    }
    footprints.set(id, r);
  }
  return r;
}

/** How far a set of shapes reaches from their origin, horizontally. */
export function shapesReach(shapes: readonly Shape[]): number {
  let r = 0;
  for (const s of shapes) {
    if (s.kind === 'sphere') r = Math.max(r, Math.hypot(s.x, s.z) + s.r);
    else {
      const c = Math.cos(s.yaw);
      const n = Math.sin(s.yaw);
      for (const [a, b] of [[s.hx, s.hz], [-s.hx, s.hz], [s.hx, -s.hz], [-s.hx, -s.hz]]) r = Math.max(r, Math.hypot(s.x + a * c + b * n, s.z - a * n + b * c));
    }
  }
  return r;
}

const landmarkReach = new Map<LandmarkId, number>();

/** How far a landmark's solid parts reach from its foot. */
export function landmarkRadius(id: LandmarkId): number {
  let r = landmarkReach.get(id);
  if (r === undefined) {
    r = shapesReach(LANDMARKS[id]().colliders);
    landmarkReach.set(id, r);
  }
  return r;
}

// ---- Layouts ------------------------------------------------------------------------------------

const layouts = new Map<string, TerritoryLayout>();

/** A territory's layout: Home Desk's hand-made one on T1, generated from its decor for the others. */
export function territoryLayout(t: Territory): TerritoryLayout {
  let layout = layouts.get(t.id);
  if (!layout) {
    layout = t.id === WORLD.homeId ? HOME_DESK : generateLayout(t);
    layouts.set(t.id, layout);
  }
  return layout;
}

/** Deterministic random numbers (mulberry32), so every client and the server scatter alike. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateLayout(t: Territory): TerritoryLayout {
  const n = numberOf(t.id);
  const decor = TERRITORY_DECOR[t.id] ?? { theme: 'notebook', landmark: 'pencilCup' };
  const facing = territoryFacing(t);
  // The landmark: in its corner, turned so its long side runs along the edge.
  const [sx, sz] = cornerSigns(landmarkCorner(n));
  const [lu, lv] = worldToFrame(t, facing, t.x + sx * LANDMARK_CORNER, t.z + sz * LANDMARK_CORNER);
  const su = Math.sign(lu);
  const sv = Math.sign(lv);
  const yaw = Math.round((Math.atan2(-su, -sv) * 180) / Math.PI);
  const landmark = { id: decor.landmark, at: [lu, lv] as const, yaw };
  const lr = landmarkRadius(decor.landmark);

  // What the scatter keeps off.
  const keep: Circle[] = [
    { u: 0, v: 0, r: MISSIONS.bullseyeRadius.easy + 1.5 },
    ...homeWorkAreas(),
    { u: lu, v: lv, r: lr + 0.8 },
    ...installationSpots(t, n).map((p) => {
      const [u, v] = worldToFrame(t, facing, p.x, p.z);
      return { u, v, r: INSTALLATION_ROOM };
    }),
    ...dummySpots(t, n).map((p) => {
      const [u, v] = worldToFrame(t, facing, p.x, p.z);
      return { u, v, r: 1 };
    }),
  ];
  // Pennant spots: the three corners the landmark leaves, out at the rim.
  const flags: Array<[number, number]> = [];
  for (const [cu, cv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    if (cu === su && cv === sv) continue;
    flags.push([cu * 18.4, cv * 18.4]);
    keep.push({ u: cu * 18.4, v: cv * 18.4, r: 1 });
  }

  const random = rng(n * 7919 + 17);
  const pool = THEMES[decor.theme].scatter;
  const props: Placement[] = [];
  const edge = t.half - 1.6;
  for (let attempt = 0; attempt < 600 && props.length < SCATTER; attempt++) {
    const prop = pool[Math.floor(random() * pool.length)];
    const r = propReach(prop);
    const u = (random() * 2 - 1) * (edge - r);
    const v = (random() * 2 - 1) * (edge - r);
    if (Math.abs(v) < CORRIDOR + r) continue;
    if (keep.some((c) => Math.hypot(c.u - u, c.v - v) < c.r + r)) continue;
    const detail = (props.length < 4 ? 1 : props.length < 8 ? 2 : 3) as Detail;
    props.push({ prop, at: [round(u), round(v)], yaw: Math.round(random() * 360), detail });
    keep.push({ u, v, r: r + 0.3 });
  }
  return { theme: decor.theme, sheet: decor.sheet, landmark, props, flags };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---- Collision shapes ---------------------------------------------------------------------------

/**
 * Everything solid a territory's decoration adds, in world space: its landmark and the props
 * declaring collision shapes. Props with shapes always show (decoration level 1), so the shapes
 * don't depend on anyone's graphics settings.
 */
export function decorColliders(t: Territory, layout: TerritoryLayout = territoryLayout(t), facing = territoryFacing(t)): Collider[] {
  const out: Collider[] = [];
  const lm = layout.landmark;
  if (lm) {
    const place: Place = { at: [lm.at[0], 0.02, lm.at[1]], rot: [0, lm.yaw, 0] };
    out.push({ id: `${t.id}-landmark`, shapes: LANDMARKS[lm.id]().colliders.map((s) => shapeToWorld(s, place, t, facing)) });
  }
  layout.props.forEach((p, i) => {
    const def = PROPS[p.prop];
    if (!def.colliders?.length) return;
    const place: Place = { at: [p.at[0], 0.02, p.at[1]], rot: [0, p.yaw ?? 0, 0] };
    out.push({ id: `${t.id}-prop-${i}`, shapes: def.colliders.map((s) => shapeToWorld(s, place, t, facing)) });
  });
  return out;
}

const worldColliders = new Map<string, Collider[]>();

/** Every territory's decoration colliders, built once per territory id. */
export function allDecorColliders(territories: readonly Territory[]): Collider[] {
  return territories.flatMap((t) => {
    let c = worldColliders.get(t.id);
    if (!c) {
      c = decorColliders(t);
      worldColliders.set(t.id, c);
    }
    return c;
  });
}

/**
 * Ground the decoration takes, as circles in world space: for the defense layout (nothing is
 * built into a landmark) and for missions (precision spots keep clear).
 */
export function decorFootprints(territories: readonly Territory[]): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = [];
  for (const t of territories) {
    const layout = territoryLayout(t);
    const facing = territoryFacing(t);
    if (layout.landmark) {
      const p = frameToWorld(t, facing, layout.landmark.at[0], layout.landmark.at[1]);
      out.push({ x: p.x, z: p.z, r: landmarkRadius(layout.landmark.id) });
    }
    for (const prop of layout.props) {
      if (!PROPS[prop.prop].colliders?.length) continue;
      const p = frameToWorld(t, facing, prop.at[0], prop.at[1]);
      out.push({ x: p.x, z: p.z, r: propReach(prop.prop) });
    }
  }
  return out;
}

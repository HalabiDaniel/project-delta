import { AIRCRAFT, BOMB, type AircraftId, type BaseShapeId } from '../config';

/**
 * Low-poly folded-paper geometry for each design, as flat-shaded triangles so every fold catches
 * the light differently. Temporary stand-ins for proper models.
 *
 * Model space: nose points down -Z (PlayCanvas forward), +Y up, +X to the right wing. Each shape
 * lists the left half of its sheet (mirrored for the right) and the parts on the centre crease
 * (x = 0), split into plain paper and the design's accent colour. Every vertex is either on the
 * crease or off it, which is what lets the fold animation rotate each half about the crease.
 */

export type V3 = readonly [number, number, number];

export interface PlaneShape {
  /** Applied to the triangle data. */
  scale: number;
  paper: { left: V3[][]; centre: V3[][] };
  accent: { left: V3[][]; centre: V3[][] };
  /** The left wingtip's trailing corner, for the wingtip ribbons (unscaled; mirrored for the right). */
  wingtip: V3;
  /** The back of the plane, where a damaged plane trails ink (unscaled). */
  tail: V3;
  /** Where carried bombs hang, already scaled, in loading order. */
  bombSlots: V3[];
  /** Gun muzzles, already scaled, one per barrel in firing order. */
  muzzles: V3[];
}

// ---- Falcon: F-35-shaped fighter with swept delta wings, a keel and two canted tails ------------

const F = {
  N: [0, 0.06, -1.5] as V3,
  M: [0, 0.16, -0.15] as V3,
  C: [0, 0.12, 1.15] as V3,
  K1: [0, -0.16, -0.7] as V3,
  K2: [0, -0.26, 0.85] as V3,
  SHOULDER: [-0.26, 0.03, -0.55] as V3,
  WRL: [-0.34, 0.02, -0.1] as V3,
  WTL: [-1.15, 0.16, 0.5] as V3,
  WTT: [-1.1, 0.16, 0.74] as V3,
  WRT: [-0.36, 0.03, 0.62] as V3,
  STAB_TIP: [-0.74, 0.07, 1.12] as V3,
  STAB_ROOT: [-0.3, 0.04, 1.22] as V3,
  FIN_BF: [-0.24, 0.07, 0.5] as V3,
  FIN_BB: [-0.27, 0.07, 1.08] as V3,
  FIN_TB: [-0.52, 0.58, 1.14] as V3,
  FIN_TF: [-0.47, 0.58, 0.88] as V3,
};

const FALCON: PlaneShape = {
  scale: 1.3,
  paper: {
    left: [
      [F.N, F.SHOULDER, F.M],
      [F.SHOULDER, F.WRL, F.M],
      [F.M, F.WRL, F.WRT],
      [F.M, F.WRT, F.C],
      [F.WRL, F.WTL, F.WTT],
      [F.WRL, F.WTT, F.WRT],
    ],
    centre: [
      [F.N, F.K1, F.M],
      [F.M, F.K1, F.K2],
      [F.M, F.K2, F.C],
    ],
  },
  accent: {
    left: [
      [F.WRT, F.STAB_TIP, F.STAB_ROOT],
      [F.WRT, F.STAB_ROOT, F.C],
      [F.FIN_BF, F.FIN_BB, F.FIN_TB],
      [F.FIN_BF, F.FIN_TB, F.FIN_TF],
    ],
    centre: [],
  },
  wingtip: F.WTT,
  tail: F.C,
  bombSlots: [[0, -BOMB.hangOffset, 0.15]],
  muzzles: [
    [-0.45, 0.02, -0.35],
    [0.45, 0.02, -0.35],
  ],
};

// ---- Dart: the classic schoolroom dart, long and narrow, with a deep keel and little winglets ---

const D = {
  N: [0, 0.03, -1.75] as V3,
  M: [0, 0.1, 0.1] as V3,
  C: [0, 0.09, 1.0] as V3,
  K1: [0, -0.1, -0.7] as V3,
  K2: [0, -0.24, 0.95] as V3,
  WRL: [-0.1, 0.03, -1.2] as V3,
  WTL: [-0.7, 0.12, 0.8] as V3,
  WTT: [-0.66, 0.12, 1.0] as V3,
  WRT: [-0.1, 0.05, 1.0] as V3,
  WINGLET: [-0.78, 0.36, 0.97] as V3,
};
// A stripe painted along each wing, a hair above the paper.
const DS: V3[] = [
  [-0.31, 0.077, -0.5],
  [-0.67, 0.131, 0.7],
  [-0.55, 0.118, 0.7],
  [-0.2, 0.064, -0.45],
];

const DART: PlaneShape = {
  scale: 1.2,
  paper: {
    left: [
      [D.N, D.WRL, D.M],
      [D.M, D.WRL, D.WRT],
      [D.M, D.WRT, D.C],
      [D.WRL, D.WTL, D.WTT],
      [D.WRL, D.WTT, D.WRT],
    ],
    centre: [],
  },
  accent: {
    left: [
      [D.WTL, D.WTT, D.WINGLET],
      [DS[0], DS[1], DS[2]],
      [DS[0], DS[2], DS[3]],
    ],
    centre: [
      [D.N, D.K1, D.M],
      [D.M, D.K1, D.K2],
      [D.M, D.K2, D.C],
    ],
  },
  wingtip: D.WTT,
  tail: D.C,
  bombSlots: [[0, -0.5, 0.15]],
  muzzles: [[0, -0.02, -1.9]],
};

// ---- Swift: a medium delta with canards by the nose and twin fins ------------------------------

const S = {
  N: [0, 0.05, -1.45] as V3,
  M: [0, 0.15, -0.2] as V3,
  C: [0, 0.12, 1.05] as V3,
  K1: [0, -0.14, -0.6] as V3,
  K2: [0, -0.22, 0.85] as V3,
  SHOULDER: [-0.22, 0.03, -0.75] as V3,
  WRL: [-0.3, 0.02, -0.3] as V3,
  WTL: [-1.15, 0.13, 0.5] as V3,
  WTT: [-1.1, 0.13, 0.78] as V3,
  WRT: [-0.32, 0.03, 0.9] as V3,
  CAN_RF: [-0.17, 0.04, -0.95] as V3,
  CAN_TIP: [-0.55, 0.07, -0.62] as V3,
  CAN_RB: [-0.23, 0.04, -0.7] as V3,
  FIN_BF: [-0.27, 0.06, 0.45] as V3,
  FIN_BB: [-0.3, 0.06, 1.0] as V3,
  FIN_TB: [-0.5, 0.48, 1.06] as V3,
  FIN_TF: [-0.45, 0.48, 0.82] as V3,
};

const SWIFT: PlaneShape = {
  scale: 1.25,
  paper: {
    left: [
      [S.N, S.SHOULDER, S.M],
      [S.SHOULDER, S.WRL, S.M],
      [S.M, S.WRL, S.WRT],
      [S.M, S.WRT, S.C],
      [S.WRL, S.WTL, S.WTT],
      [S.WRL, S.WTT, S.WRT],
    ],
    centre: [
      [S.N, S.K1, S.M],
      [S.M, S.K1, S.K2],
      [S.M, S.K2, S.C],
    ],
  },
  accent: {
    left: [
      [S.CAN_RF, S.CAN_TIP, S.CAN_RB],
      [S.FIN_BF, S.FIN_BB, S.FIN_TB],
      [S.FIN_BF, S.FIN_TB, S.FIN_TF],
    ],
    centre: [],
  },
  wingtip: S.WTT,
  tail: S.C,
  bombSlots: [
    [-0.6, -0.48, 0.3],
    [0.6, -0.48, 0.3],
  ],
  muzzles: [
    [-0.4, 0.02, -0.5],
    [0.4, 0.02, -0.5],
  ],
};

// ---- Widewing: a broad, blunt-nosed glider with end plates on its wingtips and a tailplane ------

const W = {
  N: [0, 0.05, -1.05] as V3,
  M: [0, 0.13, -0.3] as V3,
  C: [0, 0.11, 0.95] as V3,
  K1: [0, -0.1, -0.45] as V3,
  K2: [0, -0.17, 0.75] as V3,
  SHOULDER: [-0.26, 0.03, -0.7] as V3,
  WRL: [-0.34, 0.03, -0.45] as V3,
  WTL: [-1.75, 0.15, 0.1] as V3,
  WTT: [-1.7, 0.15, 0.5] as V3,
  WRT: [-0.38, 0.04, 0.75] as V3,
  PLATE_TOP: [-1.78, 0.45, 0.42] as V3,
  PLATE_FRONT: [-1.8, 0.4, 0.15] as V3,
  STAB_TIP: [-0.8, 0.06, 1.05] as V3,
  STAB_ROOT: [-0.3, 0.05, 1.12] as V3,
};

const WIDEWING: PlaneShape = {
  scale: 1.3,
  paper: {
    left: [
      [W.N, W.SHOULDER, W.M],
      [W.SHOULDER, W.WRL, W.M],
      [W.M, W.WRL, W.WRT],
      [W.M, W.WRT, W.C],
      [W.WRL, W.WTL, W.WTT],
      [W.WRL, W.WTT, W.WRT],
    ],
    centre: [
      [W.N, W.K1, W.M],
      [W.M, W.K1, W.K2],
      [W.M, W.K2, W.C],
    ],
  },
  accent: {
    left: [
      [W.WTL, W.WTT, W.PLATE_TOP],
      [W.WTL, W.PLATE_TOP, W.PLATE_FRONT],
      [W.WRT, W.STAB_TIP, W.STAB_ROOT],
      [W.WRT, W.STAB_ROOT, W.C],
    ],
    centre: [],
  },
  wingtip: W.WTT,
  tail: W.C,
  bombSlots: [
    [-0.6, -0.62, 0.05],
    [0.6, -0.62, 0.05],
    [-1.25, -0.6, 0.25],
    [1.25, -0.6, 0.25],
  ],
  muzzles: [[0, -0.05, -1.3]],
};

const BASE_SHAPES: Record<BaseShapeId, PlaneShape> = {
  dart: DART,
  falcon: FALCON,
  swift: SWIFT,
  widewing: WIDEWING,
};

/**
 * A newer design's stand-in: the base shape it borrows (AircraftSpec.shape), with as many gun
 * muzzles as it has barrels and as many bomb racks as it carries bombs.
 */
export function derivedShape(base: PlaneShape, barrels: number, bombs: number): PlaneShape {
  let muzzles = base.muzzles;
  if (barrels === 1 && muzzles.length !== 1) {
    const [, y, z] = muzzles[0];
    muzzles = [[0, y, z]];
  } else if (barrels === 2 && muzzles.length === 1) {
    const [, y, z] = muzzles[0];
    muzzles = [[-0.35, y, z], [0.35, y, z]];
  }
  const bombSlots: V3[] = base.bombSlots.slice(0, bombs);
  while (bombSlots.length < bombs) bombSlots.push([0, -BOMB.hangOffset, 0.1 + 0.35 * (bombSlots.length - base.bombSlots.length)]);
  return { ...base, muzzles, bombSlots };
}

export const PLANE_SHAPES: Record<AircraftId, PlaneShape> = Object.fromEntries(
  (Object.keys(AIRCRAFT) as AircraftId[]).map((id) => {
    const spec = AIRCRAFT[id];
    const base = BASE_SHAPES[spec.shape];
    return [id, id === spec.shape ? base : derivedShape(base, spec.gun.barrels, spec.bombs.capacity)];
  }),
) as Record<AircraftId, PlaneShape>;

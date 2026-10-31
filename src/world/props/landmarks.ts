import type { Shape } from '../../combat/Collision';
import { transformPoint, type Vec3 } from './MeshBuilder';
import { Model } from './Model';
import { pencil, ruler, star } from './stationery';

/**
 * A territory's landmark: one big, recognisable silhouette that tells the player where they are
 * from the chase camera at flying height. Each comes with simple collision shapes (spheres and
 * boxes, in the landmark's own space) so flying into it is predictable, and a height kept below
 * the AI pilots' cruising clearance.
 */
export interface Landmark {
  model: Model;
  /** Flat markings drawn without outlines or shadows. */
  decals: Model;
  colliders: Shape[];
  /** Highest point, metres above the desk. */
  height: number;
}

export type LandmarkId = 'pencilCup';

export const LANDMARKS: Record<LandmarkId, () => Landmark> = {
  pencilCup,
};

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

import type * as pc from 'playcanvas';
import { Model } from './Model';
import { paperStack, tapeRoll } from './stationery';

/**
 * The game's own buildings, made of cardboard, paper and tape. They are drawn inside the
 * gameplay's collision shapes (see defenses/Layout.ts) and face local -Z, as installations do.
 */

/**
 * T1's paper store: a corrugated cardboard box turned warehouse. Its top flaps fold up into a
 * pitched roof held with tape, a door flap is cut in the front and folded open, reams wait by the
 * door and a notebook-paper sign is taped beside it. `paint` is the store's own cardboard (it
 * darkens with damage). Fits the store's 3.8 × 2.6 × 3.2 m collision box; only the roof ridge
 * rises above it.
 */
export function paperStore(paint: pc.Material): Model {
  const m = new Model();
  const w = 3.6, d = 3, h = 2.3;
  const wall = m.own('store-paint', paint);
  // The box: four walls and a floor, the corrugated edges showing along the top.
  wall.box([w, h, d], { at: [0, h / 2, 0] });
  m.part('cardboard/edge').box([w + 0.02, 0.1, d + 0.02], { at: [0, h - 0.05, 0] });
  // Roof flaps meeting over the middle, with the gable ends filled in darker card.
  const slope = 38;
  const flap = (d / 2 + 0.15) / Math.cos((slope * Math.PI) / 180);
  const rise = Math.sin((slope * Math.PI) / 180) * flap;
  for (const side of [-1, 1]) {
    m.part('cardboard/dark').box([w + 0.24, 0.08, flap], {
      at: [0, h + rise / 2, side * (d / 4 + 0.04)],
      rot: [side * slope, 0, 0],
    });
  }
  for (const x of [-w / 2 + 0.01, w / 2 - 0.01]) {
    const s = Math.sign(x);
    m.part('cardboard/side').face(
      s > 0
        ? [[x, h, d / 2], [x, h, -d / 2], [x, h + rise - 0.05, 0]]
        : [[x, h, -d / 2], [x, h, d / 2], [x, h + rise - 0.05, 0]],
    );
  }
  // Tape over the ridge (a strip on each flap) and down the front corners.
  for (const side of [-1, 1]) {
    const along = flap / 2 - 0.2;
    m.part('tape/masking').box([w + 0.3, 0.03, 0.4], {
      at: [0, h + rise / 2 + Math.sin((slope * Math.PI) / 180) * along + 0.05, side * (d / 4 + 0.04 - Math.cos((slope * Math.PI) / 180) * along)],
      rot: [side * slope, 0, 0],
    });
  }
  for (const x of [-w / 2, w / 2]) m.part('tape/masking').box([0.5, h, 0.06], { at: [x * 0.98, h / 2, -d / 2 - 0.02] });
  // The door: a dark opening and its flap folded out on the right.
  m.part('cardboard/dark').box([1.3, 1.6, 0.05], { at: [-0.35, 0.8, -d / 2 - 0.01] });
  m.part('ink/black').box([1.12, 1.48, 0.04], { at: [-0.35, 0.76, -d / 2 - 0.035] });
  m.own('store-paint', paint).box([1.3, 1.6, 0.07], { at: [0.97, 0.8, -d / 2 - 0.62], rot: [0, 72, 0] });
  // A sign: a sheet of notebook paper taped on the front.
  m.part('paper/notebook').box([0.95, 0.75, 0.03], { at: [1.15, 1.6, -d / 2 - 0.03], rot: [0, 0, -4] });
  m.part('paper/red').box([0.95, 0.12, 0.035], { at: [1.15, 1.92, -d / 2 - 0.035], rot: [0, 0, -4] });
  m.part('tape/masking').box([0.4, 0.14, 0.04], { at: [1.15, 2.02, -d / 2 - 0.045], rot: [0, 0, 8] });
  // Reams of paper by the door, and a tape roll.
  m.add(paperStack(5, 1.2, 0.9, 3), { at: [-1.7, 0, -d / 2 - 0.75], rot: [0, 8, 0] });
  m.add(paperStack(4, 1.2, 0.9, 7), { at: [-1.6, 0.35, -d / 2 - 0.7], rot: [0, -6, 0] });
  m.add(tapeRoll(), { at: [w / 2 + 0.55, 0, 0.6] });
  return m;
}

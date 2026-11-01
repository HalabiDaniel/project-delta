import type { Shape } from '../combat/Collision';
import type { MaterialId, OutlineTier } from '../render/style';
import { Model } from '../world/props/Model';

/**
 * The environment slots for licensed models (Synty POLYGON packs and the like), v0.0.11 section 1.
 * Synty fills the classroom's furniture, architecture details, background props and a few desk-top
 * obstacles; never aircraft, player buildings, defenses, landmarks or mission targets (those are
 * the game's own designs).
 *
 * Every slot has an original low-poly placeholder built in code at the size the real model will
 * be fitted to, so the game is complete without the files. When the developer drops a file named
 * in `licensed` into assets/licensed/, it replaces the placeholder (see assets/licensed/README.md).
 *
 * Sizes: the classroom is at 1 cm (real) = 0.8 world units (a desk top, 65 × 50 cm, is 52 × 40);
 * room furniture is sized for that, desk-top props too (a stapler is about 12 units long).
 */

export type SyntyCategory = 'furniture' | 'architecture' | 'prop' | 'obstacle';

export type SyntyPropId =
  // Classroom furniture (stands on the classroom floor, along the walls)
  | 'room.bookshelf'
  | 'room.cupboard'
  | 'room.storageTrays'
  | 'room.trashBin'
  // Architecture details (on the walls and ceiling)
  | 'room.radiator'
  | 'room.wallClock'
  | 'room.noticeBoard'
  | 'room.ceilingLight'
  // Background props
  | 'room.plant'
  | 'room.boxes'
  | 'desk.stapler'
  | 'desk.scissors'
  | 'desk.glueStick'
  | 'desk.calculator'
  | 'desk.paintPots'
  // Desk-top obstacles, tall enough to fly into (they carry colliders)
  | 'desk.waterBottle'
  | 'desk.lunchbox'
  | 'desk.lamp';

export interface SyntySlot {
  name: string;
  category: SyntyCategory;
  build: () => { model: Model };
  licensed: readonly string[];
  fitHeight: number;
  materials: 'keep' | MaterialId;
  tier: OutlineTier;
  colliders?: readonly Shape[];
}

const CM = 0.8;

/** Desk-top slots (placed on territories, so tall ones collide). */
const DESK_FILES = new Set(['synty/stapler.glb', 'synty/scissors.glb', 'synty/glue_stick.glb', 'synty/calculator.glb', 'synty/paint_pots.glb']);


export const SYNTY_PROPS: Record<SyntyPropId, SyntySlot> = {
  'room.bookshelf': slot('Bookshelf', 'furniture', 'synty/bookshelf.glb', 180, bookshelf),
  'room.cupboard': slot('Low cupboard', 'furniture', 'synty/cupboard.glb', 90, cupboard),
  'room.storageTrays': slot('Storage trays', 'furniture', 'synty/storage_trays.glb', 75, storageTrays),
  'room.trashBin': slot('Waste-paper bin', 'furniture', 'synty/trash_bin.glb', 40, trashBin),
  'room.radiator': slot('Radiator', 'architecture', 'synty/radiator.glb', 60, radiator),
  'room.wallClock': slot('Wall clock', 'architecture', 'synty/wall_clock.glb', 30, wallClock),
  'room.noticeBoard': slot('Notice board', 'architecture', 'synty/notice_board.glb', 90, noticeBoard),
  'room.ceilingLight': slot('Ceiling light', 'architecture', 'synty/ceiling_light.glb', 10, ceilingLight),
  'room.plant': slot('Potted plant', 'prop', 'synty/plant_pot.glb', 90, plant),
  'room.boxes': slot('Cardboard boxes', 'prop', 'synty/cardboard_boxes.glb', 55, boxes),
  'desk.stapler': slot('Stapler', 'prop', 'synty/stapler.glb', 6, stapler, [{ kind: 'box', x: 0, y: 2.4, z: 0, hx: 6.3, hy: 2.4, hz: 1.6, yaw: 0 }]),
  'desk.scissors': slot('Scissors', 'prop', 'synty/scissors.glb', 1.5, scissors),
  'desk.glueStick': slot('Glue stick', 'prop', 'synty/glue_stick.glb', 10, glueStick, [{ kind: 'box', x: 0, y: 5, z: 0, hx: 1.5, hy: 5, hz: 1.5, yaw: 0 }]),
  'desk.calculator': slot('Calculator', 'prop', 'synty/calculator.glb', 2, calculator),
  'desk.paintPots': slot('Paint pots', 'prop', 'synty/paint_pots.glb', 4, paintPots, [{ kind: 'box', x: 0, y: 2, z: 0, hx: 7.2, hy: 2, hz: 1.8, yaw: 0 }]),
  'desk.waterBottle': slot('Water bottle', 'obstacle', 'synty/water_bottle.glb', 22, waterBottle, [
    { kind: 'box', x: 0, y: 8.8, z: 0, hx: 2.6, hy: 8.8, hz: 2.6, yaw: 0 },
  ]),
  'desk.lunchbox': slot('Lunchbox', 'obstacle', 'synty/lunchbox.glb', 8, lunchbox, [
    { kind: 'box', x: 0, y: 3.2, z: 0, hx: 8.8, hy: 3.2, hz: 6, yaw: 0 },
  ]),
  'desk.lamp': slot('Desk lamp', 'obstacle', 'synty/desk_lamp.glb', 40, deskLamp, [
    { kind: 'box', x: 0, y: 1, z: 0, hx: 6, hy: 1, hz: 6, yaw: 0 },
    { kind: 'box', x: 0, y: 14, z: 0, hx: 1.2, hy: 13, hz: 1.2, yaw: 0 },
    { kind: 'sphere', x: 6, y: 29, z: 0, r: 5 },
  ]),
};

/** Every slot in a category, e.g. for the README and the developer's checklist. */
export function syntySlots(category?: SyntyCategory): SyntyPropId[] {
  return (Object.keys(SYNTY_PROPS) as SyntyPropId[]).filter((id) => !category || SYNTY_PROPS[id].category === category);
}

function slot(name: string, category: SyntyCategory, file: string, heightCm: number, build: () => Model, colliders?: readonly Shape[]): SyntySlot {
  // Room furniture and fittings are background: never on a territory, outside the flying heights.
  const tier: OutlineTier = category === 'obstacle' ? 'structure' : DESK_FILES.has(file) ? 'prop' : 'background';
  return { name, category, licensed: [file], fitHeight: heightCm * CM, build: () => ({ model: build() }), materials: 'keep', tier, colliders };
}

// ---- Placeholders: original low-poly stand-ins, built to the fitted size (world units) -----------

function bookshelf(): Model {
  const m = new Model();
  const [w, h, d] = [80 * CM, 180 * CM, 30 * CM];
  const t = 2 * CM;
  m.part('wood/desk').box([t, h, d], { at: [-w / 2 + t / 2, h / 2, 0] });
  m.part('wood/desk').box([t, h, d], { at: [w / 2 - t / 2, h / 2, 0] });
  m.part('wood/desk').box([w, t, d], { at: [0, h - t / 2, 0] });
  m.part('wood/desk').box([w, h, t], { at: [0, h / 2, -d / 2 + t / 2] });
  const colours: MaterialId[] = ['paper/red', 'paper/blue', 'paper/green', 'paper/yellow', 'paper/white'];
  for (let i = 0; i < 5; i++) {
    const y = i * (h / 5);
    m.part('wood/desk').box([w, t, d], { at: [0, y + t / 2, 0] });
    if (i === 0) continue;
    let x = -w / 2 + t + 1;
    for (let b = 0; x < w / 2 - 6; b++) {
      const bw = 2.4 + ((b * 7 + i * 3) % 4) * 0.8;
      const bh = h / 5 - t - 3 - ((b * 5 + i) % 3) * 2;
      m.part(colours[(b + i) % colours.length]).box([bw, bh, d * 0.7], { at: [x + bw / 2, y + t + bh / 2, 0] });
      x += bw + 0.3;
    }
  }
  return m;
}

function cupboard(): Model {
  const m = new Model();
  const [w, h, d] = [100 * CM, 90 * CM, 45 * CM];
  m.part('wood/desk').box([w, h - 6, d], { at: [0, h / 2 + 3, 0] });
  m.part('cardboard/dark').box([w - 4, 6, d - 4], { at: [0, 3, 0] });
  for (const x of [-w / 4, w / 4]) {
    m.part('paper/white').box([w / 2 - 3, h - 14, 0.6], { at: [x, h / 2 + 3, d / 2 + 0.3] });
    m.part('pencil/metal').box([1.2, 8, 1.2], { at: [x + (x < 0 ? w / 4 - 5 : -w / 4 + 5), h / 2 + 6, d / 2 + 1] });
  }
  return m;
}

function storageTrays(): Model {
  const m = new Model();
  const [w, h, d] = [40 * CM, 75 * CM, 38 * CM];
  m.part('plastic/blue').box([2, h, d], { at: [-w / 2, h / 2, 0] });
  m.part('plastic/blue').box([2, h, d], { at: [w / 2, h / 2, 0] });
  m.part('plastic/blue').box([w + 2, 2, d], { at: [0, h - 1, 0] });
  const trays: MaterialId[] = ['plastic/red', 'plastic/green', 'plastic/clear', 'paper/yellow', 'plastic/red', 'plastic/green'];
  trays.forEach((mat, i) => m.part(mat).box([w - 2, 7, d - 2], { at: [0, 6 + i * 11, 1] }));
  return m;
}

function trashBin(): Model {
  const m = new Model();
  m.part('plastic/blue').cylinder(13 * CM, 40 * CM, { sides: 10, topRadius: 15 * CM });
  m.part('paper/white').cylinder(4, 4, { sides: 6 }, { at: [2, 40 * CM - 2, 1] });
  return m;
}

function radiator(): Model {
  const m = new Model();
  const [w, h, d] = [100 * CM, 60 * CM, 10 * CM];
  for (let x = -w / 2 + 2; x <= w / 2 - 2; x += 4.5) m.part('paper/white').box([3, h - 8, d], { at: [x, h / 2 + 2, 0] });
  m.part('paper/white').box([w, 3, d * 0.6], { at: [0, h - 4, 0] });
  m.part('pencil/metal').box([2, 6, 2], { at: [-w / 2 + 1, 3, 0] });
  m.part('pencil/metal').box([2, 6, 2], { at: [w / 2 - 1, 3, 0] });
  return m;
}

function wallClock(): Model {
  const m = new Model();
  const r = 15 * CM;
  m.part('plastic/red').cylinder(r, 3, { sides: 16 }, { rot: [90, 0, 0], at: [0, r, 0] });
  m.part('paper/white').cylinder(r - 1.5, 0.5, { sides: 16 }, { rot: [90, 0, 0], at: [0, r, 3] });
  m.part('ink/black').box([0.8, r * 0.6, 0.3], { at: [0, r + r * 0.3, 3.4] });
  m.part('ink/black').box([r * 0.45, 0.8, 0.3], { at: [r * 0.22, r, 3.4] });
  return m;
}

function noticeBoard(): Model {
  const m = new Model();
  const [w, h] = [120 * CM, 90 * CM];
  m.part('wood/desk').box([w, h, 2], { at: [0, h / 2, 0] });
  m.part('cardboard/side').box([w - 6, h - 6, 0.5], { at: [0, h / 2, 1.2] });
  const notes: MaterialId[] = ['paper/sticky', 'paper/white', 'paper/pink', 'paper/blue', 'paper/white', 'paper/green'];
  notes.forEach((mat, i) => {
    const x = -w / 2 + 14 + (i % 3) * (w / 3 - 2);
    const y = i < 3 ? h * 0.68 : h * 0.3;
    m.part(mat).box([16 + (i % 2) * 6, 18 - (i % 3) * 3, 0.3], { at: [x, y, 1.6], rot: [0, 0, (i - 2.5) * 3] });
    m.part('plastic/red').box([1.4, 1.4, 1], { at: [x, y + 7, 2] });
  });
  return m;
}

function ceilingLight(): Model {
  const m = new Model();
  const [w, h, d] = [120 * CM, 10 * CM, 20 * CM];
  m.part('paper/white').box([w, h * 0.6, d], { at: [0, h * 0.7, 0] });
  m.part('plastic/clear').box([w - 4, h * 0.4, d - 4], { at: [0, h * 0.2, 0] });
  return m;
}

function plant(): Model {
  const m = new Model();
  m.part('cardboard/edge').cylinder(14 * CM, 26 * CM, { sides: 8, topRadius: 17 * CM });
  m.part('pencil/graphite').cylinder(16 * CM, 1, { sides: 8 }, { at: [0, 26 * CM - 1, 0] });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 360;
    const tall = (44 + (i % 3) * 10) * CM;
    m.part('paper/green').box([9, tall, 1.2], { at: [Math.cos((a * Math.PI) / 180) * 4, 26 * CM + tall / 2 - 4, Math.sin((a * Math.PI) / 180) * 4], rot: [((i % 2) * 2 - 1) * 12, a, 0] });
  }
  return m;
}

function boxes(): Model {
  const m = new Model();
  m.part('cardboard/side').box([40 * CM, 30 * CM, 32 * CM], { at: [-8, 12, 0] });
  m.part('cardboard/side').box([34 * CM, 25 * CM, 30 * CM], { at: [9, 10, 2], rot: [0, 8, 0] });
  m.part('cardboard/edge').box([30 * CM, 24 * CM, 28 * CM], { at: [-4, 24 * CM + 10 + 4.8, 0], rot: [0, -12, 0] });
  m.part('tape/masking').box([4, 0.4, 32 * CM + 0.2], { at: [-8, 24.2, 0] });
  return m;
}

function stapler(): Model {
  const m = new Model();
  m.part('plastic/red').box([12, 2.2, 3], { at: [0, 3.4, 0], rot: [0, 0, -3] });
  m.part('pencil/metal').box([12.5, 1.4, 3.2], { at: [0, 0.7, 0] });
  m.part('ink/black').box([2.5, 3, 3], { at: [-5, 2.2, 0] });
  return m;
}

function scissors(): Model {
  const m = new Model();
  m.part('pencil/metal').box([10, 0.4, 1.2], { at: [3, 0.2, 0.4], rot: [0, 8, 0] });
  m.part('pencil/metal').box([10, 0.4, 1.2], { at: [3, 0.6, -0.4], rot: [0, -8, 0] });
  m.part('plastic/blue').cylinder(1.8, 1.2, { sides: 8 }, { at: [-4, 0, 1.6] });
  m.part('plastic/blue').cylinder(1.8, 1.2, { sides: 8 }, { at: [-4, 0, -1.6] });
  return m;
}

function glueStick(): Model {
  const m = new Model();
  m.part('paper/white').cylinder(1.4, 7, { sides: 8 });
  m.part('plastic/red').cylinder(1.5, 3, { sides: 8 }, { at: [0, 7, 0] });
  return m;
}

function calculator(): Model {
  const m = new Model();
  m.part('pencil/graphite').box([7, 1.2, 12], { at: [0, 0.6, 0] });
  m.part('plastic/clear').box([5.6, 0.2, 2.6], { at: [0, 1.3, -3.8] });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m.part('paper/white').box([1.1, 0.4, 1.1], { at: [-2.3 + c * 1.55, 1.35, -0.6 + r * 1.55] });
  return m;
}

function paintPots(): Model {
  const m = new Model();
  const pots: MaterialId[] = ['plastic/red', 'paper/yellow', 'plastic/blue', 'plastic/green'];
  pots.forEach((mat, i) => {
    m.part('plastic/clear').cylinder(1.6, 3.2, { sides: 8 }, { at: [(i - 1.5) * 3.6, 0, 0] });
    m.part(mat).cylinder(1.7, 0.8, { sides: 8 }, { at: [(i - 1.5) * 3.6, 3.2, 0] });
  });
  return m;
}

function waterBottle(): Model {
  const m = new Model();
  m.part('plastic/clear').cylinder(2.6, 14, { sides: 10 });
  m.part('plastic/clear').cylinder(2.6, 3, { sides: 10, topRadius: 1.2 }, { at: [0, 14, 0] });
  m.part('plastic/blue').cylinder(1.3, 2.2, { sides: 10 }, { at: [0, 17, 0] });
  m.part('paper/blue').cylinder(2.65, 5, { sides: 10, capBottom: false }, { at: [0, 5, 0] });
  return m;
}

function lunchbox(): Model {
  const m = new Model();
  m.part('plastic/green').box([17.6, 5.4, 12], { at: [0, 2.7, 0] });
  m.part('plastic/clear').box([18, 1.4, 12.4], { at: [0, 6.1, 0] });
  m.part('plastic/blue').box([2, 1.6, 12.6], { at: [-5, 5.4, 0] });
  m.part('plastic/blue').box([2, 1.6, 12.6], { at: [5, 5.4, 0] });
  return m;
}

function deskLamp(): Model {
  const m = new Model();
  m.part('ink/black').cylinder(6, 2, { sides: 12 });
  m.part('pencil/metal').cylinder(0.8, 26, { sides: 6 }, { at: [0, 2, 0], rot: [0, 0, -8] });
  m.part('pencil/metal').cylinder(0.7, 10, { sides: 6 }, { at: [-1.4, 27, 0], rot: [0, 0, -70] });
  m.part('ink/black').cylinder(5, 7, { sides: 10, topRadius: 1.5, capBottom: false }, { at: [7, 24, 0], rot: [0, 0, 30] });
  return m;
}

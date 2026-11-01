import * as pc from 'playcanvas';
import { CATALOG, type ModelStore } from '../assets/CustomModels';
import { WORLD } from '../config';

/**
 * The classroom around the territories (v0.0.11): the Environment Lab's room, 7.2 × 8.2 m with
 * 16 student desks in a 4 × 4 grid, their chairs and backpacks, the blackboard wall, three
 * windows, the door and the teacher's desk. Each territory is the sheet of paper on one desk.
 *
 * The lab works at 1 cm = 0.6 units, where a desk top is 39 × 30. The game's territories are
 * 40 × 40, so the whole room is scaled by 4/3: a desk top becomes 52 × 40 and holds a territory
 * with room to spare at the sides, and desk centres land 128 apart, the grid's spacing
 * (WORLD.territorySize + WORLD.gap). Lab coordinates map to the world centred on the desk grid,
 * with desk tops just under the territories' sheets.
 */

const LAYOUT = CATALOG.classroom.layout;

/** Lab units → world units. */
export const CLASSROOM_SCALE = WORLD.territorySize / LAYOUT.desk.d;

/** The middle of the desk grid in lab units (the world's origin). */
const GRID_CENTRE = {
  x: LAYOUT.desks.reduce((s, d) => s + d.position[0], 0) / LAYOUT.desks.length,
  z: LAYOUT.desks.reduce((s, d) => s + d.position[2], 0) / LAYOUT.desks.length,
};

/** Height of the classroom floor: desk tops sit just under the territories' sheets (y = −thickness). */
export const FLOOR_Y = -WORLD.thickness - LAYOUT.deskTop * CLASSROOM_SCALE;

/** A lab position (floor level) in the world. */
export function labToWorld(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: (x - GRID_CENTRE.x) * CLASSROOM_SCALE, y: FLOOR_Y + y * CLASSROOM_SCALE, z: (z - GRID_CENTRE.z) * CLASSROOM_SCALE };
}

/** The room's inside walls in world space: x from −halfX to halfX, z from minZ to maxZ, and the ceiling. */
export const ROOM = (() => {
  const [w, d] = LAYOUT.floor;
  const a = labToWorld(-w / 2, LAYOUT.wallHeight, -d / 2);
  const b = labToWorld(w / 2, 0, d / 2);
  return { halfX: b.x, minZ: a.z, maxZ: b.z, floor: FLOOR_Y, ceiling: a.y };
})();

/** Where each desk stands (world, floor level), in the same order as the territories T1…T16. */
export function deskPositions(): Array<{ x: number; z: number }> {
  return LAYOUT.desks.map((d) => {
    const p = labToWorld(d.position[0], 0, d.position[2]);
    return { x: p.x, z: p.z };
  });
}

/** Every file the classroom uses, for preloading. */
export function classroomFiles(): string[] {
  return Object.values(CATALOG.classroom.parts).map((p) => p.file);
}

/**
 * Places the classroom from its loaded models (the room is scenery: nothing in it is outlined or
 * collides; the airspace boundary keeps planes inside the walls). Returns the room's root entity,
 * or null if the models aren't available.
 */
export function buildClassroom(app: pc.AppBase, store: ModelStore): pc.Entity | null {
  const parts = CATALOG.classroom.parts;
  const [room, floor, desk, seats] = [parts.room, parts.floor, parts.desk, parts.seats].map((p) => store.ready(p.file));
  if (!room && !desk) return null;

  const root = new pc.Entity('classroom');
  const origin = labToWorld(0, 0, 0);
  root.setPosition(origin.x, origin.y, origin.z);
  root.setLocalScale(CLASSROOM_SCALE, CLASSROOM_SCALE, CLASSROOM_SCALE);
  // glTF's +Z is the room's back; the lab's coordinates are kept as they are.
  const add = (file: string, name: string, shadows: boolean) => {
    const e = store.instance(file);
    if (!e) return null;
    e.name = name;
    for (const r of e.findComponents('render') as pc.RenderComponent[]) {
      r.castShadows = shadows;
      r.receiveShadows = true;
    }
    root.addChild(e);
    return e;
  };
  if (floor) add(parts.floor.file, 'floor', false);
  // Walls don't throw the sun's shadows into the room (it shines in through the open ceiling).
  if (room) add(parts.room.file, 'walls', false);
  if (seats) add(parts.seats.file, 'chairs', true);
  if (desk) {
    for (const d of LAYOUT.desks) {
      const e = add(parts.desk.file, d.id, true);
      e?.setLocalPosition(d.position[0], d.position[1], d.position[2]);
      e?.setLocalEulerAngles(0, (d.rotationY * 180) / Math.PI, 0);
    }
  }
  root.addChild(ceiling());
  app.root.addChild(root);
  return root;
}

/** A plain ceiling (the lab leaves the room open), so looking up shows the room, not sky. */
function ceiling(): pc.Entity {
  const [w, d] = LAYOUT.floor;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0.93, 0.92, 0.88);
  m.emissive = new pc.Color(0.35, 0.35, 0.33);
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.1;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  const e = new pc.Entity('ceiling');
  e.addComponent('render', { type: 'box', material: m, castShadows: false, receiveShadows: false });
  e.setLocalPosition(0, LAYOUT.wallHeight + 1, 0);
  e.setLocalScale(w + 16, 2, d + 16);
  return e;
}

import * as pc from 'playcanvas';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { PropId } from '../assets/manifest';
import { Model } from './props/Model';
import { FLOOR_Y, ROOM } from './Classroom';

/**
 * The classroom backdrop (v0.0.11 section 4C): furniture along the walls, radiators under the
 * windows, clocks, notice boards and ceiling lights, from the licensed-model slots (Synty) or their
 * placeholders. It is scenery below the desk tops or high on the walls, outside the airspace's
 * flying heights, so it carries no colliders. Built placeholders are merged into one mesh per
 * material; imported models are placed as they are (the static batcher merges them later).
 */

export interface BackdropPlacement {
  prop: PropId;
  /** World position: x, z on the floor (or the wall), y above the floor. */
  x: number;
  y?: number;
  z: number;
  /** Degrees about the vertical; 0 faces +z (into the room from the front wall). */
  yaw: number;
}

/** Where everything goes, from the room's walls (the door is on +x near the front, the windows on −x). */
export function backdropLayout(): BackdropPlacement[] {
  const { halfX, minZ, maxZ, ceiling } = ROOM;
  const floor = FLOOR_Y;
  const rightWall = halfX - 1;
  const leftWall = -halfX + 1;
  const height = ceiling - floor;
  return [
    // Right wall, behind the door: shelves, a cupboard, trays and boxes, facing into the room.
    { prop: 'room.bookshelf', x: rightWall - 12, z: -180, yaw: -90 },
    { prop: 'room.cupboard', x: rightWall - 18, z: -70, yaw: -90 },
    { prop: 'room.bookshelf', x: rightWall - 12, z: 40, yaw: -90 },
    { prop: 'room.storageTrays', x: rightWall - 16, z: 140, yaw: -90 },
    { prop: 'room.boxes', x: rightWall - 16, z: 235, yaw: -80 },
    // Window wall: a radiator under each window.
    { prop: 'room.radiator', x: leftWall + 4, z: -230, yaw: 90 },
    { prop: 'room.radiator', x: leftWall + 4, z: -45, yaw: 90 },
    { prop: 'room.radiator', x: leftWall + 4, z: 140, yaw: 90 },
    // Front: a clock above the blackboard, a plant in the corner by the windows, a bin by the teacher's desk.
    { prop: 'room.wallClock', x: 0, y: height * 0.72, z: minZ + 1, yaw: 0 },
    { prop: 'room.plant', x: -halfX + 22, z: minZ + 24, yaw: 20 },
    { prop: 'room.trashBin', x: -112, z: minZ + 80, yaw: 0 },
    // Back wall: notice boards above the backpacks.
    { prop: 'room.noticeBoard', x: -120, y: height * 0.5, z: maxZ - 1, yaw: 180 },
    { prop: 'room.noticeBoard', x: 120, y: height * 0.5, z: maxZ - 1, yaw: 180 },
    { prop: 'room.wallClock', x: 0, y: height * 0.72, z: maxZ - 1, yaw: 180 },
    // Ceiling lights in two rows.
    ...[-150, 0, 150].flatMap((z) => [-110, 110].map((x) => ({ prop: 'room.ceilingLight' as PropId, x, y: height - 10, z, yaw: 90 }))),
  ];
}

/** Places the backdrop and returns its root entity ('backdrop'). */
export function buildBackdrop(app: pc.AppBase, assets: AssetLibrary): pc.Entity {
  const root = new pc.Entity('backdrop');
  const built = new Model();
  for (const p of backdropLayout()) {
    const y = FLOOR_Y + (p.y ?? 0);
    const made = assets.instance(p.prop);
    if (made.kind === 'built') {
      built.add(made.build.model, { at: [p.x, y, p.z], rot: [0, p.yaw, 0] });
    } else {
      made.entity.setLocalPosition(p.x, y, p.z);
      made.entity.setLocalEulerAngles(0, p.yaw, 0);
      root.addChild(made.entity);
    }
  }
  if (!built.isEmpty) root.addChild(built.toEntity(app.graphicsDevice, 'backdrop-placeholders'));
  app.root.addChild(root);
  return root;
}

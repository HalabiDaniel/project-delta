import * as pc from 'playcanvas';
import { PALETTE, THREAT, WORLD, type ThreatLevel } from '../config';
import { yawFromDirection } from '../aircraft/PlaneController';
import { Territory } from './Territory';
import { setUpLighting } from '../render/lighting';
import { outline } from '../render/outline/OutlineRenderer';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Dressing } from './territories/Dressing';
import { HOME_DESK, type Detail } from './territories/themes';

export interface World {
  territories: Territory[];
  home: Territory;
  /** Platform entities by territory id, so mission markers can tint objective territories. */
  platforms: Map<string, pc.Entity>;
  /** Where planes are folded and launched from: the start of the runway on the home platform. */
  launchPosition: pc.Vec3;
  /** Launch heading: along the runway, towards the centre of the world. */
  launchYaw: number;
  /** The sun, for the graphics settings' shadows. */
  sun: pc.Entity;
  /** T1 dressed as Home Desk: surface, runway, landmark and props, with their collision shapes. */
  homeDressing: Dressing;
}

/**
 * Lays out gridSize × gridSize square territories, numbered T1… row by row, separated by empty
 * gaps and centred on the origin. T1 belongs to the player; the others get their threat level from
 * `threats` (unlisted ones are unprotected). Mission targets are chosen per mission.
 */
export function generateTerritories(
  gridSize: number = WORLD.gridSize,
  size: number = WORLD.territorySize,
  gap: number = WORLD.gap,
  threats: Readonly<Record<string, ThreatLevel>> = THREAT.map,
): Territory[] {
  const spacing = size + gap;
  const offset = (gridSize - 1) / 2;
  const territories: Territory[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const id = `T${row * gridSize + col + 1}`;
      const home = id === WORLD.homeId;
      territories.push(
        new Territory(id, (col - offset) * spacing, (row - offset) * spacing, size, home ? 'player' : null, WORLD.thickness, home ? 0 : (threats[id] ?? 0)),
      );
    }
  }
  return territories;
}

/**
 * Creates the territories, lighting and fog. T1 is dressed as Home Desk (the art direction's
 * vertical slice: notebook surface, runway, landmark and props); the others are still plain
 * platforms, outlined, until their themes arrive.
 */
export function buildWorld(app: pc.AppBase, assets: AssetLibrary, detail: Detail): World {
  const territories = generateTerritories();
  const home = territories.find((t) => t.isHome)!;

  const sun = setUpLighting(app);

  const platforms = new Map<string, pc.Entity>();
  for (const territory of territories) {
    const platform = box(`territory-${territory.id}`, flatMaterial(territory.isHome ? PALETTE.home : PALETTE.neutral));
    platform.setPosition(territory.x, territory.top - territory.thickness / 2, territory.z);
    platform.setLocalScale(territory.size, territory.thickness, territory.size);
    app.root.addChild(platform);
    platforms.set(territory.id, platform);
    // Home's look comes from its dressing; the box stays for code that looks platforms up.
    if (territory.isHome) platform.render!.enabled = false;
    else outline(platform, 'structure');
  }

  // The runway runs through the centre of the home platform, pointing at the centre of the world.
  const dx = -home.x;
  const dz = -home.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  const launchYaw = yawFromDirection(dir.x, dir.z);
  const startOffset = WORLD.runwayLength / 2 - 6;
  const launchPosition = new pc.Vec3(home.x - dir.x * startOffset, 0, home.z - dir.z * startOffset);
  const homeDressing = new Dressing(app, home, HOME_DESK, assets, detail, dir, true);

  return { territories, home, platforms, launchPosition, launchYaw, sun, homeDressing: homeDressing };
}

export function box(name: string, material: pc.Material): pc.Entity {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: true });
  return entity;
}

export function flatMaterial(color: readonly [number, number, number]): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(color[0], color[1], color[2]);
  material.useMetalness = true;
  material.metalness = 0;
  material.gloss = 0.1;
  material.update();
  return material;
}

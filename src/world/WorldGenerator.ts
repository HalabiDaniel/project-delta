import * as pc from 'playcanvas';
import { PALETTE, WORLD } from '../config';
import { yawFromDirection } from '../aircraft/PlaneController';
import type { Territory } from './Territory';
import { generateTerritories, homeHeading } from './Grid';
import { setUpLighting } from '../render/lighting';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Dressing } from './territories/Dressing';
import { HOME_DESK, type Detail } from './territories/themes';
import { buildClassroom } from './Classroom';

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

export { generateTerritories } from './Grid';

/**
 * Creates the territories, lighting and fog. T1 is dressed as Home Desk (the art direction's
 * vertical slice: notebook surface, runway, landmark and props); the others are still plain
 * platforms, outlined, until their themes arrive.
 */
export function buildWorld(app: pc.AppBase, assets: AssetLibrary, detail: Detail): World {
  const territories = generateTerritories();
  const home = territories.find((t) => t.isHome)!;

  const sun = setUpLighting(app);
  buildClassroom(app, assets.models);

  const platforms = new Map<string, pc.Entity>();
  for (const territory of territories) {
    const platform = box(`territory-${territory.id}`, flatMaterial(territory.isHome ? PALETTE.home : PALETTE.neutral));
    platform.setPosition(territory.x, territory.top - territory.thickness / 2, territory.z);
    platform.setLocalScale(territory.size, territory.thickness, territory.size);
    app.root.addChild(platform);
    platforms.set(territory.id, platform);
    // Home's look comes from its dressing; the box stays for code that looks platforms up.
    if (territory.isHome) platform.render!.enabled = false;
  }

  // The runway runs through the centre of the home platform, pointing at the centre of the world.
  const dir = homeHeading(home);
  const launchYaw = yawFromDirection(dir.x, dir.z);
  const startOffset = WORLD.runwayLength / 2 - 6;
  const launchPosition = new pc.Vec3(home.x - dir.x * startOffset, 0, home.z - dir.z * startOffset);
  const homeDressing = new Dressing(app, home, HOME_DESK, assets, detail, dir, true);

  return { territories, home, platforms, launchPosition, launchYaw, sun, homeDressing: homeDressing };
}

/** The multiplayer classroom's scene: every territory as a plain platform, and the light. */
export interface SharedScene {
  platforms: Map<string, pc.Entity>;
  sun: pc.Entity;
}

/**
 * Builds the platforms and lighting for the shared world. Nobody's home is dressed yet: the
 * multiplayer game dresses each territory as a desk when a player claims it.
 */
export function buildSharedScene(app: pc.AppBase, territories: readonly Territory[], assets?: AssetLibrary): SharedScene {
  const sun = setUpLighting(app);
  if (assets) buildClassroom(app, assets.models);
  const platforms = new Map<string, pc.Entity>();
  for (const territory of territories) {
    const platform = box(`territory-${territory.id}`, flatMaterial(PALETTE.neutral));
    platform.setPosition(territory.x, territory.top - territory.thickness / 2, territory.z);
    platform.setLocalScale(territory.size, territory.thickness, territory.size);
    app.root.addChild(platform);
    platforms.set(territory.id, platform);
  }
  return { platforms, sun };
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

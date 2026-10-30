import * as pc from 'playcanvas';
import { PALETTE, THREAT, WORLD, type ThreatLevel } from '../config';
import { yawFromDirection } from '../aircraft/PlaneController';
import { Territory } from './Territory';

export interface World {
  territories: Territory[];
  home: Territory;
  /** Platform entities by territory id, so mission markers can tint objective territories. */
  platforms: Map<string, pc.Entity>;
  /** Where planes are folded and launched from: the start of the runway on the home platform. */
  launchPosition: pc.Vec3;
  /** Launch heading: along the runway, towards the centre of the world. */
  launchYaw: number;
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

/** Creates the territories, the runway and launch pad, lighting and fog. */
export function buildWorld(app: pc.AppBase): World {
  const territories = generateTerritories();
  const home = territories.find((t) => t.isHome)!;

  setUpLighting(app);

  const platforms = new Map<string, pc.Entity>();
  for (const territory of territories) {
    const platform = box(`territory-${territory.id}`, flatMaterial(territory.isHome ? PALETTE.home : PALETTE.neutral));
    platform.setPosition(territory.x, territory.top - territory.thickness / 2, territory.z);
    platform.setLocalScale(territory.size, territory.thickness, territory.size);
    app.root.addChild(platform);
    platforms.set(territory.id, platform);
  }

  // The runway runs through the centre of the home platform, pointing at the centre of the world.
  const dx = -home.x;
  const dz = -home.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  const launchYaw = yawFromDirection(dir.x, dir.z);
  const startOffset = WORLD.runwayLength / 2 - 6;
  const launchPosition = new pc.Vec3(home.x - dir.x * startOffset, 0, home.z - dir.z * startOffset);
  app.root.addChild(createRunway(home, launchYaw, launchPosition));

  return { territories, home, platforms, launchPosition, launchYaw };
}

function setUpLighting(app: pc.AppBase): void {
  app.scene.ambientLight = new pc.Color(0.5, 0.55, 0.64);

  const fog = app.scene.fog;
  fog.type = pc.FOG_LINEAR;
  fog.color = new pc.Color(...PALETTE.sky);
  fog.start = 220;
  fog.end = 560;

  const sun = new pc.Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.97, 0.9),
    intensity: 1.1,
    castShadows: true,
    shadowDistance: 120,
    shadowResolution: 2048,
    shadowBias: 0.3,
    normalOffsetBias: 0.05,
    shadowType: pc.SHADOW_PCF3_32F,
  });
  // High sun from behind the home → centre approach, so the plane's shadow falls just ahead of it.
  sun.setEulerAngles(25, -135, 0);
  app.root.addChild(sun);
}

/** A painted strip with a dashed centre line, threshold bars and the launch pad at its start. */
function createRunway(home: Territory, yaw: number, launch: pc.Vec3): pc.Entity {
  const root = new pc.Entity('runway');
  root.setPosition(home.x, 0, home.z);
  root.setEulerAngles(0, (yaw * 180) / Math.PI, 0);
  const paint = flatMaterial(PALETTE.launchPad);
  const strip = box('runway-strip', flatMaterial(PALETTE.runway));
  strip.setLocalPosition(0, 0.015, 0);
  strip.setLocalScale(WORLD.runwayWidth, 0.03, WORLD.runwayLength);
  root.addChild(strip);
  // Local -Z is the launch direction.
  for (let z = -WORLD.runwayLength / 2 + 7; z < WORLD.runwayLength / 2 - 6; z += 4) {
    const dash = box('runway-dash', paint);
    dash.setLocalPosition(0, 0.035, z);
    dash.setLocalScale(0.35, 0.02, 2);
    root.addChild(dash);
  }
  for (const end of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const bar = box('runway-threshold', paint);
      bar.setLocalPosition(i * 1.2, 0.035, end * (WORLD.runwayLength / 2 - 1.2));
      bar.setLocalScale(0.6, 0.02, 1.8);
      root.addChild(bar);
    }
  }
  const pad = box('launch-pad', paint);
  pad.setLocalScale(4, 0.02, 6);
  root.addChild(pad);
  pad.setPosition(launch.x, 0.04, launch.z);
  return root;
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

import * as pc from 'playcanvas';
import { PALETTE, WORLD } from '../config';
import type { TargetZone } from '../aircraft/Bomb';
import { yawFromDirection } from '../aircraft/PlaneController';
import { Territory } from './Territory';

export interface World {
  territories: Territory[];
  home: Territory;
  target: Territory;
  /** The bullseye in the centre of the target territory; only this counts as a hit. */
  targetZone: TargetZone;
  /** Where planes are folded and launched from, on the home platform. */
  launchPosition: pc.Vec3;
  /** Launch heading: straight at the target. */
  launchYaw: number;
}

/**
 * Lays out gridSize × gridSize square territories, numbered T1… row by row, separated by empty
 * gaps and centred on the origin. T1 belongs to the player and T5 (the centre) is the target.
 */
export function generateTerritories(
  gridSize: number = WORLD.gridSize,
  size: number = WORLD.territorySize,
  gap: number = WORLD.gap,
): Territory[] {
  const spacing = size + gap;
  const offset = (gridSize - 1) / 2;
  const territories: Territory[] = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const id = `T${row * gridSize + col + 1}`;
      territories.push(
        new Territory(
          id,
          (col - offset) * spacing,
          (row - offset) * spacing,
          size,
          id === WORLD.homeId ? 'player' : null,
          id === WORLD.targetId,
        ),
      );
    }
  }
  return territories;
}

/** Creates the territories, the target marker, the launch pad, lighting and fog. */
export function buildWorld(app: pc.AppBase): World {
  const territories = generateTerritories();
  const home = territories.find((t) => t.isHome)!;
  const target = territories.find((t) => t.isTarget)!;

  setUpLighting(app);

  for (const territory of territories) {
    const color = territory.isHome ? PALETTE.home : territory.isTarget ? PALETTE.target : PALETTE.neutral;
    const platform = box(`territory-${territory.id}`, flatMaterial(color));
    platform.setPosition(territory.x, territory.top - territory.thickness / 2, territory.z);
    platform.setLocalScale(territory.size, territory.thickness, territory.size);
    app.root.addChild(platform);
  }

  const targetZone: TargetZone = {
    x: target.x,
    z: target.z,
    radius: WORLD.targetRadius,
    top: target.top + WORLD.targetHeight,
  };
  app.root.addChild(createBullseye(targetZone));

  // Launch from just behind the centre of the home platform, facing the target.
  const dx = target.x - home.x;
  const dz = target.z - home.z;
  const len = Math.hypot(dx, dz) || 1;
  const launchPosition = new pc.Vec3(home.x - (dx / len) * 6, 0, home.z - (dz / len) * 6);
  const launchYaw = yawFromDirection(dx, dz);

  const pad = box('launch-pad', flatMaterial(PALETTE.launchPad));
  pad.setPosition(launchPosition.x, 0.02, launchPosition.z);
  pad.setLocalScale(4, 0.04, 6);
  pad.setEulerAngles(0, (launchYaw * 180) / Math.PI, 0);
  app.root.addChild(pad);

  return { territories, home, target, targetZone, launchPosition, launchYaw };
}

function setUpLighting(app: pc.AppBase): void {
  app.scene.ambientLight = new pc.Color(0.5, 0.55, 0.64);

  const fog = app.scene.fog;
  fog.type = pc.FOG_LINEAR;
  fog.color = new pc.Color(...PALETTE.sky);
  fog.start = 160;
  fog.end = 480;

  const sun = new pc.Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.97, 0.9),
    intensity: 1.1,
    castShadows: true,
    shadowDistance: 110,
    shadowResolution: 2048,
    shadowBias: 0.3,
    normalOffsetBias: 0.05,
    shadowType: pc.SHADOW_PCF3_32F,
  });
  // High sun from behind the T1 → T5 approach, so the plane's shadow falls just ahead of it.
  sun.setEulerAngles(25, -135, 0);
  app.root.addChild(sun);
}

/** Red-white-red rings in the centre of the target territory. */
function createBullseye(zone: TargetZone): pc.Entity {
  const root = new pc.Entity('target-marker');
  root.setPosition(zone.x, 0, zone.z);
  const red = flatMaterial(PALETTE.bullseyeRed);
  const white = flatMaterial(PALETTE.bullseyeWhite);
  const rings: Array<[number, pc.StandardMaterial]> = [
    [zone.radius, red],
    [zone.radius * 0.68, white],
    [zone.radius * 0.36, red],
  ];
  rings.forEach(([radius, material], i) => {
    const height = zone.top + i * 0.02;
    const ring = new pc.Entity(`ring-${i}`);
    ring.addComponent('render', { type: 'cylinder', material, castShadows: false });
    ring.setLocalPosition(0, height / 2, 0);
    ring.setLocalScale(radius * 2, height, radius * 2);
    root.addChild(ring);
  });
  return root;
}

function box(name: string, material: pc.Material): pc.Entity {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: true });
  return entity;
}

function flatMaterial(color: readonly [number, number, number]): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(color[0], color[1], color[2]);
  material.useMetalness = true;
  material.metalness = 0;
  material.gloss = 0.1;
  material.update();
  return material;
}

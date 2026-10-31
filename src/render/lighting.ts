import * as pc from 'playcanvas';
import { LIGHTING } from './style';

export interface ShadowQuality {
  enabled: boolean;
  resolution: number;
}

/**
 * Soft, colourful light: one warm sun with light, soft-edged shadows (the bluish ambient of
 * PaperShading fills them), a pale sky and a gentle distance haze.
 */
export function setUpLighting(app: pc.AppBase): pc.Entity {
  // The ambient comes from PaperShading's sky and ground colours; the engine's constant ambient is unused.
  app.scene.ambientLight = new pc.Color(0, 0, 0);

  const fog = app.scene.fog;
  fog.type = pc.FOG_LINEAR;
  fog.color = new pc.Color(...LIGHTING.sky);
  fog.start = LIGHTING.fogStart;
  fog.end = LIGHTING.fogEnd;

  const sun = new pc.Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    color: new pc.Color(...LIGHTING.sunColor),
    intensity: LIGHTING.sunIntensity,
    castShadows: true,
    shadowDistance: LIGHTING.shadowDistance,
    shadowResolution: 2048,
    shadowIntensity: LIGHTING.shadowIntensity,
    shadowBias: 0.3,
    normalOffsetBias: 0.05,
    shadowType: pc.SHADOW_PCF3_32F,
  });
  sun.setEulerAngles(LIGHTING.sunAngles[0], LIGHTING.sunAngles[1], LIGHTING.sunAngles[2]);
  app.root.addChild(sun);
  return sun;
}

/** Applies a graphics preset's shadow setting to the sun. */
export function setShadowQuality(sun: pc.Entity, quality: ShadowQuality): void {
  const light = sun.light!;
  light.castShadows = quality.enabled;
  if (quality.enabled) light.shadowResolution = quality.resolution;
}

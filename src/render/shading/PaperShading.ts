import * as pc from 'playcanvas';
import { SHADING, type Rgb } from '../style';
import type { TextureBank } from './textures';

/**
 * The game's lighting model, installed once for every lit material (the engine's own standard
 * materials included, so older code and imported models share it):
 *
 * - **Soft cel ramp.** The sun lights a surface in two or three flat tones with a soft edge between
 *   them, like a coloured illustration, instead of a smooth photographic gradient.
 * - **Sky and ground ambient.** Surfaces facing up pick up a cool sky tint, surfaces facing down a
 *   warm bounce, so shadows are coloured rather than grey.
 * - **Paper grain.** Every lit surface is multiplied by a faint fibre pattern projected in world
 *   space (one sample, along the axis the surface faces most), so a plain colour still reads as
 *   paper and no model needs UVs for it. A material opts
 *   out with the PAPER_NO_GRAIN define (plastic, ink).
 *
 * These replace the engine's `lightDiffuseLambertPS`, `ambientPS` and `diffusePS` chunks.
 */
export class PaperShading {
  private readonly scope: pc.ScopeSpace;

  constructor(device: pc.GraphicsDevice, textures: TextureBank) {
    const chunks = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL);
    chunks.set('lightDiffuseLambertPS', LIGHT_DIFFUSE);
    chunks.set('ambientPS', AMBIENT);
    chunks.set('diffusePS', DIFFUSE);
    this.scope = device.scope;
    this.scope.resolve('paper_grainMap').setValue(textures.grain());
    this.setRamp(SHADING.rampLow, SHADING.rampHigh, SHADING.lambertMix);
    this.setAmbient(SHADING.skyAmbient, SHADING.groundAmbient);
    this.setGrain(SHADING.grainScale, SHADING.grainStrength);
  }

  setRamp(low: number, high: number, lambertMix: number): void {
    this.scope.resolve('paper_ramp').setValue([low, high, lambertMix]);
  }

  setAmbient(sky: Rgb, ground: Rgb): void {
    this.scope.resolve('paper_skyAmbient').setValue(sky.map(toLinear));
    this.scope.resolve('paper_groundAmbient').setValue(ground.map(toLinear));
  }

  setGrain(scale: number, strength: number): void {
    this.scope.resolve('paper_grainParams').setValue([scale, strength]);
  }
}

export function toLinear(c: number): number {
  return Math.pow(c, 2.2);
}

const LIGHT_DIFFUSE = /* glsl */ `
uniform vec3 paper_ramp;
float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
    float ndl = dot(worldNormal, -lightDirNorm);
    float cel = smoothstep(paper_ramp.x, paper_ramp.y, ndl);
    return mix(cel, max(ndl, 0.0), paper_ramp.z);
}
`;

const AMBIENT = /* glsl */ `
uniform vec3 paper_skyAmbient;
uniform vec3 paper_groundAmbient;
void addAmbient(vec3 worldNormal) {
    float up = clamp(worldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    dDiffuseLight += mix(paper_groundAmbient, paper_skyAmbient, up * up * (3.0 - 2.0 * up));
}
`;

const DIFFUSE = /* glsl */ `
uniform vec3 material_diffuse;
#ifdef STD_DIFFUSEDETAIL_TEXTURE
    #include "detailModesPS"
#endif
#ifndef PAPER_NO_GRAIN
    uniform sampler2D paper_grainMap;
    uniform vec2 paper_grainParams;
    float paperGrain() {
        // One sample, projected along the axis the surface faces most: low-poly faces are flat,
        // so blending three projections would cost three times as much for no visible gain.
        vec3 w = abs(dVertexNormalW);
        vec2 uv = (w.x > w.y && w.x > w.z) ? vPositionW.zy : (w.y > w.z ? vPositionW.xz : vPositionW.xy);
        float g = texture2D(paper_grainMap, uv * paper_grainParams.x).r;
        return 1.0 + (g - 0.5) * 2.0 * paper_grainParams.y;
    }
#endif
void getAlbedo() {
    dAlbedo = material_diffuse.rgb;
    #ifdef STD_DIFFUSE_TEXTURE
        vec3 albedoTexture = {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_DIFFUSE_TEXTURE_CHANNEL};
        #ifdef STD_DIFFUSEDETAIL_TEXTURE
            vec3 albedoDetail = {STD_DIFFUSEDETAIL_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSEDETAIL_TEXTURE_NAME}, {STD_DIFFUSEDETAIL_TEXTURE_UV}, {STD_TEXTURE_BIAS})).{STD_DIFFUSEDETAIL_TEXTURE_CHANNEL};
            albedoTexture = detailMode_{STD_DIFFUSEDETAIL_DETAILMODE}(albedoTexture, albedoDetail);
        #endif
        dAlbedo *= albedoTexture;
    #endif
    #ifdef STD_DIFFUSE_VERTEX
        dAlbedo *= saturate(vVertexColor.{STD_DIFFUSE_VERTEX_CHANNEL});
    #endif
    #ifndef PAPER_NO_GRAIN
        dAlbedo *= paperGrain();
    #endif
}
`;

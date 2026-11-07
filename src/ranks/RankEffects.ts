import * as pc from 'playcanvas';
import { Ribbon } from '../aircraft/FlightTrails';
import { trailFor, type EffectId } from './Ranks';

/**
 * v0.0.17: the plane effects ranks unlock, drawn by each client from the few bytes in the player's
 * state (no bandwidth in flight). Purely cosmetic and kept out of the way: a trail behind boosts
 * from the tail only, and an aura that is a faint shimmer around the plane, never a change of its
 * silhouette or its friend-or-foe colours. Whatever hides a plane (stealth, from v0.0.18) hides
 * these too: they are drawn only while the plane itself is.
 */

export type TrailKind = 'pencil' | 'ink' | 'feather' | 'sparkle';
export type AuraKind = 'aura' | 'gold-leaf';

/** Trail colours (sRGB 0–1), width and lifetime: graphite, blue-black ink, paper white, gold. */
const TRAIL_LOOK: Record<TrailKind, { colour: [number, number, number]; width: number; life: number }> = {
  pencil: { colour: [0.33, 0.33, 0.36], width: 0.12, life: 1.2 },
  ink: { colour: [0.12, 0.16, 0.38], width: 0.22, life: 1.0 },
  feather: { colour: [0.97, 0.95, 0.9], width: 0.34, life: 0.9 },
  sparkle: { colour: [0.98, 0.82, 0.35], width: 0.2, life: 1.4 },
};

/** Which trail and which aura a set of active effects shows (the best of each). */
export function lookFor(effects: readonly EffectId[]): { trail: TrailKind | null; aura: AuraKind | null } {
  const trail = trailFor(effects);
  const aura: AuraKind | null = effects.includes('gold-leaf') ? 'gold-leaf' : effects.includes('aura') ? 'aura' : null;
  return { trail, aura };
}

let auraMaterial: pc.StandardMaterial | null = null;

function auraMat(): pc.StandardMaterial {
  if (auraMaterial) return auraMaterial;
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 0.86, 0.45);
  m.blendType = pc.BLEND_ADDITIVE;
  m.opacity = 0.09;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_FRONT;
  m.update();
  auraMaterial = m;
  return m;
}

/** One plane's rank effects: a tail trail and an aura, made on first use. */
export class RankLook {
  private trail: Ribbon | null = null;
  private trailKind: TrailKind | null = null;
  private aura: pc.Entity | null = null;
  private phase = Math.random() * 10;

  constructor(
    private readonly app: pc.AppBase,
    private readonly material: pc.Material,
  ) {}

  /**
   * Draws the effects for this frame. `tail`: the plane's tail in world space, or null when no trail
   * is drawn now (not boosting, not visible, effects off). `parent`: the plane's entity (the aura
   * follows it), `span`: its size.
   */
  update(dt: number, kind: TrailKind | null, tail: pc.Vec3 | null, side: pc.Vec3, aura: AuraKind | null, parent: pc.Entity | null, span: number): void {
    if (kind !== this.trailKind) {
      this.trail?.entity.destroy();
      this.trail = kind ? new Ribbon(this.app, this.material, TRAIL_LOOK[kind].colour, TRAIL_LOOK[kind].life, TRAIL_LOOK[kind].width) : null;
      this.trailKind = kind;
    }
    this.trail?.update(dt, tail, side, kind === 'sparkle' ? 0.8 + 0.2 * Math.sin((this.phase += dt * 9)) : 1);
    if (aura && parent) {
      if (!this.aura) {
        this.aura = new pc.Entity('rank-aura');
        this.aura.addComponent('render', { type: 'sphere', material: auraMat(), castShadows: false, receiveShadows: false });
      }
      if (this.aura.parent !== parent) {
        this.aura.parent?.removeChild(this.aura);
        parent.addChild(this.aura);
      }
      // A slow shimmer; gold leaf breathes a little brighter and wider.
      this.phase += dt;
      const pulse = 1 + 0.06 * Math.sin(this.phase * (aura === 'gold-leaf' ? 3.2 : 2));
      const s = span * (aura === 'gold-leaf' ? 1.25 : 1.1) * pulse;
      this.aura.setLocalScale(s, s * 0.45, s);
      this.aura.enabled = true;
    } else if (this.aura) {
      this.aura.enabled = false;
    }
  }

  clear(): void {
    this.trail?.clear();
    if (this.aura) this.aura.enabled = false;
  }

  dispose(): void {
    this.trail?.entity.destroy();
    this.aura?.destroy();
    this.trail = null;
    this.aura = null;
  }
}

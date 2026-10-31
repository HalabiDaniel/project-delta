import * as pc from 'playcanvas';
import { Ribbon, trailMaterial } from '../aircraft/FlightTrails';
import { FoldablePlane, inkBlotMaterial, planeMaterials, type PlaneMaterials } from '../aircraft/PlaneModel';
import { PLANE_SHAPES } from '../aircraft/PlaneShapes';
import type { FlightModel } from '../aircraft/FlightModel';
import { DAMAGE, PALETTE, type AircraftId, type Side } from '../config';

/**
 * Anything drawn as a paper plane flying by: an AI aircraft, or (multiplayer) another player's
 * plane posed from the network. AiAircraft fits as it is.
 */
export interface ShownAircraft {
  readonly id: string;
  readonly alive: boolean;
  readonly side: Side;
  readonly spec: { readonly id: AircraftId };
  readonly durability: { readonly fraction: number };
  readonly model: FlightModel;
}

/** Paper and trim colours for a side the defaults don't cover (multiplayer players). */
export type Paint = (side: Side) => { paper: readonly [number, number, number]; accent: readonly [number, number, number] } | null;

const RAD_TO_DEG = 180 / Math.PI;

interface View {
  aircraft: ShownAircraft;
  model: FoldablePlane;
  left: Ribbon;
  right: Ribbon;
  smudge: Ribbon;
  shownHealth: number;
}

/**
 * Draws the AI aircraft: the same folded-paper models as the player's planes, in grey newsprint
 * with red trim for the enemy and home blue for friends, crumpling and staining as they take
 * damage, with wingtip streamers and an ink smudge once badly hurt. It follows the air traffic's
 * list each frame; a destroyed plane's wreck is the game's to draw (Effects.wreck).
 */
export class AircraftModels {
  private readonly views = new Map<string, View>();
  private readonly materials = new Map<string, PlaneMaterials>();
  private readonly blots = inkBlotMaterial();
  private readonly trail = trailMaterial();
  private readonly rotation = new pc.Quat();
  private readonly qYaw = new pc.Quat();
  private readonly qPitch = new pc.Quat();
  private readonly qRoll = new pc.Quat();
  private readonly tipL = { x: 0, y: 0, z: 0 };
  private readonly tipR = { x: 0, y: 0, z: 0 };
  private readonly tail = { x: 0, y: 0, z: 0 };
  private readonly vl = new pc.Vec3();
  private readonly vr = new pc.Vec3();
  private readonly vt = new pc.Vec3();
  private readonly side = new pc.Vec3();
  private readonly flat = new pc.Vec3();
  private readonly fwd = new pc.Vec3();

  constructor(
    private readonly app: pc.AppBase,
    private readonly paint: Paint = () => null,
  ) {
    this.materials.set('enemy', planeMaterials(PALETTE.enemyPaper, PALETTE.enemyAccent));
    this.materials.set('player', planeMaterials(PALETTE.paper, PALETTE.friendlyAccent));
  }

  private materialsFor(side: Side): PlaneMaterials {
    let m = this.materials.get(side);
    if (!m) {
      const p = this.paint(side);
      m = p ? planeMaterials(p.paper, p.accent) : this.materials.get('player')!;
      this.materials.set(side, m);
    }
    return m;
  }

  /** Keeps one model per aircraft in the air, posed as its flight model says. */
  update(dt: number, aircraft: readonly ShownAircraft[]): void {
    const seen = new Set<string>();
    for (const a of aircraft) {
      if (!a.alive) continue;
      seen.add(a.id);
      let v = this.views.get(a.id);
      // The same id flown by another aircraft now (a player's next plane): a fresh model.
      if (v && v.aircraft !== a) {
        this.dispose(v);
        this.views.delete(a.id);
        v = undefined;
      }
      if (!v) {
        v = this.create(a);
        this.views.set(a.id, v);
      }
      this.pose(dt, v);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.dispose(v);
      this.views.delete(id);
    }
  }

  /** Everything gone at once (no wrecks). */
  clear(): void {
    for (const v of this.views.values()) this.dispose(v);
    this.views.clear();
  }

  /** The model drawn for aircraft `id`, if it has one (for name tags and effects). */
  entity(id: string): pc.Entity | null {
    return this.views.get(id)?.model.entity ?? null;
  }

  private create(a: ShownAircraft): View {
    const model = new FoldablePlane(this.app.graphicsDevice, PLANE_SHAPES[a.spec.id], this.materialsFor(a.side), 0, this.blots);
    this.app.root.addChild(model.entity);
    return {
      aircraft: a,
      model,
      left: new Ribbon(this.app, this.trail),
      right: new Ribbon(this.app, this.trail),
      smudge: new Ribbon(this.app, this.trail, PALETTE.damageTrail, 1.4, 0.8),
      shownHealth: 1,
    };
  }

  private pose(dt: number, v: View): void {
    const m = v.aircraft.model;
    this.qYaw.setFromAxisAngle(pc.Vec3.UP, m.yaw * RAD_TO_DEG);
    this.qPitch.setFromAxisAngle(pc.Vec3.RIGHT, m.pitch * RAD_TO_DEG);
    this.qRoll.setFromAxisAngle(pc.Vec3.BACK, m.roll * RAD_TO_DEG);
    this.rotation.mul2(this.qYaw, this.qPitch).mul(this.qRoll);
    v.model.entity.setPosition(m.position);
    v.model.entity.setRotation(this.rotation);
    const health = v.aircraft.durability.fraction;
    if (health !== v.shownHealth) {
      v.shownHealth = health;
      v.model.setDamage(health);
    }
    const shape = v.model.shape;
    const s = shape.scale;
    const [wx, wy, wz] = shape.wingtip;
    m.toWorld(wx * s, wy * s, wz * s, this.tipL);
    m.toWorld(-wx * s, wy * s, wz * s, this.tipR);
    this.side.copy(v.model.entity.right);
    v.left.update(dt, this.vl.set(this.tipL.x, this.tipL.y, this.tipL.z), this.side, 0.5);
    v.right.update(dt, this.vr.set(this.tipR.x, this.tipR.y, this.tipR.z), this.side, 0.5);
    const smudge = Math.max(0, Math.min(1, (DAMAGE.trailThreshold - health) / DAMAGE.trailThreshold));
    m.getForward(this.fwd);
    this.flat.set(-this.fwd.z, 0, this.fwd.x).normalize();
    m.toWorld(0, shape.tail[1] * s, shape.tail[2] * s, this.tail);
    v.smudge.update(dt, smudge > 0 ? this.vt.set(this.tail.x, this.tail.y, this.tail.z) : null, this.flat, 0.35 + 1.1 * smudge);
  }

  private dispose(v: View): void {
    v.model.entity.destroy();
    for (const r of [v.left, v.right, v.smudge]) r.entity.destroy();
  }
}

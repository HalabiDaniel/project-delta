import * as pc from 'playcanvas';
import { inkBlotMaterial } from '../aircraft/PlaneModel';
import { createPlaneModel, type PlaneModelView } from '../aircraft/JetModel';
import type { Collider } from '../combat/Collision';
import { Destructible, type TargetSpec } from '../combat/Destructibles';
import { PALETTE } from '../config';
import { flatMaterial } from './WorldGenerator';
import { outline } from '../render/outline/OutlineRenderer';

/** Seconds a target shudders after a hit, and takes to fold back up after respawning. */
const SHUDDER = 0.22;
const REBUILD = 1.2;

interface TargetView {
  target: Destructible;
  root: pc.Entity;
  /** What shudders and leans: the plane on a stand, the crate stack, the board. */
  body: pc.Entity;
  plane: PlaneModelView | null;
  /** Props darken as they take damage. */
  material: pc.StandardMaterial | null;
  shudder: number;
  rebuild: number;
  shownDamage: number;
}

/**
 * The practice targets and cardboard props on the unclaimed territories: their rules (health,
 * respawning) live in Destructible; this draws them and shows the damage. Practice planes crumple
 * and collect ink blots like the player's plane does; props darken and sag.
 */
export class TargetRange {
  readonly targets: Destructible[];
  private readonly views = new Map<string, TargetView>();
  private colliderCache: Collider[] | null = null;
  private solidCache: Collider[] | null = null;

  constructor(app: pc.AppBase, specs: readonly TargetSpec[]) {
    this.targets = specs.map((spec) => new Destructible(spec));
    const blots = inkBlotMaterial();
    const dummyPaint = { paper: PALETTE.dummyPaper, accent: PALETTE.dummyAccent };
    const mat = {
      pencil: flatMaterial(PALETTE.pencil),
      wood: flatMaterial(PALETTE.pencilWood),
      graphite: flatMaterial(PALETTE.graphite),
      tape: flatMaterial(PALETTE.tape),
      red: flatMaterial(PALETTE.bullseyeRed),
      white: flatMaterial(PALETTE.bullseyeWhite),
      leg: flatMaterial(PALETTE.cardboardDark),
    };
    for (const target of this.targets) {
      const s = target.spec;
      const root = new pc.Entity(`target-${s.id}`);
      root.setPosition(s.x, s.kind === 'dummy' ? 0 : s.y, s.z);
      app.root.addChild(root);
      let body: pc.Entity;
      let plane: PlaneModelView | null = null;
      let material: pc.StandardMaterial | null = null;
      if (s.kind === 'dummy') {
        const height = s.y;
        // A pencil standing on its end, point up, holding the paper plane.
        const shaft = height - 1.05;
        root.addChild(part('cylinder', mat.pencil, 0, shaft / 2, 0, 0.32, shaft, 0.32));
        root.addChild(part('cone', mat.wood, 0, shaft + 0.25, 0, 0.32, 0.5, 0.32));
        root.addChild(part('cone', mat.graphite, 0, shaft + 0.58, 0, 0.12, 0.18, 0.12));
        body = new pc.Entity('dummy');
        body.setLocalPosition(0, height, 0);
        body.setEulerAngles(0, (s.yaw * 180) / Math.PI, 0);
        // Practice targets stay simple folded paper planes (one draw call each), not the detailed jets.
        plane = createPlaneModel(app.graphicsDevice, null, s.aircraft!, dummyPaint, { blots });
        body.addChild(plane.entity);
        root.addChild(body);
      } else if (s.kind === 'crates') {
        material = flatMaterial(PALETTE.cardboard);
        body = new pc.Entity('crates');
        body.setEulerAngles(0, (s.yaw * 180) / Math.PI, 0);
        body.addChild(part('box', material, -1.15, 0.75, 0, 2.2, 1.5, 2.4));
        body.addChild(part('box', material, 1.15, 0.75, 0.1, 2.2, 1.5, 2.2));
        const top = part('box', material, -0.3, 2.25, 0, 2, 1.5, 2.2);
        top.setLocalEulerAngles(0, 14, 0);
        body.addChild(top);
        // Packing tape across the lids.
        body.addChild(part('box', mat.tape, -1.15, 1.51, 0, 0.4, 0.02, 2.42));
        body.addChild(part('box', mat.tape, 1.15, 1.51, 0.1, 0.4, 0.02, 2.22));
        const tape = part('box', mat.tape, -0.3, 3.01, 0, 0.4, 0.02, 2.22);
        tape.setLocalEulerAngles(0, 14, 0);
        body.addChild(tape);
        root.addChild(body);
      } else {
        material = flatMaterial(PALETTE.cardboard);
        body = new pc.Entity('board');
        body.setEulerAngles(0, (s.yaw * 180) / Math.PI, 0);
        body.addChild(part('box', mat.leg, -1.4, 0.75, 0.25, 0.25, 1.5, 0.25));
        body.addChild(part('box', mat.leg, 1.4, 0.75, 0.25, 0.25, 1.5, 0.25));
        body.addChild(part('box', material, 0, 2.9, 0, 4, 3.2, 0.24));
        // A painted target on the front (-Z), facing incoming planes.
        [[1.35, mat.red], [0.92, mat.white], [0.5, mat.red]].forEach(([radius, m], i) => {
          const ring = part('cylinder', m as pc.StandardMaterial, 0, 2.9, -0.13 - i * 0.01, (radius as number) * 2, 0.02, (radius as number) * 2);
          ring.setLocalEulerAngles(90, 0, 0);
          body.addChild(ring);
        });
        root.addChild(body);
      }
      // Pencil strokes: the stand (the practice plane outlines itself), or the whole leaning body.
      if (plane) outline(root, 'structure', { merge: true, exclude: [body] });
      else outline(body, 'structure', { merge: true });
      this.views.set(s.id, { target, root, body, plane, material, shudder: 0, rebuild: 0, shownDamage: 0 });
    }
  }

  /** Everything standing that ink rounds and bombs can hit. */
  get colliders(): Collider[] {
    if (!this.colliderCache) this.colliderCache = this.targets.filter((t) => t.alive).map((t) => ({ id: t.id, shapes: t.spec.shapes }));
    return this.colliderCache;
  }

  /** Everything standing that a plane can fly into (tighter than what rounds can hit). */
  get solids(): Collider[] {
    if (!this.solidCache) this.solidCache = this.targets.filter((t) => t.alive).map((t) => ({ id: t.id, shapes: t.spec.solids }));
    return this.solidCache;
  }

  get(id: string): Destructible | undefined {
    return this.views.get(id)?.target;
  }

  /** Damages a target; it shudders, and shows its wear. */
  damage(id: string, amount: number): { dealt: number; destroyed: boolean } {
    const view = this.views.get(id);
    if (!view) return { dealt: 0, destroyed: false };
    const result = view.target.damage(amount);
    if (result.dealt > 0) view.shudder = SHUDDER;
    if (result.destroyed) {
      view.root.enabled = false;
      this.colliderCache = this.solidCache = null;
    }
    return result;
  }

  /** Where a target's label floats. */
  labelPoint(target: Destructible, out: pc.Vec3): pc.Vec3 {
    const s = target.spec;
    return s.kind === 'dummy' ? out.set(s.x, s.y + 2.2, s.z) : out.set(s.x, s.y + (s.kind === 'crates' ? 4 : 5.2), s.z);
  }

  /** Centre of a target, for effects. */
  centre(target: Destructible, out: pc.Vec3): pc.Vec3 {
    const shape = target.spec.shapes[0];
    return out.set(shape.x, shape.y, shape.z);
  }

  /** Respawns targets whose time is up and animates hits and rebuilding. */
  update(dt: number): void {
    for (const view of this.views.values()) {
      if (view.target.update(dt)) this.respawn(view);
      if (!view.target.alive) continue;
      const damage = 1 - view.target.durability.fraction;
      if (damage !== view.shownDamage) {
        view.shownDamage = damage;
        if (view.plane) view.plane.setDamage(1 - damage);
        if (view.material) {
          const c = PALETTE.cardboard;
          const k = 1 - damage * 0.45;
          view.material.diffuse.set(c[0] * k, c[1] * k, c[2] * k * 0.95);
          view.material.update();
        }
      }
      let scale = 1;
      if (view.rebuild > 0) {
        view.rebuild = Math.max(0, view.rebuild - dt);
        const t = 1 - view.rebuild / REBUILD;
        if (view.plane) view.plane.setFold(t);
        else scale = easeOutBack(t);
        view.root.setLocalScale(1, view.plane ? 1 : Math.max(0.01, scale), 1);
      }
      // A hit makes it shudder; heavy damage makes props lean.
      const shake = view.shudder > 0 ? Math.sin(view.shudder * 70) * 6 * (view.shudder / SHUDDER) : 0;
      view.shudder = Math.max(0, view.shudder - dt);
      const lean = view.plane ? 0 : damage * 9;
      const yaw = (view.target.spec.yaw * 180) / Math.PI;
      if (view.plane) view.body.setLocalEulerAngles(shake * 0.6, yaw, shake - damage * 18);
      else view.body.setLocalEulerAngles(lean + shake * 0.4, yaw, shake * 0.3);
    }
  }

  /** Back to full health and on its feet, e.g. between sorties. */
  restoreAll(): void {
    for (const view of this.views.values()) {
      if (!view.target.alive || view.target.health < view.target.spec.maxHealth) {
        const wasDown = !view.target.alive;
        view.target.restore();
        if (wasDown) this.respawn(view);
      }
    }
    this.colliderCache = this.solidCache = null;
  }

  private respawn(view: TargetView): void {
    view.root.enabled = true;
    view.rebuild = REBUILD;
    view.shudder = 0;
    view.shownDamage = -1;
    if (view.plane) view.plane.setFold(0);
    this.colliderCache = this.solidCache = null;
  }
}

function part(type: 'box' | 'cone' | 'cylinder', material: pc.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): pc.Entity {
  const entity = new pc.Entity(type);
  entity.addComponent('render', { type, material, castShadows: true, receiveShadows: true });
  entity.setLocalPosition(x, y, z);
  entity.setLocalScale(sx, sy, sz);
  return entity;
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

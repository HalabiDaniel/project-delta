import * as pc from 'playcanvas';
import { Ribbon, trailMaterial } from '../aircraft/FlightTrails';
import { PALETTE } from '../config';
import type { EnemyFire, EnemyShot } from '../defenses/EnemyFire';

interface Live {
  entity: pc.Entity;
  trail: Ribbon | null;
  seen: boolean;
}

/**
 * Draws the defenses' fire: magenta blobs of ink, and paper rockets (white tube, red nose, fins)
 * trailing a widening ribbon of smoke that lingers after the rocket is gone, so incoming rockets
 * are easy to spot and follow.
 */
export class EnemyFireView {
  private readonly live = new Map<number, Live>();
  private readonly inkPool: pc.Entity[] = [];
  private readonly rocketPool: pc.Entity[] = [];
  private readonly trailPool: Ribbon[] = [];
  /** Trails of rockets that are gone, still fading. */
  private readonly fading: Ribbon[] = [];
  private readonly inkMaterial: pc.StandardMaterial;
  private readonly trailMat = trailMaterial();
  private readonly look = new pc.Vec3();
  private readonly side = new pc.Vec3();
  private readonly toCamera = new pc.Vec3();
  private readonly vel = new pc.Vec3();
  private readonly point = new pc.Vec3();

  constructor(private readonly app: pc.AppBase) {
    this.inkMaterial = new pc.StandardMaterial();
    this.inkMaterial.diffuse = new pc.Color(0, 0, 0);
    this.inkMaterial.emissive = new pc.Color(...PALETTE.enemyInk);
    this.inkMaterial.useLighting = false;
    this.inkMaterial.update();
  }

  /** Follows the simulation: one entity per round or rocket, a smoke trail behind every rocket. */
  update(dt: number, fire: EnemyFire, camera: pc.Vec3): void {
    for (const l of this.live.values()) l.seen = false;
    for (const shot of fire.shots) {
      let l = this.live.get(shot.id);
      if (!l) {
        l = { entity: this.take(shot.kind), trail: shot.kind === 'rocket' ? this.takeTrail() : null, seen: true };
        this.live.set(shot.id, l);
      }
      l.seen = true;
      this.place(l, shot, dt, camera);
    }
    for (const [id, l] of this.live) {
      if (l.seen) continue;
      l.entity.enabled = false;
      (l.trail ? this.rocketPool : this.inkPool).push(l.entity);
      if (l.trail) this.fading.push(l.trail);
      this.live.delete(id);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const trail = this.fading[i];
      trail.update(dt, null, this.side, 1);
      if (trail.empty) {
        this.fading.splice(i, 1);
        this.trailPool.push(trail);
      }
    }
  }

  clear(): void {
    for (const l of this.live.values()) {
      l.entity.enabled = false;
      (l.trail ? this.rocketPool : this.inkPool).push(l.entity);
      if (l.trail) {
        l.trail.clear();
        this.trailPool.push(l.trail);
      }
    }
    this.live.clear();
    for (const t of this.fading) {
      t.clear();
      this.trailPool.push(t);
    }
    this.fading.length = 0;
  }

  private place(l: Live, shot: EnemyShot, dt: number, camera: pc.Vec3): void {
    l.entity.setPosition(shot.x, shot.y, shot.z);
    this.look.set(shot.x + shot.vx, shot.y + shot.vy, shot.z + shot.vz);
    l.entity.lookAt(this.look);
    if (!l.trail) return;
    // The smoke ribbon faces the camera as far as it can, so it never shows edge-on.
    this.vel.set(shot.vx, shot.vy, shot.vz).normalize();
    this.toCamera.set(camera.x - shot.x, camera.y - shot.y, camera.z - shot.z).normalize();
    this.side.cross(this.vel, this.toCamera);
    if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
    this.side.normalize();
    // The smoke comes out of the tail.
    this.point.set(shot.x - this.vel.x * 0.9, shot.y - this.vel.y * 0.9, shot.z - this.vel.z * 0.9);
    l.trail.update(dt, this.point, this.side, 1);
  }

  private take(kind: EnemyShot['kind']): pc.Entity {
    const pool = kind === 'ink' ? this.inkPool : this.rocketPool;
    const entity = pool.pop() ?? (kind === 'ink' ? this.makeInk() : this.makeRocket());
    entity.enabled = true;
    return entity;
  }

  private takeTrail(): Ribbon {
    const trail = this.trailPool.pop() ?? new Ribbon(this.app, this.trailMat, PALETTE.rocketTrail, 1.4, 0.75);
    trail.clear();
    return trail;
  }

  private makeInk(): pc.Entity {
    const e = new pc.Entity('enemy-ink');
    e.addComponent('render', { type: 'sphere', material: this.inkMaterial, castShadows: false, receiveShadows: false });
    e.setLocalScale(0.42, 0.42, 1);
    this.app.root.addChild(e);
    return e;
  }

  /** A paper rocket pointing along -Z: the entity looks along its velocity. */
  private makeRocket(): pc.Entity {
    const root = new pc.Entity('enemy-rocket');
    const paper = flat(PALETTE.rocketPaper);
    const nose = flat(PALETTE.rocketNose);
    const tube = new pc.Entity('tube');
    tube.addComponent('render', { type: 'cylinder', material: paper, castShadows: true });
    tube.setLocalScale(0.4, 1.6, 0.4);
    tube.setLocalEulerAngles(90, 0, 0);
    root.addChild(tube);
    const cone = new pc.Entity('nose');
    cone.addComponent('render', { type: 'cone', material: nose, castShadows: false });
    cone.setLocalScale(0.4, 0.55, 0.4);
    cone.setLocalPosition(0, 0, -1.05);
    cone.setLocalEulerAngles(-90, 0, 0);
    root.addChild(cone);
    for (const [sx, sy] of [[0.8, 0.04], [0.04, 0.8]]) {
      const fin = new pc.Entity('fin');
      fin.addComponent('render', { type: 'box', material: nose, castShadows: false });
      fin.setLocalScale(sx, sy, 0.35);
      fin.setLocalPosition(0, 0, 0.7);
      root.addChild(fin);
    }
    this.app.root.addChild(root);
    return root;
  }
}

function flat(color: readonly [number, number, number]): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(color[0], color[1], color[2]);
  m.emissive = new pc.Color(color[0] * 0.25, color[1] * 0.25, color[2] * 0.25);
  m.update();
  return m;
}

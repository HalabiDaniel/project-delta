import * as pc from 'playcanvas';
import { firstHit, type Collider } from '../combat/Collision';
import { BOMB, PALETTE, WORLD, type BombKind } from '../config';
import type { Point3, TargetZone } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import { buildPaperBallMesh, createPaperMaterial } from './PlaneModel';

/** A target zone that belongs to mission objective `objective`. */
export interface ZoneRef {
  objective: number;
  territoryId: string;
  zone: TargetZone;
}

export type BombImpact =
  | { kind: 'target'; objective: number; territoryId: string; x: number; y: number; z: number }
  | { kind: 'object'; id: string; x: number; y: number; z: number }
  | { kind: 'platform'; territoryId: string; x: number; y: number; z: number }
  | { kind: 'void'; x: number; y: number; z: number };

/**
 * Finds what a falling ball of `radius` hits while moving from `prev` to `next` this step.
 * Top faces are tested by sweeping the step, so fast bombs cannot tunnel through them. Props and
 * practice targets stand above the ground, so they are hit first. Only a ball that comes down on
 * one of the target zones counts as a target hit; landing anywhere else, even on a target
 * territory, is an ordinary platform impact.
 */
export function sweepBomb(
  prev: Point3,
  next: Point3,
  radius: number,
  zones: readonly ZoneRef[],
  territories: readonly Territory[],
  objects: readonly Collider[] = [],
  voidY: number = WORLD.voidY,
): BombImpact | null {
  const struck = firstHit(prev, next, radius, objects);
  if (struck) {
    const t = struck.t;
    return { kind: 'object', id: struck.id, x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t, z: prev.z + (next.z - prev.z) * t };
  }

  const crossing = (surfaceY: number) => {
    if (!(prev.y >= surfaceY && next.y < surfaceY)) return null;
    const t = (prev.y - surfaceY) / (prev.y - next.y);
    return { x: prev.x + (next.x - prev.x) * t, z: prev.z + (next.z - prev.z) * t };
  };

  // Count a hit when the ball's centre comes down within half a ball of the zone's edge.
  for (const { objective, territoryId, zone } of zones) {
    const onTarget = crossing(zone.top + radius);
    if (onTarget && Math.hypot(onTarget.x - zone.x, onTarget.z - zone.z) <= zone.radius + radius * 0.5) {
      return { kind: 'target', objective, territoryId, x: onTarget.x, y: zone.top, z: onTarget.z };
    }
  }

  for (const territory of territories) {
    const onTop = crossing(territory.top + radius);
    if (onTop && territory.containsXZ(onTop.x, onTop.z)) {
      return { kind: 'platform', territoryId: territory.id, x: onTop.x, y: territory.top, z: onTop.z };
    }
    // Clipping a platform's side or edge after falling past its top.
    if (territory.intersectsSphere(next.x, next.y, next.z, radius)) {
      return { kind: 'platform', territoryId: territory.id, x: next.x, y: next.y, z: next.z };
    }
  }

  if (next.y < voidY) return { kind: 'void', x: next.x, y: next.y, z: next.z };
  return null;
}

/** One paper-ball bomb: released from the plane, falls under gravity, reports its impact. */
class Bomb {
  readonly entity: pc.Entity;
  active = false;
  kind: BombKind = 'standard';
  /** Release order, so the camera can follow the newest bomb. */
  serial = 0;
  readonly position = new pc.Vec3();
  readonly velocity = new pc.Vec3();
  private readonly previous = new pc.Vec3();
  private spin = 0;

  constructor(app: pc.AppBase, mesh: pc.Mesh, material: pc.Material) {
    this.entity = new pc.Entity('bomb');
    this.entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: true });
    this.entity.enabled = false;
    app.root.addChild(this.entity);
  }

  get radius(): number {
    return BOMB.kinds[this.kind].radius;
  }

  release(position: pc.Vec3, planeVelocity: pc.Vec3, serial: number, kind: BombKind): void {
    this.active = true;
    this.kind = kind;
    const scale = this.radius / BOMB.kinds.standard.radius;
    this.entity.setLocalScale(scale, scale, scale);
    this.serial = serial;
    this.spin = 0;
    this.position.copy(position);
    this.velocity.copy(planeVelocity);
    this.velocity.y -= BOMB.releaseKick;
    this.entity.enabled = true;
    this.entity.setPosition(this.position);
  }

  update(dt: number, zones: readonly ZoneRef[], territories: readonly Territory[], objects: readonly Collider[]): BombImpact | null {
    if (!this.active) return null;
    this.previous.copy(this.position);
    this.velocity.y -= BOMB.gravity * dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;
    this.spin += dt * 360;
    this.entity.setPosition(this.position);
    this.entity.setEulerAngles(this.spin, this.spin * 0.7, 0);

    const impact = sweepBomb(this.previous, this.position, this.radius, zones, territories, objects);
    if (impact) this.clear();
    return impact;
  }

  clear(): void {
    this.active = false;
    this.entity.enabled = false;
  }
}

/** The bombs currently in the air. Several can fall at once on multi-bomb missions. */
export class Bombs {
  private readonly pool: Bomb[] = [];
  private serial = 0;

  constructor(app: pc.AppBase, size = 4) {
    const mesh = buildPaperBallMesh(app.graphicsDevice, BOMB.kinds.standard.radius);
    const material = createPaperMaterial(new pc.Color(...PALETTE.paperBall));
    for (let i = 0; i < size; i++) this.pool.push(new Bomb(app, mesh, material));
  }

  get anyActive(): boolean {
    return this.pool.some((b) => b.active);
  }

  /** Drops a ball, carrying the plane's velocity plus a small downward kick. */
  release(position: pc.Vec3, planeVelocity: pc.Vec3, kind: BombKind): void {
    const bomb = this.pool.find((b) => !b.active) ?? this.pool.reduce((a, b) => (a.serial < b.serial ? a : b));
    bomb.release(position, planeVelocity, ++this.serial, kind);
  }

  /** Moves every falling bomb; returns each impact with the kind of bomb that made it. */
  update(dt: number, zones: readonly ZoneRef[], territories: readonly Territory[], objects: readonly Collider[]): Array<BombImpact & { bomb: BombKind }> {
    const impacts: Array<BombImpact & { bomb: BombKind }> = [];
    for (const bomb of this.pool) {
      const impact = bomb.update(dt, zones, territories, objects);
      if (impact) impacts.push({ ...impact, bomb: bomb.kind });
    }
    return impacts;
  }

  /** Position of the most recently released bomb still falling, for the camera. */
  newest(): pc.Vec3 | null {
    let newest: Bomb | null = null;
    for (const b of this.pool) if (b.active && (!newest || b.serial > newest.serial)) newest = b;
    return newest?.position ?? null;
  }

  clear(): void {
    for (const b of this.pool) b.clear();
  }
}

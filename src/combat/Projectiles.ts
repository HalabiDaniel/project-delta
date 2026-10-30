import * as pc from 'playcanvas';
import { PALETTE, WEAPONS } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Territory } from '../world/Territory';
import { firstHit, segmentHit, type Collider } from './Collision';

export type ShotImpact =
  | { kind: 'object'; id: string; x: number; y: number; z: number }
  | { kind: 'platform'; territoryId: string; x: number; y: number; z: number };

/**
 * What an ink round moving from `prev` to `next` this step hits first: a prop or practice target,
 * or a platform. The whole step is swept, so fast rounds can't pass through thin things.
 */
export function sweepShot(
  prev: Point3,
  next: Point3,
  radius: number,
  objects: readonly Collider[],
  territories: readonly Territory[],
): ShotImpact | null {
  const object = firstHit(prev, next, radius, objects);
  let platform: { id: string; t: number } | null = null;
  for (const t of territories) {
    const hit = segmentHit(prev, next, radius, t.shape);
    if (hit !== null && (!platform || hit < platform.t)) platform = { id: t.id, t: hit };
  }
  const at = (t: number) => ({ x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t, z: prev.z + (next.z - prev.z) * t });
  if (object && (!platform || object.t <= platform.t)) return { kind: 'object', id: object.id, ...at(object.t) };
  if (platform) return { kind: 'platform', territoryId: platform.id, ...at(platform.t) };
  return null;
}

/** One blob of ink in flight. */
class Shot {
  readonly entity: pc.Entity;
  active = false;
  damage = 0;
  readonly position = new pc.Vec3();
  readonly velocity = new pc.Vec3();
  private readonly previous = new pc.Vec3();
  private readonly ahead = new pc.Vec3();
  private travelled = 0;
  private range = 0;

  constructor(app: pc.AppBase, material: pc.Material) {
    this.entity = new pc.Entity('ink-shot');
    this.entity.addComponent('render', { type: 'sphere', material, castShadows: false, receiveShadows: false });
    this.entity.setLocalScale(0.24, 0.24, 0.8);
    this.entity.enabled = false;
    app.root.addChild(this.entity);
  }

  fire(position: pc.Vec3, velocity: pc.Vec3, damage: number, range: number): void {
    this.active = true;
    this.damage = damage;
    this.range = range;
    this.travelled = 0;
    this.position.copy(position);
    this.velocity.copy(velocity);
    this.entity.enabled = true;
    this.place();
  }

  /** Moves the round; returns what it hit, 'spent' once it has flown its range, or null. */
  update(dt: number, objects: readonly Collider[], territories: readonly Territory[]): ShotImpact | 'spent' | null {
    if (!this.active) return null;
    this.previous.copy(this.position);
    this.position.add(this.ahead.copy(this.velocity).mulScalar(dt));
    this.travelled += this.velocity.length() * dt;
    const impact = sweepShot(this.previous, this.position, WEAPONS.projectileRadius, objects, territories);
    if (impact) {
      this.clear();
      return impact;
    }
    if (this.travelled >= this.range) {
      this.clear();
      return 'spent';
    }
    this.place();
    return null;
  }

  clear(): void {
    this.active = false;
    this.entity.enabled = false;
  }

  private place(): void {
    this.entity.setPosition(this.position);
    this.entity.lookAt(this.ahead.copy(this.position).add(this.velocity));
  }
}

/** The player's ink rounds in flight, pooled. */
export class Projectiles {
  private readonly pool: Shot[] = [];
  private next = 0;

  constructor(app: pc.AppBase, size = 64) {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0, 0, 0);
    material.emissive = new pc.Color(...PALETTE.inkShot);
    material.useLighting = false;
    material.update();
    for (let i = 0; i < size; i++) this.pool.push(new Shot(app, material));
  }

  fire(position: pc.Vec3, velocity: pc.Vec3, damage: number, range: number): void {
    // Reuse the oldest round if every one is in the air.
    const shot = this.pool.find((s) => !s.active) ?? this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    shot.fire(position, velocity, damage, range);
  }

  /** Impacts this step, each with the damage its round carried. */
  update(dt: number, objects: readonly Collider[], territories: readonly Territory[]): Array<ShotImpact & { damage: number }> {
    const impacts: Array<ShotImpact & { damage: number }> = [];
    for (const shot of this.pool) {
      const damage = shot.damage;
      const result = shot.update(dt, objects, territories);
      if (result && result !== 'spent') impacts.push({ ...result, damage });
    }
    return impacts;
  }

  clear(): void {
    for (const s of this.pool) s.clear();
  }
}

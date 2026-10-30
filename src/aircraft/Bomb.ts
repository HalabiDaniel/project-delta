import * as pc from 'playcanvas';
import { BOMB, PALETTE, WORLD } from '../config';
import type { Territory } from '../world/Territory';
import { buildPaperBallMesh, createPaperMaterial } from './FalconModel';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The bullseye on the target territory: a short cylinder standing on the platform. */
export interface TargetZone {
  x: number;
  z: number;
  radius: number;
  /** Height of the bullseye's top face. */
  top: number;
}

export type BombImpact =
  | { kind: 'target'; x: number; y: number; z: number }
  | { kind: 'platform'; territoryId: string; x: number; y: number; z: number }
  | { kind: 'void'; x: number; y: number; z: number };

/**
 * Finds what a falling ball of `radius` hits while moving from `prev` to `next` this step.
 * Top faces are tested by sweeping the step, so fast bombs cannot tunnel through them. Only a
 * ball that comes down on the bullseye itself counts as a target hit; landing anywhere else on
 * the target territory is an ordinary platform impact.
 */
export function sweepBomb(
  prev: Vec3Like,
  next: Vec3Like,
  radius: number,
  target: TargetZone,
  territories: readonly Territory[],
  voidY: number = WORLD.voidY,
): BombImpact | null {
  const crossing = (surfaceY: number) => {
    if (!(prev.y >= surfaceY && next.y < surfaceY)) return null;
    const t = (prev.y - surfaceY) / (prev.y - next.y);
    return { x: prev.x + (next.x - prev.x) * t, z: prev.z + (next.z - prev.z) * t };
  };

  // Count a hit when the ball's centre comes down within half a ball of the bullseye's edge.
  const onTarget = crossing(target.top + radius);
  if (onTarget && Math.hypot(onTarget.x - target.x, onTarget.z - target.z) <= target.radius + radius * 0.5) {
    return { kind: 'target', x: onTarget.x, y: target.top, z: onTarget.z };
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

/** The single paper-ball bomb: released from the plane, falls under gravity, reports its impact. */
export class Bomb {
  readonly entity: pc.Entity;
  active = false;
  readonly position = new pc.Vec3();
  readonly velocity = new pc.Vec3();
  private readonly previous = new pc.Vec3();
  private spin = 0;

  constructor(app: pc.AppBase) {
    this.entity = new pc.Entity('bomb');
    this.entity.addComponent('render', {
      meshInstances: [
        new pc.MeshInstance(
          buildPaperBallMesh(app.graphicsDevice, BOMB.radius),
          createPaperMaterial(new pc.Color(...PALETTE.paperBall)),
        ),
      ],
      castShadows: true,
    });
    this.entity.enabled = false;
    app.root.addChild(this.entity);
  }

  /** Drops the ball, carrying the plane's velocity plus a small downward kick. */
  release(position: pc.Vec3, planeVelocity: pc.Vec3): void {
    this.active = true;
    this.spin = 0;
    this.position.copy(position);
    this.velocity.copy(planeVelocity);
    this.velocity.y -= BOMB.releaseKick;
    this.entity.enabled = true;
    this.entity.setPosition(this.position);
  }

  update(dt: number, target: TargetZone, territories: readonly Territory[]): BombImpact | null {
    if (!this.active) return null;
    this.previous.copy(this.position);
    this.velocity.y -= BOMB.gravity * dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;
    this.spin += dt * 360;
    this.entity.setPosition(this.position);
    this.entity.setEulerAngles(this.spin, this.spin * 0.7, 0);

    const impact = sweepBomb(this.previous, this.position, BOMB.radius, target, territories);
    if (impact) this.clear();
    return impact;
  }

  clear(): void {
    this.active = false;
    this.entity.enabled = false;
  }
}

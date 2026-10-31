import { sweepBomb, type BombImpact, type ZoneRef } from '../../src/aircraft/Bomb';
import type { Strike } from '../../src/ai/AiAircraft';
import { BOMB, type BombKind, type Side } from '../../src/config';
import type { Collider } from '../../src/combat/Collision';
import type { Territory } from '../../src/world/Territory';

/** A paper-ball bomb falling on the server: a player's, or an AI bomber's. */
export interface FallingBomb {
  id: number;
  /** The player who dropped it, or null for an AI bomber's. */
  owner: string | null;
  /** The AI bomber that dropped it, and what it was aimed at. */
  tag: string | null;
  strike: Strike | null;
  side: Side;
  kind: BombKind;
  clean: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export type Landing = BombImpact & { bomb: FallingBomb };

/** Bombs in the air: the same fall and the same sweep as single-player's (Bomb.ts), without the drawing. */
export class FallingBombs {
  bombs: FallingBomb[] = [];
  private nextId = 1;

  /** Released at `at` with the plane's velocity plus the release kick. */
  release(b: Omit<FallingBomb, 'id' | 'vy'> & { vy: number }): FallingBomb {
    const bomb: FallingBomb = { ...b, id: this.nextId++, vy: b.vy - BOMB.releaseKick };
    this.bombs.push(bomb);
    return bomb;
  }

  /** One step. `zones(bomb)`: the target zones that bomb can score on (its owner's open objectives). */
  update(dt: number, zones: (b: FallingBomb) => readonly ZoneRef[], territories: readonly Territory[], objects: readonly Collider[]): Landing[] {
    const landings: Landing[] = [];
    const keep: FallingBomb[] = [];
    for (const b of this.bombs) {
      const prev = { x: b.x, y: b.y, z: b.z };
      b.vy -= BOMB.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      const impact = sweepBomb(prev, b, BOMB.kinds[b.kind].radius, zones(b), territories, objects);
      if (impact) landings.push({ ...impact, bomb: b });
      else keep.push(b);
    }
    this.bombs = keep;
    return landings;
  }

  clear(owner?: string): void {
    this.bombs = owner === undefined ? [] : this.bombs.filter((b) => b.owner !== owner);
  }
}

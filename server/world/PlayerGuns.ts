import { WEAPONS, type Side } from '../../src/config';
import type { Collider, MovingSphere } from '../../src/combat/Collision';
import { aimAssist, sweepShot, type ShotImpact } from '../../src/combat/Projectiles';
import type { Point3 } from '../../src/missions/Mission';
import type { Territory } from '../../src/world/Territory';

/** One ink round from a player's guns, in flight on the server. */
export interface InkRound {
  id: number;
  /** The player who fired it, and their side. */
  owner: string;
  side: Side;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  range: number;
  travelled: number;
  /** Seconds the shooter's view of other aircraft lags the server (their round trip / 2 + interpolation). */
  rewind: number;
}

/** An aircraft a round can hit, with where it was a step ago and how big it is. */
export interface Hittable {
  id: string;
  side: Side;
  radius: number;
}

export type RoundImpact = ShotImpact & { round: InkRound };

/**
 * Every player's ink in flight. Rounds fly exactly like single-player's (Projectiles: the same
 * sweep and aim assistance), but aircraft are tested where the shooter saw them: rewound by the
 * shooter's lag, using the position history. Installations and the ground don't move, so they are
 * tested as they are. A round never hits its own side.
 */
export class PlayerGuns {
  rounds: InkRound[] = [];
  private nextId = 1;
  private readonly a: Point3 = { x: 0, y: 0, z: 0 };
  private readonly b: Point3 = { x: 0, y: 0, z: 0 };

  fire(round: Omit<InkRound, 'id' | 'travelled'>): InkRound {
    const r: InkRound = { ...round, id: this.nextId++, travelled: 0 };
    this.rounds.push(r);
    return r;
  }

  /**
   * Moves every round one step. `aircraft` are everything in the air; `past(id, time, out)` says
   * where one was at `time`. Returns what each round hit (rounds that dry up just vanish).
   */
  update(
    dt: number,
    now: number,
    aircraft: readonly Hittable[],
    past: (id: string, time: number, out: Point3) => boolean,
    objects: readonly Collider[],
    territories: readonly Territory[],
  ): RoundImpact[] {
    const impacts: RoundImpact[] = [];
    const keep: InkRound[] = [];
    for (const r of this.rounds) {
      const prev = { x: r.x, y: r.y, z: r.z };
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.travelled += Math.hypot(r.vx, r.vy, r.vz) * dt;
      const t1 = now - r.rewind;
      const t0 = t1 - dt;
      const movers: MovingSphere[] = [];
      for (const a of aircraft) {
        if (a.side === r.side) continue;
        if (!past(a.id, t1, this.a) || !past(a.id, t0, this.b)) continue;
        movers.push({ id: a.id, x: this.a.x, y: this.a.y, z: this.a.z, px: this.b.x, py: this.b.y, pz: this.b.z, r: a.radius });
      }
      const impact = sweepShot(prev, r, WEAPONS.projectileRadius, objects, territories, movers, aimAssist(r.travelled));
      if (impact) {
        impacts.push({ ...impact, round: r });
        continue;
      }
      if (r.travelled < r.range) keep.push(r);
    }
    this.rounds = keep;
    return impacts;
  }

  clear(owner?: string): void {
    this.rounds = owner === undefined ? [] : this.rounds.filter((r) => r.owner !== owner);
  }
}

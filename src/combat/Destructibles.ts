import { AIRCRAFT, AIRCRAFT_ORDER, TARGETS, type AircraftId } from '../config';
import type { Territory } from '../world/Territory';
import type { Shape } from './Collision';
import { Durability } from './Damage';

/**
 * dummy  – a paper plane on a pencil stand, for gunnery practice.
 * crates – a stack of cardboard boxes.
 * board  – a standing cardboard target board.
 */
export type TargetKind = 'dummy' | 'crates' | 'board';

export interface TargetSpec {
  id: string;
  kind: TargetKind;
  territoryId: string;
  /** Shown on the label: "Practice Falcon". */
  name: string;
  /** Shown under the name: "Fighter dummy". */
  role: string;
  /** For dummies: which design the paper plane is folded as. */
  aircraft: AircraftId | null;
  /** The plane's position for a dummy; the base centre for props. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  maxHealth: number;
  /** What ink rounds and bombs can hit. Any of them counts as hitting this target. */
  shapes: Shape[];
  /** What a plane flies into: no bigger than what you can see. */
  solids: Shape[];
}

/**
 * One practice target or prop: static, with health. It never moves or shoots. When destroyed it
 * stays down for a while, then folds itself back up.
 */
export class Destructible {
  readonly durability: Durability;
  /** Seconds until a destroyed target is back. */
  respawnIn = 0;

  constructor(readonly spec: TargetSpec) {
    this.durability = new Durability(spec.maxHealth);
  }

  get id(): string {
    return this.spec.id;
  }

  get alive(): boolean {
    return !this.durability.destroyed;
  }

  get health(): number {
    return this.durability.health;
  }

  /** Returns the damage dealt and whether this hit destroyed it. */
  damage(amount: number): { dealt: number; destroyed: boolean } {
    if (!this.alive) return { dealt: 0, destroyed: false };
    const dealt = this.durability.damage(amount);
    const destroyed = !this.alive;
    if (destroyed) this.respawnIn = TARGETS.respawnTime;
    return { dealt, destroyed };
  }

  /** Counts down a destroyed target's return. Returns true on the step it comes back. */
  update(dt: number): boolean {
    if (this.alive) return false;
    this.respawnIn -= dt;
    if (this.respawnIn > 0) return false;
    this.restore();
    return true;
  }

  restore(): void {
    this.durability.repair();
    this.respawnIn = 0;
  }
}

/**
 * The target range on every unclaimed territory: three practice planes on pencil stands of
 * different heights around the centre, a stack of cardboard crates and a target board in two
 * opposite corners. The pattern turns from one territory to the next so they don't all look alike,
 * and the stand heights rotate too. The centre (where bullseyes go) and the gaps stay clear.
 */
export function layoutTargetRange(territories: readonly Territory[]): TargetSpec[] {
  const specs: TargetSpec[] = [];
  territories
    .filter((t) => !t.isHome)
    .forEach((t, k) => {
      const turn = (k * 40 * Math.PI) / 180;
      for (let i = 0; i < 3; i++) {
        const angle = turn + (i * 2 * Math.PI) / 3;
        const x = t.x + Math.cos(angle) * TARGETS.dummyRing;
        const z = t.z + Math.sin(angle) * TARGETS.dummyRing;
        const y = t.top + TARGETS.dummyHeights[(i + k) % TARGETS.dummyHeights.length];
        // Nose along the circle (forward = local -Z, as for the player's plane), as if flying laps.
        const yaw = Math.atan2(Math.sin(angle), -Math.cos(angle));
        const aircraft = AIRCRAFT_ORDER[(i + k) % AIRCRAFT_ORDER.length];
        const stand = y - 0.45 - t.top;
        specs.push({
          id: `${t.id}-d${i + 1}`,
          kind: 'dummy',
          territoryId: t.id,
          name: `Practice ${AIRCRAFT[aircraft].name}`,
          role: `${AIRCRAFT[aircraft].roleLabel} dummy`,
          aircraft,
          x, y, z, yaw,
          maxHealth: TARGETS.dummyHealth,
          shapes: [
            { kind: 'sphere', x, y, z, r: TARGETS.dummyRadius },
            { kind: 'box', x, y: t.top + stand / 2, z, hx: 0.16, hy: stand / 2, hz: 0.16, yaw: 0 },
          ],
          solids: [
            { kind: 'sphere', x, y, z, r: TARGETS.dummySolidRadius },
            { kind: 'box', x, y: t.top + stand / 2, z, hx: 0.16, hy: stand / 2, hz: 0.16, yaw: 0 },
          ],
        });
      }
      const corner = (j: number) => {
        const a = Math.PI / 4 + (j * Math.PI) / 2;
        const d = t.half - 4.5;
        return { x: t.x + Math.sign(Math.cos(a)) * d, z: t.z + Math.sign(Math.sin(a)) * d };
      };
      const crates = corner(k % 4);
      const crateYaw = turn * 0.5;
      specs.push({
        id: `${t.id}-crates`,
        kind: 'crates',
        territoryId: t.id,
        name: 'Cardboard crates',
        role: 'Prop',
        aircraft: null,
        x: crates.x, y: t.top, z: crates.z, yaw: crateYaw,
        maxHealth: TARGETS.crateHealth,
        shapes: [{ kind: 'box', x: crates.x, y: t.top + 1.5, z: crates.z, hx: 2.3, hy: 1.5, hz: 1.3, yaw: crateYaw }],
        solids: [{ kind: 'box', x: crates.x, y: t.top + 1.5, z: crates.z, hx: 2.3, hy: 1.5, hz: 1.3, yaw: crateYaw }],
      });
      const board = corner((k + 2) % 4);
      // The painted front (local -Z) faces the centre of the world, where planes come from.
      const boardYaw = Math.atan2(board.x, board.z);
      specs.push({
        id: `${t.id}-board`,
        kind: 'board',
        territoryId: t.id,
        name: 'Target board',
        role: 'Prop',
        aircraft: null,
        x: board.x, y: t.top, z: board.z, yaw: boardYaw,
        maxHealth: TARGETS.boardHealth,
        shapes: [{ kind: 'box', x: board.x, y: t.top + 2.9, z: board.z, hx: 2, hy: 1.6, hz: 0.15, yaw: boardYaw }],
        solids: [{ kind: 'box', x: board.x, y: t.top + 2.9, z: board.z, hx: 2, hy: 1.6, hz: 0.15, yaw: boardYaw }],
      });
    });
  return specs;
}

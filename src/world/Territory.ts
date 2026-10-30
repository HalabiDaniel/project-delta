import { WORLD } from '../config';

export type TerritoryOwner = 'player' | null;

/** One square floating platform. Pure data plus the geometry queries collisions need. */
export class Territory {
  constructor(
    readonly id: string,
    /** Centre of the platform's top face. */
    readonly x: number,
    readonly z: number,
    readonly size: number,
    readonly owner: TerritoryOwner,
    readonly thickness: number = WORLD.thickness,
  ) {}

  /** Platform tops all sit at y = 0. */
  get top(): number {
    return 0;
  }

  get bottom(): number {
    return this.top - this.thickness;
  }

  get half(): number {
    return this.size / 2;
  }

  get isHome(): boolean {
    return this.owner === 'player';
  }

  /** Is (x, z) over this platform, optionally grown or shrunk by `margin` on every side? */
  containsXZ(x: number, z: number, margin = 0): boolean {
    const h = this.half + margin;
    return Math.abs(x - this.x) <= h && Math.abs(z - this.z) <= h;
  }

  /** Does a sphere overlap this platform's box? */
  intersectsSphere(x: number, y: number, z: number, radius: number): boolean {
    const cx = clamp(x, this.x - this.half, this.x + this.half);
    const cy = clamp(y, this.bottom, this.top);
    const cz = clamp(z, this.z - this.half, this.z + this.half);
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

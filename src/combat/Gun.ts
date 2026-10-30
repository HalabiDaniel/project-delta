import type { GunSpec } from '../config';

/**
 * An aircraft's ink guns: ammunition, rate of fire, and which barrel fires next. Holding the
 * trigger fires one round every `interval`, the barrels taking turns. Ammunition only comes back
 * by rearming at home; it costs no paper.
 */
export class Gun {
  ammo: number;
  private cooldown = 0;
  private nextBarrel = 0;

  constructor(readonly spec: GunSpec) {
    this.ammo = spec.ammo;
  }

  get capacity(): number {
    return this.spec.ammo;
  }

  get empty(): boolean {
    return this.ammo <= 0;
  }

  /** 0 → 1 while the next round is chambered. */
  get cooling(): number {
    return this.cooldown / this.spec.interval;
  }

  canFire(): boolean {
    return this.ammo > 0 && this.cooldown <= 0;
  }

  /** Fires a round if one is ready; returns the barrel it left from, or null. */
  fire(): number | null {
    if (!this.canFire()) return null;
    this.ammo--;
    this.cooldown = this.spec.interval;
    const barrel = this.nextBarrel;
    this.nextBarrel = (this.nextBarrel + 1) % this.spec.barrels;
    return barrel;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  refill(): void {
    this.ammo = this.spec.ammo;
    this.cooldown = 0;
  }
}

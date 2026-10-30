import { Durability } from '../combat/Damage';
import type { ShotOrder } from '../combat/Ordnance';
import { DEFENSES, type Side } from '../config';
import type { Point3 } from '../missions/Mission';
import type { Rng } from '../systems/Random';
import type { InstallationSpec } from './Layout';

export type { ShotOrder } from '../combat/Ordnance';

/**
 * What the defenses know about an aircraft: which one it is and whose side it is on, where it is,
 * how it moves, and how easy it is to notice. The network only ever sees aircraft like this, so the
 * player's plane, an AI plane and (later) another player's plane are all the same to it.
 */
export interface Target {
  id: string;
  side: Side;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Detection ranges are multiplied by this. */
  signature: number;
}

/**
 * idle      – nothing to shoot at; the weapon swings back to its rest heading.
 * tracking  – it sees the plane (or remembers it) and turns towards it, but can't fire yet.
 * locking   – a launcher holding the plane in its sights; a rocket goes when the lock completes.
 * firing    – a turret on target and shooting.
 * destroyed – a wreck until the sortie ends.
 */
export type InstallationState = 'idle' | 'tracking' | 'locking' | 'firing' | 'destroyed';

export type DefenseEvent =
  /** A territory noticed an aircraft: through its radar, or one of its weapons saw it. */
  | { type: 'spotted'; territoryId: string; target: string; by: 'radar' | 'weapon' }
  /** …and has lost it again. */
  | { type: 'lost'; territoryId: string; target: string }
  | { type: 'lock'; id: string; target: string }
  | { type: 'lock-broken'; id: string; target: string }
  | { type: 'launch'; id: string; target: string }
  | { type: 'fire'; id: string; target: string };

/**
 * One defensive installation's rules: health, and for weapons, how they notice, follow and shoot at
 * a plane. Nothing about it is perfect. A turret turns at a limited rate and only within its arc,
 * so the space behind it is a blind spot. It leads the plane using a smoothed guess of its
 * velocity, so a change of course throws it off, and its shots scatter more the faster the plane
 * flies. A launcher must hold the plane in its sights for a while before a rocket goes, and can't
 * aim low on the horizon. Rounds and rockets then take time to fly (see EnemyFire).
 */
export class Installation {
  readonly durability: Durability;
  state: InstallationState = 'idle';
  /** Where the weapon (or dish) points now. */
  yaw: number;
  pitch = 0;
  /** 0 → 1 while it gets a fix on a plane it has just noticed. It fires only at 1. */
  acquire = 0;
  /** A launcher's lock, 0 → 1. */
  lock = 0;
  /** Seconds until it can fire again. */
  cooldown = 0;
  /** Seconds since it last saw the plane. */
  unseen = Infinity;
  /** Seconds since its last shot, for muzzle flashes. */
  sinceShot = Infinity;
  /** A radar dish's turn, for show. */
  spin = 0;
  /** The aircraft it is following (or last followed), or null. */
  targetId: string | null = null;
  /** Its idea of the plane's velocity, which lags behind the real one. */
  private readonly estimate = { x: 0, y: 0, z: 0 };
  private fresh = true;

  constructor(
    readonly spec: InstallationSpec,
    private readonly rng: Rng = Math.random,
  ) {
    this.durability = new Durability(spec.maxHealth);
    this.yaw = spec.facing;
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

  get side(): Side {
    return this.spec.side;
  }

  get isWeapon(): boolean {
    return this.spec.kind === 'turret' || this.spec.kind === 'launcher';
  }

  /** It is following the plane, locking on or shooting. */
  get engaged(): boolean {
    return this.state === 'tracking' || this.state === 'locking' || this.state === 'firing';
  }

  /** Where the gun pivots, the rails turn or the dish sits. */
  pivot(out: Point3 = { x: 0, y: 0, z: 0 }): Point3 {
    out.x = this.spec.x;
    out.y = this.spec.ground + this.spec.pivot;
    out.z = this.spec.z;
    return out;
  }

  /** Where rounds leave: the end of the barrel, or the top of the rails. */
  muzzle(out: Point3 = { x: 0, y: 0, z: 0 }): Point3 {
    const length = this.spec.kind === 'turret' ? DEFENSES.turret.barrel : 0.9;
    this.pivot(out);
    const cp = Math.cos(this.pitch);
    out.x += -Math.sin(this.yaw) * cp * length;
    out.y += Math.sin(this.pitch) * length;
    out.z += -Math.cos(this.yaw) * cp * length;
    return out;
  }

  /** How close a plane must be before this installation notices it on its own. */
  detectionRange(target: Pick<Target, 'signature'>, scale = 1): number {
    return this.spec.range * target.signature * scale;
  }

  /** Is the plane within this installation's own detection range? */
  sees(target: Target, scale = 1): boolean {
    return distance(this.pivot(tmp), target) <= this.detectionRange(target, scale);
  }

  damage(amount: number): { dealt: number; destroyed: boolean } {
    if (!this.alive) return { dealt: 0, destroyed: false };
    const dealt = this.durability.damage(amount);
    const destroyed = !this.alive;
    if (destroyed) {
      this.state = 'destroyed';
      this.lock = 0;
    }
    return { dealt, destroyed };
  }

  /** Back to full health, at rest. */
  restore(): void {
    this.durability.repair();
    this.state = 'idle';
    this.yaw = this.spec.facing;
    this.pitch = 0;
    this.acquire = 0;
    this.lock = 0;
    this.cooldown = 0;
    this.unseen = Infinity;
    this.sinceShot = Infinity;
    this.fresh = true;
    this.targetId = null;
  }

  /**
   * One step. `target` is the aircraft it is after, or null when there is nothing to shoot at.
   * `alerted` means the territory's radar sees it, which counts as seeing it and gets a fix at
   * once. `scale` shrinks detection once the radar is gone. Switching to another aircraft starts
   * the fix and the lock over. Returns a shot, or null.
   */
  update(dt: number, target: Target | null, alerted = false, scale = 1): ShotOrder | null {
    this.sinceShot += dt;
    if (!this.alive) return null;
    if (target && target.id !== this.targetId) {
      if (this.targetId !== null) {
        this.fresh = true;
        this.acquire = 0;
        this.lock = 0;
        if (this.state !== 'destroyed') this.state = 'tracking';
      }
      this.targetId = target.id;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.spec.kind === 'radar') {
      this.spin += DEFENSES.radar.spin * dt;
      this.state = target && this.sees(target) ? 'tracking' : 'idle';
      return null;
    }
    if (this.spec.kind === 'supply') return null;

    const turret = this.spec.kind === 'turret';
    const w = turret ? DEFENSES.turret : DEFENSES.launcher;
    const p = this.pivot();
    let seen = false;
    let dist = Infinity;
    if (target) {
      dist = distance(p, target);
      const reach = this.detectionRange(target, scale) * (this.state === 'idle' ? 1 : DEFENSES.keepTrack);
      seen = alerted || dist <= reach;
    }
    this.unseen = seen ? 0 : this.unseen + dt;
    if (!seen || !target) {
      this.lock = Math.max(0, this.lock - dt / 0.5);
      if (this.unseen > DEFENSES.memory) {
        this.state = 'idle';
        this.acquire = 0;
        this.fresh = true;
        this.turn(dt, this.spec.facing, 0);
      } else if (this.state !== 'idle') {
        this.state = 'tracking';
      }
      return null;
    }

    // The velocity it believes in catches up with the real one gradually.
    if (this.fresh) {
      this.estimate.x = this.estimate.y = this.estimate.z = 0;
      this.fresh = false;
    }
    const k = 1 - Math.exp(-dt / DEFENSES.turret.trackingLag);
    this.estimate.x += (target.vx - this.estimate.x) * k;
    this.estimate.y += (target.vy - this.estimate.y) * k;
    this.estimate.z += (target.vz - this.estimate.z) * k;
    this.acquire = alerted || !turret ? 1 : Math.min(1, this.acquire + dt / DEFENSES.turret.acquireTime);

    // Turrets lead the plane; launchers point at it and let the rocket do the chasing.
    const aim = { x: target.x, y: target.y, z: target.z };
    if (turret) {
      const t = leadTime(p, target, this.estimate, DEFENSES.turret.shot.speed, DEFENSES.turret.lead);
      aim.x += this.estimate.x * t * DEFENSES.turret.lead;
      aim.y += this.estimate.y * t * DEFENSES.turret.lead;
      aim.z += this.estimate.z * t * DEFENSES.turret.lead;
    }
    const wantYaw = yawTo(aim.x - p.x, aim.z - p.z);
    const wantPitch = Math.atan2(aim.y - p.y, Math.hypot(aim.x - p.x, aim.z - p.z));
    const inArc = this.spec.arc === null || Math.abs(wrapAngle(wantYaw - this.spec.facing)) <= this.spec.arc;
    const pitchOk = wantPitch >= w.minPitch && wantPitch <= w.maxPitch;
    this.turn(dt, wantYaw, clamp(wantPitch, w.minPitch, w.maxPitch));
    const error = angleBetween(this.yaw, this.pitch, wantYaw, wantPitch);
    const engage = dist <= this.spec.range && inArc && pitchOk && this.acquire >= 1;

    if (turret) {
      const c = DEFENSES.turret;
      if (!engage || error > c.fireCone) {
        this.state = 'tracking';
        return null;
      }
      this.state = 'firing';
      if (this.cooldown > 0) return null;
      this.cooldown = c.interval;
      this.sinceShot = 0;
      // The faster the plane, the more the aim scatters.
      const speed = Math.hypot(target.vx, target.vy, target.vz);
      const sigma = c.spread + (c.speedSpread * Math.max(0, speed - DEFENSES.spreadFreeSpeed)) / 10;
      const yaw = this.yaw + (this.rng() + this.rng() - 1) * sigma;
      const pitch = this.pitch + (this.rng() + this.rng() - 1) * sigma;
      return this.order('ink', yaw, pitch, c.shot.speed);
    }

    const c = DEFENSES.launcher;
    if (engage && this.cooldown <= 0 && error <= 15 * DEG) {
      this.lock = Math.min(1, this.lock + dt / c.lockTime);
      this.state = 'locking';
      if (this.lock >= 1) {
        this.lock = 0;
        this.cooldown = c.reload;
        this.sinceShot = 0;
        this.state = 'firing';
        return this.order('rocket', this.yaw, Math.max(this.pitch, 25 * DEG), c.rocket.launchSpeed);
      }
      return null;
    }
    this.lock = Math.max(0, this.lock - dt / 0.5);
    this.state = 'tracking';
    return null;
  }

  private order(kind: ShotOrder['kind'], yaw: number, pitch: number, speed: number): ShotOrder {
    const m = this.muzzle();
    const cp = Math.cos(pitch);
    return {
      kind, source: this.id, side: this.side, target: this.targetId,
      x: m.x, y: m.y, z: m.z, vx: -Math.sin(yaw) * cp * speed, vy: Math.sin(pitch) * speed, vz: -Math.cos(yaw) * cp * speed,
    };
  }

  /** Turns towards a heading and elevation at the weapon's rates, never through the blind spot behind it. */
  private turn(dt: number, wantYaw: number, wantPitch: number): void {
    const w = this.spec.kind === 'turret' ? DEFENSES.turret : DEFENSES.launcher;
    const step = w.turnRate * dt;
    const arc = this.spec.arc;
    if (arc === null) {
      this.yaw = wrapAngle(this.yaw + clamp(wrapAngle(wantYaw - this.yaw), -step, step));
    } else {
      // Work relative to the rest heading, where the arc is a plain interval: the shortest way
      // within it never crosses the blind side.
      const now = wrapAngle(this.yaw - this.spec.facing);
      const want = clamp(wrapAngle(wantYaw - this.spec.facing), -arc, arc);
      this.yaw = wrapAngle(this.spec.facing + now + clamp(want - now, -step, step));
    }
    this.pitch += clamp(wantPitch - this.pitch, -w.pitchRate * dt, w.pitchRate * dt);
  }
}

/**
 * Every installation on the map, grouped by territory. Each weapon picks one aircraft of the other
 * side to deal with: it sticks with the one it is following while it can still see or remember it,
 * otherwise it takes the nearest one it can see (or that its territory's radar sees). A territory's
 * radar, while it stands, alerts all its weapons at once; once the radar is destroyed they only
 * notice aircraft from closer in. Reports when territories spot or lose an aircraft, and when
 * launchers lock on and launch.
 */
export class DefenseNetwork {
  readonly installations: Installation[];
  private readonly byId = new Map<string, Installation>();
  private readonly byTerritory = new Map<string, Installation[]>();
  /** Per territory, the aircraft it currently knows about. */
  private readonly aware = new Map<string, Set<string>>();

  constructor(specs: readonly InstallationSpec[], rng: Rng = Math.random) {
    this.installations = specs.map((spec) => new Installation(spec, rng));
    for (const i of this.installations) {
      this.byId.set(i.id, i);
      const list = this.byTerritory.get(i.spec.territoryId) ?? [];
      list.push(i);
      this.byTerritory.set(i.spec.territoryId, list);
    }
  }

  get(id: string): Installation | undefined {
    return this.byId.get(id);
  }

  /** The installations on a territory. */
  on(territoryId: string): readonly Installation[] {
    return this.byTerritory.get(territoryId) ?? [];
  }

  radar(territoryId: string): Installation | null {
    return this.on(territoryId).find((i) => i.spec.kind === 'radar') ?? null;
  }

  /** The territory's radar stands and sees the aircraft. */
  alerted(territoryId: string, target: Target | null): boolean {
    const radar = this.radar(territoryId);
    return !!target && !!radar?.alive && radar.side !== target.side && radar.sees(target);
  }

  /** 1, or less once the territory's radar has been destroyed. */
  detectionScale(territoryId: string): number {
    const radar = this.radar(territoryId);
    return radar && !radar.alive ? DEFENSES.radarLostDetection : 1;
  }

  /** Does the territory know where aircraft `targetId` is? */
  isAware(territoryId: string, targetId: string): boolean {
    return this.aware.get(territoryId)?.has(targetId) ?? false;
  }

  /** Weapons following, locking onto or shooting at aircraft `targetId`. */
  engagedWith(targetId: string): Installation[] {
    return this.installations.filter((i) => i.isWeapon && i.alive && i.engaged && i.targetId === targetId);
  }

  /** One step for every installation. `targets` are the aircraft in the air that may be shot at. */
  update(dt: number, targets: readonly Target[]): { orders: ShotOrder[]; events: DefenseEvent[] } {
    const orders: ShotOrder[] = [];
    const events: DefenseEvent[] = [];
    for (const [territoryId, group] of this.byTerritory) {
      const scale = this.detectionScale(territoryId);
      const sees = new Set<string>();
      const radarSees = new Set<string>();
      for (const t of targets) if (this.alerted(territoryId, t)) radarSees.add(t.id);
      for (const i of group) {
        const was = i.state;
        const target = this.choose(i, targets, radarSees, scale);
        const alerted = !!target && radarSees.has(target.id);
        const order = i.update(dt, target, alerted, scale);
        if (target && i.isWeapon && i.alive && i.unseen === 0) sees.add(target.id);
        const about = i.targetId ?? '';
        if (order) {
          orders.push(order);
          events.push({ type: order.kind === 'rocket' ? 'launch' : 'fire', id: i.id, target: about });
        } else if (was !== 'locking' && i.state === 'locking') {
          events.push({ type: 'lock', id: i.id, target: about });
        } else if (was === 'locking' && i.state !== 'locking' && i.alive) {
          events.push({ type: 'lock-broken', id: i.id, target: about });
        }
      }
      const known = this.aware.get(territoryId) ?? new Set<string>();
      this.aware.set(territoryId, known);
      for (const id of new Set([...sees, ...radarSees])) {
        if (known.has(id)) continue;
        known.add(id);
        events.push({ type: 'spotted', territoryId, target: id, by: radarSees.has(id) ? 'radar' : 'weapon' });
      }
      for (const id of [...known]) {
        if (sees.has(id) || radarSees.has(id) || group.some((i) => i.engaged && i.targetId === id)) continue;
        known.delete(id);
        events.push({ type: 'lost', territoryId, target: id });
      }
    }
    return { orders, events };
  }

  restoreAll(): void {
    for (const i of this.installations) i.restore();
    this.aware.clear();
  }

  /**
   * The aircraft installation `i` deals with this step: the one it is following while it can still
   * see it, else the nearest one of the other side it (or its radar) sees, else the one it is
   * following, which it remembers for a moment before giving up.
   */
  private choose(i: Installation, targets: readonly Target[], radarSees: ReadonlySet<string>, scale: number): Target | null {
    if (!i.alive || i.spec.kind === 'supply') return null;
    const p = i.pivot(tmp);
    let current: Target | null = null;
    let best: Target | null = null;
    let bestDistance = Infinity;
    for (const t of targets) {
      if (t.side === i.side) continue;
      const following = t.id === i.targetId && i.state !== 'idle';
      const d = distance(p, t);
      const visible = radarSees.has(t.id) || d <= i.detectionRange(t, scale) * (following ? DEFENSES.keepTrack : 1);
      if (following) {
        current = t;
        if (visible) return t;
      }
      if (visible && d < bestDistance) {
        best = t;
        bestDistance = d;
      }
    }
    return best ?? current;
  }
}

const DEG = Math.PI / 180;
const tmp: Point3 = { x: 0, y: 0, z: 0 };

/**
 * Flight time for a round of `speed` from `from` to meet a target moving at `velocity`, if the
 * shooter leads by `skill` (0–1) of that motion. A few fixed-point steps are plenty at these speeds.
 */
export function leadTime(from: Point3, target: Point3, velocity: Point3, speed: number, skill = 1): number {
  let t = distance(from, target) / speed;
  for (let n = 0; n < 3; n++) {
    const x = target.x + velocity.x * t * skill;
    const y = target.y + velocity.y * t * skill;
    const z = target.z + velocity.z * t * skill;
    t = Math.hypot(x - from.x, y - from.y, z - from.z) / speed;
  }
  return t;
}

/** Yaw that faces along (dx, dz), in the scene's convention (yaw 0 faces -Z). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Angle between two directions given as yaw and pitch. */
export function angleBetween(yaw1: number, pitch1: number, yaw2: number, pitch2: number): number {
  const c1 = Math.cos(pitch1);
  const c2 = Math.cos(pitch2);
  const dot = Math.sin(yaw1) * c1 * Math.sin(yaw2) * c2 + Math.sin(pitch1) * Math.sin(pitch2) + Math.cos(yaw1) * c1 * Math.cos(yaw2) * c2;
  return Math.acos(clamp(dot, -1, 1));
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a %= twoPi;
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

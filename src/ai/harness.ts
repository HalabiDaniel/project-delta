import { BOMB, PLAYER_ID, RAIDS, type Side } from '../config';
import { footprint } from '../combat/Collision';
import { layoutTargetRange } from '../combat/Destructibles';
import { Ordnance, type AircraftTarget } from '../combat/Ordnance';
import { layoutDefenses } from '../defenses/Layout';
import type { Point3 } from '../missions/Mission';
import { seededRng } from '../systems/Random';
import { generateTerritories } from '../world/WorldGenerator';
import { decorFootprints } from '../world/territories/decor';
import type { Contact, Strike } from './AiAircraft';
import { AirTraffic, type AirEvent } from './AirTraffic';

/** Shared set-up for the AI tests: the real world, a scripted "player", and fire resolved by Ordnance. */
export const territories = generateTerritories();
export const home = territories.find((t) => t.isHome)!;
const occupied = [...layoutTargetRange(territories).flatMap((s) => s.shapes.map(footprint)), ...decorFootprints(territories)];
export const layout = layoutDefenses(territories, occupied);
const storeSpec = layout.installations.find((i) => i.id === 'T1-store')!;
export const store: Strike = { territoryId: 'T1', x: storeSpec.x, y: 0, z: storeSpec.z, radius: RAIDS.hitRadius };
export const DT = 1 / 60;
export const at = (id: string) => territories.find((t) => t.id === id)!;

/** Where the scripted player is at time t, and how it moves. */
export type Script = (t: number) => { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null;

export function traffic(seed: number, ambient = false): AirTraffic {
  return new AirTraffic(territories, home, () => store, seededRng(seed), ambient);
}

export interface RunResult {
  /** Damage dealt to the scripted player. */
  damage: number;
  firstHit: number | null;
  events: AirEvent[];
  /** Bombs that landed: how far from their strike point. */
  misses: number[];
  shots: number;
}

export interface RunOptions {
  shielded?: (t: number) => boolean;
  signature?: number;
  visible?: (p: Point3) => boolean;
  raids?: boolean;
  side?: Side;
}

/**
 * Steps the traffic with a scripted player (or none), keeping rounds and bombs in flight between
 * calls. AI rounds are resolved against the player and every AI aircraft; bombs fall like the real
 * ones and report whether they hit.
 */
export class Session {
  time = 0;
  readonly result: RunResult = { damage: 0, firstHit: null, events: [], misses: [], shots: 0 };
  private readonly fire = new Ordnance();
  private readonly falling: Array<{ p: Point3; v: Point3; source: string; strike: Strike }> = [];
  private prev: Point3 | null = null;

  constructor(
    readonly air: AirTraffic,
    private readonly script: Script | null = null,
    private readonly opts: RunOptions = {},
  ) {}

  run(seconds: number): RunResult {
    const { air, opts, result } = this;
    for (const end = this.time + seconds; this.time < end; this.time += DT) {
      const t = this.time;
      const s = this.script?.(t) ?? null;
      const shielded = opts.shielded?.(t) ?? false;
      const player: Contact | null = s
        ? { id: PLAYER_ID, side: opts.side ?? 'player', ...s, signature: opts.signature ?? 0.9, radius: 1, shielded, role: 'player' }
        : null;
      const out = air.update(DT, { territories, obstacles: [], player, visible: opts.visible ?? (() => false), raids: opts.raids ?? false, patrol: 0 });
      result.events.push(...out.events);
      for (const o of out.shots) {
        this.fire.spawn(o);
        result.shots++;
      }
      for (const b of out.bombs) this.falling.push({ p: { x: b.x, y: b.y, z: b.z }, v: { x: b.vx, y: b.vy - BOMB.releaseKick, z: b.vz }, source: b.source, strike: b.strike });
      for (let i = this.falling.length - 1; i >= 0; i--) {
        const b = this.falling[i];
        b.v.y -= BOMB.gravity * DT;
        b.p.x += b.v.x * DT;
        b.p.y += b.v.y * DT;
        b.p.z += b.v.z * DT;
        if (b.p.y > b.strike.y + BOMB.kinds.standard.radius) continue;
        const miss = Math.hypot(b.p.x - b.strike.x, b.p.z - b.strike.z);
        result.misses.push(miss);
        air.bombLanded(b.source, miss <= b.strike.radius + BOMB.kinds.standard.blastRadius * 0.5);
        this.falling.splice(i, 1);
      }
      const targets: AircraftTarget[] = [];
      if (s) targets.push({ id: PLAYER_ID, side: opts.side ?? 'player', x: s.x, y: s.y, z: s.z, px: this.prev?.x ?? s.x, py: this.prev?.y ?? s.y, pz: this.prev?.z ?? s.z, radius: 1, shielded });
      for (const a of air.aircraft) {
        const p = a.model.position;
        const q = a.model.prevPosition;
        targets.push({ id: a.id, side: a.side, x: p.x, y: p.y, z: p.z, px: q.x, py: q.y, pz: q.z, radius: a.spec.hitRadius });
      }
      for (const e of this.fire.update(DT, targets, territories)) {
        if (e.type !== 'hit') continue;
        if (e.target === PLAYER_ID) {
          result.damage += e.shot.damage;
          result.firstHit ??= t;
        } else {
          air.damage(e.target, e.shot.damage, e.shot.source, false);
        }
      }
      this.prev = s ? { x: s.x, y: s.y, z: s.z } : null;
    }
    return result;
  }
}

/** Runs a fresh session for `seconds`. */
export function run(air: AirTraffic, seconds: number, script: Script | null = null, opts: RunOptions = {}): RunResult {
  return new Session(air, script, opts).run(seconds);
}

/** Circling (cx, cz) at `radius` and `speed`. */
export function circle(cx: number, cz: number, radius: number, speed: number, y = 22): Script {
  return (t) => {
    const w = speed / radius;
    const a = w * t;
    return { x: cx + Math.cos(a) * radius, y, z: cz + Math.sin(a) * radius, vx: -Math.sin(a) * radius * w, vy: 0, vz: Math.cos(a) * radius * w };
  };
}

/** A player flying a straight line from `from` at `speed`, heading `yaw` (scene convention), optionally weaving. */
export function straight(from: Point3, yaw: number, speed: number, weave = 0): Script {
  let x = from.x;
  let z = from.z;
  let last = 0;
  return (t) => {
    const heading = yaw + weave * Math.sin(t * 2.2);
    const vx = -Math.sin(heading) * speed;
    const vz = -Math.cos(heading) * speed;
    x += vx * (t - last);
    z += vz * (t - last);
    last = t;
    return { x, y: from.y, z, vx, vy: 0, vz };
  };
}

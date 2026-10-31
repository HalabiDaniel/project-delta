import type { AircraftId } from '../../src/config';
import { NET, NEUTRAL_FRAME, type InputFrame } from '../../src/net/protocol';
import type { Pilot } from './Pilot';
import { ServerWorld } from './ServerWorld';

/**
 * Test support: a world with no ambient traffic, players that join and claim in one call, and
 * "clients" that send one input frame per step the way the browser does.
 */
export function quietWorld(seed = 1): ServerWorld {
  return new ServerWorld({ seed, ambient: false });
}

export function player(world: ServerWorld, id: string, territory: string, name = id): Pilot {
  world.join(id, name);
  const error = world.claim(id, territory);
  if (error) throw new Error(`claim ${territory}: ${error}`);
  return world.pilots.get(id)!;
}

/** Per-player frame numbers, as each client would count them. */
const seqs = new WeakMap<ServerWorld, Map<string, number>>();

export function frame(world: ServerWorld, id: string, controls: Partial<Omit<InputFrame, 'seq'>> = {}): InputFrame {
  let map = seqs.get(world);
  if (!map) {
    map = new Map();
    seqs.set(world, map);
  }
  const seq = (map.get(id) ?? 0) + 1;
  map.set(id, seq);
  return { ...NEUTRAL_FRAME, ...controls, seq };
}

/**
 * Runs the world for `seconds`, each connected player's client sending one frame per step with the
 * controls `controls(id, t)` returns (neutral by default).
 */
export function run(world: ServerWorld, seconds: number, controls: (id: string, t: number) => Partial<Omit<InputFrame, 'seq'>> | null = () => ({})): void {
  const steps = Math.round(seconds / NET.step);
  for (let i = 0; i < steps; i++) {
    for (const p of world.pilots.values()) {
      if (!p.connected) continue;
      const c = controls(p.id, i * NET.step);
      if (c) world.input(p.id, [frame(world, p.id, c)]);
    }
    world.step(NET.step);
  }
}

/** Folds `aircraft` and launches it on the selected card (any card it suits). */
export function launch(world: ServerWorld, p: Pilot, aircraft: AircraftId = 'falcon'): void {
  world.command(p.id, { a: 'aircraft', id: aircraft });
  const st = p.state!;
  for (let i = 0; i < st.offers.length; i++) {
    st.select(i);
    if (world.suits(p, aircraft)) break;
  }
  if (!world.command(p.id, { a: 'build' })) throw new Error(`can't build: ${st.phase}, paper ${p.resources.paper}`);
  run(world, 2.2);
  if (!world.command(p.id, { a: 'launch' })) throw new Error(`can't launch: ${st.phase}`);
  // Clear of the launch shield and climbing.
  run(world, 3.5);
}

/** Puts a flying plane at (x, y, z), heading `yaw`, level, at cruise speed. */
export function place(p: Pilot, x: number, y: number, z: number, yaw: number): void {
  const m = p.flight.model;
  m.position.set(x, y, z);
  m.prevPosition.set(x, y, z);
  m.yaw = m.aimYaw = yaw;
  m.pitch = m.aimPitch = 0;
  m.roll = 0;
  m.speed = m.throttleSpeed = m.flight.cruiseSpeed;
}

import { describe, expect, it } from 'vitest';
import { NET, NEUTRAL_FRAME, type InputFrame } from '../../src/net/protocol';
import { Predictor } from '../../src/net/Prediction';
import type { ServerWorld } from './ServerWorld';
import { launch, player, quietWorld } from './testkit';

/**
 * The pilot's game predicts its own plane with the same flight model and frames the server uses.
 * These tests play client and server side by side, with the network in between delaying and
 * bunching frames, and check that the prediction agrees with the server whenever the server's
 * state arrives (no corrections), and that it recovers when they do disagree.
 */

interface Link {
  /** Frames on their way to the server: delivered at `at` (steps). */
  up: Array<{ at: number; frame: InputFrame }>;
  /** Server states on their way back. */
  down: Array<{ at: number; own: NonNullable<ReturnType<ServerWorld['ownFor']>> }>;
}

function controls(t: number): Omit<InputFrame, 'seq'> {
  // Weave about, change throttle, boost now and then: plenty for the model to get wrong.
  return {
    ...NEUTRAL_FRAME,
    mx: Math.round(Math.sin(t * 1.7) * 30) / 10,
    my: Math.round(Math.cos(t * 1.1) * 20) / 10,
    throttle: t % 4 < 1.5 ? 1 : t % 4 < 2.5 ? -1 : 0,
    bank: t % 6 < 1 ? 1 : 0,
    boost: t % 7 < 1,
  };
}

/** Runs `seconds` with a one-way latency of `latency` steps, delivering frames in bunches of `bunch`. */
function play(seconds: number, latency: number, bunch: number) {
  const world = quietWorld(11);
  const p = player(world, 'a', 'T1');
  launch(world, p);
  const own = world.ownFor('a')!;
  const predictor = new Predictor(p.flight.model.spec);
  predictor.flight.model.park({ x: 0, y: 0, z: 0 }, 0, 'T1');
  // The client starts from the server's plane, numbering frames after the server's last one.
  predictor.reconcile(own, { home: p.home, territories: world.territories, solids: world.solids() });
  let seq = own.seq;
  const link: Link = { up: [], down: [] };
  const errors: number[] = [];
  const steps = Math.round(seconds / NET.step);
  for (let i = 0; i < steps; i++) {
    const frame = { ...controls(i * NET.step), seq: ++seq };
    predictor.apply(frame, { home: p.home, territories: world.territories, solids: world.solids() });
    link.up.push({ at: i + latency + (bunch - (i % bunch)) - 1, frame });
    const due = link.up.filter((x) => x.at <= i);
    link.up = link.up.filter((x) => x.at > i);
    if (due.length > 0) world.input('a', due.map((x) => x.frame));
    world.step(NET.step);
    if (i % 3 === 0) {
      const o = world.ownFor('a');
      if (o) link.down.push({ at: i + latency, own: o });
    }
    for (const d of link.down.filter((x) => x.at <= i)) errors.push(predictor.reconcile(d.own, { home: p.home, territories: world.territories, solids: world.solids() }));
    link.down = link.down.filter((x) => x.at > i);
  }
  return { errors, inputs: p.inputs, predictor };
}

describe('client prediction against the server', () => {
  it('agrees with the server on a steady connection', () => {
    const { errors } = play(6, 4, 1);
    expect(errors.length).toBeGreaterThan(50);
    expect(Math.max(...errors)).toBeLessThan(0.01);
  });

  it('agrees with the server when frames arrive late and bunched (a slow or jittery client)', () => {
    const { errors, inputs } = play(6, 9, 6);
    expect(inputs.autoSteps).toBe(0);
    expect(Math.max(...errors)).toBeLessThan(0.01);
  });

  it('agrees with the server when the client draws at a few frames a second', () => {
    const { errors, inputs } = play(6, 6, 20);
    expect(inputs.autoSteps).toBe(0);
    expect(Math.max(...errors)).toBeLessThan(0.01);
  });
});

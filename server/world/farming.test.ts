import { describe, expect, it } from 'vitest';
import { FARMING, PVP } from '../../src/config';
import { FarmWatch } from '../../src/systems/Farming';
import { BountyBoard } from './Bounties';
import { launch, player, quietWorld, run } from './testkit';

/** v0.0.19 §7: anti-farming. */
describe('the farm watch', () => {
  it('decays every new reward between a pair, per direction, across sources', () => {
    const w = new FarmWatch();
    const flows = ['kill', 'bounty', 'coop', 'escort', 'mischief'] as const;
    const factors: number[] = [];
    flows.forEach((kind, i) => {
      factors.push(w.factor('a', 'b', i));
      w.record({ earner: 'a', from: 'b', kind, amount: 5, at: i });
    });
    expect(factors).toEqual(FARMING.decay.slice(0, flows.length));
    // The other direction has its own count.
    expect(w.factor('b', 'a', 10)).toBe(1);
    // Out of the window, back to full.
    expect(w.factor('a', 'b', FARMING.window + 10)).toBe(1);
  });

  it('flags one-sided kills, kills traded in turns, undefended raids, bounties on each other and big flows; pauses the pair', () => {
    const oneSided = new FarmWatch();
    let flag = null;
    for (let i = 0; i < FARMING.kills && !flag; i++) flag = oneSided.record({ earner: 'a', from: 'b', kind: 'kill', amount: 5, at: i * 10, cost: 10 });
    expect(flag?.reason).toBe('kills');
    expect(oneSided.factor('a', 'b', 100)).toBe(0);
    expect(oneSided.factor('b', 'a', 100)).toBe(0);
    expect(oneSided.factor('a', 'b', 60 + FARMING.pause)).toBeGreaterThan(0);
    expect(oneSided.takeFlags()).toHaveLength(1);
    expect(oneSided.takeFlags()).toHaveLength(0);

    const traded = new FarmWatch();
    flag = null;
    for (let i = 0; i < FARMING.traded && !flag; i++) flag = traded.record({ earner: i % 2 ? 'a' : 'b', from: i % 2 ? 'b' : 'a', kind: 'kill', amount: 5, at: i });
    expect(flag?.reason).toBe('kills');

    const losses = new FarmWatch();
    flag = null;
    for (let i = 0; i < FARMING.losses && !flag; i++) flag = losses.record({ earner: 'a', from: 'b', kind: 'kill', amount: 30, at: i, cost: FARMING.expensive });
    expect(flag?.reason).toBe('losses');

    const raids = new FarmWatch();
    flag = null;
    for (let i = 0; i < FARMING.undefended && !flag; i++) flag = raids.record({ earner: 'a', from: 'b', kind: 'raid', amount: 40, at: i, defended: false });
    expect(flag?.reason).toBe('undefended');
    // Defended raids are no pattern.
    const fair = new FarmWatch();
    for (let i = 0; i < FARMING.undefended; i++) expect(fair.record({ earner: 'a', from: 'b', kind: 'raid', amount: 40, at: i, defended: true })).toBeNull();

    const bounties = new FarmWatch();
    flag = null;
    for (let i = 0; i < FARMING.bounties && !flag; i++) flag = bounties.record({ earner: 'a', from: 'b', kind: 'bounty', amount: 20, at: i });
    expect(flag?.reason).toBe('bounties');

    const flow = new FarmWatch();
    expect(flow.record({ earner: 'a', from: 'b', kind: 'coop', amount: FARMING.flowCap, at: 0 })?.reason).toBe('flow');
  });

  it('a paused pair splits nothing of a bounty', () => {
    const w = new FarmWatch();
    w.record({ earner: 'a', from: 't', kind: 'coop', amount: FARMING.flowCap, at: 0 });
    const shares = BountyBoard.split({ pot: 100, target: 't' }, new Map([['a', 50], ['b', 50]]), new Set(), (p) => w.factor(p, 't', 1));
    expect(shares).toEqual([{ player: 'b', amount: 50 }]);
  });
});

describe('anti-farming in the world', () => {
  it('kill rewards between a pair shrink, the pair is flagged and logged, and no reward-bearing cards are dealt between them', () => {
    const world = quietWorld(51);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    for (const p of [a, b]) {
      p.protectUntil = 0;
      p.resources.restore(150);
    }
    const paid: number[] = [];
    for (let i = 0; i < FARMING.kills; i++) {
      launch(world, b, 'dart');
      const before = a.resources.paper;
      b.damageLog.push({ by: 'a', amount: 999, at: world.time });
      b.state!.crash('shot-down');
      paid.push(a.resources.paper - before);
      run(world, 1.3);
      world.command('b', { a: 'continue' });
      a.resources.restore(150);
      b.resources.restore(150);
    }
    // PVP.killRepeat and the anti-farming decay together: never more, and soon nothing.
    for (let i = 1; i < paid.length; i++) expect(paid[i]).toBeLessThanOrEqual(paid[i - 1]);
    expect(paid[paid.length - 1]).toBe(0);
    expect(world.farm.isPaused('a', 'b', world.time)).toBe(true);
    expect(world.directorLog.entries.some((d) => d.kind === 'farming')).toBe(true);
    expect(world.takeFarmFlags().map((f) => f.reason)).toEqual(['kills']);
    run(world, 1.2);
    expect(a.pvp.some((c) => ['raid', 'hunt', 'strike', 'challenge', 'mischief'].includes(c.tag.kind) && c.tag.target === 'b')).toBe(false);
    void PVP;
  });
});

import { describe, expect, it } from 'vitest';
import { BOUNTIES, SITUATION } from '../../src/config';
import { BountyBoard } from './Bounties';
import { addThreat, median, strengthOf, threatNow, tierOf, weakKill, weakKillsWithin } from './Situation';
import { cleanSocial, emptySocial } from './SocialData';
import { launch, player, quietWorld, run } from './testkit';

/** v0.0.19 §2: the multiplayer director: the player's situation, tiers and bounties. */
describe('player situation and tiers', () => {
  it('works out strength from resources, planes and weapons, and tiers against the median', () => {
    expect(strengthOf({ paper: 100, ink: 10, rubber: 2, planes: 1, weapons: 2 })).toBe(100 + 15 + 6 + SITUATION.weights.plane + 2 * SITUATION.weights.weapon);
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(tierOf(50, 100, 2)).toBe('newcomer');
    expect(tierOf(100, 100, 20)).toBe('intermediate');
    expect(tierOf(200, 100, 20)).toBe('advanced');
    // Sorties alone don't make anyone advanced: they also need to be above the median.
    expect(tierOf(90, 100, SITUATION.advancedSorties)).toBe('intermediate');
  });

  it('decays threat with its half-life and survives a save', () => {
    const s = emptySocial();
    addThreat(s, 4, 1_000_000);
    expect(threatNow(s, 1_000_000)).toBe(4);
    expect(threatNow(s, 1_000_000 + SITUATION.halfLife * 1000)).toBeCloseTo(2, 5);
    weakKill(s, 1_000_000, BOUNTIES.window);
    expect(weakKillsWithin(s, 1_000_000, BOUNTIES.window)).toBe(1);
    expect(weakKillsWithin(s, 1_000_000 + (BOUNTIES.window + 1) * 1000, BOUNTIES.window)).toBe(0);
    const back = cleanSocial(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);
    // Rubbish in a save is dropped, not trusted.
    expect(cleanSocial({ threat: -5, mutes: ['ok', 3, '<script>'], reputation: { raids: 'x' } })).toEqual({ ...emptySocial(), mutes: ['ok'] });
  });

  it('the world sees each player: tier, threat, resources, record (and the client is told)', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1');
    const b = player(world, 'b', 'T3');
    b.resources.restore(400);
    run(world, 1.2);
    expect(world.situations.get('a')?.tier).toBeDefined();
    expect(world.situations.get('b')!.strength).toBeGreaterThan(world.situations.get('a')!.strength);
    expect(world.privateFor('a', true)?.situation?.tier).toBe(world.situations.get('a')!.tier);
    void a;
  });

  it('never offers an advanced player a raid on a newcomer, unless the newcomer struck first', () => {
    const world = quietWorld(5);
    const big = player(world, 'big', 'T1', 'Big');
    const small = player(world, 'small', 'T3', 'Small');
    const mid = player(world, 'mid', 'T6', 'Mid');
    for (const p of [big, small, mid]) p.protectUntil = 0;
    big.resources.restore(big.base!.capacity);
    big.resources.restoreOf('ink', 200);
    big.lifetime.successes = 200;
    small.resources.restore(0);
    mid.resources.restore(150);
    run(world, 1.2);
    expect(world.situations.get('big')!.tier).toBe('advanced');
    expect(world.situations.get('small')!.tier).toBe('newcomer');
    expect(world.mismatch(big, small)).toBe(true);
    expect(big.pvp.some((c) => c.tag.kind === 'raid' && c.tag.target === 'small')).toBe(false);
    // The newcomer hit them: retaliation is allowed.
    small.aggression.set('big', world.time);
    expect(world.mismatch(big, small)).toBe(false);
    // An intermediate taking on a stronger player is paid more.
    expect(world.underdogFactor(mid, big)).toBeGreaterThan(1);
    expect(world.underdogFactor(big, mid)).toBe(1);
  });
});

describe('bounties', () => {
  it('split the pot by contribution: no target, no excluded, no tag-and-run, defender priority', () => {
    const pot = { pot: 100, target: 't', defender: undefined as string | undefined };
    const split = BountyBoard.split(pot, new Map([['a', 60], ['b', 30], ['c', 5], ['t', 50]]));
    expect(split).toEqual([{ player: 'a', amount: 66 }, { player: 'b', amount: 33 }]);
    expect(BountyBoard.split(pot, new Map([['a', 60], ['b', 30]]), new Set(['a']))).toEqual([{ player: 'b', amount: 100 }]);
    const withDefender = BountyBoard.split({ ...pot, defender: 'b' }, new Map([['a', 80], ['b', 20]]));
    expect(withDefender.find((s) => s.player === 'b')!.amount).toBe(Math.floor(100 * BOUNTIES.defenderShare));
    // A decaying pair factor scales a share down (anti-farming).
    expect(BountyBoard.split(pot, new Map([['a', 10]]), new Set(), () => 0.5)).toEqual([{ player: 'a', amount: 50 }]);
  });

  it('allows one bounty per target, a cooldown after it, and a cap per session', () => {
    const board = new BountyBoard();
    expect(board.place('ace', 't1', 'T1', 0, 'x', 0)).not.toBeNull();
    expect(board.place('ace', 't1', 'T1', 0, 'x', 0)).toBeNull();
    board.close(board.on('t1')!, 'expired', 10);
    expect(board.refusal('t1', 10 + BOUNTIES.targetCooldown - 1)).toBe('cooldown');
    expect(board.refusal('t1', 10 + BOUNTIES.targetCooldown)).toBeNull();
    for (let i = 0; i < BOUNTIES.maxOpen; i++) board.place('ace', `x${i}`, 'X', 0, 'x', 20);
    expect(board.refusal('another', 20)).toBe('full');
    expect(BountyBoard.pot('ace', 100)).toBe(BOUNTIES.maxPot);
  });

  it('are placed on a player on a kill streak against weaker players, offered to others, and paid by contribution', () => {
    const world = quietWorld(7);
    const ace = player(world, 'ace', 'T1', 'Ace');
    const a = player(world, 'a', 'T3', 'Ann');
    const b = player(world, 'b', 'T6', 'Bo');
    for (const p of [ace, a, b]) p.protectUntil = 0;
    const now = world.wallOf(world.time);
    for (let i = 0; i < BOUNTIES.streak; i++) weakKill(ace.social, now, BOUNTIES.window);
    launch(world, ace, 'falcon');
    run(world, 1.2);
    const bounty = world.bounties.on('ace');
    expect(bounty?.kind).toBe('ace');
    expect(world.privateFor('a', true)?.bounties?.[0]).toMatchObject({ target: 'ace', kind: 'ace' });
    // Ann and Bo get the card; Ace doesn't get one on themself.
    expect(a.pvp.some((c) => c.tag.kind === 'bounty' && c.tag.target === 'ace')).toBe(true);
    expect(ace.pvp.some((c) => c.tag.kind === 'bounty')).toBe(false);
    // Ann does most of the damage, Bo some; then Ace goes down.
    ace.damageLog.push({ by: 'a', amount: 70, at: world.time }, { by: 'b', amount: 30, at: world.time });
    const [pa, pb] = [a.resources.paper, b.resources.paper];
    ace.state!.crash('shot-down');
    expect(world.bounties.on('ace')).toBeUndefined();
    // Each is paid their share of the pot (on top of the kill and the assist themselves).
    const paid = world.directorLog.entries.find((d) => d.kind === 'bounty-paid')!;
    expect(paid.text).toContain(`Ann ${Math.floor(bounty!.pot * 0.7)}`);
    expect(paid.text).toContain(`Bo ${Math.floor(bounty!.pot * 0.3)}`);
    expect(a.resources.paper - pa).toBeGreaterThanOrEqual(Math.floor(bounty!.pot * 0.7));
    expect(b.resources.paper - pb).toBeGreaterThanOrEqual(Math.floor(bounty!.pot * 0.3));
    // Paid once: a second crash pays nothing more.
    expect(world.bounties.open).toEqual([]);
  });

  it('are never placed on an offline or protected player, and end when the target lands or leaves', () => {
    const world = quietWorld(8);
    const ace = player(world, 'ace', 'T1', 'Ace');
    player(world, 'a', 'T3', 'Ann');
    const now = world.wallOf(world.time);
    for (let i = 0; i < BOUNTIES.streak; i++) weakKill(ace.social, now, BOUNTIES.window);
    launch(world, ace, 'falcon');
    // Still under new-player protection: no bounty.
    run(world, 1.2);
    expect(world.bounties.on('ace')).toBeUndefined();
    ace.protectUntil = 0;
    run(world, 1.2);
    expect(world.bounties.on('ace')).toBeDefined();
    world.setConnected('ace', false);
    run(world, 1.2);
    expect(world.bounties.on('ace')).toBeUndefined();
    expect(world.directorLog.entries.some((d) => d.kind === 'bounty')).toBe(true);
    expect(world.directorLog.entries.some((d) => d.kind === 'bounty-ended')).toBe(true);
  });

  it('a repeated raider gets a "prevent the raid" bounty, with the defender keeping priority', () => {
    const world = quietWorld(9);
    const r = player(world, 'r', 'T1', 'Raider');
    const v = player(world, 'v', 'T3', 'Vic');
    for (const p of [r, v]) p.protectUntil = 0;
    v.resources.restore(300);
    world.attacks.history.push({ id: 'old', attacker: 'r', victim: 'x', at: world.time - 60, success: true });
    run(world, 1.2);
    const card = r.pvp.find((c) => c.tag.kind === 'raid')!;
    expect(card).toBeDefined();
    r.state!.select(r.state!.offers.indexOf(card.mission));
    launch(world, r, 'widewing');
    run(world, 1.2);
    const b = world.bounties.on('r');
    expect(b?.kind).toBe('raid');
    expect(b?.defender).toBe('v');
  });
});

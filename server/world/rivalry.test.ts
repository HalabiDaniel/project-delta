import { describe, expect, it } from 'vitest';
import { RIVALRY } from '../../src/config';
import { reputationOf, RivalryBook } from './Rivalry';
import { emptySocial } from './SocialData';
import { launch, player, quietWorld, run } from './testkit';

/** v0.0.19 §5: reputation and rivalries. */
describe('rivalries', () => {
  it('finds the nemesis: whoever beat you most often, the most recent breaking a tie', () => {
    const book = new RivalryBook();
    book.record({ id: '1', kind: 'kill', attacker: 'x', victim: 'me', success: true, at: 1 });
    expect(book.nemesisOf('me')).toBeNull();
    book.record({ id: '2', kind: 'raid', attacker: 'x', victim: 'me', success: true, at: 2 });
    book.record({ id: '3', kind: 'kill', attacker: 'y', victim: 'me', success: true, at: 3 });
    book.record({ id: '4', kind: 'challenge', attacker: 'y', victim: 'me', success: true, at: 4 });
    // A failed raid is no win; an assist and cooperation are not a beating.
    book.record({ id: '5', kind: 'raid', attacker: 'z', victim: 'me', success: false, at: 5 });
    book.record({ id: '6', kind: 'coop', attacker: 'z', victim: 'me', success: true, at: 6 });
    expect(book.nemesisOf('me')?.other).toBe('y');
    // The same record read back twice counts once.
    book.record({ id: '3', kind: 'kill', attacker: 'y', victim: 'me', success: true, at: 3 });
    expect(book.between('me', 'y')).toMatchObject({ wins: 0, losses: 2 });
    expect(book.between('me', 'z')).toMatchObject({ helps: 1, losses: 0 });
    expect(book.between('y', 'me')).toMatchObject({ wins: 2 });
    book.prune(RIVALRY.memory + 3.5);
    expect(book.nemesisOf('me')).toBeNull();
  });

  it('labels reputation by what a player does most, and never before they have done enough', () => {
    const s = emptySocial();
    expect(reputationOf(s)).toBeNull();
    s.reputation = { raids: 2, defends: 1, kills: 0, helps: 0 };
    expect(reputationOf(s)).toBeNull();
    s.reputation = { raids: 5, defends: 7, kills: 3, helps: 1 };
    expect(reputationOf(s)).toBe('defender');
  });

  it('records kills, assists and defenses for the store, and a new world rebuilds the rivalry from them', () => {
    const world = quietWorld(31);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    const c = player(world, 'c', 'T6', 'Cy');
    launch(world, a, 'falcon');
    b.damageLog.length = 0;
    launch(world, b, 'falcon');
    b.damageLog.push({ by: 'c', amount: 40, at: world.time }, { by: 'a', amount: 60, at: world.time });
    b.state!.crash('shot-down');
    const out = world.takePvp();
    expect(out.map((e) => e.kind).sort()).toEqual(['assist', 'kill']);
    expect(world.rivalry.between('b', 'a')).toMatchObject({ losses: 1 });
    // A restart: the same records, read back, rebuild the same rivalry (and count once).
    const again = quietWorld(32);
    player(again, 'a', 'T1', 'Ann');
    player(again, 'b', 'T3', 'Bo');
    const second = { ...out[0], id: 'k2', kind: 'kill' as const, attacker: 'a', victim: 'b', at: out[0].at + 1000 };
    again.rememberPvp([...out, ...out, second]);
    expect(again.rivalry.between('b', 'a')).toMatchObject({ losses: 2 });
    expect(again.rivalry.nemesisOf('b')?.other).toBe('a');
    void c;
  });

  it('weighs rematch cards towards your nemesis, says why, and never past a protection', () => {
    const world = quietWorld(33);
    const me = player(world, 'me', 'T1', 'Me');
    const nem = player(world, 'nem', 'T3', 'Nem');
    const other = player(world, 'o', 'T6', 'Oz');
    for (const p of [me, nem, other]) p.protectUntil = 0;
    for (const p of [nem, other]) p.resources.restore(300);
    world.rememberPvp([1, 2, 3].map((i) => ({ id: `n${i}`, kind: 'kill' as const, attacker: 'nem', victim: 'me', success: true, at: world.wallOf(world.time) - i * 1000 })));
    expect(world.rivalWeight(me, nem)).toEqual({ weight: RIVALRY.rematchWeight, why: 'Rematch with Nem' });
    let rematches = 0;
    for (let i = 0; i < 40; i++) {
      me.pvp = [];
      run(world, 1.05);
      const card = me.pvp.find((c) => c.tag.kind === 'raid');
      if (card?.tag.target === 'nem') {
        rematches++;
        expect(card.tag.why).toBe('Rematch with Nem');
      }
    }
    expect(rematches).toBeGreaterThan(20);
    expect(world.directorLog.entries.some((d) => d.kind === 'rematch')).toBe(true);
    // Shielded: no rematch at all.
    nem.shieldUntil = world.time + 1000;
    me.pvp = [];
    run(world, 1.05);
    expect(me.pvp.some((c) => c.tag.kind === 'raid' && c.tag.target === 'nem')).toBe(false);
    // The player sees their nemesis and their reputation.
    expect(world.privateFor('me', true)?.rivals?.nemesis).toMatchObject({ id: 'nem', name: 'Nem', losses: 3 });
  });

  it('payback: someone who raided you lately is likelier, and the card says so', () => {
    const world = quietWorld(34);
    const me = player(world, 'me', 'T1', 'Me');
    const r = player(world, 'r', 'T3', 'Rex');
    world.rememberPvp([{ id: 'p1', kind: 'raid', attacker: 'r', victim: 'me', success: true, at: world.wallOf(world.time) - 60_000 }]);
    expect(world.rivalWeight(me, r)).toEqual({ weight: RIVALRY.paybackWeight, why: 'Payback: Rex raided you' });
  });
});

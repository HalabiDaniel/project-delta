import { describe, expect, it } from 'vitest';
import { SOCIAL } from '../../src/config';
import { EMOTES, parseCommand, type NetEvent } from '../../src/net/protocol';
import { SocialBook } from './Social';
import { cleanSocial } from './SocialData';
import { launch, place, player, quietWorld, run } from './testkit';

const sent = (world: ReturnType<typeof quietWorld>, t: NetEvent['t']) => world.drainEvents().filter((o) => o.e.t === t);

/** v0.0.19 §6: playful social interaction, with mute and report. */
describe('emotes, ink and mutes', () => {
  it('has more emotes, still rate-limited, and never sends a muted player\'s emotes to whoever muted them', () => {
    expect(EMOTES).toEqual(expect.arrayContaining(['waggle', 'confetti', 'heart', 'salute', 'laugh', 'tease', 'splat']));
    const world = quietWorld();
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a, 'falcon');
    world.drainEvents();
    expect(world.emote('a', 'salute')).toBe(true);
    expect(world.emote('a', 'laugh')).toBe(false);
    expect(sent(world, 'emote').map((o) => o.to).sort()).toEqual(['a', 'b']);
    expect(world.command('b', { a: 'mute', id: 'a', on: true })).toBe(true);
    run(world, 2);
    world.drainEvents();
    expect(world.emote('a', 'tease')).toBe(true);
    expect(sent(world, 'emote').map((o) => o.to)).toEqual(['a']);
    // Kept with the player for good.
    expect(world.progressSave('b')?.social).toMatchObject({ mutes: ['a'] });
    expect(cleanSocial(world.progressSave('b')!.social).mutes).toEqual(['a']);
    expect(world.privateFor('b', true)?.mutes).toEqual(['a']);
    world.command('b', { a: 'mute', id: 'a', on: false });
    expect(b.social.mutes).toEqual([]);
    expect(parseCommand({ a: 'mute', id: 'a', on: 'yes' })).toBeNull();
  });

  it('an ink splat marks the plane just ahead, harmlessly, and it fades', () => {
    const world = quietWorld();
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    launch(world, a, 'falcon');
    launch(world, b, 'falcon');
    place(a, 0, 40, 0, 0);
    place(b, 0, 40, -15, 0);
    const health = b.state!.durability!.health;
    expect(world.emote('a', 'splat')).toBe(true);
    expect(SocialBook.left(world.social.planeInk.get('b'), world.time)).toMatchObject({ by: 'a' });
    expect(b.state!.durability!.health).toBe(health);
    run(world, SOCIAL.inkFade + 1.1);
    expect(world.social.planeInk.get('b')).toBeUndefined();
  });
});

describe('reports', () => {
  it('keeps a report with a reason (no free text), once per player, a few per session', () => {
    const world = quietWorld();
    player(world, 'a', 'T1', 'Ann');
    player(world, 'b', 'T3', 'Bo');
    expect(parseCommand({ a: 'report', id: 'b', reason: 'you are bad' })).toBeNull();
    expect(world.command('a', { a: 'report', id: 'b', reason: 'harassment' })).toBe(true);
    expect(world.command('a', { a: 'report', id: 'b', reason: 'cheating' })).toBe(false);
    expect(world.command('a', { a: 'report', id: 'a', reason: 'cheating' })).toBe(false);
    const reports = world.takeReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reporter: 'a', reported: 'b', reason: 'harassment', context: { reporterName: 'Ann', reportedName: 'Bo' } });
    expect(world.takeReports()).toEqual([]);
    expect(world.privateFor('a', true)?.reported).toEqual(['b']);
    const book = new SocialBook();
    for (let i = 0; i < SOCIAL.reportsPerSession; i++) expect(book.report({ reporter: 'x', reported: `y${i}`, reason: 'other', context: {} })).toBe(true);
    expect(book.reportRefusal('x', 'z')).toBe('many');
  });
});

describe('mischief', () => {
  it('is never offered against a new or offline player, nor anyone who muted you; and is rate-limited per target', () => {
    const world = quietWorld(41);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    a.protectUntil = 0;
    run(world, 1.2);
    // Bo is new.
    expect(a.pvp.some((c) => c.tag.kind === 'mischief')).toBe(false);
    b.protectUntil = 0;
    run(world, 1.2);
    expect(a.pvp.some((c) => c.tag.kind === 'mischief' && c.tag.target === 'b')).toBe(true);
    world.command('b', { a: 'mute', id: 'a', on: true });
    run(world, 1.2);
    expect(a.pvp.some((c) => c.tag.kind === 'mischief')).toBe(false);
    world.command('b', { a: 'mute', id: 'a', on: false });
    world.setConnected('b', false);
    run(world, 1.2);
    expect(a.pvp.some((c) => c.tag.kind === 'mischief')).toBe(false);
    const book = new SocialBook();
    book.mischief('x', 't', 0);
    expect(book.mischiefRefusal('x', 't', 1)).toBe('pair');
    expect(book.mischiefRefusal('x', 't', SOCIAL.mischief.perPair)).toBeNull();
    for (let i = 0; i < SOCIAL.mischief.perTarget; i++) book.mischief(`p${i}`, 'u', 10);
    expect(book.mischiefRefusal('new', 'u', 11)).toBe('target');
  });

  it('inks a banner without destroying anything, and a flyby ends at the first hit from the teased player', () => {
    const world = quietWorld(42);
    const a = player(world, 'a', 'T1', 'Ann');
    const b = player(world, 'b', 'T3', 'Bo');
    for (const p of [a, b]) p.protectUntil = 0;
    run(world, 1.2);
    const card = a.pvp.find((c) => c.tag.kind === 'mischief')!;
    expect(card).toBeDefined();
    a.state!.select(a.state!.offers.indexOf(card.mission));
    launch(world, a, 'falcon');
    // Never a raid: Ann can't damage Bo's base.
    const turret = world.network.on('T3').find((i) => i.isWeapon)!;
    expect(world.mayDamage(a, turret)).toBe(false);
    const paper = b.resources.paper;
    if (card.tag.mischief === 'flyby') {
      const hurt = (world as unknown as { hurtPilot: (v: unknown, n: number, s: string, w: string, by: unknown, at: unknown) => number }).hurtPilot.bind(world);
      hurt(a, 5, 'projectile', 'ink', { player: 'b', name: 'Bo' }, { x: 0, y: 0, z: 0 });
      expect(a.state!.mission!.status).toBe('failed');
    } else {
      (world as unknown as { mischiefDone: (p: unknown, t: unknown) => void }).mischiefDone(a, { ...card.tag, mischief: 'banner' });
      expect(SocialBook.left(world.social.bannerInk.get('T3'), world.time)).toMatchObject({ by: 'a' });
    }
    expect(b.resources.paper).toBeGreaterThanOrEqual(paper);
    // Counted against the limits from launch: no second card on Bo from Ann for a while.
    expect(world.social.mischiefRefusal('a', 'b', world.time)).toBe('pair');
  });
});

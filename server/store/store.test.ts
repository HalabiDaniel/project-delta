import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { TEST_DATABASE_URL, testDatabase, type TestDatabase } from '../db/testdb';
import { hashSecret, newPublicId } from '../identity/secrets';
import { MemoryStore } from './MemoryStore';
import { PgStore } from './PgStore';
import { BASE_FORMAT, IncompatibleBaseError, IncompatibleSaveError, SAVE_FORMAT, type BaseState, type NewPlayer, type Store } from './Store';

/**
 * The store's contract, run against both stores: the in-memory one always, PostgreSQL when
 * TEST_DATABASE_URL is set (each run in its own throw-away schema).
 */

const pepper = 'test-pepper-0123456789';
const h = (s: string) => hashSecret(s, pepper);
const player = (name = 'Ann'): NewPlayer => ({ id: randomUUID(), publicId: newPublicId(), name });

const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

function contract(label: string, open: () => Promise<Store>, extra?: (store: () => Store) => void) {
  describe(`the store (${label})`, () => {
    let store: Store;
    beforeAll(async () => {
      store = await open();
    });

    it('creates players with a hashed device token and finds them by it', async () => {
      const p = await store.createPlayer(player('Ann'), h('token-ann'), 'open');
      expect(p.name).toBe('Ann');
      expect(p.revoked).toBe(false);
      expect((await store.playerByToken(h('token-ann')))?.id).toBe(p.id);
      expect(await store.playerByToken(h('token-nobody'))).toBeNull();
      expect((await store.findPlayers(p.publicId))[0]?.id).toBe(p.id);
      expect((await store.playerById(p.id))?.publicId).toBe(p.publicId);
      expect(await store.playerById('not-a-uuid')).toBeNull();
    });

    it("keeps a player's tutorial progress on their record", async () => {
      const p = await store.createPlayer(player('Tutee'), h('token-tutee'), 'open');
      expect(await store.tutorial(p.id)).toBeNull();
      await store.setTutorial(p.id, { v: 1, step: 4, skipped: false });
      expect(await store.tutorial(p.id)).toEqual({ v: 1, step: 4, skipped: false });
      await store.setTutorial(p.id, { v: 1, step: 10, skipped: true });
      expect(await store.tutorial(p.id)).toEqual({ v: 1, step: 10, skipped: true });
      expect(await store.tutorial('not-a-uuid')).toBeNull();
    });

    it('refuses a second player with the same public id or token', async () => {
      const a = player();
      await store.createPlayer(a, h(`t-${a.id}`), 'open');
      await expect(store.createPlayer({ ...player(), publicId: a.publicId }, h(`t2-${a.id}`), 'open')).rejects.toThrow();
      await expect(store.createPlayer(player(), h(`t-${a.id}`), 'open')).rejects.toThrow();
    });

    it('renames players without changing who they are', async () => {
      const p = await store.createPlayer(player('Bo'), h('token-bo'), 'open');
      await store.rename(p.id, 'Bob');
      const again = await store.playerByToken(h('token-bo'));
      expect(again?.id).toBe(p.id);
      expect(again?.name).toBe('Bob');
    });

    it('revokes players and their tokens, and restores them', async () => {
      const p = await store.createPlayer(player('Cy'), h('token-cy'), 'open');
      expect(await store.setRevoked(p.id, true)).toBe(true);
      expect((await store.playerByToken(h('token-cy')))?.revoked).toBe(true);
      await store.setRevoked(p.id, false);
      expect((await store.playerByToken(h('token-cy')))?.revoked).toBe(false);
      expect(await store.revokeTokens(p.id)).toBe(1);
      expect(await store.playerByToken(h('token-cy'))).toBeNull();
    });

    it('redeems an invite only as often as it allows, and refuses revoked or expired ones', async () => {
      const id = randomUUID();
      await store.createInvite({ id, codeHash: h('INV-TWICE'), label: 'two uses', maxUses: 2, expiresAt: null });
      const a = await store.redeemInvite(h('INV-TWICE'), player('A'), h('tok-a'));
      const b = await store.redeemInvite(h('INV-TWICE'), player('B'), h('tok-b'));
      const c = await store.redeemInvite(h('INV-TWICE'), player('C'), h('tok-c'));
      expect(typeof a).toBe('object');
      expect(typeof b).toBe('object');
      expect(c).toBe('used-up');
      expect(await store.playerByToken(h('tok-c'))).toBeNull();
      expect((await store.listInvites()).find((i) => i.id === id)?.uses).toBe(2);
      expect(await store.redeemInvite(h('INV-NONE'), player(), h('tok-x'))).toBe('unknown');
      const old = randomUUID();
      await store.createInvite({ id: old, codeHash: h('INV-OLD'), label: '', maxUses: 1, expiresAt: new Date(Date.now() - 1000) });
      expect(await store.redeemInvite(h('INV-OLD'), player(), h('tok-y'))).toBe('expired');
      const gone = randomUUID();
      await store.createInvite({ id: gone, codeHash: h('INV-GONE'), label: '', maxUses: 1, expiresAt: null });
      expect(await store.revokeInvite(gone)).toBe(true);
      expect(await store.redeemInvite(h('INV-GONE'), player(), h('tok-z'))).toBe('revoked');
    });

    it('lets only one of two simultaneous redemptions take the last use of an invite', async () => {
      await store.createInvite({ id: randomUUID(), codeHash: h('INV-RACE'), label: '', maxUses: 1, expiresAt: null });
      const results = await Promise.all([1, 2, 3, 4].map((n) => store.redeemInvite(h('INV-RACE'), player(`R${n}`), h(`tok-race-${n}`))));
      expect(results.filter((r) => typeof r === 'object')).toHaveLength(1);
      expect(results.filter((r) => r === 'used-up')).toHaveLength(3);
    });

    it('moves a player to a new device with a single-use, expiring transfer code', async () => {
      const p = await store.createPlayer(player('Di'), h('tok-di'), 'open');
      await store.createTransferCode(p.id, h('XFER-1'), new Date(Date.now() + 60_000), 'player');
      const [first, second] = await Promise.all([store.redeemTransferCode(h('XFER-1'), h('tok-di-2')), store.redeemTransferCode(h('XFER-1'), h('tok-di-3'))]);
      expect([first, second].filter((x) => x?.id === p.id)).toHaveLength(1);
      expect((await store.playerByToken(h('tok-di')))?.id).toBe(p.id);
      const added = first ? h('tok-di-2') : h('tok-di-3');
      expect((await store.playerByToken(added))?.id).toBe(p.id);
      await store.createTransferCode(p.id, h('XFER-OLD'), new Date(Date.now() - 1000), 'admin');
      expect(await store.redeemTransferCode(h('XFER-OLD'), h('tok-di-4'))).toBeNull();
      await store.createTransferCode(p.id, h('XFER-REV'), new Date(Date.now() + 60_000), 'admin');
      await store.setRevoked(p.id, true);
      expect(await store.redeemTransferCode(h('XFER-REV'), h('tok-di-5'))).toBeNull();
    });

    it('opens the same world twice and refuses none of the current format', async () => {
      const a = await store.openWorld('alpha', { note: 'first' });
      const b = await store.openWorld('alpha');
      expect(b.id).toBe(a.id);
      expect(b.format).toBe(SAVE_FORMAT);
      expect(b.settings).toEqual({ note: 'first' });
      expect((await store.listWorlds()).some((w) => w.id === a.id)).toBe(true);
    });

    it('applies a transaction once per key, never overdraws, and logs every change', async () => {
      const world = await store.openWorld('ledger');
      const p = await store.createPlayer(player('Ed'), h('tok-ed'), 'open');
      const tx = { worldId: world.id, playerId: p.id, kind: 'reward', reason: 'Mission complete' };
      expect(await store.applyTransaction({ ...tx, key: 'mission:1', amount: 120, reference: 'mission 1' })).toEqual({ status: 'applied', balance: 120 });
      // The same mission reported again (a repeated message, a refresh, a retry after a restart).
      expect(await store.applyTransaction({ ...tx, key: 'mission:1', amount: 120 })).toEqual({ status: 'duplicate', balance: 120 });
      expect(await store.applyTransaction({ ...tx, key: 'build:7', kind: 'spend', amount: -200 })).toEqual({ status: 'insufficient', balance: 120 });
      expect(await store.applyTransaction({ ...tx, key: 'build:8', kind: 'spend', amount: -100 })).toEqual({ status: 'applied', balance: 20 });
      expect(await store.balance(world.id, p.id)).toBe(20);
      const log = await store.transactions(world.id, p.id);
      expect(log.map((t) => [t.key, t.amount, t.balanceAfter])).toEqual([
        ['build:8', -100, 20],
        ['mission:1', 120, 120],
      ]);
      // The balance is the sum of the log.
      expect(log.reduce((sum, t) => sum + t.amount, 0)).toBe(20);
      await expect(store.applyTransaction({ ...tx, key: '', amount: 1 })).rejects.toThrow();
      await expect(store.applyTransaction({ ...tx, key: 'frac', amount: 1.5 })).rejects.toThrow();
    });

    it('pays a reward once when the same completion arrives many times at once', async () => {
      const world = await store.openWorld('race');
      const p = await store.createPlayer(player('Flo'), h('tok-flo'), 'open');
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.applyTransaction({ worldId: world.id, playerId: p.id, key: 'mission:race', kind: 'reward', amount: 50, reason: 'race' })),
      );
      expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
      expect(await store.balance(world.id, p.id)).toBe(50);
      expect(await store.transactions(world.id, p.id)).toHaveLength(1);
    });

    it('keeps two players finishing missions at the same moment apart', async () => {
      const world = await store.openWorld('pair');
      const a = await store.createPlayer(player('Gil'), h('tok-gil'), 'open');
      const b = await store.createPlayer(player('Hal'), h('tok-hal'), 'open');
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => [
          store.applyTransaction({ worldId: world.id, playerId: a.id, key: `a:${i}`, kind: 'reward', amount: 10, reason: '' }),
          store.applyTransaction({ worldId: world.id, playerId: b.id, key: `b:${i}`, kind: 'reward', amount: 7, reason: '' }),
        ]).flat(),
      );
      expect(await store.balance(world.id, a.id)).toBe(100);
      expect(await store.balance(world.id, b.id)).toBe(70);
    });

    it('lets simultaneous spending never take the balance below zero', async () => {
      const world = await store.openWorld('spend');
      const p = await store.createPlayer(player('Ivy'), h('tok-ivy'), 'open');
      await store.applyTransaction({ worldId: world.id, playerId: p.id, key: 'seed', kind: 'grant', amount: 100, reason: '' });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => store.applyTransaction({ worldId: world.id, playerId: p.id, key: `spend:${i}`, kind: 'spend', amount: -30, reason: '' })),
      );
      expect(results.filter((r) => r.status === 'applied')).toHaveLength(3);
      expect(await store.balance(world.id, p.id)).toBe(10);
    });

    // ---- Portable bases (v0.0.12) -----------------------------------------------------------------

    const aBase = (storeHealth = 80): BaseState => ({
      storeHealth,
      stats: { raids: 2, repelled: 1 },
      buildings: [
        { slot: 'D1', kind: 'turret', level: 2, health: 55, data: { invested: 105, kills: 3 } },
        { slot: 'E1', kind: 'workshop', level: 1, health: 0, data: { invested: 80 } },
      ],
    });

    it('keeps the paper limits with the balance, and knows a player who has never had paper', async () => {
      const world = await store.openWorld('limits');
      const p = await store.createPlayer(player('Lim'), h('tok-lim'), 'open');
      expect(await store.economy(world.id, p.id)).toBeNull();
      await store.applyTransaction({ worldId: world.id, playerId: p.id, key: 'start', kind: 'reward', amount: 100, reason: '' });
      expect(await store.economy(world.id, p.id)).toEqual({ paper: 100, capacity: 0, protected: 0 });
      await store.setEconomyLimits(world.id, p.id, 450, 40);
      await store.setEconomyLimits(world.id, p.id, 500, 45);
      expect(await store.economy(world.id, p.id)).toEqual({ paper: 100, capacity: 500, protected: 45 });
      await expect(store.setEconomyLimits(world.id, p.id, -1, 0)).rejects.toThrow();
      // Limits alone (a player whose first change hasn't been written yet) still count as a record.
      const q = await store.createPlayer(player('Lim2'), h('tok-lim2'), 'open');
      await store.setEconomyLimits(world.id, q.id, 300, 30);
      expect(await store.economy(world.id, q.id)).toEqual({ paper: 0, capacity: 300, protected: 30 });
    });

    it('keeps the planes a player owns, and destroys for good the ones no longer listed', async () => {
      const world = await store.openWorld('planes');
      const p = await store.createPlayer(player('Pilot'), h('tok-pilot'), 'open');
      const falcon = { id: randomUUID(), type: 'falcon', status: 'ready' as const, health: 70, loadout: { invested: 45 } };
      const dart = { id: randomUUID(), type: 'dart', status: 'damaged' as const, health: 12, loadout: {} };
      expect(await store.aircraft(world.id, p.id)).toEqual([]);
      await store.saveAircraft(world.id, p.id, [falcon, dart]);
      expect(sortById(await store.aircraft(world.id, p.id))).toEqual(sortById([falcon, dart]));
      // The Dart crashed: it isn't listed any more, and it never comes back.
      await store.saveAircraft(world.id, p.id, [{ ...falcon, status: 'airborne', health: 50 }]);
      expect(await store.aircraft(world.id, p.id)).toEqual([{ ...falcon, status: 'airborne', health: 50 }]);
      await expect(store.saveAircraft(world.id, p.id, [falcon, dart])).rejects.toThrow(/destroyed/);
      expect(await store.aircraft(world.id, p.id)).toHaveLength(1);
      // Another player can't take over someone's plane by its id.
      const q = await store.createPlayer(player('Thief'), h('tok-thief'), 'open');
      await expect(store.saveAircraft(world.id, q.id, [falcon])).rejects.toThrow();
      await expect(store.saveAircraft(world.id, p.id, [{ ...falcon, status: 'flying' as never }])).rejects.toThrow();
    });

    it("keeps a player's progress and writes each mission's outcome once", async () => {
      const world = await store.openWorld('progress');
      const p = await store.createPlayer(player('Prog'), h('tok-prog'), 'open');
      expect(await store.progress(world.id, p.id)).toBeNull();
      const record = { stats: { kills: 3, sorties: 9 }, director: { swaps: 2, offers: [] }, garage: { aircraft: 'falcon', board: { safe: randomUUID() } } };
      await store.saveProgress(world.id, p.id, record);
      expect(await store.progress(world.id, p.id)).toEqual({ ...record, protectUntil: null, shieldUntil: null });
      await store.saveProgress(world.id, p.id, { ...record, stats: { kills: 4, sorties: 10 } });
      expect((await store.progress(world.id, p.id))?.stats).toEqual({ kills: 4, sorties: 10 });
      const outcome = { id: randomUUID(), template: 'strike', state: 'completed' as const, outcome: null, reward: 60, spec: { title: 'Strike' } };
      expect(await store.recordMission(world.id, p.id, outcome)).toBe(true);
      expect(await store.recordMission(world.id, p.id, { ...outcome, reward: 999 })).toBe(false);
      const racing = { ...outcome, id: randomUUID() };
      const twice = await Promise.all([1, 2, 3].map(() => store.recordMission(world.id, p.id, racing)));
      expect(twice.filter(Boolean)).toHaveLength(1);
    });

    it("keeps the first-time tips a player has seen, cleaned", async () => {
      const p = await store.createPlayer(player('Tippy'), h('tok-tippy'), 'open');
      expect(await store.tips(p.id)).toEqual([]);
      await store.setTips(p.id, ['mp-desk', 'mp-desk', '<script>', 'raid-card']);
      expect(await store.tips(p.id)).toEqual(['mp-desk', 'raid-card']);
    });

    it('gives each username to one player only, ignoring case, and lets it change once a week', async () => {
      const tag = randomUUID().slice(0, 6);
      const a = await store.createPlayer(player('a'), h(`tok-ua-${tag}`), 'open');
      const b = await store.createPlayer(player('b'), h(`tok-ub-${tag}`), 'open');
      expect(await store.setUsername(a.id, `Ace_${tag}`, 3600)).toBe('ok');
      expect((await store.playerById(a.id))).toMatchObject({ username: `Ace_${tag}`, name: `Ace_${tag}` });
      expect(await store.setUsername(b.id, `ACE_${tag}`, 3600)).toBe('taken');
      expect(await store.setUsername(a.id, `Ace_${tag}`, 3600)).toBe('same');
      // A case-only change is always fine; a new name waits for the cooldown.
      expect(await store.setUsername(a.id, `ace_${tag}`, 3600)).toBe('ok');
      expect(await store.setUsername(a.id, `Ace2_${tag}`, 3600)).toBe('cooldown');
      expect(await store.setUsername(a.id, `Ace2_${tag}`, 0)).toBe('ok');
      // The old name is free again.
      expect(await store.setUsername(b.id, `ACE_${tag}`, 3600)).toBe('ok');
      expect((await store.findPlayers(`ace_${tag}`)).map((p) => p.id)).toEqual([b.id]);
      // Two players asking for one name at once: one gets it.
      const c = await store.createPlayer(player('c'), h(`tok-uc-${tag}`), 'open');
      const d = await store.createPlayer(player('d'), h(`tok-ud-${tag}`), 'open');
      const both = await Promise.all([store.setUsername(c.id, `Twin_${tag}`, 0), store.setUsername(d.id, `twin_${tag}`, 0)]);
      expect(both.sort()).toEqual(['ok', 'taken']);
    });

    it('keeps raids and kills between players, found from either side, each once', async () => {
      const world = await store.openWorld('pvp');
      const a = await store.createPlayer(player('Raider'), h('tok-raider'), 'open');
      const b = await store.createPlayer(player('Target'), h('tok-target'), 'open');
      const old = { id: randomUUID(), kind: 'raid' as const, attacker: a.id, victim: b.id, success: true, at: new Date(Date.now() - 3_600_000) };
      const raid = { id: randomUUID(), kind: 'raid' as const, attacker: a.id, victim: b.id, success: true, at: new Date(Date.now() - 60_000) };
      const kill = { id: randomUUID(), kind: 'kill' as const, attacker: b.id, victim: a.id, success: true, at: new Date(Date.now() - 30_000) };
      for (const r of [old, raid, raid, kill]) await store.addPvpRecord(world.id, r);
      const since = new Date(Date.now() - 600_000);
      const ofA = await store.pvpRecords(world.id, a.id, since);
      expect(ofA.map((r) => r.id)).toEqual([raid.id, kill.id]);
      expect(ofA[0]).toMatchObject({ kind: 'raid', attacker: a.publicId, victim: b.publicId, success: true });
      expect((await store.pvpRecords(world.id, b.id, since)).map((r) => r.id)).toEqual([raid.id, kill.id]);
    });

    it('keeps protections as clock times with the progress', async () => {
      const world = await store.openWorld('timers');
      const p = await store.createPlayer(player('Shielded'), h('tok-shielded'), 'open');
      const protectUntil = new Date(Date.now() + 120_000);
      await store.saveProgress(world.id, p.id, { stats: {}, director: null, garage: {}, protectUntil, shieldUntil: null });
      const back = await store.progress(world.id, p.id);
      expect(back?.protectUntil?.getTime()).toBe(protectUntil.getTime());
      expect(back?.shieldUntil).toBeNull();
    });

    it("places a new player's base for one room, which saves and packs it; nobody else can meanwhile", async () => {
      const p = await store.createPlayer(player('Mo'), h('tok-mo'), 'open');
      expect(await store.base(p.id)).toBeNull();
      expect(await store.placeBase(p.id, 'srv/a', 'T3', 60)).toEqual({ status: 'placed', state: null });
      const held = await store.placeBase(p.id, 'srv/b', 'T7', 60);
      expect(held).toMatchObject({ status: 'elsewhere', placement: { holder: 'srv/a', territoryId: 'T3' } });
      expect(await store.saveBase(p.id, 'srv/b', aBase(1), 60)).toBe(false);
      expect(await store.saveBase(p.id, 'srv/a', aBase(), 60)).toBe(true);
      expect((await store.base(p.id))?.state).toEqual(aBase());
      // Placing again for the same room renews it (a reconnect).
      expect(await store.placeBase(p.id, 'srv/a', 'T3', 60)).toEqual({ status: 'placed', state: aBase() });
      expect(await store.packBase(p.id, 'srv/b', aBase(2))).toBe(false);
      expect(await store.packBase(p.id, 'srv/a', aBase(70))).toBe(true);
      const packed = await store.base(p.id);
      expect(packed?.placement).toBeNull();
      expect(packed?.state?.storeHealth).toBe(70);
      // Packed: saving as the old room does nothing, and any room can place it now, as it was left.
      expect(await store.saveBase(p.id, 'srv/a', aBase(1), 60)).toBe(false);
      expect(await store.placeBase(p.id, 'srv/b', 'T7', 60)).toEqual({ status: 'placed', state: aBase(70) });
      expect((await store.base(p.id))?.placement).toMatchObject({ holder: 'srv/b', territoryId: 'T7' });
    });

    it('replaces the buildings on every save: a removed building stays removed', async () => {
      const p = await store.createPlayer(player('Ned'), h('tok-ned'), 'open');
      await store.placeBase(p.id, 'srv/a', 'T2', 60);
      await store.saveBase(p.id, 'srv/a', aBase(), 60);
      const fewer = { ...aBase(), buildings: aBase().buildings.slice(0, 1) };
      await store.saveBase(p.id, 'srv/a', fewer, 60);
      expect((await store.base(p.id))?.state?.buildings).toEqual(fewer.buildings);
    });

    it("lets a crashed room's base go once its lease runs out", async () => {
      const p = await store.createPlayer(player('Oz'), h('tok-oz'), 'open');
      await store.placeBase(p.id, 'dead/a', 'T4', 0);
      await new Promise((r) => setTimeout(r, 20));
      expect(await store.placeBase(p.id, 'srv/b', 'T9', 60)).toMatchObject({ status: 'placed' });
      // The dead room can't write over it any more.
      expect(await store.saveBase(p.id, 'dead/a', aBase(1), 60)).toBe(false);
    });

    it('never places one base in two rooms, even when both try at once', async () => {
      const p = await store.createPlayer(player('Pia'), h('tok-pia'), 'open');
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => store.placeBase(p.id, `srv/${i}`, `T${i + 1}`, 60)));
      expect(results.filter((r) => r.status === 'placed')).toHaveLength(1);
    });

    it('releases a placement for its holder, or for the developer whoever holds it', async () => {
      const p = await store.createPlayer(player('Quin'), h('tok-quin'), 'open');
      await store.placeBase(p.id, 'srv/a', 'T5', 60);
      expect(await store.releaseBase(p.id, 'srv/b')).toBe(false);
      expect(await store.releaseBase(p.id, 'srv/a')).toBe(true);
      expect(await store.releaseBase(p.id)).toBe(false);
      await store.placeBase(p.id, 'srv/c', 'T5', 60);
      expect(await store.releaseBase(p.id)).toBe(true);
      expect((await store.base(p.id))?.placement).toBeNull();
    });

    it('records sessions as they open, start and end, keeping the busiest moment', async () => {
      const id = `s-${randomUUID().slice(0, 8)}`;
      const created = new Date(Date.now() - 1000);
      const base = { id, title: 'Classroom', capacity: 16, createdAt: created, startedAt: null, endsAt: null, endedAt: null, status: 'open' as const, peakPlayers: 0, desks: {} as Record<string, string> };
      await store.recordSession(base);
      const started = new Date();
      const ends = new Date(started.getTime() + 3600_000);
      await store.recordSession({ ...base, startedAt: started, endsAt: ends, peakPlayers: 5 });
      const ann = randomUUID();
      await store.recordSession({ ...base, startedAt: started, endsAt: ends, status: 'closing', peakPlayers: 3, desks: { [ann]: 'T7', 'not-a-player': 'T1' } });
      const running = (await store.sessionRecords(['open', 'closing'])).find((r) => r.id === id);
      expect(running).toMatchObject({ status: 'closing', peakPlayers: 5, capacity: 16 });
      expect(running?.endsAt?.getTime()).toBe(ends.getTime());
      expect(running?.createdAt.getTime()).toBe(created.getTime());
      expect(running?.desks).toEqual({ [ann]: 'T7' });
      await store.recordSession({ ...base, startedAt: started, endsAt: ends, endedAt: new Date(), status: 'ended', peakPlayers: 0 });
      expect((await store.sessionRecords(['open', 'closing'])).some((r) => r.id === id)).toBe(false);
      expect((await store.sessionRecords()).find((r) => r.id === id)?.status).toBe('ended');
    });

    it('refuses to save a broken base', async () => {
      const p = await store.createPlayer(player('Ray'), h('tok-ray'), 'open');
      await store.placeBase(p.id, 'srv/a', 'T6', 60);
      await expect(store.saveBase(p.id, 'srv/a', { ...aBase(), storeHealth: -3 }, 60)).rejects.toThrow();
      await expect(store.packBase(p.id, 'srv/a', { ...aBase(), buildings: [aBase().buildings[0], aBase().buildings[0]] })).rejects.toThrow();
      expect((await store.base(p.id))?.placement).not.toBeNull();
    });

    extra?.(() => store);

    afterAll(async () => {
      await store.close();
    });
  });
}

contract('memory', async () => new MemoryStore(), (store) => {
  it('refuses a world written in a newer format', async () => {
    const s = store() as MemoryStore;
    await s.openWorld('future');
    s.worldFormatOverride = SAVE_FORMAT + 1;
    await expect(s.openWorld('future')).rejects.toBeInstanceOf(IncompatibleSaveError);
    s.worldFormatOverride = null;
  });
});

let pgdb: TestDatabase | null = null;
describe.skipIf(!TEST_DATABASE_URL)('PostgreSQL', () => {
  afterAll(async () => {
    await pgdb?.dispose();
  });
  contract(
    'postgres',
    async () => {
      pgdb = await testDatabase();
      await migrate(pgdb!.db);
      return new PgStore(pgdb!.db);
    },
    (store) => {
      it('refuses a world written in a newer format, with a message that says why', async () => {
        const s = store() as PgStore;
        await s.openWorld('future');
        await s.db.query(`update worlds set format = $1 where name = 'future'`, [SAVE_FORMAT + 1]);
        const error = await s.openWorld('future').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(IncompatibleSaveError);
        expect((error as Error).message).toMatch(/format 2.*only understands format 1/);
      });

      it('refuses a base saved in a newer format', async () => {
        const s = store() as PgStore;
        const p = await s.createPlayer(player('Sol'), h('tok-sol'), 'open');
        await s.placeBase(p.id, 'srv/a', 'T1', 60);
        await s.db.query('update bases set format = $2 where player_id = $1', [p.id, BASE_FORMAT + 1]);
        await expect(s.base(p.id)).rejects.toBeInstanceOf(IncompatibleBaseError);
      });

      it("keeps a base's placement consistent in the database itself", async () => {
        const s = store() as PgStore;
        const p = await s.createPlayer(player('Tam'), h('tok-tam'), 'open');
        await s.placeBase(p.id, 'srv/a', 'T1', 60);
        await expect(s.db.query('update bases set placed_on = null where player_id = $1', [p.id])).rejects.toThrow();
        await expect(s.db.query(`insert into base_buildings (player_id, slot, kind, level, health) values ($1, 'D1', 'castle', 1, 10)`, [p.id])).rejects.toThrow();
      });

      it('stores hashes, never tokens or codes', async () => {
        const s = store() as PgStore;
        await s.createPlayer(player('Jo'), h('plain-token-jo'), 'open');
        const { rows } = await s.db.query<{ token_hash: string }>('select token_hash from player_tokens');
        expect(rows.some((r) => r.token_hash.includes('plain-token'))).toBe(false);
        expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
      });

      it('keeps the balance and its log row together: a failed log write changes no balance', async () => {
        const s = store() as PgStore;
        const world = await s.openWorld('atomic');
        const p = await s.createPlayer(player('Kai'), h('tok-kai'), 'open');
        // A reason the log can't hold makes the insert fail after the balance row was locked.
        await expect(s.applyTransaction({ worldId: world.id, playerId: p.id, key: 'x', kind: 'k'.repeat(41), amount: 10, reason: '' })).rejects.toThrow();
        await expect(s.db.query(`insert into transactions (world_id, player_id, idem_key, kind, amount, balance_after) values ($1, $2, 'neg', 'k', -5, -5)`, [world.id, p.id])).rejects.toThrow();
        expect(await s.balance(world.id, p.id)).toBe(0);
      });

      it('only lets a destroyed aircraft be marked destroyed with a time, and never back', async () => {
        const s = store() as PgStore;
        const world = await s.openWorld('hangar');
        const p = await s.createPlayer(player('Lu'), h('tok-lu'), 'open');
        const id = randomUUID();
        await s.db.query(`insert into aircraft (id, world_id, player_id, type, status, health) values ($1, $2, $3, 'dart', 'ready', 40)`, [id, world.id, p.id]);
        await expect(s.db.query(`update aircraft set status = 'destroyed' where id = $1`, [id])).rejects.toThrow();
        await s.db.query(`update aircraft set status = 'destroyed', destroyed_at = now() where id = $1`, [id]);
        await expect(s.db.query(`update aircraft set status = 'ready' where id = $1`, [id])).rejects.toThrow();
        await expect(s.db.query(`update aircraft set status = 'ready', destroyed_at = null where id = $1`, [id])).rejects.toThrow(/cannot be restored/);
      });
    },
  );
});

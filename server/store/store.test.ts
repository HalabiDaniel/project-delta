import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { TEST_DATABASE_URL, testDatabase, type TestDatabase } from '../db/testdb';
import { hashSecret, newPublicId } from '../identity/secrets';
import { MemoryStore } from './MemoryStore';
import { PgStore } from './PgStore';
import { IncompatibleSaveError, SAVE_FORMAT, type NewPlayer, type Store } from './Store';

/**
 * The store's contract, run against both stores: the in-memory one always, PostgreSQL when
 * TEST_DATABASE_URL is set (each run in its own throw-away schema).
 */

const pepper = 'test-pepper-0123456789';
const h = (s: string) => hashSecret(s, pepper);
const player = (name = 'Ann'): NewPlayer => ({ id: randomUUID(), publicId: newPublicId(), name });

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

import { describe, expect, it } from 'vitest';
import { ConfigError, DEV_PEPPER, serverConfig } from '../config';
import { MemoryStore } from '../store/MemoryStore';
import type { Store } from '../store/Store';
import { AuthFailure, Identity } from './Identity';
import { hashSecret, isTokenShaped, newCode, newPublicId, newToken, normaliseCode, sameHash } from './secrets';

const PEPPER = 'a-test-pepper-of-some-length';

describe('secrets', () => {
  it('makes 256-bit tokens that never repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken()));
    expect(seen.size).toBe(500);
    for (const t of seen) {
      expect(isTokenShaped(t)).toBe(true);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes with the pepper: another pepper, another hash', () => {
    const t = newToken();
    expect(hashSecret(t, PEPPER)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(t, PEPPER)).not.toBe(hashSecret(t, `${PEPPER}!`));
    expect(sameHash(hashSecret(t, PEPPER), hashSecret(t, PEPPER))).toBe(true);
    expect(sameHash(hashSecret(t, PEPPER), hashSecret(`${t}x`, PEPPER))).toBe(false);
  });

  it('makes typeable codes and reads them back however they were typed', () => {
    const code = newCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normaliseCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normaliseCode('k7q2m9xrta')).toBe('K7Q2M-9XRTA');
    // Look-alikes: O is 0, I and L are 1.
    expect(normaliseCode('O0000-IIIII')).toBe('00000-11111');
    expect(normaliseCode('short')).toBeNull();
    expect(normaliseCode('UUUUU-UUUUU')).toBeNull();
    expect(normaliseCode(42)).toBeNull();
  });

  it('makes short public ids', () => {
    expect(newPublicId()).toMatch(/^[a-z2-9]{8}$/);
  });
});

describe('the server configuration', () => {
  it('runs in development with defaults and says what is missing', () => {
    const c = serverConfig({});
    expect(c).toMatchObject({ port: 2567, databaseUrl: null, pepper: DEV_PEPPER, access: 'open', production: false });
    expect(c.warnings.join(' ')).toMatch(/TOKEN_PEPPER/);
    expect(c.warnings.join(' ')).toMatch(/DATABASE_URL/);
  });

  it('insists on a database and a pepper in production, and defaults to invites', () => {
    expect(() => serverConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(ConfigError);
    expect(() => serverConfig({ NODE_ENV: 'production', TOKEN_PEPPER: 'p'.repeat(32) })).toThrow(/DATABASE_URL/);
    const c = serverConfig({ NODE_ENV: 'production', TOKEN_PEPPER: 'p'.repeat(32), DATABASE_URL: 'postgres://x', PORT: '8080' });
    expect(c).toMatchObject({ access: 'invite', port: 8080, production: true, warnings: [] });
  });

  it('refuses nonsense', () => {
    expect(() => serverConfig({ ACCESS: 'public' })).toThrow(/ACCESS/);
    expect(() => serverConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => serverConfig({ TOKEN_PEPPER: 'short' })).toThrow(/16/);
  });
});

describe('the identity service', () => {
  const make = (access: 'open' | 'invite' = 'open', store: Store = new MemoryStore()) => ({ store, identity: new Identity(store, PEPPER, access) });

  it('gives a new player a token in open mode, and recognises the token afterwards', async () => {
    const { store, identity } = make();
    const first = await identity.authenticate({ name: 'Ann' });
    expect(first.via).toBe('open');
    expect(first.token).toBeTruthy();
    const again = await identity.authenticate({ token: first.token, name: 'Ann' });
    expect(again).toMatchObject({ via: 'token', token: null });
    expect(again.player.id).toBe(first.player.id);
    // Only the hash is stored.
    expect(await store.playerByToken(first.token!)).toBeNull();
    expect((await store.playerByToken(hashSecret(first.token!, PEPPER)))?.id).toBe(first.player.id);
  });

  it('updates the display name, which never changes who the player is', async () => {
    const { identity } = make();
    const first = await identity.authenticate({ name: 'Ann' });
    const renamed = await identity.authenticate({ token: first.token, name: 'Queen Ann' });
    expect(renamed.player).toMatchObject({ id: first.player.id, publicId: first.player.publicId, name: 'Queen Ann' });
  });

  it('refuses everyone without an invite in invite mode, and unknown tokens with a hint', async () => {
    const { identity } = make('invite');
    await expect(identity.authenticate({ name: 'Eve' })).rejects.toMatchObject({ code: 'invite-required' });
    await expect(identity.authenticate({ token: newToken(), name: 'Eve' })).rejects.toMatchObject({ code: 'unknown-device' });
    await expect(identity.authenticate({ code: 'not a code', name: 'Eve' })).rejects.toMatchObject({ code: 'bad-code' });
    await expect(identity.authenticate({ code: newCode(), name: 'Eve' })).rejects.toMatchObject({ code: 'bad-code' });
  });

  it('turns an invite into a player and a token', async () => {
    const { identity } = make('invite');
    const { code, invite } = await identity.createInvite('for the friend');
    expect(invite).toMatchObject({ label: 'for the friend', maxUses: 1, uses: 0, revoked: false });
    expect(invite.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);
    const friend = await identity.authenticate({ code: code.toLowerCase(), name: 'Bo' });
    expect(friend.via).toBe('invite');
    expect((await identity.authenticate({ token: friend.token, name: 'Bo' })).player.id).toBe(friend.player.id);
  });

  it('moves a player with a transfer code; a typed code wins over the token already in the browser', async () => {
    const { identity } = make('invite');
    const { code: invite } = await identity.createInvite('ann', 2);
    const ann = await identity.authenticate({ code: invite, name: 'Ann' });
    const bo = await identity.authenticate({ code: invite, name: 'Bo' });
    const { code } = await identity.transferCode(ann.player.id);
    // Bo's computer, with Bo's token, takes Ann's transfer code: it becomes Ann's.
    const moved = await identity.authenticate({ token: bo.token, code, name: 'Ann' });
    expect(moved.via).toBe('transfer');
    expect(moved.player.id).toBe(ann.player.id);
    expect(moved.token).not.toBe(ann.token);
    // Both of Ann's devices work; Bo's token still works for Bo.
    expect((await identity.authenticate({ token: ann.token, name: 'Ann' })).player.id).toBe(ann.player.id);
    expect((await identity.authenticate({ token: moved.token, name: 'Ann' })).player.id).toBe(ann.player.id);
    expect((await identity.authenticate({ token: bo.token, name: 'Bo' })).player.id).toBe(bo.player.id);
    await expect(identity.authenticate({ code, name: 'Ann' })).rejects.toBeInstanceOf(AuthFailure);
  });

  it('lets the developer reissue a lost pass with a longer-lived code', async () => {
    const { identity } = make('invite');
    const { code: invite } = await identity.createInvite('');
    const ann = await identity.authenticate({ code: invite, name: 'Ann' });
    const { code, expiresAt } = await identity.transferCode(ann.player.id, 'admin');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect((await identity.authenticate({ code, name: 'Ann' })).player.id).toBe(ann.player.id);
  });

  it('refuses revoked players, whatever token they bring', async () => {
    const { store, identity } = make();
    const ann = await identity.authenticate({ name: 'Ann' });
    await store.setRevoked(ann.player.id, true);
    await expect(identity.authenticate({ token: ann.token, name: 'Ann' })).rejects.toMatchObject({ code: 'revoked' });
  });

  it("says the server can't check passes when the store fails, without leaking why", async () => {
    const store = new MemoryStore();
    store.playerByToken = async () => {
      throw new Error('connection terminated: password authentication failed for user "x"');
    };
    const { identity } = make('open', store);
    const error = await identity.authenticate({ token: newToken(), name: 'Ann' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unavailable' });
    expect((error as Error).message).not.toMatch(/password/);
  });
});

import { randomUUID } from 'node:crypto';
import type { AccessMode } from '../config';
import type { InviteRecord, NewPlayer, PlayerRecord, Store } from '../store/Store';
import { hashSecret, isTokenShaped, newCode, newPlayerId, newPublicId, newToken, normaliseCode } from './secrets';

export const IDENTITY = {
  /** A transfer code made from the pause menu works this long (seconds). */
  transferTtl: 15 * 60,
  /** A transfer code the developer makes (a reissued pass) works this long. */
  reissueTtl: 7 * 24 * 3600,
  /** Invites made by the admin tool expire after this many days unless told otherwise. */
  inviteDays: 14,
} as const;

/**
 * Why a join was refused. The message is shown to the player as it is.
 */
export type AuthFailureCode = 'invite-required' | 'bad-code' | 'revoked' | 'unknown-device' | 'unavailable';

const MESSAGES: Record<AuthFailureCode, string> = {
  'invite-required': 'This alpha is invite-only. Enter your invite code to join.',
  'bad-code': "That code didn't work: it may be mistyped, already used or expired.",
  revoked: 'Access for this player has been withdrawn. Ask the developer.',
  'unknown-device': "This browser's pass isn't recognised any more. Enter an invite or transfer code.",
  unavailable: "The server can't check your pass right now. Try again in a moment.",
};

export class AuthFailure extends Error {
  constructor(readonly code: AuthFailureCode) {
    super(MESSAGES[code]);
    // An expected refusal: Colyseus logs refused joins, one line is enough.
    this.stack = `join refused (${code}): ${this.message}`;
  }
}

/** A join refused for a reason that isn't an error (a full room): logged in one line. */
export function refusal(message: string): Error {
  const e = new Error(message);
  e.stack = `join refused: ${message}`;
  return e;
}

export interface Credentials {
  /** The device token this browser was given before. */
  token?: unknown;
  /** An invite code (first join) or a transfer code (moving to this device). */
  code?: unknown;
  /** The display name to use (already cleaned). */
  name: string;
}

export interface Authenticated {
  player: PlayerRecord;
  /** A new device token, when one was issued just now: the browser must keep it. */
  token: string | null;
  /** How they got in, for the log. */
  via: 'token' | 'invite' | 'transfer' | 'open';
}

/**
 * Who a connecting browser is. The answer comes only from things the server can check: a device
 * token (hashed and looked up), an invite code or a transfer code. Nothing the client says about
 * itself (a player id, a name) decides it.
 *
 * - A code, when given, wins: typing a transfer code on a computer that played before moves that
 *   computer to the code's player.
 * - Else a known token is the player it belongs to.
 * - Else, with ACCESS=open, a new player is made; with ACCESS=invite the join is refused.
 */
export class Identity {
  constructor(
    readonly store: Store,
    private readonly pepper: string,
    readonly access: AccessMode,
  ) {}

  hash(secret: string): string {
    return hashSecret(secret, this.pepper);
  }

  async authenticate(credentials: Credentials): Promise<Authenticated> {
    try {
      return await this.check(credentials);
    } catch (error) {
      if (error instanceof AuthFailure) throw error;
      // The database is down or misbehaving: say so, without details.
      console.error(`[auth] ${(error as Error).message}`);
      throw new AuthFailure('unavailable');
    }
  }

  private async check({ token, code, name }: Credentials): Promise<Authenticated> {
    const typed = code !== undefined && code !== null && code !== '' ? normaliseCode(code) : null;
    if (code !== undefined && code !== null && code !== '' && !typed) throw new AuthFailure('bad-code');
    if (typed) return this.redeem(typed, name);
    if (isTokenShaped(token)) {
      const player = await this.store.playerByToken(this.hash(token));
      if (player) {
        if (player.revoked) throw new AuthFailure('revoked');
        if (player.name !== name) {
          await this.store.rename(player.id, name);
          player.name = name;
        }
        await this.store.touch(player.id);
        return { player, token: null, via: 'token' };
      }
      if (this.access === 'invite') throw new AuthFailure('unknown-device');
    }
    if (this.access === 'invite') throw new AuthFailure('invite-required');
    const fresh = newToken();
    const player = await this.withNewIds(name, (p) => this.store.createPlayer(p, this.hash(fresh), 'open'));
    return { player, token: fresh, via: 'open' };
  }

  /** A typed code: a transfer code first, then an invite. */
  private async redeem(code: string, name: string): Promise<Authenticated> {
    const codeHash = this.hash(code);
    const fresh = newToken();
    const moved = await this.store.redeemTransferCode(codeHash, this.hash(fresh));
    if (moved) {
      if (moved.name !== name) {
        await this.store.rename(moved.id, name);
        moved.name = name;
      }
      return { player: moved, token: fresh, via: 'transfer' };
    }
    const result = await this.withNewIds(name, (p) => this.store.redeemInvite(codeHash, p, this.hash(fresh)));
    if (typeof result === 'string') throw new AuthFailure('bad-code');
    return { player: result, token: fresh, via: 'invite' };
  }

  /** Makes a player with fresh ids; a (very unlikely) public id collision just tries again. */
  private async withNewIds<T>(name: string, create: (p: NewPlayer) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await create({ id: newPlayerId(), publicId: newPublicId(), name });
      } catch (error) {
        if (attempt >= 4 || !isUniqueViolation(error)) throw error;
      }
    }
  }

  /** A one-time code that adds another computer to the player (shown to them in the pause menu). */
  async transferCode(playerId: string, by: 'player' | 'admin' = 'player'): Promise<{ code: string; expiresAt: Date }> {
    const ttl = by === 'admin' ? IDENTITY.reissueTtl : IDENTITY.transferTtl;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    for (let attempt = 1; ; attempt++) {
      const code = newCode();
      try {
        await this.store.createTransferCode(playerId, this.hash(code), expiresAt, by);
        return { code, expiresAt };
      } catch (error) {
        if (attempt >= 4 || !isUniqueViolation(error)) throw error;
      }
    }
  }

  async createInvite(label: string, maxUses = 1, days: number | null = IDENTITY.inviteDays): Promise<{ code: string; invite: InviteRecord }> {
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) throw new Error('an invite can be used 1 to 100 times');
    const expiresAt = days === null ? null : new Date(Date.now() + days * 24 * 3600 * 1000);
    for (let attempt = 1; ; attempt++) {
      const code = newCode();
      try {
        const invite = await this.store.createInvite({ id: randomUUID(), codeHash: this.hash(code), label: label.slice(0, 80), maxUses, expiresAt });
        return { code, invite };
      } catch (error) {
        if (attempt >= 4 || !isUniqueViolation(error)) throw error;
      }
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === '23505' || (typeof e?.message === 'string' && e.message.startsWith('duplicate'));
}

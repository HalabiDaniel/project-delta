import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Device tokens, invite and transfer codes, and the ids players are known by.
 *
 * - A device token is 32 random bytes (256 bits), base64url. The browser keeps it; the server only
 *   ever stores its hash.
 * - Codes (invites, transfers) are meant to be typed: ten characters from an alphabet without
 *   look-alikes, shown as XXXXX-XXXXX (50 bits). They are hashed the same way, and are single-use
 *   or short-lived.
 * - Hashes are HMAC-SHA256 keyed with the server's pepper (TOKEN_PEPPER), so a copy of the database
 *   alone can't be used to check guesses.
 */

export const TOKEN_BYTES = 32;
/** Crockford's base 32: no I, L, O or U. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
/** Public ids: lower-case letters and digits a player never needs to type. */
const PUBLIC_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const PUBLIC_LENGTH = 8;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Tokens look like 43 base64url characters; anything else is refused before it is hashed. */
export function isTokenShaped(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(raw);
}

export function hashSecret(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

function randomFrom(alphabet: string, length: number): string {
  // 32 symbols: 5 bits each, from one random byte apiece (256 is a multiple of 32: no bias).
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** "K7Q2M-9XRTA". */
export function newCode(): string {
  const raw = randomFrom(CODE_ALPHABET, CODE_LENGTH);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * The canonical form of a typed code: upper case, dashes and spaces dropped, look-alikes mapped
 * (O → 0, I and L → 1). Null if it can't be a code at all.
 */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const s = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function newPlayerId(): string {
  return randomUUID();
}

/** The short id a player is known by in a world (schema keys, events): about 40 bits. */
export function newPublicId(): string {
  return randomFrom(PUBLIC_ALPHABET, PUBLIC_LENGTH);
}

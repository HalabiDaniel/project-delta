/**
 * The server's settings, all from environment variables (secrets never live in the repository or
 * the client bundle). `serverConfig()` reads them once at start-up; tests build their own.
 *
 *   PORT            WebSocket and HTTP port (default 2567)
 *   DATABASE_URL    postgres://user:password@host:5432/db. Without it the server keeps everything
 *                   in memory (development only: nothing survives a restart).
 *   TOKEN_PEPPER    Secret mixed into every stored token and code hash. Required in production.
 *   ACCESS          "invite" (an invite code is needed to join the first time) or "open" (anyone
 *                   who can reach the server gets a player). Default: invite in production, open
 *                   otherwise.
 *   NODE_ENV        "production" makes the checks above strict.
 *   LATENCY         Simulated latency on everything the server sends (ms, testing).
 *   PROTECTION      New-player protection in seconds (testing raids alone).
 *   SESSION_LENGTH  Session length in seconds (testing the end of a session; default SESSION.length).
 *   ALLOWED_ORIGINS The addresses the game is served from, comma separated
 *                   (https://project-delta.vercel.app,https://play.example.com). A `*` stands for
 *                   any run of letters, digits and dashes in a host name
 *                   (https://project-delta-*.vercel.app for Vercel's preview builds). A browser on any
 *                   other site is refused. Unset: every origin is allowed (development).
 *   ADMIN_KEY       Secret for the /admin endpoint (v0.0.14), at least 24 characters. Unset: /admin
 *                   is off.
 */

export type AccessMode = 'open' | 'invite';

export interface ServerConfig {
  port: number;
  databaseUrl: string | null;
  pepper: string;
  access: AccessMode;
  production: boolean;
  latency: number;
  protection: number | null;
  sessionLength: number | null;
  /** Browser origins allowed to connect (null: any). */
  allowedOrigins: string[] | null;
  /** The /admin endpoint's secret (null: the endpoint is off). */
  adminKey: string | null;
  /** Problems worth a line in the log (a missing database in development, a default pepper). */
  warnings: string[];
}

/** Used only when TOKEN_PEPPER is unset outside production: development tokens are not secret. */
export const DEV_PEPPER = 'paperwars-development-pepper';

export class ConfigError extends Error {}

export function serverConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  const warnings: string[] = [];
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  let pepper = env.TOKEN_PEPPER ?? '';
  if (pepper.length === 0) {
    if (production) throw new ConfigError('TOKEN_PEPPER must be set in production (a long random secret).');
    pepper = DEV_PEPPER;
    warnings.push('TOKEN_PEPPER is not set: using the development pepper.');
  } else if (pepper.length < 16) {
    throw new ConfigError('TOKEN_PEPPER must be at least 16 characters.');
  }
  if (!databaseUrl) {
    if (production) throw new ConfigError('DATABASE_URL must be set in production.');
    warnings.push('DATABASE_URL is not set: players and worlds live in memory and are lost on restart.');
  }
  const accessRaw = env.ACCESS?.trim().toLowerCase();
  if (accessRaw && accessRaw !== 'open' && accessRaw !== 'invite') throw new ConfigError(`ACCESS must be "open" or "invite", not "${env.ACCESS}".`);
  const access: AccessMode = (accessRaw as AccessMode | undefined) ?? (production ? 'invite' : 'open');
  if (production && access === 'open') warnings.push('ACCESS=open in production: anyone who finds the server can join.');
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError(`PORT must be a port number, not "${env.PORT}".`);
  const latency = Math.max(0, Number(env.LATENCY ?? 0) || 0);
  const protection = env.PROTECTION !== undefined && env.PROTECTION !== '' ? Number(env.PROTECTION) : null;
  if (protection !== null && !Number.isFinite(protection)) throw new ConfigError('PROTECTION must be a number of seconds.');
  const sessionLength = env.SESSION_LENGTH !== undefined && env.SESSION_LENGTH !== '' ? Number(env.SESSION_LENGTH) : null;
  if (sessionLength !== null && !(Number.isFinite(sessionLength) && sessionLength > 0)) throw new ConfigError('SESSION_LENGTH must be a number of seconds.');
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS);
  if (production && !allowedOrigins) warnings.push('ALLOWED_ORIGINS is not set: a game served from any website can connect. Set it to the game\'s address.');
  const adminKey = env.ADMIN_KEY?.trim() || null;
  if (adminKey !== null && adminKey.length < 24) throw new ConfigError('ADMIN_KEY must be at least 24 characters (a long random secret).');
  return { port, databaseUrl, pepper, access, production, latency, protection, sessionLength, allowedOrigins, adminKey, warnings };
}

/** ALLOWED_ORIGINS as a list of origins (scheme, host and port; no path), or null when unset. */
export function parseOrigins(raw: string | undefined): string[] | null {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter((s) => s.length > 0);
  if (list.length === 0) return null;
  for (const o of list) {
    if (!/^https?:\/\/[a-z0-9*.\-]+(:\d+)?$/.test(o)) throw new ConfigError(`ALLOWED_ORIGINS: "${o}" isn't an address like https://project-delta.vercel.app (scheme and host, no path).`);
  }
  return list;
}

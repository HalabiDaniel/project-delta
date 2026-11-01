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
  return { port, databaseUrl, pepper, access, production, latency, protection, warnings };
}

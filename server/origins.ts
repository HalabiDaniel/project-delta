import { matchMaker } from '@colyseus/core';

/**
 * Which websites may talk to this server (v0.0.14): ALLOWED_ORIGINS, checked on the WebSocket
 * upgrade, on Colyseus's matchmaking requests and on the lobby's own HTTP endpoints. A request with
 * no Origin header (a bot, the load test, curl) is not a browser on another site and is let through:
 * the origin check keeps other websites from embedding the game, while who may play is decided by
 * the invite and the device token.
 */

let allowed: string[] | null = null;
let patterns: RegExp[] = [];

/** The allowed origins (null: any, as in development). */
export function setAllowedOrigins(list: string[] | null): void {
  allowed = list;
  patterns = (list ?? []).map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`));
}

export function allowedOrigins(): string[] | null {
  return allowed;
}

/** Whether a request from `origin` (its Origin header; null when there is none) is allowed. */
export function originAllowed(origin: string | null | undefined): boolean {
  if (!origin || allowed === null) return true;
  const o = origin.trim().toLowerCase();
  return patterns.some((p) => p.test(o));
}

/** CORS headers for a response to a request from `origin`: the origin itself when it is allowed. */
export function corsFor(origin: string | null | undefined): Record<string, string> {
  if (allowed === null) return { 'Access-Control-Allow-Origin': origin || '*', Vary: 'Origin' };
  if (origin && originAllowed(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  return { Vary: 'Origin' };
}

/** Colyseus's matchmaking routes (joinById, …) answer with the same CORS headers. */
export function installCors(): void {
  const controller = matchMaker.controller as unknown as { getCorsHeaders(headers: Headers): Record<string, string>; DEFAULT_CORS_HEADERS: Record<string, string> };
  // The defaults allow every origin ("*"); the header now comes from corsFor alone.
  delete controller.DEFAULT_CORS_HEADERS['Access-Control-Allow-Origin'];
  controller.getCorsHeaders = (headers: Headers) => corsFor(headers.get('origin'));
}

/** The WebSocket upgrade: a browser on a site that isn't allowed is refused before the handshake. */
export function checkUpgrade(_request: Request, context: { headers: Headers }): Response | void {
  const origin = context.headers.get('origin');
  if (!originAllowed(origin)) return new Response('This game server only accepts the game from its own address.', { status: 403 });
}

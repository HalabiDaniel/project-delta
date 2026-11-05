import { createEndpoint, createRouter } from '@colyseus/core';
import type { QuickJoinDTO } from '../../src/net/protocol';
import pkg from '../../package.json' with { type: 'json' };
import { log } from '../log';
import { corsFor, originAllowed } from '../origins';
import { LIMITS } from '../RateLimit';
import { services } from '../services';
import { isStopping, listing, quickJoin, sessions } from './directory';

const quickLimit = LIMITS.quickPerAddress();
const startedAt = Date.now();

/** What /health says (v0.0.14): Railway's deploy check and the uptime monitor read it. */
export interface HealthDTO {
  status: 'ok' | 'degraded' | 'stopping';
  version: string;
  store: 'memory' | 'postgres';
  storeReachable: boolean;
  sessions: number;
  players: number;
  uptime: number;
}

/**
 * The HTTP side of sessions (v0.0.13), next to the WebSocket port:
 *
 *   GET  /sessions        the running sessions (players, time left, open or closing)
 *   POST /sessions/quick  the session to join now (the busiest with space; a new one if none has)
 *   GET  /health          200 with the version, the store and the session count while all is well;
 *                         503 when the database can't be reached or the server is stopping (v0.0.14)
 *
 * Joining itself goes through the room (joinById), which checks who the player is and refuses a
 * full, closing or ended session.
 */
export function sessionRoutes() {
  return createRouter({
    health: createEndpoint('/health', { method: 'GET' }, async (ctx) => {
      const store = services().store;
      const reachable = await Promise.race([store.ping(), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]).catch(() => false);
      const all = sessions();
      const status: HealthDTO['status'] = isStopping() ? 'stopping' : reachable ? 'ok' : 'degraded';
      const body: HealthDTO = { status, version: pkg.version, store: store.kind, storeReachable: reachable, sessions: all.length, players: all.reduce((n, s) => n + s.players, 0), uptime: Math.round((Date.now() - startedAt) / 1000) };
      return ctx.json(body, { status: status === 'ok' ? 200 : 503, headers: { ...corsFor(ctx.headers?.get('origin')), 'Cache-Control': 'no-store' } });
    }),
    sessions: createEndpoint('/sessions', { method: 'GET' }, async (ctx) => ctx.json(listing(), { headers: corsFor(ctx.headers?.get('origin')) })),
    quick: createEndpoint('/sessions/quick', { method: 'POST' }, async (ctx) => {
      const origin = ctx.headers?.get('origin');
      const CORS = corsFor(origin);
      if (!originAllowed(origin)) {
        log('warn', 'origin.refused', { origin, route: 'quick' });
        return ctx.json({ error: 'This game server only accepts the game from its own address.' }, { status: 403, headers: CORS });
      }
      // Behind the host's proxy the caller's address is the first in X-Forwarded-For.
      const ip = ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() || 'direct';
      if (!quickLimit.take(ip)) {
        log('warn', 'quick.limited', { ip });
        return ctx.json({ error: 'Too many requests from your address. Wait a minute and try again.' }, { status: 429, headers: CORS });
      }
      try {
        const id = await quickJoin();
        log('info', 'quick', { session: id, ip });
        return ctx.json({ id } satisfies QuickJoinDTO, { headers: CORS });
      } catch (error) {
        log('error', 'quick.error', { error });
        const restarting = error instanceof Error && /restarting/.test(error.message);
        return ctx.json({ error: restarting ? 'The server is restarting. Back in a moment.' : 'No session could be opened right now. Try again in a moment.' }, { status: 503, headers: CORS });
      }
    }),
  });
}

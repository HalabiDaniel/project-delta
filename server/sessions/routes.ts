import { createEndpoint, createRouter } from '@colyseus/core';
import type { QuickJoinDTO } from '../../src/net/protocol';
import { log } from '../log';
import { LIMITS } from '../RateLimit';
import { listing, quickJoin } from './directory';

const quickLimit = LIMITS.quickPerAddress();

const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * The HTTP side of sessions (v0.0.13), next to the WebSocket port:
 *
 *   GET  /sessions        the running sessions (players, time left, open or closing)
 *   POST /sessions/quick  the session to join now (the busiest with space; a new one if none has)
 *
 * Joining itself goes through the room (joinById), which checks who the player is and refuses a
 * full, closing or ended session.
 */
export function sessionRoutes() {
  return createRouter({
    sessions: createEndpoint('/sessions', { method: 'GET' }, async (ctx) => ctx.json(listing(), { headers: CORS })),
    quick: createEndpoint('/sessions/quick', { method: 'POST' }, async (ctx) => {
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

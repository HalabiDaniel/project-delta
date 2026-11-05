import { createEndpoint, createRouter } from '@colyseus/core';
import type { QuickJoinDTO } from '../../src/net/protocol';
import { listing, quickJoin } from './directory';

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
      try {
        const id = await quickJoin();
        return ctx.json({ id } satisfies QuickJoinDTO, { headers: CORS });
      } catch (error) {
        console.error('[sessions] quick join failed:', error);
        return ctx.json({ error: 'No session could be opened right now. Try again in a moment.' }, { status: 503, headers: CORS });
      }
    }),
  });
}

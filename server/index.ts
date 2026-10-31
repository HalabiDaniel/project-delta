import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM } from '../src/net/protocol';
import { WorldRoom } from './WorldRoom';

/**
 * The paperwars.io multiplayer server: Colyseus over WebSockets, one room type (a classroom
 * session of up to eight players), and a small HTTP endpoint the menu uses to list sessions.
 *
 *   npm run server                 # ws://localhost:2567
 *   PORT=3000 npm run server
 *   LATENCY=120 npm run server     # every message delayed by 120 ms (testing)
 *   PROTECTION=20 npm run server   # new players can be raided after 20 s instead of 5 min (testing)
 */

const port = Number(process.env.PORT ?? 2567);

const routes = createRouter({
  rooms: createEndpoint('/rooms', { method: 'GET' }, async (ctx) => {
    const rooms = await matchMaker.query({ name: ROOM });
    return ctx.json(
      rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, locked: r.locked, metadata: r.metadata })),
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }),
});

const server = defineServer({
  rooms: {
    [ROOM]: defineRoom(WorldRoom, process.env.PROTECTION !== undefined ? { newPlayerProtection: Number(process.env.PROTECTION) } : {}),
  },
  routes,
  transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 }),
  greet: false,
});

const latency = Number(process.env.LATENCY ?? 0);
if (latency > 0) server.simulateLatency(latency);

await server.listen(port);
console.log(`paperwars.io multiplayer server on ws://localhost:${port}${latency > 0 ? ` (simulated latency ${latency} ms)` : ''}`);

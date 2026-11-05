import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM } from '../src/net/protocol';
import { ConfigError, serverConfig } from './config';
import { Identity } from './identity/Identity';
import { setServices } from './services';
import { setSessionDefaults } from './sessions/directory';
import { sessionRoutes } from './sessions/routes';
import { openStore } from './store/open';
import { WorldRoom } from './WorldRoom';

/**
 * The paperwars.io multiplayer server: Colyseus over WebSockets, one room type (a timed classroom
 * session of up to sixteen players, several at once, opened by the server only), and the HTTP
 * endpoints the lobby uses to list sessions and quick join (server/sessions/routes.ts).
 * Settings come from the environment (see server/config.ts):
 *
 *   npm run server                                   # ws://localhost:2567, everything in memory
 *   DATABASE_URL=postgres://… npm run server         # players kept in PostgreSQL (migrated on start)
 *   ACCESS=invite npm run server                     # an invite code is needed to join the first time
 *   PORT=3000 npm run server
 *   LATENCY=120 npm run server                       # every message delayed by 120 ms (testing)
 *   PROTECTION=20 npm run server                     # new players can be raided after 20 s instead of 5 min (testing)
 *   SESSION_LENGTH=300 npm run server                # five-minute sessions (testing the end of a session)
 */

let config;
try {
  config = serverConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[config] ${error.message}`);
    process.exit(1);
  }
  throw error;
}
for (const w of config.warnings) console.warn(`[config] ${w}`);

const store = await openStore(config.databaseUrl).catch((error: Error) => {
  console.error(`[db] ${error.message}`);
  process.exit(1);
});
setServices({ store, identity: new Identity(store, config.pepper, config.access) });

if (config.sessionLength !== null) setSessionDefaults({ session: { length: config.sessionLength } });

const server = defineServer({
  rooms: {
    [ROOM]: defineRoom(WorldRoom, config.protection !== null ? { newPlayerProtection: config.protection } : {}),
  },
  routes: sessionRoutes(),
  transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 3 }),
  greet: false,
});
// After the rooms have closed: release the database.
server.onShutdown(() => store.close());

if (config.latency > 0) server.simulateLatency(config.latency);

await server.listen(config.port);
console.log(
  `paperwars.io multiplayer server on ws://localhost:${config.port} (store: ${store.kind}, access: ${config.access})` +
    (config.latency > 0 ? ` (simulated latency ${config.latency} ms)` : ''),
);

import { DEV_PEPPER, type AccessMode } from './config';
import { Identity } from './identity/Identity';
import { MemoryStore } from './store/MemoryStore';
import type { Store } from './store/Store';

/**
 * What rooms need from outside: the store and the identity service. Set once by `server/index.ts`
 * (from the environment) and by tests. Rooms read it rather than taking it from room options,
 * because Colyseus merges room options with whatever a client sends when it creates a room.
 */
export interface Services {
  store: Store;
  identity: Identity;
  /**
   * Lets a client pick its desk (tests and tools). Off in a real server: until v0.0.13's sessions,
   * every base is placed on a random free desk.
   */
  chooseDesk?: boolean;
}

export function memoryServices(access: AccessMode = 'open', pepper = DEV_PEPPER): Services {
  const store = new MemoryStore();
  return { store, identity: new Identity(store, pepper, access) };
}

/** The world every multiplayer player's paper, planes and progress belong to (one for the whole game). */
export const ECONOMY_WORLD = 'multiplayer';

let current: Services = memoryServices();
const worlds = new WeakMap<Store, Promise<string>>();

/**
 * The id of the economy world in the current store, opened (and created) once per store. A failed
 * open is forgotten, so the next call tries again.
 */
export function economyWorld(): Promise<string> {
  const store = current.store;
  let id = worlds.get(store);
  if (!id) {
    id = store.openWorld(ECONOMY_WORLD).then((w) => w.id);
    id.catch(() => worlds.delete(store));
    worlds.set(store, id);
  }
  return id;
}

export function services(): Services {
  return current;
}

export function setServices(next: Services): void {
  current = next;
}

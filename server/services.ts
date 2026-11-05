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

let current: Services = memoryServices();

export function services(): Services {
  return current;
}

export function setServices(next: Services): void {
  current = next;
}

import { randomUUID } from 'node:crypto';
import type { BaseState, PlaceResult, Store } from '../store/Store';

/** How long a placement holds without a save (s). A crashed server's bases are free again after this. */
export const BASE_LEASE = 120;
/** How often a room saves the bases standing in it (s), renewing their leases. */
export const BASE_SAVE_EVERY = 15;

/** This server process, so two processes (a restart overlapping the old one) never share a holder. */
export const SERVER_INSTANCE = randomUUID().slice(0, 8);

/**
 * A room's side of the portable bases: places, saves and packs them in the store as this room's
 * holder ("<server instance>/<room id>").
 *
 * Every store call for one player runs after the previous one for that player has finished, across
 * every room in this process. So a base packed in one room (the player moved to another classroom)
 * is written before the next room places it, and a periodic save that started earlier can never
 * land after the pack and bring back an older base.
 */
export class BaseKeeper {
  private static readonly chains = new Map<string, Promise<unknown>>();
  /** Store calls this room started and that haven't finished (a disposing room waits for them). */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly store: () => Store,
    readonly holder: string,
  ) {}

  place(playerId: string, territoryId: string): Promise<PlaceResult> {
    return this.run(playerId, () => this.store().placeBase(playerId, this.holder, territoryId, BASE_LEASE));
  }

  save(playerId: string, state: BaseState): Promise<boolean> {
    return this.run(playerId, () => this.store().saveBase(playerId, this.holder, state, BASE_LEASE));
  }

  pack(playerId: string, state: BaseState): Promise<boolean> {
    return this.run(playerId, () => this.store().packBase(playerId, this.holder, state));
  }

  /** Lets go of a placement this room took but didn't build (the player left while it loaded). */
  release(playerId: string): Promise<boolean> {
    return this.run(playerId, () => this.store().releaseBase(playerId, this.holder));
  }

  /** Resolves once every store call this room started has finished. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private run<T>(playerId: string, work: () => Promise<T>): Promise<T> {
    const chains = BaseKeeper.chains;
    const next = (chains.get(playerId) ?? Promise.resolve()).then(work, work);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    chains.set(playerId, tail);
    this.pending.add(tail);
    void tail.then(() => {
      this.pending.delete(tail);
      if (chains.get(playerId) === tail) chains.delete(playerId);
    });
    return next;
  }
}

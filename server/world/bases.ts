import type { Building, BaseSave } from '../../src/base/Base';
import { emptyBaseStats } from '../../src/base/Base';
import type { BaseState, SavedBuilding } from '../store/Store';

/**
 * Between the base rules' own save (`Base.save`, single-player's format) and the store's
 * `BaseState`. Health is stored in whole points, rounded up so a hurt building never comes back as
 * a wreck; `Base.load` checks slots, kinds and the one-of-each rules again when it puts a base up.
 */

export function toBaseState(save: BaseSave): BaseState {
  return {
    storeHealth: wholeHealth(save.store),
    stats: { ...save.stats },
    buildings: save.buildings.map(
      (b): SavedBuilding => ({
        slot: b.slot,
        kind: b.kind,
        level: b.level,
        health: wholeHealth(b.health),
        data: { invested: b.invested, kills: b.kills, bombers: b.bombers, damage: b.damage },
      }),
    ),
  };
}

export function fromBaseState(state: BaseState): BaseSave {
  const stats = { ...emptyBaseStats() };
  for (const key of Object.keys(stats) as Array<keyof typeof stats>) {
    const v = state.stats[key];
    if (typeof v === 'number' && Number.isFinite(v)) stats[key] = v;
  }
  return {
    store: state.storeHealth,
    stats,
    buildings: state.buildings.map((b): Building & { health: number } => ({
      slot: b.slot,
      kind: b.kind,
      level: b.level,
      health: b.health,
      invested: num(b.data.invested),
      kills: num(b.data.kills),
      bombers: num(b.data.bombers),
      damage: num(b.data.damage),
    })),
  };
}

function wholeHealth(h: number): number {
  return Number.isFinite(h) && h > 0 ? Math.ceil(h) : 0;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

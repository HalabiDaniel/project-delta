import type { Base } from '../base/Base';
import { AIRCRAFT, ECONOMY, type AircraftSpec } from '../config';
import { HomeIncome } from './HomeIncome';
import { RESOURCES, type Bundle, type Resource, type ResourceManager } from './ResourceManager';

/** One income per resource: paper, ink and rubber balls (v0.0.18). */
export type Incomes = Record<Resource, HomeIncome>;

export function newIncomes(paper: HomeIncome = new HomeIncome()): Incomes {
  return { paper, ink: new HomeIncome({ resource: 'ink' }), rubber: new HomeIncome({ resource: 'rubber' }) };
}

/**
 * Sets each income and store from the base: net production (after upkeep), capacity. `producing`
 * false stops every income (multiplayer: production only while the player is online, v0.0.12).
 * Single-player, the server and the simulator all go through here, so the rule is in one place.
 */
export function applyBaseEconomy(base: Base, resources: ResourceManager, incomes: Incomes, producing = true): void {
  for (const r of RESOURCES) {
    incomes[r].perMinute = producing ? base.netProductionOf(r) : 0;
    incomes[r].capacity = base.capacityOf(r);
    resources.capacities[r] = base.capacityOf(r);
  }
}

/**
 * v0.0.18: what a player from before ink and rubber balls starts with: half of what their base
 * holds, and never less than a new player's starting amount (nobody loads into an empty store).
 */
export function startingStock(resource: 'ink' | 'rubber', capacity: number): number {
  const start = resource === 'ink' ? ECONOMY.startingInk : ECONOMY.startingRubber;
  return Math.max(start, Math.floor(capacity * 0.5));
}

/** Each store's capacity from the base (after building, upgrading, a wreck). */
export function applyCapacities(base: Base, resources: ResourceManager): void {
  for (const r of RESOURCES) resources.capacities[r] = base.capacityOf(r);
}

/** Ink and rubber balls for the economy strip (paper has its own pill). */
export function resourceViews(resources: ResourceManager, incomes: Incomes): Array<{ id: Resource; icon: 'inkwell' | 'rubber'; label: string; amount: number; capacity: number | null; rate: number }> {
  return (['ink', 'rubber'] as const).map((r) => ({
    id: r,
    icon: r === 'ink' ? 'inkwell' : 'rubber',
    label: r === 'ink' ? 'Ink' : 'Rubber balls',
    amount: resources.amount(r),
    capacity: Number.isFinite(resources.capacities[r]) ? resources.capacities[r] : null,
    rate: incomes[r].ratePerMinute(resources.amount(r)),
  }));
}

/** Ink and rubber balls a new plane of this design takes on top of its paper (none for a refit). */
export function materialsOf(spec: AircraftSpec): Bundle {
  return { ...(spec.materials ?? {}) };
}

/** What arming a plane takes and gives: rounds and bombs loaded, and the ink and rubber they cost. */
export interface Arming {
  rounds: number;
  bombs: number;
  ink: number;
  rubber: number;
  /** Some of the load couldn't be paid for: the plane carries less than it could. */
  short: boolean;
}

/**
 * How a plane is armed from the stores (GDD §4.2, plan v0.0.18 §1.C). It wants `roundsWanted` gun
 * rounds (it already has `roundsHave`) and `bombsWanted` bombs. A basic share of the rounds
 * (ECONOMY.arming.basicLoad) and up to `freeBombs` bombs are free, so nobody is ever grounded by an
 * empty store; the rest is paid in ink and rubber balls as far as `ink` and `rubber` go.
 */
export function armingFor(spec: AircraftSpec, roundsWanted: number, roundsHave: number, bombsWanted: number, ink: number, rubber: number): Arming {
  const a = ECONOMY.arming;
  const free = Math.max(0, Math.ceil(spec.gun.ammo * a.basicLoad) - roundsHave);
  const toFill = Math.max(0, roundsWanted - roundsHave);
  const freeRounds = Math.min(free, toFill);
  const paidWanted = toFill - freeRounds;
  const paidRounds = Math.min(paidWanted, ink * a.roundsPerInk);
  const inkCost = Math.ceil(paidRounds / a.roundsPerInk);
  const perBomb = a.rubberPerBomb[spec.bombs.kind];
  const freeBombs = Math.min(a.freeBombs, bombsWanted);
  const paidBombsWanted = bombsWanted - freeBombs;
  const paidBombs = Math.min(paidBombsWanted, Math.floor(rubber / perBomb));
  return {
    rounds: roundsHave + freeRounds + paidRounds,
    bombs: freeBombs + paidBombs,
    ink: inkCost,
    rubber: paidBombs * perBomb,
    short: paidRounds < paidWanted || paidBombs < paidBombsWanted,
  };
}

/** What fully arming a design costs (garage cards): ink for a full gun, rubber balls for a full rack. */
export function fullArmingCost(spec: AircraftSpec, bombs = spec.bombs.capacity): Bundle {
  const full = armingFor(spec, spec.gun.ammo, 0, bombs, Infinity, Infinity);
  return { ink: full.ink, rubber: full.rubber };
}

/** Every design's materials, for the docs and the simulator. */
export function rosterMaterials(): Record<string, Bundle> {
  const out: Record<string, Bundle> = {};
  for (const [id, spec] of Object.entries(AIRCRAFT)) out[id] = materialsOf(spec);
  return out;
}

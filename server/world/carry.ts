import { AIRCRAFT, AIRCRAFT_ORDER, type AircraftId, type ManeuverId } from '../../src/config';
import { cleanProgress, parseDirector } from '../../src/systems/SaveGame';
import type { AircraftRecord, ProgressRecord } from '../store/Store';
import type { CarriedPlane, PlayerCarry } from './ServerWorld';

/**
 * Between the store's records of what a player carries (planes, progress) and the world's
 * `PlayerCarry`. Everything loaded is checked here: unknown designs, broken numbers and an unusable
 * director state are dropped rather than trusted.
 */

/**
 * The player's planes, as the hangar takes them: one per design (the hangar holds one of each),
 * a plane that was on the pad comes back ready, one that was in the air when the server last saved
 * comes back recovered (it needs a refit), as single-player does with a plane in flight.
 */
export function planesFrom(records: AircraftRecord[]): CarriedPlane[] {
  const out: CarriedPlane[] = [];
  for (const r of records) {
    if (!(AIRCRAFT_ORDER as readonly string[]).includes(r.type)) continue;
    const design = r.type as AircraftId;
    if (out.some((p) => p.design === design)) continue;
    const invested = Number(r.loadout.invested);
    out.push({
      id: r.id,
      design,
      condition: r.status === 'ready' ? 'ready' : 'recovered',
      health: Math.max(1, Math.min(AIRCRAFT[design].maxHealth, Number.isFinite(r.health) ? r.health : 1)),
      invested: Number.isFinite(invested) && invested > 0 ? Math.round(invested) : 0,
    });
  }
  return out;
}

/** The player's progress, as the world takes it. */
export function progressFrom(record: ProgressRecord | null): Pick<PlayerCarry, 'aircraft' | 'director' | 'board' | 'stats' | 'maneuvers' | 'profile'> {
  if (!record) return {};
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(record.stats ?? {})) if (/^[a-zA-Z]{1,32}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) stats[k] = Math.round(v);
  const garage = record.garage ?? {};
  const aircraft = typeof garage.aircraft === 'string' && (AIRCRAFT_ORDER as readonly string[]).includes(garage.aircraft) ? (garage.aircraft as AircraftId) : undefined;
  const board: Record<string, string> = {};
  if (garage.board && typeof garage.board === 'object') {
    for (const [slot, id] of Object.entries(garage.board as Record<string, unknown>)) if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) board[slot] = id;
  }
  // v0.0.16: the maneuver chosen for each design's slot; anything a design can't carry is dropped.
  const maneuvers: Partial<Record<AircraftId, ManeuverId>> = {};
  if (garage.maneuvers && typeof garage.maneuvers === 'object') {
    for (const [id, man] of Object.entries(garage.maneuvers as Record<string, unknown>)) {
      if ((AIRCRAFT_ORDER as readonly string[]).includes(id) && typeof man === 'string' && AIRCRAFT[id as AircraftId].maneuvers.includes(man as ManeuverId)) maneuvers[id as AircraftId] = man as ManeuverId;
    }
  }
  // v0.0.18: medals, records and achievements, checked field by field.
  const profile = record.profile ? cleanProgress(record.profile) : undefined;
  return { stats, aircraft, board, maneuvers, director: parseDirector(record.director), profile };
}

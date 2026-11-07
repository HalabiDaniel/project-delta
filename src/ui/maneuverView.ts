import type { FlightModel } from '../aircraft/FlightModel';
import { MANEUVERS, type AircraftSpec, type ManeuverId } from '../config';
import { T } from './strings';
import type { ManeuverPickerView, ManeuverSlotView } from './views';

/**
 * v0.0.16: the maneuver slot as the HUD shows it in flight, from the flight model (single-player
 * and multiplayer alike).
 */
export function maneuverSlotView(m: FlightModel): ManeuverSlotView {
  const id = m.slottedManeuver;
  const refusal = m.lastRefusal ? T.maneuver.refusal[m.lastRefusal] : null;
  const airbrake = m.speed < m.flight.minSpeed - 0.25;
  if (!id) return { id: null, name: T.maneuver.none, state: 'none', readiness: 0, refusal: null, airbrake };
  const state: ManeuverSlotView['state'] = m.activeManeuver ? 'active' : m.mode === 'loop' ? 'loop' : m.maneuverCooldown > 0 ? 'cooldown' : 'ready';
  return { id, name: MANEUVERS[id].name, state, readiness: m.maneuverReadiness, refusal, airbrake };
}

/** The picker at home: the design's set and which one is in the slot. */
export function maneuverPickerView(spec: Pick<AircraftSpec, 'maneuvers'>, slot: ManeuverId | null, atHome: boolean): ManeuverPickerView {
  const set = spec.maneuvers;
  if (!slot || set.length === 0) return { current: null, index: 0, count: 0, canChange: false };
  const m = MANEUVERS[slot];
  return {
    current: { id: slot, name: m.name, summary: m.summary, inspiredBy: m.inspiredBy },
    index: Math.max(0, set.indexOf(slot)),
    count: set.length,
    canChange: atHome && set.length > 1,
  };
}

/**
 * The names of the controls, as the tutorial, the dashboard and the reports show them.
 *
 * Text that tells the player what to press asks `controlLabel(action)` instead of writing a key
 * into the string. The defaults are the keyboard and mouse; the input layer switches the whole set
 * (for example to controller glyphs) with `setControlLabels` when the player picks up another
 * device, and every hint follows on the next frame.
 */

import { keyFor } from '../input/bindings';
import { T } from './strings';

export type ControlAction =
  | 'selectCard'
  | 'prevPlane'
  | 'nextPlane'
  | 'fold'
  | 'launch'
  | 'steer'
  | 'fire'
  | 'bomb'
  | 'boost'
  | 'maneuver'
  | 'maneuverPick'
  | 'throttle'
  | 'bank'
  | 'rearm'
  | 'takeOff'
  | 'endSortie'
  | 'continue'
  | 'base'
  | 'repairAll'
  | 'quickRebuild'
  | 'skipTutorial'
  | 'back'
  | 'pause';

/** The keyboard and mouse names, from the bindings (src/input/bindings.ts). */
export const KEYBOARD_LABELS: Readonly<Record<ControlAction, string>> = {
  selectCard: `${keyFor('pick1')} – ${keyFor('pick3')}`,
  prevPlane: keyFor('prevAircraft'),
  nextPlane: keyFor('nextAircraft'),
  fold: keyFor('fold'),
  launch: keyFor('launch'),
  steer: T.keys.mouse,
  fire: T.keys.leftClick,
  bomb: T.keys.rightClick,
  boost: keyFor('boost'),
  maneuver: keyFor('maneuver'),
  maneuverPick: keyFor('maneuverNext'),
  throttle: `${keyFor('throttleUp')} / ${keyFor('throttleDown')}`,
  bank: `${keyFor('bankLeft')} / ${keyFor('bankRight')}`,
  rearm: keyFor('service'),
  takeOff: keyFor('launch'),
  endSortie: keyFor('confirm'),
  continue: keyFor('confirm'),
  base: keyFor('base'),
  repairAll: T.controls.repairAll(keyFor('base')),
  quickRebuild: keyFor('fold'),
  skipTutorial: T.controls.skip,
  back: keyFor('back'),
  pause: keyFor('back'),
};

type Labeler = (action: ControlAction) => string;

const keyboard: Labeler = (action) => KEYBOARD_LABELS[action];
let current: Labeler = keyboard;
let generation = 0;

/** What to press for `action`, on the device in use. */
export function controlLabel(action: ControlAction): string {
  return current(action) || KEYBOARD_LABELS[action];
}

/**
 * Switches every label: a map of overrides (missing actions keep the keyboard's), a function, or
 * null for the keyboard and mouse again.
 */
export function setControlLabels(labels: Partial<Record<ControlAction, string>> | Labeler | null): void {
  if (labels === null) current = keyboard;
  else if (typeof labels === 'function') current = labels;
  else current = (action) => labels[action] ?? KEYBOARD_LABELS[action];
  generation++;
}

/** Changes whenever the labels do, so views can tell when to redraw. */
export function controlLabelsVersion(): number {
  return generation;
}

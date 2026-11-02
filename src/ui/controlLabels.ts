/**
 * The names of the controls, as the tutorial, the dashboard and the reports show them.
 *
 * Text that tells the player what to press asks `controlLabel(action)` instead of writing a key
 * into the string. The defaults are the keyboard and mouse; the input layer switches the whole set
 * (for example to controller glyphs) with `setControlLabels` when the player picks up another
 * device, and every hint follows on the next frame.
 */

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

export const KEYBOARD_LABELS: Readonly<Record<ControlAction, string>> = {
  selectCard: '1 – 3',
  prevPlane: 'Q',
  nextPlane: 'E',
  fold: 'F',
  launch: 'Space',
  steer: 'Mouse',
  fire: 'Left click',
  bomb: 'Right click',
  boost: 'Shift',
  throttle: 'W / S',
  bank: 'A / D',
  rearm: 'R',
  takeOff: 'Space',
  endSortie: 'Enter',
  continue: 'Enter',
  base: 'B',
  repairAll: 'B → Repair all',
  quickRebuild: 'F',
  skipTutorial: 'Skip',
  back: 'Esc',
  pause: 'Esc',
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

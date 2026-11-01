/**
 * Control hints follow the last device used. The HUD writes keyboard hints (`<kbd>F</kbd>`) as it
 * always has; while a controller is the active device, every `<kbd>` on the page is relabelled
 * with the controller button that does the same thing (or hidden when there is no direct
 * equivalent and the button is reached by moving the highlight instead). The original key is
 * kept in `data-key`, so switching back to the keyboard restores it.
 */

import type { PadButton, PadFamily } from './Gamepad';
import type { ControlAction } from '../ui/controlLabels';

const LABELS: Record<PadFamily, Record<PadButton, string>> = {
  xbox: {
    south: 'A', east: 'B', west: 'X', north: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
    view: 'View', menu: 'Menu', ls: 'LS', rs: 'RS', up: '↑', down: '↓', left: '←', right: '→',
  },
  playstation: {
    south: '✕', east: '○', west: '□', north: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2',
    view: 'Share', menu: 'Options', ls: 'L3', rs: 'R3', up: '↑', down: '↓', left: '←', right: '→',
  },
  generic: {
    south: 'A', east: 'B', west: 'X', north: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT',
    view: 'View', menu: 'Menu', ls: 'LS', rs: 'RS', up: '↑', down: '↓', left: '←', right: '→',
  },
};

export function buttonLabel(b: PadButton, family: PadFamily): string {
  return LABELS[family][b];
}

/**
 * Keyboard hint → controller hint. A button name, a small template using {button} names, or ''
 * to hide the hint (the action is reached with the highlight and A).
 */
const KEY_TO_PAD: Record<string, string> = {
  Esc: '{east}',
  Enter: '{south}',
  Space: '{south}',
  F: '{south}',
  R: '{west}',
  B: '{north}',
  H: '{north}',
  Q: '{lb}',
  E: '{rb}',
  'Q / E': '{lb} / {rb}',
  L: '{view}',
  Tab: '{view}',
  Shift: '{rb}',
  LMB: '{rt}',
  RMB: '{lt}',
  Mouse: 'L stick',
  W: '{lb}+↑',
  S: '{lb}+↓',
  A: '{lb}+←',
  D: '{lb}+→',
  'W / S': '{lb} + L ↕',
  'A / D': '{lb} + L ↔',
  Z: '↑',
  C: '←',
  V: '→',
  '1 – 4': '{lt} / {rt}',
};

export function padHint(key: string, family: PadFamily): string {
  const t = KEY_TO_PAD[key.trim()];
  if (t === undefined) return '';
  return t.replace(/\{(\w+)\}/g, (_, b: string) => LABELS[family][b as PadButton] ?? b);
}

/** Relabels every `<kbd>` under `root` for the device in use. Cheap when nothing changed. */
export function applyGlyphs(root: ParentNode, family: PadFamily | null): void {
  for (const kbd of root.querySelectorAll<HTMLElement>('kbd')) {
    // A hint the HUD rewrote since we last touched it carries a new key.
    if (kbd.dataset.shown === undefined || kbd.textContent !== kbd.dataset.shown) kbd.dataset.key = kbd.textContent ?? '';
    const key = kbd.dataset.key ?? '';
    const shown = family ? padHint(key, family) : key;
    if (kbd.textContent !== shown) kbd.textContent = shown;
    kbd.dataset.shown = shown;
    kbd.classList.toggle('pad-hidden', family !== null && shown === '');
  }
}

/** The tutorial's, dashboard's and reports' control names (src/ui/controlLabels.ts) on a controller. */
export function padControlLabels(family: PadFamily): Partial<Record<ControlAction, string>> {
  const b = (button: PadButton): string => LABELS[family][button];
  return {
    selectCard: `${b('lt')} / ${b('rt')}`,
    prevPlane: b('lb'),
    nextPlane: b('rb'),
    fold: b('south'),
    launch: b('south'),
    steer: 'Left stick',
    fire: b('rt'),
    bomb: b('lt'),
    boost: b('rb'),
    throttle: `${b('lb')} + left stick ↕`,
    bank: `${b('lb')} + left stick ↔`,
    rearm: b('west'),
    takeOff: b('south'),
    endSortie: `${b('south')} on End sortie`,
    continue: b('south'),
    base: b('north'),
    repairAll: `${b('north')} → Repair all`,
    quickRebuild: b('south'),
    back: b('east'),
    pause: b('menu'),
  };
}

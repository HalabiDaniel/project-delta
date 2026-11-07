/**
 * Control hints follow the last device used. The HUD writes keyboard hints (`<kbd>F</kbd>`) as it
 * always has; while a controller is the active device, every `<kbd>` on the page is relabelled
 * with the controller button that does the same thing (or hidden when there is no direct
 * equivalent and the button is reached by moving the highlight instead). The original key is
 * kept in `data-key`, so switching back to the keyboard restores it.
 */

import type { PadButton, PadFamily } from './Gamepad';
import type { ControlAction } from '../ui/controlLabels';
import { padButtonFor, type Action } from './bindings';
import { T } from '../ui/strings';

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

/** Template names beyond the buttons: the sticks and the D-pad (the same words on every family). */
const EXTRA: Readonly<Record<string, string>> = { lstick: 'L stick', rstick: 'R stick', dpad: 'D-pad' };

/**
 * Keyboard hint → controller hint, for hints written with a key only. A button name, a small
 * template using {button} names, or '' to hide the hint (the controller reaches the action with
 * the highlight and A). Every key the game binds (KEYMAP) has an entry, so nothing falls through
 * by accident; a test checks that.
 */
export const KEY_TO_PAD: Readonly<Record<string, string>> = {
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
  // v0.0.16: the maneuver in flight, changing it at home.
  Alt: '{south}',
  T: '{rs}',
  // v0.0.17: the profile at the desk.
  P: '{up}',
  LMB: '{rt}',
  RMB: '{lt}',
  // Key caps that are words come from the dictionary, so a translation keeps working.
  [T.keys.leftClick]: '{rt}',
  [T.keys.rightClick]: '{lt}',
  [T.keys.mouse]: '{lstick}',
  W: '{lb}+↑',
  S: '{lb}+↓',
  A: '{lb}+←',
  D: '{lb}+→',
  'W / S': '{lb} + L ↕',
  'A / D': '{lb} + L ↔',
  Z: '{up}',
  C: '{left}',
  V: '{right}',
  '1 – 3': '{lt} / {rt}',
  '1 – 4': '{lt} / {rt}',
  // Reached with the highlight and A on a controller: the hint hides.
  X: '',
  Del: '',
  U: '',
  M: '',
  '`': '',
  F8: '',
  'Ctrl+Enter': '',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), ''])),
};

/** Fills a template's {button} (and {lstick}, {rstick}, {dpad}) names for a controller family. */
export function padTemplate(template: string, family: PadFamily): string {
  return template.replace(/\{(\w+)\}/g, (_, b: string) => LABELS[family][b as PadButton] ?? EXTRA[b] ?? b);
}

export function padHint(key: string, family: PadFamily): string {
  const t = KEY_TO_PAD[key.trim()];
  if (t === undefined) return '';
  return padTemplate(t, family);
}

/** What a hint element reads as for `family` (null: the keyboard). */
function shownFor(key: string, named: string | undefined, template: string | undefined, family: PadFamily | null): string {
  if (!family) return key;
  if (template) return padTemplate(template, family);
  if (named && LABELS[family][named as PadButton]) return LABELS[family][named as PadButton];
  return padHint(key, family);
}

/** Relabels every `<kbd>` under `root` for the device in use. Cheap when nothing changed. */
export function applyGlyphs(root: ParentNode, family: PadFamily | null): void {
  for (const kbd of root.querySelectorAll<HTMLElement>('kbd')) {
    // A glyph drawn for one device on purpose (the gallery's glyph table), or text that already
    // names the device's controls (controlLabel), keeps its label.
    if (kbd.dataset.glyphFixed !== undefined) continue;
    // A hint the HUD rewrote since we last touched it carries a new key.
    if (kbd.dataset.shown === undefined || kbd.textContent !== kbd.dataset.shown) kbd.dataset.key = kbd.textContent ?? '';
    const key = kbd.dataset.key ?? '';
    // A hint can name its controller button outright (data-pad) or give a template (data-pad-text).
    const shown = shownFor(key, kbd.dataset.pad, kbd.dataset.padText, family);
    if (kbd.textContent !== shown) kbd.textContent = shown;
    kbd.dataset.shown = shown;
    kbd.classList.toggle('pad-hidden', family !== null && shown === '');
  }
  // Tooltips that name a key ("Base (B)") name the controller's button instead, or none.
  for (const el of root.querySelectorAll<HTMLElement>('[data-tip-key]')) {
    const shown = shownFor(el.dataset.tipKey ?? '', el.dataset.tipPad, el.dataset.tipPadText, family);
    const tip = keyTip(el.dataset.tipText ?? '', shown);
    if (el.dataset.tip !== tip) el.dataset.tip = tip;
  }
}

/** A tooltip with its binding: "Base (B)", or just "Base" when the device has none. */
export function keyTip(text: string, shown: string): string {
  return shown ? `${text} (${shown})` : text;
}

/** The tutorial's, dashboard's and reports' control names (src/ui/controlLabels.ts) on a controller. */
export function padControlLabels(family: PadFamily): Partial<Record<ControlAction, string>> {
  // From the bindings (src/input/bindings.ts), so a rebinding relabels the tutorial too. A with
  // nothing highlighted does the sortie's next step (fold, launch, take off, continue).
  const p = (action: Action): string => LABELS[family][padButtonFor(action) ?? 'south'];
  return {
    selectCard: `${p('prevMission')} / ${p('nextMission')}`,
    prevPlane: p('prevAircraft'),
    nextPlane: p('nextAircraft'),
    fold: p('confirm'),
    launch: p('confirm'),
    steer: 'Left stick',
    fire: p('firePrimary'),
    bomb: p('fireSecondary'),
    boost: p('boost'),
    maneuver: p('maneuver'),
    maneuverPick: p('maneuverNext'),
    throttle: `${p('modifier')} + left stick ↕`,
    bank: `${p('modifier')} + left stick ↔`,
    rearm: p('service'),
    takeOff: p('confirm'),
    endSortie: `${p('confirm')} on End sortie`,
    continue: p('confirm'),
    base: p('base'),
    repairAll: `${p('base')} → Repair all`,
    quickRebuild: p('confirm'),
    back: p('back'),
    pause: p('pause'),
  };
}

/** The device a glyph is drawn for: the keyboard, or a controller family. */
export type GlyphDevice = 'keyboard' | PadFamily;
export const GLYPH_DEVICES: readonly GlyphDevice[] = ['keyboard', 'xbox', 'playstation', 'generic'];

/** A binding to show: the keyboard key's label and, optionally, the controller button that does the same. */
export interface GlyphSpec {
  /** The keyboard hint as the HUD writes it ("Esc", "Enter", "Q / E"). */
  key: string;
  /** The controller button, when the key alone does not say (else KEY_TO_PAD decides). */
  pad?: PadButton;
  /** Or a controller template for a combination: "{lb} / {rb}", "{lstick}" (see padTemplate). */
  padText?: string;
  /** The label already names the device's control (from `controlLabel`): never relabel it. */
  literal?: boolean;
}

/** The bindings every dialog shows: confirm (Enter / A) and cancel (Esc / B). */
export const DIALOG_KEYS: Readonly<Record<'confirm' | 'cancel', GlyphSpec>> = {
  confirm: { key: 'Enter', pad: 'south' },
  cancel: { key: 'Esc', pad: 'east' },
};

/** What a binding reads as on a device ('' when the controller has no direct equivalent). */
export function glyphText(spec: GlyphSpec, device: GlyphDevice): string {
  if (device === 'keyboard') return spec.key;
  return shownFor(spec.key, spec.pad, spec.padText, device);
}

/** The glyph device for the device in use: the keyboard, or the active controller's family. */
export function glyphDeviceFor(device: 'keyboard' | 'gamepad', family: PadFamily | null): GlyphDevice {
  return device === 'gamepad' ? (family ?? 'xbox') : 'keyboard';
}

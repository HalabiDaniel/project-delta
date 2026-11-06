/**
 * The bindings: which key, mouse button and controller button triggers each action (the unified
 * input-action layer, src/input/Controls.ts, reads them; plan v0.0.11 §7C for the controller).
 *
 * Every hint the interface shows (key caps, controller glyphs, "Base (B)" tooltips, the pause
 * menu's controls grid, the tutorial's and tips' keys) asks `bind(action)` or `controlLabel` here
 * instead of naming a key, so one table decides both what a key does and what the hint says.
 * Rebinding (v0.0.19) changes these tables and every hint follows.
 */

import type { PadButton } from './Gamepad';
import type { GlyphSpec } from './glyphs';
import { MOUSE_LEFT, MOUSE_RIGHT } from '../systems/Input';

export type Action =
  // Flight
  | 'throttleUp' | 'throttleDown' | 'bankLeft' | 'bankRight' | 'boost' | 'firePrimary' | 'fireSecondary' | 'modifier'
  // Sortie flow
  | 'confirm' | 'launch' | 'back' | 'pause' | 'fold' | 'service' | 'swap' | 'remove' | 'upgrade'
  // Selection
  | 'prevAircraft' | 'nextAircraft' | 'prevMission' | 'nextMission'
  | 'pick0' | 'pick1' | 'pick2' | 'pick3' | 'pick4' | 'pick5' | 'pick6' | 'pick7'
  // Screens
  | 'base' | 'logbook' | 'sound' | 'dev' | 'hints' | 'scoreboard'
  // Multiplayer
  | 'emote1' | 'emote2' | 'emote3';

/** Where the player is, which decides what the controller's buttons do. */
export type InputContext = 'flight' | 'home' | 'menu';

/** Keyboard: physical key code → action. */
export const KEYMAP: Readonly<Record<string, Action>> = {
  KeyW: 'throttleUp', KeyS: 'throttleDown', KeyA: 'bankLeft', KeyD: 'bankRight',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'launch', Escape: 'back',
  KeyF: 'fold', KeyR: 'service', KeyX: 'swap', Delete: 'remove', KeyU: 'upgrade',
  KeyQ: 'prevAircraft', KeyE: 'nextAircraft',
  KeyB: 'base', KeyL: 'logbook', KeyM: 'sound', Backquote: 'dev', KeyH: 'hints', Tab: 'scoreboard',
  KeyZ: 'emote1', KeyC: 'emote2', KeyV: 'emote3',
  Digit0: 'pick0', Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Digit4: 'pick4', Digit5: 'pick5', Digit6: 'pick6', Digit7: 'pick7',
  Numpad0: 'pick0', Numpad1: 'pick1', Numpad2: 'pick2', Numpad3: 'pick3', Numpad4: 'pick4', Numpad5: 'pick5', Numpad6: 'pick6', Numpad7: 'pick7',
};

/** Controller: per context, button → action on press. */
export const PAD_PRESS: Readonly<Record<InputContext, Partial<Record<PadButton, Action>>>> = {
  flight: { lt: 'fireSecondary', west: 'service', menu: 'pause', up: 'emote1', left: 'emote2', right: 'emote3' },
  home: {
    south: 'confirm', east: 'back', west: 'service', north: 'base', lb: 'prevAircraft', rb: 'nextAircraft',
    lt: 'prevMission', rt: 'nextMission', view: 'logbook', menu: 'pause',
  },
  menu: { south: 'confirm', east: 'back', menu: 'pause', view: 'logbook' },
};

/** Controller: per context, button → action while held. */
export const PAD_HOLD: Readonly<Record<InputContext, Partial<Record<PadButton, Action>>>> = {
  flight: { rt: 'firePrimary', rb: 'boost', lb: 'modifier', north: 'hints', view: 'scoreboard' },
  home: { view: 'scoreboard' },
  menu: {},
};

/** The mouse buttons as actions. */
export const MOUSE_HOLD: Partial<Record<Action, number>> = { firePrimary: MOUSE_LEFT, fireSecondary: MOUSE_RIGHT };

/** How a key code reads on a key cap. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  Delete: 'Del', Backquote: '`', Tab: 'Tab',
};

/** A key code's label: KeyB → B, Digit1 → 1, Escape → Esc. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return m ? m[1] : code;
}

const MOUSE_NAMES: Readonly<Record<number, string>> = { [MOUSE_LEFT]: 'LMB', [MOUSE_RIGHT]: 'RMB' };

/** The key codes bound to an action, main keyboard first (the numpad and right-hand copies last). */
export function keysFor(action: Action): string[] {
  const codes = Object.entries(KEYMAP).filter(([, a]) => a === action).map(([c]) => c);
  return codes.sort((a, b) => Number(/^Numpad|Right$/.test(a)) - Number(/^Numpad|Right$/.test(b)));
}

/** The key cap for an action (its first key, or its mouse button); '' when nothing is bound. */
export function keyFor(action: Action): string {
  const code = keysFor(action)[0];
  if (code) return keyLabel(code);
  const mouse = MOUSE_HOLD[action];
  return mouse !== undefined ? MOUSE_NAMES[mouse] : '';
}

const CONTEXTS: readonly InputContext[] = ['home', 'flight', 'menu'];

/**
 * The controller button for an action: pressed in `context` (or anywhere, home first), else held.
 * Undefined when the controller reaches it another way (the highlight and A).
 */
export function padButtonFor(action: Action, context?: InputContext): PadButton | undefined {
  const contexts = context ? [context] : CONTEXTS;
  for (const table of [PAD_PRESS, PAD_HOLD]) {
    for (const c of contexts) {
      const hit = (Object.entries(table[c]) as Array<[PadButton, Action]>).find(([, a]) => a === action);
      if (hit) return hit[0];
    }
  }
  return undefined;
}

/**
 * The binding to show for an action, as a glyph spec: the key cap, and the controller button when
 * the controller has one. `padAction` names a different action for the controller (Esc is "back"
 * on the keyboard; the controller's pause is its Menu button).
 */
export function bind(action: Action, padAction: Action = action, context?: InputContext): GlyphSpec {
  const pad = padButtonFor(padAction, context);
  return pad ? { key: keyFor(action), pad } : { key: keyFor(action) };
}

/** Two bindings shown as one hint ("Q / E", "LB / RB"). */
export function pair(a: GlyphSpec, b: GlyphSpec, sep = ' / '): GlyphSpec {
  const pad = a.pad && b.pad ? `{${a.pad}}${sep}{${b.pad}}` : undefined;
  return pad ? { key: `${a.key}${sep}${b.key}`, padText: pad } : { key: `${a.key}${sep}${b.key}` };
}

/** Every action some device can trigger (for text that names actions, "{fold}"). */
export function isAction(name: string): name is Action {
  return Object.values(KEYMAP).includes(name as Action) || name in MOUSE_HOLD
    || [PAD_PRESS, PAD_HOLD].some((t) => Object.values(t).some((c) => Object.values(c).includes(name as Action)));
}

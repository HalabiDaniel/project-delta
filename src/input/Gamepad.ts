/**
 * Game controllers through the browser Gamepad API, read into one normalised shape whatever the
 * browser reports. Browsers that recognise a controller give the "standard" mapping (Xbox layout:
 * A B X Y, bumpers, analog triggers as buttons 6 and 7, D-pad as buttons 12–15); others hand over
 * the raw HID layout, which differs between Linux (xpad), DualShock / DualSense and others. The
 * profiles below fix the common raw layouts; anything unknown is read as if it were standard, so
 * at least the face buttons and the left stick work.
 */

import { STICK, type Stick } from './analog';

/** The buttons the game uses, by position (Xbox names; PlayStation shows its own labels). */
export type PadButton =
  | 'south' | 'east' | 'west' | 'north'
  | 'lb' | 'rb' | 'lt' | 'rt'
  | 'view' | 'menu' | 'ls' | 'rs'
  | 'up' | 'down' | 'left' | 'right';

export const PAD_BUTTONS: readonly PadButton[] = [
  'south', 'east', 'west', 'north', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'ls', 'rs', 'up', 'down', 'left', 'right',
];

export type PadFamily = 'xbox' | 'playstation' | 'generic';

/** One controller, read and normalised. */
export interface PadState {
  index: number;
  id: string;
  family: PadFamily;
  profile: ProfileId;
  left: Stick;
  right: Stick;
  /** Trigger pull 0–1. */
  lt: number;
  rt: number;
  pressed: Record<PadButton, boolean>;
}

export type ProfileId = 'standard' | 'xinput-raw' | 'dualshock-raw' | 'unknown';

/** The bits of the Gamepad API this module reads (so tests can pass plain objects). */
export interface RawPad {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
}

export function familyOf(id: string): PadFamily {
  const s = id.toLowerCase();
  if (/045e|xbox|xinput|x-box/.test(s)) return 'xbox';
  // Sony's vendor id, or the names DualShock 4 ("Wireless Controller") and DualSense report.
  if (/054c|playstation|dualshock|dualsense|^wireless controller/.test(s)) return 'playstation';
  return 'generic';
}

export function profileOf(pad: Pick<RawPad, 'id' | 'mapping' | 'axes'>): ProfileId {
  if (pad.mapping === 'standard') return 'standard';
  const family = familyOf(pad.id);
  if (family === 'playstation') return 'dualshock-raw';
  // The Linux xpad driver (Firefox): sticks on 0/1 and 3/4, triggers on 2 and 5, the D-pad on 6/7.
  if (pad.axes.length >= 6) return 'xinput-raw';
  return 'unknown';
}

const btn = (pad: RawPad, i: number): { pressed: boolean; value: number } => pad.buttons[i] ?? { pressed: false, value: 0 };
/** An analog button's pull 0–1 (some browsers report only `pressed` for digital ones). */
const pull = (pad: RawPad, i: number): number => {
  const b = btn(pad, i);
  return b.value > 0 ? Math.min(1, b.value) : b.pressed ? 1 : 0;
};
const axis = (pad: RawPad, i: number): number => {
  const v = pad.axes[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};
/** A raw trigger axis rests at -1 and reads +1 fully pulled; some browsers report 0 until first touched. */
const triggerAxis = (v: number): number => Math.max(0, Math.min(1, (v + 1) / 2));

/** Reads one controller into the normalised shape. */
export function readPad(pad: RawPad): PadState {
  const profile = profileOf(pad);
  const pressed = Object.fromEntries(PAD_BUTTONS.map((b) => [b, false])) as Record<PadButton, boolean>;
  let left: Stick;
  let right: Stick;
  let lt: number;
  let rt: number;
  const set = (b: PadButton, i: number): void => {
    pressed[b] = btn(pad, i).pressed;
  };
  switch (profile) {
    case 'xinput-raw': {
      left = { x: axis(pad, 0), y: axis(pad, 1) };
      right = { x: axis(pad, 3), y: axis(pad, 4) };
      lt = triggerAxis(axis(pad, 2));
      rt = triggerAxis(axis(pad, 5));
      set('south', 0); set('east', 1); set('west', 2); set('north', 3);
      set('lb', 4); set('rb', 5); set('view', 6); set('menu', 7); set('ls', 9); set('rs', 10);
      const hx = axis(pad, 6);
      const hy = axis(pad, 7);
      pressed.left = hx < -0.5; pressed.right = hx > 0.5; pressed.up = hy < -0.5; pressed.down = hy > 0.5;
      break;
    }
    case 'dualshock-raw': {
      // Square, Cross, Circle, Triangle on 0–3; L2/R2 also as buttons 6/7; Share 8, Options 9.
      left = { x: axis(pad, 0), y: axis(pad, 1) };
      right = { x: axis(pad, 2), y: axis(pad, pad.axes.length >= 6 ? 5 : 3) };
      lt = pull(pad, 6);
      rt = pull(pad, 7);
      set('west', 0); set('south', 1); set('east', 2); set('north', 3);
      set('lb', 4); set('rb', 5); set('view', 8); set('menu', 9); set('ls', 10); set('rs', 11);
      // The D-pad is a hat on axis 9 (a value per direction) on some systems, buttons 14–17 on others.
      if (pad.buttons.length > 17) {
        set('up', 14); set('down', 15); set('left', 16); set('right', 17);
      } else if (pad.axes.length > 9) {
        const hat = axis(pad, 9);
        if (hat <= 1) {
          const step = Math.round((hat + 1) / (2 / 7));
          pressed.up = step === 0 || step === 1 || step === 7;
          pressed.right = step >= 1 && step <= 3;
          pressed.down = step >= 3 && step <= 5;
          pressed.left = step >= 5 && step <= 7;
        }
      }
      break;
    }
    default: {
      // Standard mapping, and the fallback for anything unrecognised.
      left = { x: axis(pad, 0), y: axis(pad, 1) };
      right = { x: axis(pad, 2), y: axis(pad, 3) };
      lt = pull(pad, 6);
      rt = pull(pad, 7);
      set('south', 0); set('east', 1); set('west', 2); set('north', 3);
      set('lb', 4); set('rb', 5); set('view', 8); set('menu', 9); set('ls', 10); set('rs', 11);
      set('up', 12); set('down', 13); set('left', 14); set('right', 15);
    }
  }
  pressed.lt = lt > STICK.triggerThreshold;
  pressed.rt = rt > STICK.triggerThreshold;
  return { index: pad.index, id: pad.id, family: familyOf(pad.id), profile, left, right, lt, rt, pressed };
}

/** Is anything on this pad being used (beyond resting noise)? Used to switch the active device. */
export function padActive(s: PadState, dead = 0.35): boolean {
  if (PAD_BUTTONS.some((b) => s.pressed[b])) return true;
  return Math.hypot(s.left.x, s.left.y) > dead || Math.hypot(s.right.x, s.right.y) > dead;
}

export type PadEvent =
  | { kind: 'connected'; index: number; id: string }
  | { kind: 'disconnected'; index: number; id: string };

/**
 * Polls the browser's controllers once per frame. The game follows one controller at a time: the
 * last one that was used. Connection and disconnection are reported whenever they happen (the
 * browser's events, plus a poll diff, since some browsers only expose a pad after a button press).
 */
export class GamepadSource {
  /** The controller being followed, as read this frame. */
  state: PadState | null = null;
  /** The same controller's buttons last frame, for edge detection. */
  private previous: Record<PadButton, boolean> | null = null;
  private activeIndex: number | null = null;
  private readonly known = new Map<number, string>();
  private readonly listeners: Array<(e: PadEvent) => void> = [];

  constructor(private readonly getPads: () => ReadonlyArray<RawPad | null> = browserPads) {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () => this.poll());
      window.addEventListener('gamepaddisconnected', () => this.poll());
    }
  }

  onEvent(handler: (e: PadEvent) => void): void {
    this.listeners.push(handler);
  }

  get connected(): number {
    return this.known.size;
  }

  /** Reads every controller; returns the followed one's state (null when none is connected). */
  poll(): PadState | null {
    let pads: ReadonlyArray<RawPad | null>;
    try {
      pads = this.getPads();
    } catch {
      pads = [];
    }
    const seen = new Set<number>();
    let firstActive: PadState | null = null;
    let followed: PadState | null = null;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      if (!this.known.has(pad.index)) {
        this.known.set(pad.index, pad.id);
        this.emit({ kind: 'connected', index: pad.index, id: pad.id });
      }
      const s = readPad(pad);
      if (pad.index === this.activeIndex) followed = s;
      if (!firstActive && padActive(s)) firstActive = s;
    }
    for (const [index, id] of [...this.known]) {
      if (seen.has(index)) continue;
      this.known.delete(index);
      if (index === this.activeIndex) {
        this.activeIndex = null;
        this.previous = null;
      }
      this.emit({ kind: 'disconnected', index, id });
    }
    // Follow whichever controller is being used; stay on the current one while it is idle.
    if (firstActive && firstActive.index !== this.activeIndex && (!followed || !padActive(followed))) {
      this.activeIndex = firstActive.index;
      this.previous = null;
      followed = firstActive;
    }
    if (!followed && this.activeIndex === null) {
      const first = pads.find((p): p is RawPad => !!p && p.connected);
      if (first) {
        this.activeIndex = first.index;
        followed = readPad(first);
      }
    }
    if (this.state) this.previous = this.state.index === followed?.index ? this.state.pressed : null;
    this.state = followed;
    return followed;
  }

  /** Pressed this frame (and not the last). */
  justPressed(b: PadButton): boolean {
    return !!this.state?.pressed[b] && !(this.previous?.[b] ?? false);
  }

  held(b: PadButton): boolean {
    return !!this.state?.pressed[b];
  }

  private emit(e: PadEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function browserPads(): ReadonlyArray<RawPad | null> {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()) as ReadonlyArray<RawPad | null>;
}

/**
 * The unified input-action layer. Keyboard, mouse and controller all feed the same named actions,
 * and the game reads actions, never devices:
 *
 * - `onAction(fn)`: an action was triggered (a key or button went down).
 * - `held(action)`: is an action being held (by any device)?
 * - `throttle()`, `bank()`: -1 / 0 / +1 flight axes.
 * - `flightMouse(...)`: mouse movement plus the stick's steering, as one mouse-movement delta.
 * - `look()`: the camera-look stick, smoothed and recentring.
 *
 * Which controller button means which action depends on where the player is (`context`): in
 * flight the triggers fire, at home they cycle the mission cards and the D-pad moves the
 * highlight through the HUD's buttons (see FocusNav). The keyboard keeps its v0.0.10 keys.
 * The default controller mapping is in docs/roadmap/v0.0.11.md section 7C; rebinding is v0.0.14.
 */

import {
  NavRepeater, PAD_DEFAULTS, STICK, clamp, padAimAssist, shapeStick, smooth, stickDirection, stickToMouse,
  type AimState, type AssistTarget, type FlightLimits, type NavDirection, type PadTuning, type Stick,
} from './analog';
import { FocusNav } from './FocusNav';
import { GamepadSource, padActive, type PadButton, type PadEvent, type PadFamily } from './Gamepad';
import { applyGlyphs } from './glyphs';
import { MOUSE_LEFT, MOUSE_RIGHT, type Input } from '../systems/Input';

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

export type Device = 'keyboard' | 'gamepad';

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
const MOUSE_HOLD: Partial<Record<Action, number>> = { firePrimary: MOUSE_LEFT, fireSecondary: MOUSE_RIGHT };

// ---- Controller settings (per browser) ---------------------------------------------------------

export type PadLevel = 'low' | 'medium' | 'high';
export interface PadSettings {
  invertY: boolean;
  stick: PadLevel;
  camera: PadLevel;
}
const LEVEL: Record<PadLevel, number> = { low: 0.75, medium: 1, high: 1.3 };
const SETTINGS_KEY = 'paperwars.pad';
export const PAD_SETTINGS_DEFAULT: PadSettings = { invertY: false, stick: 'medium', camera: 'medium' };

export function loadPadSettings(): PadSettings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) ?? 'null') as Partial<PadSettings> | null;
    const level = (v: unknown): PadLevel => (v === 'low' || v === 'high' ? v : 'medium');
    return { invertY: raw?.invertY === true, stick: level(raw?.stick), camera: level(raw?.camera) };
  } catch {
    return { ...PAD_SETTINGS_DEFAULT };
  }
}

export function savePadSettings(s: PadSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the setting lasts for this visit.
  }
}

/** The settings in use, shared by the controls and the pause menu. */
let current: PadSettings | null = null;
let version = 0;

export function getPadSettings(): PadSettings {
  current ??= loadPadSettings();
  return { ...current };
}

export function setPadSettings(s: PadSettings): void {
  current = { ...s };
  version++;
  savePadSettings(current);
}

export function tuningFor(s: PadSettings): PadTuning {
  return { ...PAD_DEFAULTS, invertY: s.invertY, sensitivity: LEVEL[s.stick], lookSensitivity: LEVEL[s.camera] };
}

// ---- The layer -----------------------------------------------------------------------------------

export class Controls {
  readonly pad: GamepadSource;
  readonly nav: FocusNav;
  context: InputContext = 'home';
  /** Whether the HUD's buttons can be navigated with the controller right now. */
  navigable = true;
  /**
   * A name for what is on screen (phase, open menus). When it changes the highlight goes back to
   * the screen's main button, so A always does the obvious next thing on a new screen.
   */
  screen = '';
  private lastScreen = '';
  private dev: Device = 'keyboard';
  private tuningVersion = -1;
  private tuningCache: PadTuning = tuningFor(PAD_SETTINGS_DEFAULT);
  private readonly actionHandlers: Array<(a: Action, device: Device) => void> = [];
  private readonly deviceHandlers: Array<(d: Device) => void> = [];
  private readonly padHandlers: Array<(e: PadEvent) => void> = [];
  private readonly repeater = new NavRepeater();
  private steerStick: Stick = { x: 0, y: 0 };
  private lookState: Stick = { x: 0, y: 0 };
  private glyphFamily: PadFamily | null = null;
  private glyphsDirty = true;

  constructor(
    readonly input: Input,
    private readonly hudRoot: ParentNode | null = typeof document !== 'undefined' ? document : null,
    pad?: GamepadSource,
  ) {
    this.pad = pad ?? new GamepadSource();
    this.nav = new FocusNav(this.hudRoot);
    input.onKeyDown((code) => {
      this.use('keyboard');
      const action = KEYMAP[code];
      if (action) this.emit(action, 'keyboard');
    });
    input.onCanvasClick((button) => {
      this.use('keyboard');
      if (button === MOUSE_RIGHT) this.emit('fireSecondary', 'keyboard');
    });
    input.onMouseMove(() => this.use('keyboard'));
    this.pad.onEvent((e) => {
      for (const h of this.padHandlers) h(e);
      if (e.kind === 'disconnected' && this.pad.connected === 0) this.use('keyboard');
    });
    if (typeof MutationObserver !== 'undefined' && this.hudRoot && 'nodeType' in this.hudRoot) {
      new MutationObserver(() => (this.glyphsDirty = true)).observe(this.hudRoot as Node, { subtree: true, childList: true, characterData: true });
    }
  }

  get device(): Device {
    return this.dev;
  }

  get padFamily(): PadFamily {
    return this.pad.state?.family ?? 'xbox';
  }

  private get tuning(): PadTuning {
    if (this.tuningVersion !== version) {
      this.tuningVersion = version;
      this.tuningCache = tuningFor(getPadSettings());
    }
    return this.tuningCache;
  }

  onAction(handler: (a: Action, device: Device) => void): void {
    this.actionHandlers.push(handler);
  }

  onDeviceChange(handler: (d: Device) => void): void {
    this.deviceHandlers.push(handler);
  }

  /** A controller connected or disconnected. */
  onPad(handler: (e: PadEvent) => void): void {
    this.padHandlers.push(handler);
  }

  /**
   * Once per frame, before the game reads actions: polls the controller, fires its button
   * actions for the current context, moves the menu highlight and keeps the hints in step.
   */
  update(dt: number): void {
    const s = this.pad.poll();
    if (s && padActive(s)) this.use('gamepad');
    const navOn = this.dev === 'gamepad' && this.context !== 'flight' && this.navigable;
    this.nav.setActive(navOn);
    if (this.screen !== this.lastScreen) {
      this.lastScreen = this.screen;
      this.nav.reset();
    }
    this.nav.update();
    if (s) {
      for (const [button, action] of Object.entries(PAD_PRESS[this.context]) as Array<[PadButton, Action]>) {
        if (!this.pad.justPressed(button)) continue;
        // A presses the highlighted button when there is one; otherwise it is the plain confirm.
        if (action === 'confirm' && this.nav.active && this.nav.press()) continue;
        this.emit(action, 'gamepad');
      }
    }
    // Menu navigation: D-pad, or the left stick, with auto-repeat.
    if (navOn && s) {
      const dpad: NavDirection | null = s.pressed.up ? 'up' : s.pressed.down ? 'down' : s.pressed.left ? 'left' : s.pressed.right ? 'right' : null;
      const dir = dpad ?? stickDirection(s.left);
      const step = this.repeater.update(dir, dt);
      this.nav.update();
      if (step) this.nav.move(step);
    } else {
      this.repeater.update(null, dt);
      this.nav.update();
    }
    // Steering and looking.
    const flying = this.context === 'flight' && this.dev === 'gamepad' && !!s;
    const steer = flying && s ? shapeStick(s.left, this.tuning) : { x: 0, y: 0 };
    this.steerStick = {
      x: smooth(this.steerStick.x, steer.x, this.tuning.smoothing, dt),
      y: smooth(this.steerStick.y, steer.y, this.tuning.smoothing, dt),
    };
    const lookRaw = flying && s ? shapeStick(s.right, this.tuning) : { x: 0, y: 0 };
    const k = 1 - Math.exp(-STICK.lookRate * dt);
    this.lookState = {
      x: this.lookState.x + (clamp(lookRaw.x * this.tuning.lookSensitivity, -1, 1) - this.lookState.x) * k,
      y: this.lookState.y + (clamp(lookRaw.y * this.tuning.lookSensitivity, -1, 1) - this.lookState.y) * k,
    };
    this.refreshGlyphs();
  }

  /** Is the action held on any device? */
  held(action: Action): boolean {
    const input = this.input;
    for (const [code, a] of Object.entries(KEYMAP)) if (a === action && input.isHeld(code)) return true;
    const mouse = MOUSE_HOLD[action];
    if (mouse !== undefined && input.isButtonHeld(mouse)) return true;
    if (this.pad.state) {
      for (const [button, a] of Object.entries(PAD_HOLD[this.context]) as Array<[PadButton, Action]>) if (a === action && this.pad.held(button)) return true;
    }
    return false;
  }

  /** -1, 0 or +1: W / S, or the left stick's y with the modifier (LB) held. */
  throttle(): -1 | 0 | 1 {
    const keys = (this.held('throttleUp') ? 1 : 0) - (this.held('throttleDown') ? 1 : 0);
    if (keys !== 0) return keys as -1 | 1;
    const s = this.pad.state;
    if (this.context !== 'flight' || !s || !this.held('modifier')) return 0;
    const y = shapeStick(s.left, this.tuning).y;
    return y < -0.5 ? 1 : y > 0.5 ? -1 : 0;
  }

  /** +1 bank left, -1 bank right: A / D, or the left stick's x with the modifier held. */
  bank(): -1 | 0 | 1 {
    const keys = (this.held('bankLeft') ? 1 : 0) - (this.held('bankRight') ? 1 : 0);
    if (keys !== 0) return keys as -1 | 1;
    const s = this.pad.state;
    if (this.context !== 'flight' || !s || !this.held('modifier')) return 0;
    const x = shapeStick(s.left, this.tuning).x;
    return x < -0.5 ? 1 : x > 0.5 ? -1 : 0;
  }

  /** The mouse movement since the last call (keyboard-and-mouse steering, or dragging at the desk). */
  consumeMouse(): { dx: number; dy: number } {
    return this.input.consumeMouse();
  }

  /**
   * The stick's steering this step, as mouse movement for the flight model (zero unless the
   * controller is in use and the modifier is up). `targets` get the controller's aim help.
   */
  stickMouse(aim: AimState, limits: FlightLimits, dt: number, from?: AssistTarget, targets: readonly AssistTarget[] = []): { dx: number; dy: number } {
    if (this.context !== 'flight' || this.dev !== 'gamepad' || !this.pad.state || this.held('modifier')) return { dx: 0, dy: 0 };
    const pitch = aim.aimPitch;
    const assist = from && targets.length ? padAimAssist(from, aim.aimYaw, pitch, targets) : null;
    return stickToMouse(this.steerStick, aim, limits, dt, this.tuning, assist);
  }

  /** Is the steering stick deflected (so the auto-level should wait)? */
  get steering(): boolean {
    return Math.hypot(this.steerStick.x, this.steerStick.y) > 0.05;
  }

  /** Camera look, -1..1 each way, eased and recentring when released. */
  look(): Stick {
    return this.lookState;
  }

  /** The right stick at the desk, for turning the plane preview (pixels-ish per second). */
  previewTurn(): Stick {
    const s = this.pad.state;
    if (this.dev !== 'gamepad' || this.context === 'flight' || !s) return { x: 0, y: 0 };
    return shapeStick(s.right, this.tuning);
  }

  /** Whether the controller is driving steering (so pointer lock isn't needed). */
  get padFlying(): boolean {
    return this.dev === 'gamepad' && this.pad.state !== null;
  }

  private use(d: Device): void {
    if (d === this.dev) return;
    this.dev = d;
    this.glyphsDirty = true;
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('pad-mode', d === 'gamepad');
    }
    for (const h of this.deviceHandlers) h(d);
  }

  private refreshGlyphs(): void {
    const family = this.dev === 'gamepad' ? this.padFamily : null;
    if (family !== this.glyphFamily) {
      this.glyphFamily = family;
      this.glyphsDirty = true;
      if (typeof document !== 'undefined') document.body.dataset.pad = family ?? '';
    }
    if (!this.glyphsDirty || !this.hudRoot) return;
    this.glyphsDirty = false;
    applyGlyphs(this.hudRoot, family);
  }

  private emit(a: Action, d: Device): void {
    for (const h of this.actionHandlers) h(a, d);
  }
}

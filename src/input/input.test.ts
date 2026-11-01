import { describe, expect, it } from 'vitest';
import { PLANE } from '../config';
import { FlightModel } from '../aircraft/FlightModel';
import { AIRCRAFT } from '../config';
import {
  NavRepeater, PAD_ASSIST, PAD_DEFAULTS, STICK, axisDeadZone, padAimAssist, radialDeadZone, responseCurve, shapeStick, stickDirection, stickToMouse,
} from './analog';
import { GamepadSource, familyOf, padActive, profileOf, readPad, type RawPad } from './Gamepad';
import { padHint } from './glyphs';
import { pickInDirection, type Rect } from './FocusNav';
import { Controls, KEYMAP, PAD_HOLD, PAD_PRESS, tuningFor, type Action } from './Controls';
import type { Input } from '../systems/Input';

// ---- Helpers -------------------------------------------------------------------------------------

function standardPad(over: { axes?: number[]; pressed?: number[]; values?: Record<number, number>; id?: string; index?: number } = {}): RawPad {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = over.values?.[i] ?? (over.pressed?.includes(i) ? 1 : 0);
    return { pressed: value > 0.5 || !!over.pressed?.includes(i), value };
  });
  return { index: over.index ?? 0, id: over.id ?? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard', connected: true, axes: over.axes ?? [0, 0, 0, 0], buttons };
}

class FakeInput {
  held = new Set<string>();
  buttons = new Set<number>();
  private keys: Array<(code: string) => void> = [];
  onKeyDown(h: (code: string) => void): void { this.keys.push(h); }
  onCanvasClick(): void {}
  onMouseMove(): void {}
  isHeld(code: string): boolean { return this.held.has(code); }
  isButtonHeld(b: number): boolean { return this.buttons.has(b); }
  consumeMouse(): { dx: number; dy: number } { return { dx: 0, dy: 0 }; }
  press(code: string): void { for (const k of this.keys) k(code); }
}

function rig(): { controls: Controls; input: FakeInput; pads: Array<RawPad | null>; actions: Action[] } {
  const input = new FakeInput();
  const pads: Array<RawPad | null> = [];
  const controls = new Controls(input as unknown as Input, null, new GamepadSource(() => pads));
  const actions: Action[] = [];
  controls.onAction((a) => actions.push(a));
  return { controls, input, pads, actions };
}

// ---- Dead zones and curves -----------------------------------------------------------------------

describe('stick shaping', () => {
  it('reads zero inside the radial dead zone and rescales beyond it without a jump', () => {
    expect(radialDeadZone({ x: 0.1, y: 0.1 }, 0.16)).toEqual({ x: 0, y: 0 });
    const just = radialDeadZone({ x: 0.17, y: 0 }, 0.16);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.02);
    expect(radialDeadZone({ x: 1, y: 0 }, 0.16).x).toBeCloseTo(1);
    // Square-gate corners are clamped to full deflection.
    const corner = radialDeadZone({ x: 1, y: 1 }, 0.16);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1);
  });

  it('keeps a slightly diagonal push straight with the per-axis dead zone', () => {
    expect(axisDeadZone(0.04, 0.06)).toBe(0);
    expect(axisDeadZone(-1, 0.06)).toBe(-1);
    const s = shapeStick({ x: 0.9, y: 0.05 }, PAD_DEFAULTS);
    expect(s.y).toBe(0);
    expect(s.x).toBeGreaterThan(0.8);
  });

  it('gives finer control near the centre with the response curve, and full at the edge', () => {
    const half = responseCurve({ x: 0.5, y: 0 }, 1.6);
    expect(half.x).toBeLessThan(0.5);
    expect(responseCurve({ x: 1, y: 0 }, 1.6).x).toBeCloseTo(1);
    expect(responseCurve({ x: -0.5, y: 0 }, 1.6).x).toBeCloseTo(-half.x);
  });
});

// ---- Steering --------------------------------------------------------------------------------------

describe('stick steering', () => {
  const limits = { maxAimLead: PLANE.maxAimLead, mouseSensitivity: PLANE.mouseSensitivity };
  const tuning = { sensitivity: 1, invertY: false };

  it('leads the aim to the right with the stick to the right, and back to the nose when released', () => {
    const aim = { yaw: 0, aimYaw: 0, aimPitch: 0 };
    const right = stickToMouse({ x: 1, y: 0 }, aim, limits, 1 / 60, tuning);
    // Mouse right is positive dx, which turns right (negative yaw).
    expect(right.dx).toBeGreaterThan(0);
    const newAimYaw = aim.aimYaw - right.dx * PLANE.mouseSensitivity;
    expect(newAimYaw).toBeCloseTo(-STICK.yawLeadShare * PLANE.maxAimLead);
    const released = stickToMouse({ x: 0, y: 0 }, { yaw: 0, aimYaw: newAimYaw, aimPitch: 0 }, limits, 1 / 60, tuning);
    expect(newAimYaw - released.dx * PLANE.mouseSensitivity).toBeCloseTo(0);
  });

  it('climbs with the stick pushed up, and the other way when inverted', () => {
    const aim = { yaw: 0, aimYaw: 0, aimPitch: 0 };
    const up = stickToMouse({ x: 0, y: -1 }, aim, limits, 0.1, tuning);
    expect(-up.dy * PLANE.mouseSensitivity).toBeCloseTo(STICK.pitchRate * 0.1);
    const inverted = stickToMouse({ x: 0, y: -1 }, aim, limits, 0.1, { ...tuning, invertY: true });
    expect(inverted.dy).toBeCloseTo(-up.dy);
  });

  it('scales with sensitivity', () => {
    const aim = { yaw: 0, aimYaw: 0, aimPitch: 0 };
    const low = stickToMouse({ x: 0, y: -1 }, aim, limits, 0.1, { ...tuning, sensitivity: 0.75 });
    const high = stickToMouse({ x: 0, y: -1 }, aim, limits, 0.1, { ...tuning, sensitivity: 1.3 });
    expect(Math.abs(high.dy)).toBeGreaterThan(Math.abs(low.dy));
  });

  it('turns a real flight model as hard as the mouse can, and no harder', () => {
    const fly = (controls: (m: FlightModel) => { dx: number; dy: number }) => {
      const m = new FlightModel(AIRCRAFT.falcon);
      m.status = 'flying';
      m.position.set(0, 60, 0);
      m.speed = m.throttleSpeed = AIRCRAFT.falcon.flight.cruiseSpeed;
      for (let i = 0; i < 45; i++) {
        const d = controls(m);
        m.fly(1 / 60, { mouseDX: d.dx, mouseDY: d.dy, throttle: 0, bank: 0, boost: false, autoLevel: true, autopilot: null, gliding: false }, [], []);
      }
      return m.yaw;
    };
    const stick = fly((m) => stickToMouse({ x: 1, y: 0 }, m, limits, 1 / 60, tuning));
    const mouse = fly(() => ({ dx: 400, dy: 0 }));
    expect(stick).toBeLessThan(-0.4); // turned right a good way in 0.75 s
    expect(Math.abs(stick)).toBeLessThanOrEqual(Math.abs(mouse) + 1e-6);
  });

  it('helps the aim towards an aircraft near it, and not one far off the aim', () => {
    const from = { x: 0, y: 50, z: 0 };
    const near = padAimAssist(from, 0, 0, [{ x: -3, y: 50, z: -60 }]); // a little to the left
    expect(near).not.toBeNull();
    expect(near!.yaw).toBeGreaterThan(0); // pulls left (positive yaw)
    expect(near!.scale).toBeLessThan(1);
    expect(near!.scale).toBeGreaterThanOrEqual(PAD_ASSIST.slowdown);
    expect(padAimAssist(from, 0, 0, [{ x: -60, y: 50, z: -60 }])).toBeNull();
    expect(padAimAssist(from, 0, 0, [{ x: 0, y: 50, z: -400 }])).toBeNull();
  });
});

// ---- Controllers ----------------------------------------------------------------------------------

describe('controller mapping', () => {
  it('recognises Xbox and PlayStation controllers and the raw layouts', () => {
    expect(familyOf('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(familyOf('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(familyOf('Some Arcade Stick')).toBe('generic');
    expect(profileOf({ id: 'x', mapping: 'standard', axes: [0, 0, 0, 0] })).toBe('standard');
    expect(profileOf({ id: '054c-09cc-Wireless Controller', mapping: '', axes: [0, 0, 0, 0, 0, 0] })).toBe('dualshock-raw');
    expect(profileOf({ id: '045e-028e-Microsoft X-Box 360 pad', mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0] })).toBe('xinput-raw');
    expect(profileOf({ id: 'mystery', mapping: '', axes: [0, 0] })).toBe('unknown');
  });

  it('reads the standard mapping', () => {
    const s = readPad(standardPad({ axes: [0.5, -0.2, 0.1, 0.9], pressed: [0, 12], values: { 7: 0.8, 6: 0.2 } }));
    expect(s.left).toEqual({ x: 0.5, y: -0.2 });
    expect(s.right).toEqual({ x: 0.1, y: 0.9 });
    expect(s.pressed.south).toBe(true);
    expect(s.pressed.up).toBe(true);
    expect(s.rt).toBeCloseTo(0.8);
    expect(s.pressed.rt).toBe(true);
    expect(s.pressed.lt).toBe(false); // below the trigger threshold
  });

  it('fixes the Linux xpad raw layout: triggers and D-pad on axes', () => {
    const pad: RawPad = {
      index: 0, id: '045e-028e-Microsoft X-Box 360 pad', mapping: '', connected: true,
      axes: [0, 0, 1, 0.3, 0.4, -1, -1, 1],
      buttons: Array.from({ length: 11 }, (_, i) => ({ pressed: i === 7, value: i === 7 ? 1 : 0 })),
    };
    const s = readPad(pad);
    expect(s.right).toEqual({ x: 0.3, y: 0.4 });
    expect(s.pressed.lt).toBe(true); // axis 2 fully pulled
    expect(s.pressed.rt).toBe(false); // axis 5 at rest
    expect(s.pressed.left).toBe(true);
    expect(s.pressed.down).toBe(true);
    expect(s.pressed.menu).toBe(true); // Start is button 7 here
  });

  it('fixes the raw DualShock layout: Cross is south, Square is west', () => {
    const pad: RawPad = {
      index: 0, id: '054c-05c4-Wireless Controller', mapping: '', connected: true,
      axes: [0, 0, 0, 0, 0, 0],
      buttons: Array.from({ length: 14 }, (_, i) => ({ pressed: i === 1 || i === 0, value: 0 })),
    };
    const s = readPad(pad);
    expect(s.pressed.south).toBe(true);
    expect(s.pressed.west).toBe(true);
    expect(s.pressed.east).toBe(false);
    expect(s.family).toBe('playstation');
  });

  it('reports connection and disconnection, follows the controller in use, and detects presses', () => {
    const pads: Array<RawPad | null> = [];
    const source = new GamepadSource(() => pads);
    const events: string[] = [];
    source.onEvent((e) => events.push(`${e.kind}:${e.index}`));
    source.poll();
    expect(source.state).toBeNull();
    pads[0] = standardPad();
    pads[1] = standardPad({ index: 1 });
    source.poll();
    expect(events).toEqual(['connected:0', 'connected:1']);
    expect(source.state?.index).toBe(0);
    pads[1] = standardPad({ index: 1, pressed: [0] });
    source.poll();
    expect(source.state?.index).toBe(1); // the one being used
    expect(source.justPressed('south')).toBe(true);
    source.poll();
    expect(source.justPressed('south')).toBe(false);
    expect(source.held('south')).toBe(true);
    pads[1] = null;
    source.poll();
    expect(events).toContain('disconnected:1');
    expect(source.state?.index).toBe(0);
  });

  it('ignores resting stick noise when deciding whether a controller is in use', () => {
    expect(padActive(readPad(standardPad({ axes: [0.05, -0.08, 0.02, 0] })))).toBe(false);
    expect(padActive(readPad(standardPad({ axes: [0.9, 0, 0, 0] })))).toBe(true);
  });
});

// ---- The action layer ---------------------------------------------------------------------------------

describe('input actions', () => {
  it('maps every game key to an action', () => {
    for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'Escape', 'Enter', 'KeyF', 'KeyQ', 'KeyE', 'KeyB', 'KeyR', 'KeyX', 'KeyL', 'KeyM', 'Tab', 'KeyZ', 'Digit1']) {
      expect(KEYMAP[code], code).toBeDefined();
    }
  });

  it('gives keyboard and controller the same actions', () => {
    const { controls, input, pads, actions } = rig();
    input.press('KeyQ');
    expect(actions).toEqual(['prevAircraft']);
    expect(controls.device).toBe('keyboard');
    pads[0] = standardPad({ pressed: [4] }); // LB at home: previous aircraft
    controls.context = 'home';
    controls.update(1 / 60);
    expect(actions).toEqual(['prevAircraft', 'prevAircraft']);
    expect(controls.device).toBe('gamepad');
    // Back to the keyboard without anything to reset.
    input.press('KeyE');
    expect(controls.device).toBe('keyboard');
    expect(actions.at(-1)).toBe('nextAircraft');
  });

  it('changes what the buttons mean with the context', () => {
    const { controls, pads, actions } = rig();
    controls.context = 'flight';
    pads[0] = standardPad({ values: { 6: 1 } }); // LT
    controls.update(1 / 60);
    expect(actions).toEqual(['fireSecondary']);
    pads[0] = standardPad();
    controls.update(1 / 60);
    controls.context = 'home';
    pads[0] = standardPad({ values: { 6: 1 } });
    controls.update(1 / 60);
    expect(actions.at(-1)).toBe('prevMission');
  });

  it('holds actions from either device', () => {
    const { controls, input, pads } = rig();
    controls.context = 'flight';
    input.held.add('ShiftLeft');
    expect(controls.held('boost')).toBe(true);
    input.held.clear();
    expect(controls.held('boost')).toBe(false);
    pads[0] = standardPad({ pressed: [5], values: { 7: 1 } }); // RB, RT
    controls.update(1 / 60);
    expect(controls.held('boost')).toBe(true);
    expect(controls.held('firePrimary')).toBe(true);
    // Every held mapping names a real action.
    for (const ctx of Object.values(PAD_HOLD)) for (const a of Object.values(ctx)) expect(typeof a).toBe('string');
    for (const ctx of Object.values(PAD_PRESS)) expect(Object.keys(ctx).length).toBeGreaterThan(0);
  });

  it('throttles and banks with the stick only while the modifier is held, and then does not steer', () => {
    const { controls, pads } = rig();
    controls.context = 'flight';
    pads[0] = standardPad({ axes: [0, -1, 0, 0] });
    for (let i = 0; i < 10; i++) controls.update(1 / 60);
    expect(controls.throttle()).toBe(0);
    const aim = { yaw: 0, aimYaw: 0, aimPitch: 0 };
    expect(controls.stickMouse(aim, PLANE, 1 / 60).dy).toBeLessThan(0); // climbing
    pads[0] = standardPad({ axes: [-1, 0, 0, 0], pressed: [4] });
    controls.update(1 / 60);
    expect(controls.bank()).toBe(1);
    expect(controls.stickMouse(aim, PLANE, 1 / 60)).toEqual({ dx: 0, dy: 0 });
    pads[0] = standardPad({ axes: [0, -1, 0, 0], pressed: [4] });
    controls.update(1 / 60);
    expect(controls.throttle()).toBe(1);
  });

  it('recentres the camera look when the right stick is released', () => {
    const { controls, pads } = rig();
    controls.context = 'flight';
    pads[0] = standardPad({ axes: [0, 0, 1, 0] });
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(controls.look().x).toBeGreaterThan(0.9);
    pads[0] = standardPad();
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(Math.abs(controls.look().x)).toBeLessThan(0.01);
  });

  it('goes back to the keyboard when the last controller is unplugged, mid-flight included', () => {
    const { controls, pads } = rig();
    const seen: string[] = [];
    controls.onPad((e) => seen.push(e.kind));
    controls.context = 'flight';
    pads[0] = standardPad({ pressed: [0] });
    controls.update(1 / 60);
    expect(controls.device).toBe('gamepad');
    pads[0] = null;
    controls.update(1 / 60);
    expect(seen).toEqual(['connected', 'disconnected']);
    expect(controls.device).toBe('keyboard');
    expect(controls.held('firePrimary')).toBe(false);
    expect(controls.stickMouse({ yaw: 0, aimYaw: 0, aimPitch: 0 }, PLANE, 1 / 60)).toEqual({ dx: 0, dy: 0 });
  });

  it('applies the sensitivity settings', () => {
    expect(tuningFor({ invertY: true, stick: 'high', camera: 'low' })).toMatchObject({ invertY: true, sensitivity: 1.3, lookSensitivity: 0.75 });
  });
});

// ---- Menus and hints ---------------------------------------------------------------------------------

describe('menu navigation and hints', () => {
  const r = (left: number, top: number, w = 40, h = 20): Rect => ({ left, top, right: left + w, bottom: top + h });

  it('moves to the nearest control in a direction, preferring one in line', () => {
    const from = r(100, 100);
    const candidates = [r(200, 100), r(150, 200), r(160, 130), r(0, 100), r(100, 0)];
    expect(pickInDirection(from, candidates, 'right')).toBe(0);
    expect(pickInDirection(from, [r(260, 100), r(160, 112)], 'right')).toBe(1);
    expect(pickInDirection(from, [r(200, 100), r(170, 160)], 'right')).toBe(0);
    expect(pickInDirection(from, candidates, 'left')).toBe(3);
    expect(pickInDirection(from, candidates, 'up')).toBe(4);
    expect(pickInDirection(from, candidates, 'down')).toBe(2);
    expect(pickInDirection(from, [r(0, 100)], 'right')).toBe(-1);
  });

  it('turns a stick into menu steps with auto-repeat', () => {
    expect(stickDirection({ x: 0.2, y: 0.1 })).toBeNull();
    expect(stickDirection({ x: 0.9, y: 0.2 })).toBe('right');
    expect(stickDirection({ x: 0.1, y: -0.9 })).toBe('up');
    const rep = new NavRepeater();
    expect(rep.update('down', 0.016)).toBe('down');
    expect(rep.update('down', 0.1)).toBeNull();
    expect(rep.update('down', STICK.navDelay)).toBe('down');
    expect(rep.update('down', STICK.navRepeat)).toBe('down');
    expect(rep.update(null, 0.016)).toBeNull();
  });

  it('shows the controller button for each keyboard hint, and hides keys it has no button for', () => {
    expect(padHint('Space', 'xbox')).toBe('A');
    expect(padHint('Esc', 'playstation')).toBe('○');
    expect(padHint('Q / E', 'xbox')).toBe('LB / RB');
    expect(padHint('LMB', 'playstation')).toBe('R2');
    expect(padHint('U', 'xbox')).toBe('');
    expect(padHint('3', 'xbox')).toBe('');
  });
});

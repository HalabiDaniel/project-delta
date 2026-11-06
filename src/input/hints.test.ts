// @vitest-environment happy-dom
/**
 * Device-aware hints (plan v0.0.15 §6): glyph sets per device, read from the bindings, switching
 * live: the pause menu's controls grid, tooltips that name a key ("Base (B)"), key caps, tips and
 * the tutorial's chips.
 */
import { describe, expect, it } from 'vitest';
import { bind, keyFor, keyLabel, keysFor, padButtonFor, pair } from './bindings';
import { Controls, KEYMAP } from './Controls';
import { GamepadSource } from './Gamepad';
import { applyGlyphs, KEY_TO_PAD, padControlLabels, padHint } from './glyphs';
import { glyph, iconButton } from '../ui/components';
import { KEYBOARD_LABELS } from '../ui/controlLabels';
import { controlsGridHtml, keyboardControls, padControls } from '../ui/Menus';
import { withKeys } from '../ui/Alerts';
import type { Input } from '../systems/Input';

class FakeInput {
  onKeyDown(): void {}
  onCanvasClick(): void {}
  onMouseMove(): void {}
  isHeld(): boolean { return false; }
  isButtonHeld(): boolean { return false; }
  consumeMouse(): { dx: number; dy: number } { return { dx: 0, dy: 0 }; }
}

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const glyphs = (root: ParentNode): string[] => [...root.querySelectorAll('kbd')].map((k) => k.textContent ?? '');

describe('bindings: one source for what a key does and what the hint says', () => {
  it('names keys and buttons from KEYMAP and the controller tables', () => {
    expect(keyLabel('KeyB')).toBe('B');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('Delete')).toBe('Del');
    expect(keysFor('confirm')[0]).toBe('Enter');
    expect(bind('base')).toEqual({ key: 'B', pad: 'north' });
    expect(bind('logbook')).toEqual({ key: 'L', pad: 'view' });
    expect(bind('back', 'pause')).toEqual({ key: 'Esc', pad: 'menu' });
    expect(bind('firePrimary')).toEqual({ key: 'LMB', pad: 'rt' });
    expect(bind('boost')).toEqual({ key: 'Shift', pad: 'rb' });
    expect(bind('swap')).toEqual({ key: 'X' }); // the controller uses the highlight and A
    expect(padButtonFor('hints')).toBe('north');
    expect(pair(bind('prevAircraft'), bind('nextAircraft'))).toEqual({ key: 'Q / E', padText: '{lb} / {rb}' });
  });

  it('has a controller hint (or a deliberate none) for every key the game binds', () => {
    for (const code of Object.keys(KEYMAP)) expect(KEY_TO_PAD, `${code} → ${keyLabel(code)}`).toHaveProperty([keyLabel(code)]);
    // The v0.0.14 gaps: U, X, Delete and the digits now have entries (hidden: reached with the highlight).
    for (const k of ['U', 'X', 'Del', '0', '5', '7']) expect(padHint(k, 'xbox')).toBe('');
    expect(padHint('1 – 3', 'playstation')).toBe('L2 / R2');
  });

  it('derives the tutorial and dashboard labels from the bindings, per device', () => {
    expect(KEYBOARD_LABELS).toMatchObject({ fold: 'F', launch: 'Space', base: 'B', throttle: 'W / S', bank: 'A / D', selectCard: '1 – 3', back: 'Esc', rearm: 'R' });
    expect(padControlLabels('xbox')).toMatchObject({ base: 'Y', fire: 'RT', bomb: 'LT', boost: 'RB', rearm: 'X', pause: 'Menu', prevPlane: 'LB' });
    expect(padControlLabels('playstation')).toMatchObject({ base: '△', fire: 'R2', bomb: 'L2', boost: 'R1', rearm: '□', pause: 'Options', back: '○', fold: '✕' });
    expect(keyFor('pick4')).toBe('4');
  });
});

describe('the pause menu controls grid per device', () => {
  it('draws the controller grid for Xbox, PlayStation and generic pads, and the keyboard grid', () => {
    const root = host(controlsGridHtml(padControls(), 'pad-only') + controlsGridHtml(keyboardControls(), 'kbd-only'));
    const pad = root.querySelector('.pad-only')!;
    applyGlyphs(root, 'playstation');
    const ps = glyphs(pad);
    expect(ps).toEqual(expect.arrayContaining(['L stick', 'R stick', 'R2', 'L2', 'R1', 'L1 + L', '✕', '○', '□', '△', 'L1 / R1', 'L2 / R2', 'D-pad', 'Share', 'Options']));
    expect(ps.join(' ')).not.toMatch(/\b(RT|LT|RB|LB|Menu|View)\b/);
    applyGlyphs(root, 'xbox');
    expect(glyphs(pad)).toEqual(expect.arrayContaining(['RT', 'LT', 'RB', 'LB + L', 'A', 'B', 'X', 'Y', 'LB / RB', 'LT / RT', 'View', 'Menu']));
    applyGlyphs(root, 'generic');
    expect(glyphs(pad)).toContain('A');
    applyGlyphs(root, null);
    expect(glyphs(root.querySelector('.kbd-only')!)).toEqual(expect.arrayContaining(['Mouse', 'W / S', 'A / D', 'Shift', 'LMB', 'RMB', '1 – 4', 'Q / E', 'F', 'Space', 'R', 'B', 'X', 'L', 'H', 'M']));
    root.remove();
  });
});

describe('live device switching', () => {
  it('relabels key caps, tooltips with keys, tips and the grid when the device changes, and keeps literal labels', () => {
    const root = host([
      iconButton({ icon: 'base', name: 'Base', tipKey: bind('base'), attrs: { id: 'base' } }),
      iconButton({ icon: 'menu', name: 'Menu', tipKey: bind('back', 'pause'), attrs: { id: 'menu' } }),
      iconButton({ icon: 'swap', name: 'Swap', tip: 'Swap the card', tipKey: bind('swap'), attrs: { id: 'swap' } }),
      `<span id="tip">${withKeys('Fold it ({fold}), then {base} opens your base.')}</span>`,
      `<span id="tut">${glyph({ key: 'A' }, { literal: true })}</span>`,
      controlsGridHtml(padControls(), 'pad-only'),
    ].join(''));
    const controls = new Controls(new FakeInput() as unknown as Input, root, new GamepadSource(() => []));
    const tip = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!.dataset.tip;
    controls.update(0);
    expect(tip('base')).toBe('Base (B)');
    expect(tip('menu')).toBe('Menu (Esc)');
    expect(glyphs(root.querySelector('#tip')!)).toEqual(['F', 'B']);

    controls.simulatePad('playstation');
    expect(controls.device).toBe('gamepad');
    expect(document.body.dataset.pad).toBe('playstation');
    expect(tip('base')).toBe('Base (△)');
    expect(tip('menu')).toBe('Menu (Options)');
    expect(tip('swap')).toBe('Swap the card'); // no controller equivalent: no key in the tooltip
    expect(glyphs(root.querySelector('#tip')!)).toEqual(['✕', '△']);
    expect(glyphs(root.querySelector('.pad-only')!)).toContain('L1 / R1');
    expect(glyphs(root.querySelector('#tut')!)).toEqual(['A']); // literal: never turned into "LB+←"

    controls.simulatePad('xbox');
    expect(tip('base')).toBe('Base (Y)');
    expect(glyphs(root.querySelector('#tip')!)).toEqual(['A', 'Y']);
    expect(glyphs(root.querySelector('.pad-only')!)).toContain('LB / RB');

    controls.simulatePad(null);
    expect(controls.device).toBe('keyboard');
    expect(tip('base')).toBe('Base (B)');
    expect(glyphs(root.querySelector('#tip')!)).toEqual(['F', 'B']);
    root.remove();
  });
});

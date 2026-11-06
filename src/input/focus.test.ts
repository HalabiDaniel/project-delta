// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { FocusManager, FocusNav, keyOf, NAV_SELECTOR, type Rect } from './FocusNav';
import { Controls, KEYMAP, NAV_KEYS, type Action } from './Controls';
import { GamepadSource, type RawPad } from './Gamepad';
import type { Input } from '../systems/Input';
import { bindTabs, button, dialog, tabs } from '../ui/components';

// ---- A page with fixed geometry -----------------------------------------------------------------
// happy-dom has no layout, so each control carries its rectangle: data-rect="left top width height".

function rectOf(el: HTMLElement): Rect {
  const r = el.getAttribute('data-rect');
  if (!r) {
    // Containers without a rect take their children's union (for scrollers and tab lists).
    const kids = [...el.querySelectorAll<HTMLElement>('[data-rect]')].map(rectOf);
    if (!kids.length) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: Math.min(...kids.map((k) => k.left)), top: Math.min(...kids.map((k) => k.top)), right: Math.max(...kids.map((k) => k.right)), bottom: Math.max(...kids.map((k) => k.bottom)) };
  }
  const [l, t, w, h] = r.split(' ').map(Number);
  return { left: l, top: t, right: l + w, bottom: t + h };
}

const at = (l: number, t: number, w = 80, h = 30): string => `data-rect="${l} ${t} ${w} ${h}"`;

function page(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById('root')!;
}

function manager(clock = { t: 0 }): FocusManager {
  const m = new FocusManager(document, { rectOf, hitTest: false, tipDelayMs: 400, now: () => clock.t });
  m.setActive(true);
  return m;
}

const id = (m: FocusManager): string | undefined => m.focused?.id;

afterEach(() => {
  document.body.innerHTML = '';
});

// A 3 × 2 grid:  a b c
//                d e f
const GRID = `
  <button id="a" ${at(0, 0)}>A</button><button id="b" ${at(100, 0)}>B</button><button id="c" ${at(200, 0)}>C</button>
  <button id="d" ${at(0, 100)}>D</button><button id="e" class="primary" ${at(100, 100)}>E</button><button id="f" ${at(200, 100)}>F</button>`;

describe('focus manager: moving', () => {
  it('is the same class Controls has always used', () => {
    expect(FocusNav).toBe(FocusManager);
  });

  it('starts on the main control and moves spatially', () => {
    page(GRID);
    const m = manager();
    m.update();
    expect(id(m)).toBe('e'); // .primary
    m.move('up');
    expect(id(m)).toBe('b');
    m.move('right');
    expect(id(m)).toBe('c');
    m.move('right');
    expect(id(m)).toBe('c'); // nothing further: stays
    m.move('down');
    expect(id(m)).toBe('f');
    m.move('left');
    m.move('left');
    expect(id(m)).toBe('d');
    expect(document.getElementById('d')!.classList.contains('pad-focus')).toBe(true);
    expect(document.querySelectorAll('.pad-focus').length).toBe(1);
  });

  it('honours data-nav overrides, and none blocks a direction', () => {
    page(`<button id="a" ${at(0, 0)} data-nav-right="#c" data-nav-down="none" data-nav-default>A</button><button id="b" ${at(100, 0)}>B</button>
      <button id="c" ${at(0, 300)}>C</button><button id="d" ${at(0, 100)}>D</button>`);
    const m = manager();
    m.update();
    expect(id(m)).toBe('a'); // data-nav-default beats geometry
    m.move('down');
    expect(id(m)).toBe('a');
    m.move('right');
    expect(id(m)).toBe('c');
  });

  it('skips disabled, hidden and dev-panel controls; reaches inputs, textareas and selects', () => {
    page(`<button id="a" ${at(0, 0)}>A</button><button id="x" disabled ${at(100, 0)}>X</button><div hidden><button id="h" ${at(150, 0)}>H</button></div>
      <div class="dev-panel"><button id="dv" ${at(160, 0)}>D</button></div>
      <textarea id="t" ${at(200, 0)}></textarea><select id="s" ${at(300, 0)}><option>1</option></select><input id="i" type="number" ${at(400, 0)} />`);
    const m = manager();
    m.update();
    expect(id(m)).toBe('a');
    m.move('right');
    expect(id(m)).toBe('t');
    m.press();
    expect(document.activeElement?.id).toBe('t'); // a text field takes real focus to type
    m.move('right');
    expect(id(m)).toBe('s');
    m.move('right');
    expect(id(m)).toBe('i');
    expect(NAV_SELECTOR).toContain('textarea');
  });

  it('finds the same control after a re-render by its key attributes, else its text', () => {
    const root = page(`<button data-act="launch" ${at(0, 0)}>Go</button><button ${at(100, 0)}>Plain</button>`);
    const m = manager();
    m.update();
    m.move('right');
    expect(m.focused!.textContent).toBe('Plain');
    root.innerHTML = `<button data-act="launch" ${at(0, 0)}>Go</button><button ${at(100, 0)}>Plain</button>`;
    m.update();
    expect(m.focused!.textContent).toBe('Plain');
    m.move('left');
    root.innerHTML = `<button data-act="launch" ${at(0, 0)}>Launch now</button><button ${at(100, 0)}>Plain</button>`;
    m.update();
    expect(m.focused!.getAttribute('data-act')).toBe('launch');
    expect(keyOf(m.focused!)).toBe('BUTTON:launch');
  });

  it('presses with click and shows nothing while off', () => {
    page(GRID);
    const m = manager();
    let clicked = '';
    document.getElementById('root')!.addEventListener('click', (e) => (clicked = (e.target as HTMLElement).id));
    m.update();
    expect(m.press()).toBe(true);
    expect(clicked).toBe('e');
    m.setActive(false);
    expect(document.querySelectorAll('.pad-focus').length).toBe(0);
    expect(m.press()).toBe(false);
    m.setActive(true);
    m.update();
    expect(id(m)).toBe('e');
  });
});

describe('focus manager: restore and modal trapping', () => {
  it('returns from a panel to the control that opened it', () => {
    const root = page(`${GRID}<div id="panel"><button id="p1" ${at(0, 300)}>P1</button><button id="p2" class="primary" ${at(100, 300)}>P2</button></div>`);
    const m = manager();
    m.update();
    m.move('left');
    expect(id(m)).toBe('d');
    m.openPanel(root.querySelector('#panel')!);
    expect(id(m)).toBe('p2'); // the panel's .primary
    m.closePanel();
    expect(id(m)).toBe('d');
  });

  it('restores the highlight when going back to a screen on the stack', () => {
    const root = page(GRID);
    const m = manager();
    m.reset('desk');
    m.update();
    m.move('right');
    expect(id(m)).toBe('f');
    // The pause menu replaces the desk's controls.
    m.reset('pause');
    root.innerHTML = `<button id="resume" class="primary" ${at(0, 0)}>Resume</button>`;
    m.update();
    expect(id(m)).toBe('resume');
    // Back to the desk: the same control, found again after its re-render.
    m.reset('desk');
    root.innerHTML = GRID;
    m.update();
    expect(id(m)).toBe('f');
    // A new screen starts from its main control; clearHistory forgets the way back.
    m.reset('flight');
    m.clearHistory();
    m.reset('desk');
    m.update();
    expect(id(m)).toBe('e');
  });

  it('traps the highlight in a modal dialog, cancels it with back, and restores focus after', () => {
    page(GRID);
    const m = manager();
    m.update();
    m.move('right');
    expect(id(m)).toBe('f');
    const host = document.createElement('div');
    host.innerHTML = dialog({ id: 'dlg', title: 'Sure?', confirm: { label: 'Yes' }, cancel: { label: 'No' } });
    host.querySelector('[data-dialog-cancel]')!.setAttribute('data-rect', '300 300 80 30');
    host.querySelector('[data-dialog-cancel]')!.id = 'no';
    host.querySelector('[data-dialog-confirm]')!.setAttribute('data-rect', '400 300 80 30');
    host.querySelector('[data-dialog-confirm]')!.id = 'yes';
    document.body.appendChild(host);
    m.update();
    expect(m.modalScope?.id).toBe('dlg');
    expect(id(m)).toBe('yes'); // the confirm is .primary
    m.move('left');
    expect(id(m)).toBe('no');
    m.move('up');
    m.move('left');
    expect(id(m)).toBe('no'); // nothing outside the dialog is reachable
    let cancelled = false;
    host.querySelector('[data-dialog-cancel]')!.addEventListener('click', () => {
      cancelled = true;
      host.remove();
    });
    expect(m.back()).toBe(true);
    expect(cancelled).toBe(true);
    m.update();
    expect(m.modalScope).toBeNull();
    expect(id(m)).toBe('f');
    expect(m.back()).toBe(false); // no dialog: the game's back happens
  });
});

describe('focus manager: tabs, pages and tooltips', () => {
  it('switches tabs with switchTab, wrapping, skipping disabled tabs', () => {
    const root = page(tabs({ id: 'lb', label: 'Logbook', tabs: [{ id: 'a', label: 'A', selected: true }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C' }] }));
    root.querySelectorAll('[role="tab"]').forEach((t, i) => t.setAttribute('data-rect', `${i * 100} 0 80 30`));
    bindTabs(root);
    const m = manager();
    m.update();
    const selected = (): string | null => root.querySelector('[aria-selected="true"]')!.getAttribute('data-tab');
    expect(m.switchTab(1)).toBe(true);
    expect(selected()).toBe('c');
    expect(m.switchTab(1)).toBe(true);
    expect(selected()).toBe('a');
    expect(m.switchTab(-1)).toBe(true);
    expect(selected()).toBe('c');
    expect(id(m)).toBe('lb-tab-c'); // the highlight follows when it was on the tabs
  });

  it('has no tab switching where there are no tabs (Q / E keep their meaning)', () => {
    page(GRID);
    expect(manager().switchTab(1)).toBe(false);
  });

  it('pages a long list and moves the highlight into view', () => {
    const items = Array.from({ length: 10 }, (_, i) => `<button id="r${i}" ${at(0, i * 40 - 0, 80, 30)}>R${i}</button>`).join('');
    const root = page(`<div id="list" data-nav-scroll data-rect="0 0 100 120">${items}</div>`);
    const list = root.querySelector<HTMLElement>('#list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 400 });
    Object.defineProperty(list, 'clientHeight', { value: 120 });
    const m = manager();
    m.update();
    expect(id(m)).toBe('r0');
    expect(m.page(1, false)).toBe(true);
    expect(list.scrollTop).toBeGreaterThan(0);
    expect(m.focused).not.toBeNull();
    page(GRID);
    expect(manager().page(1, false)).toBe(false); // nothing to scroll
  });

  it('shows the tooltip after a delay, closes it on move, and the info button shows it at once', () => {
    page(`<button id="a" data-tip="About A" ${at(0, 0)}>A</button><button id="b" title="About B" ${at(100, 0)}>B</button><button id="c" ${at(200, 0)}>C</button>`);
    const clock = { t: 0 };
    const m = manager(clock);
    m.update();
    expect(m.tipElement).toBeNull();
    clock.t = 500;
    m.update();
    expect(m.tipElement?.textContent).toBe('About A');
    m.move('right');
    expect(m.tipElement).toBeNull(); // closes on move
    expect(m.info()).toBe(true);
    expect(m.tipElement?.textContent).toBe('About B');
    m.move('right');
    expect(m.info()).toBe(false); // no tooltip on C
  });
});

// ---- Controls: keyboard arrows and contexts --------------------------------------------------------

class FakeInput {
  held = new Set<string>();
  private keys: Array<(code: string) => void> = [];
  private moves: Array<() => void> = [];
  onKeyDown(h: (code: string) => void): void { this.keys.push(h); }
  onCanvasClick(): void {}
  onMouseMove(h: () => void): void { this.moves.push(h); }
  isHeld(code: string): boolean { return this.held.has(code); }
  isButtonHeld(): boolean { return false; }
  consumeMouse(): { dx: number; dy: number } { return { dx: 0, dy: 0 }; }
  press(code: string): void { for (const k of this.keys) k(code); }
  mouse(): void { for (const m of this.moves) m(); }
}

function rig(): { controls: Controls; input: FakeInput; actions: Action[]; pads: Array<RawPad | null> } {
  const input = new FakeInput();
  const pads: Array<RawPad | null> = [];
  const controls = new Controls(input as unknown as Input, document, new GamepadSource(() => pads));
  const actions: Action[] = [];
  controls.onAction((a) => actions.push(a));
  return { controls, input, actions, pads };
}

describe('Controls and the focus manager', () => {
  it('uses keys no game action has', () => {
    for (const code of Object.keys(NAV_KEYS)) expect(KEYMAP[code], code).toBeUndefined();
  });

  it('turns the highlight on with the arrows outside flight, never in flight; the mouse turns it off', () => {
    const { controls, input, actions } = rig();
    controls.context = 'home';
    expect(controls.navOn).toBe(false);
    input.press('ArrowDown');
    expect(controls.navOn).toBe(true);
    controls.update(0.016);
    expect(controls.nav.active).toBe(true);
    input.mouse();
    controls.update(0.016);
    expect(controls.nav.active).toBe(false);
    controls.context = 'flight';
    input.press('ArrowDown');
    controls.update(0.016);
    expect(controls.navOn).toBe(false);
    expect(controls.nav.active).toBe(false);
    expect(actions).toEqual([]);
  });

  it('keeps Enter, Q and E as game keys until the arrows are used', () => {
    const { controls, input, actions } = rig();
    controls.context = 'home';
    input.press('Enter');
    input.press('KeyQ');
    input.press('KeyE');
    expect(actions).toEqual(['confirm', 'prevAircraft', 'nextAircraft']);
  });

  it('cancels an open dialog with the pad B before the game sees back', () => {
    const { controls, pads, actions } = rig();
    document.body.innerHTML = dialog({ id: 'd', title: 'T', confirm: { label: 'Y' }, cancel: { label: 'N' } });
    let cancelled = 0;
    document.querySelector('[data-dialog-cancel]')!.addEventListener('click', () => cancelled++);
    controls.context = 'menu';
    const pad = (pressed: number[]): RawPad => ({
      index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
    });
    pads[0] = pad([]);
    controls.update(0.016);
    pads[0] = pad([1]); // B
    controls.update(0.016);
    expect(cancelled).toBe(1);
    expect(actions).not.toContain('back');
  });

  it('renders buttons the focus manager can reach', () => {
    document.body.innerHTML = button({ label: 'x' });
    expect(document.querySelector(NAV_SELECTOR)).not.toBeNull();
  });
});

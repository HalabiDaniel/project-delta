/**
 * The focus manager: one focus model for the whole UI (plan v0.0.15 §2, docs/DESIGN_SYSTEM.md).
 *
 * A visible highlight (the focus ring, class `pad-focus`) that the D-pad, the left stick or the
 * arrow keys move to the nearest control in that direction, and A / Enter presses. It works on
 * whatever is on screen without each screen knowing about it: a control is reachable when it is
 * visible, enabled and not covered by something on top of it.
 *
 * - The highlight is a class, not browser focus, so Enter and Space keep their game meanings
 *   outside menus; Controls only lets Enter press the highlight once the arrows have been used.
 * - Overrides: `data-nav-up|down|left|right="<selector>"` on a control names its neighbour where
 *   geometry misleads (`none` blocks that direction).
 * - Modal trapping: while a `[aria-modal="true"]` element is open, only its controls are
 *   reachable; when it closes the highlight returns to the control that had it before.
 * - Focus restore: `openPanel(panel)` remembers the highlighted control and moves into the panel
 *   (its `[data-nav-default]`, `.primary` or first control); `closePanel()` returns. Screens that
 *   open by re-rendering get the same through `reset(screen)`: going back to a screen on the stack
 *   restores the control that had the highlight there.
 * - Tabs: `switchTab(±1)` clicks the next tab of the visible `[role="tablist"]` (Q / E, LB / RB).
 * - Pages: `page(±1)` scrolls the scrolling list the highlight is in (triggers, PageUp / PageDown).
 * - Tooltips: a control's `data-tip` (else `title`) shows near it after a short delay, closes on
 *   move; `info()` shows it at once (Y / Triangle). `bindHoverTips()` gives mouse hover the same.
 * - After a re-render the same control is found again by its KEY_ATTRS, else (last resort) by its
 *   text.
 */

import type { NavDirection } from './analog';

/** What can take the highlight. */
export const NAV_SELECTOR = [
  'button', 'a[href]', '[data-nav]', '[role="tab"]',
  'input:not([type="hidden"])', 'textarea', 'select',
].join(', ');
const FOCUS_CLASS = 'pad-focus';
/** Attributes that identify the same control after the HUD rebuilds it. */
export const KEY_ATTRS = ['data-u', 'data-p', 'data-b', 'data-m', 'data-r', 'data-act', 'data-tab', 'data-v', 'data-room', 'data-t', 'data-id', 'data-slot', 'data-kind', 'data-nav', 'id'];
const MODAL_SELECTOR = '[aria-modal="true"]';
const EXCLUDED = '[hidden], .dev-panel, .pad-skip, [inert]';
const MAX_STACK = 12;
const RESTORE_FRAMES = 3;
export const DEFAULT_TIP_DELAY_MS = 450;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The best candidate in a direction from `from`: in that half-plane, nearest by distance along
 * the direction plus twice the sideways offset (so a button straight ahead beats a closer one
 * off to the side). Returns the index, or -1.
 */
export function pickInDirection(from: Rect, candidates: readonly Rect[], dir: NavDirection): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    const x = (r.left + r.right) / 2;
    const y = (r.top + r.bottom) / 2;
    let along: number;
    let side: number;
    switch (dir) {
      case 'right': along = r.left - from.right; side = Math.abs(y - cy); if (x <= cx + 1) return; break;
      case 'left': along = from.left - r.right; side = Math.abs(y - cy); if (x >= cx - 1) return; break;
      case 'down': along = r.top - from.bottom; side = Math.abs(x - cx); if (y <= cy + 1) return; break;
      case 'up': along = from.top - r.bottom; side = Math.abs(x - cx); if (y >= cy - 1) return; break;
    }
    const score = Math.max(0, along) + side * 2 + (along < 0 ? 40 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export interface FocusOptions {
  /** Where an element is (tests give fixed rectangles; default getBoundingClientRect). */
  rectOf?: (el: HTMLElement) => Rect;
  /**
   * Check that a control is the topmost thing at its centre (elementFromPoint). Default on in a
   * browser; tests without layout turn it off.
   */
  hitTest?: boolean;
  /** Delay before a focused control's tooltip shows. */
  tipDelayMs?: number;
  /** Clock in ms (tests). */
  now?: () => number;
}

interface Remembered {
  el: HTMLElement | null;
  key: string;
}

export class FocusManager {
  private current: HTMLElement | null = null;
  private currentKey = '';
  private tip: HTMLElement | null = null;
  private tipFor: HTMLElement | null = null;
  private tipPinned = false;
  private focusedAt = 0;
  private hoverEl: HTMLElement | null = null;
  private hoverAt = 0;
  private modal: HTMLElement | null = null;
  private readonly modalStack: Remembered[] = [];
  private readonly panelStack: Array<Remembered & { panel: HTMLElement }> = [];
  private readonly screenStack: Array<Remembered & { screen: string }> = [];
  private screen = '';
  /**
   * A panel opened (or closed) by code since the last screen change: the screen stack and the
   * panel stack then agree on where the highlight goes (see reset).
   */
  private openedSinceReset: Remembered | null = null;
  private closedSinceReset = false;
  /**
   * Frames to wait for a control being restored to show again (a screen re-renders after the
   * screen change that restores it), before falling back to the screen's main control.
   */
  private restoreFrames = 0;
  /** The highlight was put on the screen's main control by update(), not by the player. */
  private autoPlaced = false;
  private readonly rectOf: (el: HTMLElement) => Rect;
  private readonly hitTest: boolean;
  private readonly tipDelay: number;
  private readonly now: () => number;
  active = false;

  constructor(private readonly root: ParentNode | null = typeof document !== 'undefined' ? document : null, options: FocusOptions = {}) {
    this.rectOf = options.rectOf ?? ((el) => el.getBoundingClientRect());
    this.hitTest = options.hitTest ?? (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' && !options.rectOf);
    this.tipDelay = options.tipDelayMs ?? DEFAULT_TIP_DELAY_MS;
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Turns the highlight on (controller or arrow keys in use at a screen with controls) or off. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) this.mark(null);
    this.placeTip();
  }

  /** Keeps the highlight on something reachable; called every frame while active. */
  update(): void {
    this.trackModal();
    this.openedSinceReset = null;
    this.closedSinceReset = false;
    // In a dialog the keyboard moves real focus (Tab, arrows): the highlight follows it.
    const real = typeof document !== 'undefined' ? document.activeElement : null;
    if (this.active && this.modal && real instanceof HTMLElement && real !== this.current && this.modal.contains(real) && real.matches(NAV_SELECTOR)) this.mark(real);
    if (!this.active) {
      this.placeTip();
      return;
    }
    if (this.current && this.reachable(this.current)) {
      this.placeTip();
      return;
    }
    const list = this.candidates();
    const again = this.currentKey ? list.find((el) => keyOf(el) === this.currentKey) : undefined;
    if (!again && this.restoreFrames > 0) {
      this.restoreFrames--;
      if (this.current) this.mark(null);
      return;
    }
    this.restoreFrames = 0;
    this.mark(again ?? defaultOf(list, this.rectOf));
    this.autoPlaced = !again;
  }

  move(dir: NavDirection): void {
    if (!this.active) return;
    this.autoPlaced = false;
    this.trackModal();
    const list = this.candidates();
    if (!this.current || !list.includes(this.current)) {
      this.mark(defaultOf(list, this.rectOf));
      return;
    }
    // An explicit neighbour wins over geometry.
    const override = this.current.getAttribute(`data-nav-${dir}`);
    if (override !== null) {
      if (override === 'none') return;
      const target = this.queryScope(override).find((el) => list.includes(el)) ?? null;
      if (target) {
        this.mark(target);
        return;
      }
    }
    const others = list.filter((el) => el !== this.current);
    const i = pickInDirection(this.rectOf(this.current), others.map((el) => this.rectOf(el)), dir);
    if (i >= 0) this.mark(others[i]);
  }

  /**
   * The screen changed (a phase, a menu). With a name: going back to a screen on the stack
   * restores the control that had the highlight there; a new screen starts from its main control.
   * Without one: start again from the main control.
   */
  reset(screen?: string): void {
    if (screen === undefined) {
      this.mark(null);
      this.currentKey = '';
      return;
    }
    const back = this.screenStack.findIndex((s) => s.screen === screen);
    if (back >= 0) {
      const saved = this.screenStack[back];
      this.screenStack.length = back;
      this.screen = screen;
      // A panel closed by code already put the highlight back on its opener.
      if (this.closedSinceReset) {
        this.closedSinceReset = false;
        return;
      }
      this.mark(null);
      this.currentKey = saved.key;
      if (saved.el && saved.el.isConnected) this.currentKey = keyOf(saved.el);
      if (this.currentKey) this.restoreFrames = RESTORE_FRAMES;
      return;
    }
    // A panel opened by code just now: its opener is what this screen returns to, and the
    // highlight stays where openPanel put it.
    const opened = this.openedSinceReset;
    this.openedSinceReset = null;
    if (this.screen) {
      this.screenStack.push({ screen: this.screen, el: opened ? opened.el : this.current, key: opened ? opened.key : this.currentKey });
      if (this.screenStack.length > MAX_STACK) this.screenStack.shift();
    }
    this.screen = screen;
    if (opened) return;
    this.mark(null);
    this.currentKey = '';
  }

  /** Forget the screens behind this one (flight starts clean: no restore across a sortie). */
  clearHistory(): void {
    this.screenStack.length = 0;
    this.panelStack.length = 0;
  }

  /** A panel opened by code: remember where the highlight was and move into the panel. */
  openPanel(panel: HTMLElement): void {
    // A highlight the screen change just placed by default is not an opener: the screen stack
    // already remembers the real one.
    const opener: Remembered = this.autoPlaced ? { el: null, key: '' } : { el: this.current, key: this.currentKey };
    this.autoPlaced = false;
    this.panelStack.push({ panel, ...opener });
    this.openedSinceReset = opener;
    this.closedSinceReset = false;
    if (this.panelStack.length > MAX_STACK) this.panelStack.shift();
    const inside = this.candidates().filter((el) => panel.contains(el));
    const first = inside.find((el) => el.hasAttribute('data-nav-default')) ?? defaultOf(inside, this.rectOf);
    if (first) this.mark(first);
    else {
      this.mark(null);
      this.currentKey = '';
    }
  }

  /** The panel closed: the highlight returns to the control that opened it. */
  closePanel(panel?: HTMLElement): void {
    let i = this.panelStack.length - 1;
    if (panel) i = this.panelStack.map((p) => p.panel).lastIndexOf(panel);
    if (i < 0) return;
    const saved = this.panelStack[i];
    this.panelStack.length = i;
    this.openedSinceReset = null;
    // Nothing had the highlight when it opened (a screen change had just cleared it): the screen
    // stack restores instead.
    if (!saved.el && !saved.key) return;
    this.closedSinceReset = true;
    this.restore(saved);
  }

  /** A / Enter: presses the highlighted control. False when nothing is highlighted. */
  press(): boolean {
    if (!this.active || !this.current || !this.reachable(this.current)) return false;
    const el = this.current;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(el.type))) el.focus();
    else el.click();
    return true;
  }

  /**
   * B / Esc inside a modal dialog: presses its cancel control (`[data-dialog-cancel]`). False when
   * no dialog is open, so the game's own back still happens.
   */
  back(): boolean {
    this.trackModal();
    const cancel = this.modal?.querySelector<HTMLElement>('[data-dialog-cancel]');
    if (!cancel) return false;
    cancel.click();
    return true;
  }

  /**
   * Q / E, LB / RB: the next or previous tab of the tab list the highlight is in (else the first
   * visible one). False when the screen has no tabs, so the keys keep their other meaning.
   */
  switchTab(delta: 1 | -1): boolean {
    this.trackModal();
    const lists = this.queryScope('[role="tablist"]').filter((l) => this.visible(l));
    const listEl = (this.current && lists.find((l) => l.contains(this.current))) || lists[0];
    if (!listEl) return false;
    const tabs = [...listEl.querySelectorAll<HTMLElement>('[role="tab"]')].filter((t) => !(t as HTMLButtonElement).disabled && t.getAttribute('aria-disabled') !== 'true');
    if (tabs.length < 2) return false;
    const at = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    const next = tabs[(at + delta + tabs.length) % tabs.length];
    next.click();
    if (this.active && this.current && listEl.contains(this.current)) this.mark(next);
    return true;
  }

  /**
   * Triggers, PageUp / PageDown: scroll the list the highlight is in by a page and move the
   * highlight onto what came into view. `anyScroller` false (at the desk) only scrolls lists that
   * asked for it (`data-nav-scroll`). False when there is nothing to scroll.
   */
  page(delta: 1 | -1, anyScroller = true): boolean {
    this.trackModal();
    const scroller = (this.current && scrollerOf(this.current, anyScroller)) || this.queryScope('[data-nav-scroll]').find((s) => this.visible(s) && canScroll(s));
    if (!scroller) return false;
    const step = Math.max(40, scroller.clientHeight * 0.85);
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + delta * step));
    if (this.active) {
      const box = this.rectOf(scroller);
      const inside = this.candidates().filter((el) => scroller.contains(el) && el !== scroller);
      const visible = inside.filter((el) => {
        const r = this.rectOf(el);
        return r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
      });
      const pick = delta > 0 ? visible[visible.length - 1] : visible[0];
      if (pick) this.mark(pick);
    }
    return true;
  }

  /** Y / Triangle: show the highlighted control's tooltip now (again to hide it). */
  info(): boolean {
    if (!this.current || !tipText(this.current)) return false;
    this.tipPinned = !this.tipPinned;
    this.placeTip();
    return true;
  }

  get focused(): HTMLElement | null {
    return this.current;
  }

  /** The open modal dialog the highlight is confined to, if any. */
  get modalScope(): HTMLElement | null {
    return this.modal;
  }

  /** Puts the highlight on a control (a click, a screen that knows best). */
  focus(el: HTMLElement | null): void {
    this.autoPlaced = false;
    this.mark(el);
  }

  /**
   * Mouse hover over `[data-tip]` shows the same tooltip after the same delay (no hover-only
   * information: focus and the info button show it too). Returns an unbind.
   */
  bindHoverTips(target: HTMLElement | Document | null = typeof document !== 'undefined' ? document : null): () => void {
    if (!target) return () => {};
    const over = (e: Event): void => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === this.hoverEl) return;
      this.hoverEl = el;
      this.hoverAt = this.now();
      this.placeTip();
      if (el) setTimeout(() => this.placeTip(), this.tipDelay + 10);
    };
    const out = (e: Event): void => {
      const to = (e as MouseEvent).relatedTarget as Element | null;
      if (this.hoverEl && to && this.hoverEl.contains(to)) return;
      this.hoverEl = null;
      this.placeTip();
    };
    target.addEventListener('mouseover', over);
    target.addEventListener('mouseout', out);
    return () => {
      target.removeEventListener('mouseover', over);
      target.removeEventListener('mouseout', out);
    };
  }

  // ---- Internals -----------------------------------------------------------------------------------

  private restore(saved: Remembered): void {
    const list = this.candidates();
    const el = saved.el && list.includes(saved.el) ? saved.el : list.find((c) => keyOf(c) === saved.key);
    if (el) this.mark(el);
    else {
      this.mark(null);
      this.currentKey = saved.key;
      if (saved.key) this.restoreFrames = RESTORE_FRAMES;
    }
  }

  /** Follows modal dialogs opening and closing: remember on open, restore on close. */
  private trackModal(): void {
    const modal = this.topModal();
    if (modal === this.modal) return;
    if (modal && (!this.modal || !modal.contains(this.modal))) {
      this.modalStack.push({ el: this.current, key: this.currentKey });
      this.modal = modal;
      this.mark(null);
      this.currentKey = '';
      if (this.active) this.mark(defaultOf(this.candidates(), this.rectOf));
      return;
    }
    this.modal = modal;
    const saved = this.modalStack.pop();
    if (saved) this.restore(saved);
  }

  private topModal(): HTMLElement | null {
    if (!this.root) return null;
    const open = [...this.root.querySelectorAll<HTMLElement>(MODAL_SELECTOR)].filter((m) => m.isConnected && !m.closest(EXCLUDED));
    return open.length ? open[open.length - 1] : null;
  }

  private queryScope(selector: string): HTMLElement[] {
    const scope: ParentNode | null = this.modal ?? this.root;
    if (!scope) return [];
    try {
      return [...scope.querySelectorAll<HTMLElement>(selector)];
    } catch {
      return [];
    }
  }

  private mark(el: HTMLElement | null): void {
    if (this.current === el) return;
    this.current?.classList.remove(FOCUS_CLASS);
    if (el && !this.active) {
      // Not showing: remember it, and find it again when the highlight comes on.
      this.current = null;
      this.currentKey = keyOf(el);
      this.placeTip();
      return;
    }
    this.current = el;
    this.tipPinned = false;
    this.focusedAt = this.now();
    if (el) {
      el.classList.add(FOCUS_CLASS);
      this.currentKey = keyOf(el);
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    this.placeTip();
  }

  /**
   * What a mouse player reads by hovering (a control's tip or title) shows near the highlight
   * after a short delay, so no information is hover-only.
   */
  private placeTip(): void {
    if (typeof document === 'undefined') return;
    const now = this.now();
    let el: HTMLElement | null = null;
    if (this.active && this.current && (this.tipPinned || now - this.focusedAt >= this.tipDelay)) el = this.current;
    else if (this.hoverEl && this.hoverEl.isConnected && now - this.hoverAt >= this.tipDelay) el = this.hoverEl;
    const title = el ? tipText(el) : '';
    if (!el || !title) {
      if (this.tip) this.tip.hidden = true;
      this.tipFor = null;
      return;
    }
    if (!this.tip) {
      this.tip = document.createElement('div');
      this.tip.className = 'pad-tip';
      this.tip.setAttribute('role', 'tooltip');
      document.body.appendChild(this.tip);
    }
    const r = this.rectOf(el);
    if (this.tip.textContent !== title) this.tip.textContent = title;
    this.tip.hidden = false;
    this.tipFor = el;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const below = r.bottom + 34 < h;
    this.tip.style.left = `${Math.max(4, Math.min(w - 264, r.left))}px`;
    this.tip.style.top = below ? `${r.bottom + 6}px` : `${Math.max(4, r.top - 30)}px`;
  }

  /** The tooltip element (tests). */
  get tipElement(): HTMLElement | null {
    return this.tip && !this.tip.hidden && this.tipFor ? this.tip : null;
  }

  private candidates(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const el of this.queryScope(NAV_SELECTOR)) if (this.reachable(el)) out.push(el);
    return out;
  }

  private visible(el: HTMLElement): boolean {
    if (!el.isConnected || el.closest(EXCLUDED)) return false;
    const r = this.rectOf(el);
    return r.right - r.left >= 2 && r.bottom - r.top >= 2;
  }

  /** Visible, enabled, inside the modal (if one is open) and the topmost thing at its centre. */
  private reachable(el: HTMLElement): boolean {
    if (!el.isConnected || (el as HTMLButtonElement).disabled || el.closest(EXCLUDED)) return false;
    if (el.getAttribute('tabindex') === '-1' && el.getAttribute('role') !== 'tab') return false;
    if (this.modal && !this.modal.contains(el)) return false;
    const r = this.rectOf(el);
    if (r.right - r.left < 2 || r.bottom - r.top < 2) return false;
    if (!this.hitTest) return true;
    const x = Math.min(window.innerWidth - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, (r.top + r.bottom) / 2));
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) {
      // Off screen inside a scrolling list: reachable if its scroller is.
      return getComputedStyle(el).visibility !== 'hidden';
    }
    // Topmost at its centre or at one of four points around it (a toast over part of it is fine).
    const dx = (r.right - r.left) * 0.3;
    const dy = (r.bottom - r.top) * 0.3;
    for (const [px, py] of [[x, y], [x - dx, y], [x + dx, y], [x, y - dy], [x, y + dy]]) {
      const top = document.elementFromPoint(px, py);
      if (top && (top === el || el.contains(top) || top.contains(el))) return true;
    }
    return false;
  }
}

let shared: FocusManager | null = null;

/** The page's focus manager (Controls registers its own), for screens that open panels by code. */
export function focusManager(): FocusManager | null {
  return shared;
}

export function setFocusManager(m: FocusManager | null): void {
  shared = m;
}

/** The v0.0.11 name, kept for Controls and tests. */
export { FocusManager as FocusNav };

/** A control's tooltip text: `data-tip`, else its own or nearest `title`. */
export function tipText(el: HTMLElement): string {
  return el.getAttribute('data-tip') || el.getAttribute('title') || el.closest('[data-tip]')?.getAttribute('data-tip') || el.closest('[title]')?.getAttribute('title') || '';
}

/**
 * How the same control is found after a re-render: its identifying attributes, else (last resort,
 * English-coupled) its first 40 characters of text.
 */
export function keyOf(el: HTMLElement): string {
  const parts = KEY_ATTRS.map((a) => el.getAttribute(a)).filter((v) => v !== null);
  return parts.length ? `${el.tagName}:${parts.join('|')}` : `${el.tagName}:${(el.textContent ?? '').trim().slice(0, 40)}`;
}

/** Where the highlight starts: `[data-nav-default]`, else the largest `.primary`, else the top-left control. */
export function defaultOf(list: HTMLElement[], rectOf: (el: HTMLElement) => Rect = (el) => el.getBoundingClientRect()): HTMLElement | null {
  if (list.length === 0) return null;
  const preset = list.find((el) => el.hasAttribute('data-nav-default'));
  if (preset) return preset;
  const area = (el: HTMLElement): number => {
    const r = rectOf(el);
    return (r.right - r.left) * (r.bottom - r.top);
  };
  const primary = list.filter((el) => el.classList.contains('primary'));
  if (primary.length) return primary.sort((a, b) => area(b) - area(a))[0];
  return [...list].sort((a, b) => {
    const ra = rectOf(a);
    const rb = rectOf(b);
    return ra.top - rb.top || ra.left - rb.left;
  })[0];
}

function canScroll(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

/** The nearest ancestor that scrolls vertically (only `[data-nav-scroll]` ones unless `any`). */
function scrollerOf(el: HTMLElement, any: boolean): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.hasAttribute('data-nav-scroll') && canScroll(p)) return p;
    if (any && canScroll(p) && typeof getComputedStyle === 'function') {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') return p;
    }
  }
  return null;
}

/**
 * Controller navigation of the page's buttons: a visible highlight that the D-pad or left stick
 * moves to the nearest button in that direction, and A presses. It works on whatever is on screen
 * (the desk HUD, base management, the pause menu, the logbook, the report, the lobby) without each
 * screen knowing about it: a button is reachable when it is visible, enabled and not covered by
 * something on top of it (so an open menu automatically confines the highlight to itself).
 *
 * The highlight is a class, not browser focus, so Enter and Space keep their game meanings.
 */

import type { NavDirection } from './analog';

const SELECTOR = 'button, a[href], [data-nav], input[type="text"], input:not([type])';
const FOCUS_CLASS = 'pad-focus';
/** Attributes that identify the same control after the HUD rebuilds it. */
const KEY_ATTRS = ['data-u', 'data-p', 'data-b', 'data-m', 'data-r', 'data-act', 'data-tab', 'data-v', 'data-room', 'data-t', 'data-id', 'data-slot', 'data-kind', 'data-nav'];

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

export class FocusNav {
  private current: HTMLElement | null = null;
  private currentKey = '';
  private tip: HTMLElement | null = null;
  active = false;

  constructor(private readonly root: ParentNode | null = typeof document !== 'undefined' ? document : null) {}

  /** Turns the highlight on (controller in use at a screen with buttons) or off. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) this.mark(null);
    this.placeTip();
  }

  /** Keeps the highlight on something reachable; called every frame while active. */
  update(): void {
    if (!this.active) return;
    if (this.current && this.reachable(this.current)) {
      this.placeTip();
      return;
    }
    const list = this.candidates();
    const again = this.currentKey ? list.find((el) => keyOf(el) === this.currentKey) : undefined;
    this.mark(again ?? defaultOf(list));
  }

  move(dir: NavDirection): void {
    if (!this.active) return;
    const list = this.candidates();
    if (!this.current || !list.includes(this.current)) {
      this.mark(defaultOf(list));
      return;
    }
    const others = list.filter((el) => el !== this.current);
    const i = pickInDirection(this.current.getBoundingClientRect(), others.map((el) => el.getBoundingClientRect()), dir);
    if (i >= 0) this.mark(others[i]);
  }

  /** The screen changed (a phase, a menu): start again from its main button. */
  reset(): void {
    this.mark(null);
    this.currentKey = '';
  }

  /** A pressed: presses the highlighted control. False when nothing is highlighted. */
  press(): boolean {
    if (!this.active || !this.current || !this.reachable(this.current)) return false;
    const el = this.current;
    if (el instanceof HTMLInputElement) el.focus();
    else el.click();
    return true;
  }

  get focused(): HTMLElement | null {
    return this.current;
  }

  private mark(el: HTMLElement | null): void {
    if (this.current === el) return;
    this.current?.classList.remove(FOCUS_CLASS);
    this.current = el;
    if (el) {
      el.classList.add(FOCUS_CLASS);
      this.currentKey = keyOf(el);
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    this.placeTip();
  }

  /**
   * What a mouse player reads by hovering (a control's title) shows under the highlight, so no
   * information is hover-only.
   */
  private placeTip(): void {
    if (typeof document === 'undefined') return;
    const el = this.current;
    const title = el ? (el.getAttribute('title') || el.closest('[title]')?.getAttribute('title') || '') : '';
    if (!title) {
      if (this.tip) this.tip.hidden = true;
      return;
    }
    if (!this.tip) {
      this.tip = document.createElement('div');
      this.tip.className = 'pad-tip';
      document.body.appendChild(this.tip);
    }
    const r = el!.getBoundingClientRect();
    if (this.tip.textContent !== title) this.tip.textContent = title;
    this.tip.hidden = false;
    const below = r.bottom + 34 < window.innerHeight;
    this.tip.style.left = `${Math.max(4, Math.min(window.innerWidth - 264, r.left))}px`;
    this.tip.style.top = below ? `${r.bottom + 6}px` : `${Math.max(4, r.top - 30)}px`;
  }

  private candidates(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (!this.root) return out;
    for (const el of this.root.querySelectorAll<HTMLElement>(SELECTOR)) if (this.reachable(el)) out.push(el);
    return out;
  }

  /** Visible, enabled and the topmost thing at its centre. */
  private reachable(el: HTMLElement): boolean {
    if (!el.isConnected || (el as HTMLButtonElement).disabled || el.closest('[hidden], .dev-panel, .pad-skip')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const x = Math.min(window.innerWidth - 1, Math.max(0, (r.left + r.right) / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, (r.top + r.bottom) / 2));
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) {
      // Off screen inside a scrolling list: reachable if its scroller is.
      return getComputedStyle(el).visibility !== 'hidden';
    }
    // Topmost at its centre or at one of four points around it (a toast over part of it is fine).
    const dx = r.width * 0.3;
    const dy = r.height * 0.3;
    for (const [px, py] of [[x, y], [x - dx, y], [x + dx, y], [x, y - dy], [x, y + dy]]) {
      const top = document.elementFromPoint(px, py);
      if (top && (top === el || el.contains(top) || top.contains(el))) return true;
    }
    return false;
  }
}

function keyOf(el: HTMLElement): string {
  const parts = KEY_ATTRS.map((a) => el.getAttribute(a)).filter((v) => v !== null);
  return parts.length ? `${el.tagName}:${parts.join('|')}` : `${el.tagName}:${(el.textContent ?? '').trim().slice(0, 40)}`;
}

/** Where the highlight starts: the screen's main button, else the top-left control. */
function defaultOf(list: HTMLElement[]): HTMLElement | null {
  if (list.length === 0) return null;
  const primary = list.filter((el) => el.classList.contains('primary'));
  if (primary.length) return primary.sort((a, b) => area(b) - area(a))[0];
  return [...list].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  })[0];
}

function area(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

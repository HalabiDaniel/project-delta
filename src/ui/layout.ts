/**
 * Resolution scaling and the ultrawide safe area (plan v0.0.15 §7).
 *
 * Everything is measured in CSS pixels (`innerWidth` / `innerHeight`), so the device pixel ratio
 * never enters: a 4K screen at 200% system scaling lays out like 1080p and is drawn sharp (the
 * icons are vectors), and browser zoom gives the bigger interface the player asked for, never a
 * smaller one than the 720p layout.
 *
 * - `fit`: the zones' scale (multiplied by the HUD size S / M / L). 1.4 at the 1920 x 1080
 *   reference, as before, and in proportion beyond it (2.8 at 4K, so text is never tiny), down to
 *   0.9 on small windows. It follows the shorter of the height and the safe width, so 16:10
 *   and narrow windows don't clip.
 * - `overlay`: the scale of the overlays outside the zones (pause, welcome, logbook, dialogs,
 *   lobby, feedback, the focus tooltip): 1 up to 1080p, then in proportion.
 * - `safeX`, `safeWidth`: with "Keep the HUD in 16:9" on a screen wider than 16:9, the zones sit
 *   in a centred 16:9 area (a comfortable reading area on 21:9); otherwise the whole window.
 */

export const REFERENCE = { width: 1920, height: 1080, fit: 1.4 } as const;
/** The smallest zone scale (small windows). */
export const MIN_FIT = 0.9;
const WIDE = 16 / 9;

export interface LayoutOptions {
  /** Keep the HUD inside a centred 16:9 area on wider screens. */
  safeArea?: boolean;
}

export interface Layout {
  fit: number;
  overlay: number;
  /** Space left and right of the safe area, in CSS px (0 without one). */
  safeX: number;
  safeWidth: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function layoutFor(width: number, height: number, opts: LayoutOptions = {}): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const safeWidth = opts.safeArea && w / h > WIDE + 0.01 ? Math.round(h * WIDE) : w;
  const base = Math.min(h / REFERENCE.height, safeWidth / REFERENCE.width);
  return {
    fit: round(Math.max(MIN_FIT, REFERENCE.fit * base)),
    overlay: round(Math.max(1, base)),
    safeX: Math.round((w - safeWidth) / 2),
    safeWidth,
  };
}

/** Writes the layout as custom properties (--fit-scale, --overlay-scale, --safe-x, --safe-w). */
export function applyLayout(root: HTMLElement, layout: Layout): void {
  root.style.setProperty('--fit-scale', String(layout.fit));
  root.style.setProperty('--overlay-scale', String(layout.overlay));
  root.style.setProperty('--safe-x', `${layout.safeX}px`);
  root.style.setProperty('--safe-w', `${layout.safeWidth}px`);
  root.dataset.safeArea = layout.safeX > 0 ? 'on' : 'off';
}

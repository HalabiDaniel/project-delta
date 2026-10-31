/** Number formatting for the HUD: short, tabular, with units only where they aren't obvious. */

/** 1234 → "1.2k", 950 → "950". */
export function fmt(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) < 1000) return String(v);
  const k = v / 1000;
  return `${k.toFixed(Math.abs(k) < 10 ? 1 : 0).replace(/\.0$/, '')}k`;
}

/** A change: "+12", "−8", "0". */
export function signed(n: number): string {
  const v = Math.round(n);
  return v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0';
}

/** Seconds as "1:05" (or "45s" under a minute when `short`). */
export function clock(seconds: number, short = false): string {
  const s = Math.max(0, Math.round(seconds));
  if (short && s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function pct(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function metres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Pips for small counts: "●●○". */
export function pips(filled: number, total: number): string {
  return '●'.repeat(Math.max(0, Math.min(total, filled))) + '○'.repeat(Math.max(0, total - Math.max(0, filled)));
}

/** Eight-point compass direction of (dx, dz) as the mini-map draws it (up is +x, right is +z). */
export function compass(dx: number, dz: number): string {
  const angle = Math.atan2(dz, dx); // 0 = up the map
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

/** A health share as a level for colouring bars. */
export function level(fraction: number): 'ok' | 'worn' | 'critical' {
  return fraction > 0.6 ? 'ok' : fraction > 0.3 ? 'worn' : 'critical';
}

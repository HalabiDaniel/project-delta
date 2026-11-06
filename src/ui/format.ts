/**
 * Number formatting for the HUD: short, tabular, with units only where they aren't obvious.
 *
 * Every number the interface shows goes through here (docs/DESIGN_SYSTEM.md §11): counts, paper,
 * times, distances, percentages and ratios. Digits, decimal marks and grouping come from `Intl`
 * for the locale in use (`LOCALE`, src/ui/strings.ts; every function takes a `locale` to say
 * otherwise); the unit words come from the dictionary (`T.units`). English output is unchanged
 * from before: no grouping, a lower-case "k".
 */
import { LOCALE, T } from './strings';

const cache = new Map<string, Intl.NumberFormat>();

/** A cached `Intl.NumberFormat` (they are slow to make and these run every frame). */
function nf(locale: string, digits: number, minDigits = 0): Intl.NumberFormat {
  const key = `${locale}|${digits}|${minDigits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: minDigits, useGrouping: false });
    cache.set(key, f);
  }
  return f;
}

/** A plain number with at most `digits` decimals ("2.5", "12"). */
export function num(n: number, digits = 0, locale: string = LOCALE): string {
  return nf(locale, digits).format(n);
}

/** A number with exactly `digits` decimals ("1.50"). */
export function fixed(n: number, digits: number, locale: string = LOCALE): string {
  return nf(locale, digits, digits).format(n);
}

/** A whole count ("12"). */
export function count(n: number, locale: string = LOCALE): string {
  return nf(locale, 0).format(Math.round(n));
}

/** An amount of paper, whole ("120"); `fmt` shortens big ones. */
export function paper(n: number, locale: string = LOCALE): string {
  return count(n, locale);
}

/** 1234 → "1.2k", 950 → "950". */
export function fmt(n: number, locale: string = LOCALE): string {
  const v = Math.round(n);
  if (Math.abs(v) < 1000) return count(v, locale);
  const k = v / 1000;
  return T.units.thousands(nf(locale, Math.abs(k) < 10 ? 1 : 0).format(k));
}

/** A change: "+12", "−8", "0". */
export function signed(n: number, locale: string = LOCALE): string {
  const v = Math.round(n);
  return v > 0 ? `+${fmt(v, locale)}` : v < 0 ? `−${fmt(-v, locale)}` : count(0, locale);
}

/** Seconds as "1:05" (or "45s" under a minute when `short`). */
export function clock(seconds: number, short = false, locale: string = LOCALE): string {
  const s = Math.max(0, Math.round(seconds));
  if (short && s < 60) return T.units.seconds(count(s, locale));
  return `${count(Math.floor(s / 60), locale)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whole seconds with the unit: "12 s" (`spaced`) or "12s". */
export function seconds(s: number, locale: string = LOCALE): string {
  return T.units.secondsSpaced(count(s, locale));
}

/** Whole minutes: "12m". */
export function minutes(m: number, locale: string = LOCALE): string {
  return T.units.minutes(count(m, locale));
}

/** Whole minutes as a duration: "12 min". */
export function minutesLong(m: number, locale: string = LOCALE): string {
  return T.units.minutesLong(count(m, locale));
}

/** A share of 0..1 as a percentage: "45%". */
export function pct(fraction: number, locale: string = LOCALE): string {
  return percent(Math.max(0, Math.min(1, fraction)), locale);
}

/** A share as a percentage, not clamped (a text scale of 1.15 → "115%"). */
export function percent(fraction: number, locale: string = LOCALE): string {
  return T.units.percent(count(fraction * 100, locale));
}

/** A distance: "850 m", "1.2 km". */
export function metres(m: number, locale: string = LOCALE): string {
  return m >= 1000 ? km(m, 1, locale) : T.units.metres(count(m, locale));
}

/** A distance in kilometres with `digits` decimals: "1.25 km". */
export function km(m: number, digits = 1, locale: string = LOCALE): string {
  return T.units.km(fixed(m / 1000, digits, locale));
}

/** A speed: "12 m/s", with `digits` decimals. */
export function speed(mps: number, digits = 0, locale: string = LOCALE): string {
  return T.units.speed(fixed(mps, digits, locale));
}

/** A ratio: "1.5×". */
export function times(n: number, digits = 1, locale: string = LOCALE): string {
  return T.units.times(fixed(n, digits, locale));
}

/** Pips for small counts: "●●○". */
export function pips(filled: number, total: number): string {
  return '●'.repeat(Math.max(0, Math.min(total, filled))) + '○'.repeat(Math.max(0, total - Math.max(0, filled)));
}

/** Eight-point compass direction of (dx, dz) as the mini-map draws it (up is +x, right is +z). */
export function compass(dx: number, dz: number): string {
  const angle = Math.atan2(dz, dx); // 0 = up the map
  const c = T.units.compass;
  const names = [c.n, c.ne, c.e, c.se, c.s, c.sw, c.w, c.nw];
  return names[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

/** A health share as a level for colouring bars. */
export function level(fraction: number): 'ok' | 'worn' | 'critical' {
  return fraction > 0.6 ? 'ok' : fraction > 0.3 ? 'worn' : 'critical';
}

/** A calendar date in the locale's short form ("06/11/2026" or "11/6/2026"). */
export function date(at: number | Date, locale: string = LOCALE): string {
  return new Date(at).toLocaleDateString(locale);
}

/** A time of day, hours and minutes ("14:05", "02:05 PM"). */
export function timeOfDay(at: number | Date, locale: string = LOCALE): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** A long duration as a clock: "42:05", or "1:02:00" for an hour or more. */
export function longClock(seconds: number, locale: string = LOCALE): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${count(h, locale)}:${two(m)}:${two(s)}` : `${count(m, locale)}:${two(s)}`;
}

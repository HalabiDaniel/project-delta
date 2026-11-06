import { alert, glyph, type Severity } from './components';
import { esc } from './dom';
import { icon, type IconName } from './icons';
import { SAY } from './strings';

export type AlertTone = 'good' | 'bad' | 'warn' | 'info';

/** How much an alert matters: critical beats warning beats good / info. */
export type AlertLevel = 'critical' | 'warning' | 'info';
const RANK: Record<AlertLevel, number> = { critical: 3, warning: 2, info: 1 };

/** At most this many alerts show at once (plan v0.0.15 §3B). */
export const MAX_ALERTS = 3;

/**
 * Bad news with one of these icons is critical even when the caller didn't say so (the multiplayer
 * game's alerts arrive from the server as icon, title, value and tone): a raid on home, a rocket
 * lock or launch, and low health always win.
 */
const CRITICAL_ICONS = new Set<IconName>(['raid', 'rocket', 'lock', 'health', 'launcher']);

export interface AlertOptions {
  /** Low health, a rocket lock, a raid on home: always shown, ahead of everything else. */
  critical?: boolean;
}

export function alertLevel(iconName: IconName, tone: AlertTone, opts: AlertOptions = {}): AlertLevel {
  if (opts.critical || (tone === 'bad' && CRITICAL_ICONS.has(iconName))) return 'critical';
  return tone === 'bad' || tone === 'warn' ? 'warning' : 'info';
}

export interface QueuedAlert {
  key: string;
  level: AlertLevel;
  /** When it came (or last repeated): newest first within a level. */
  at: number;
  until: number;
  count: number;
}

/**
 * Which alerts show, as pure logic: at most three, ordered critical > warning > good / info and
 * newest first within a level. A new alert that matters at least as much as the least important
 * one showing takes its place; one that matters less is dropped. A repeat of one already up
 * counts up instead (×2) and moves to the front of its level.
 */
export class AlertQueue<T extends QueuedAlert = QueuedAlert> {
  readonly items: T[] = [];

  constructor(readonly max = MAX_ALERTS) {}

  find(key: string): T | undefined {
    return this.items.find((a) => a.key === key);
  }

  /** Adds an alert. Returns the ones it pushed out, or null when it wasn't important enough to show. */
  push(item: T): T[] | null {
    const out: T[] = [];
    if (this.items.length >= this.max) {
      // Sorted: the last is the least important, and the oldest of its level.
      const weakest = this.items[this.items.length - 1];
      if (!weakest || RANK[weakest.level] > RANK[item.level]) return null;
      this.remove(weakest);
      out.push(weakest);
    }
    this.items.push(item);
    this.sort();
    return out;
  }

  /** A repeat: counts up, refreshes its time, moves up within its level. */
  bump(item: T, now: number, until: number): void {
    item.count++;
    item.at = now;
    item.until = until;
    this.sort();
  }

  /** Removes and returns the alerts whose time is up. */
  expire(now: number): T[] {
    const gone = this.items.filter((a) => now > a.until);
    for (const a of gone) this.remove(a);
    return gone;
  }

  remove(item: T): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  private sort(): void {
    this.items.sort((a, b) => RANK[b.level] - RANK[a.level] || b.at - a.at);
  }
}

const SEVERITY: Record<AlertTone, Severity> = { good: 'good', bad: 'critical', warn: 'warning', info: 'info' };

interface Live extends QueuedAlert {
  el: HTMLElement;
}

/**
 * Alerts below the objective: an icon, a title of one to three words and at most one number
 * (the Alert component). At most three show, in priority order; an alert that is already up is
 * not repeated but counts up (×2), and each one goes away by itself.
 */
export class Alerts {
  private readonly el: HTMLElement;
  private readonly queue = new AlertQueue<Live>();

  constructor(host: HTMLElement, private readonly now: () => number = () => performance.now()) {
    this.el = document.createElement('div');
    this.el.className = 'alerts';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-label', SAY.alerts);
    host.appendChild(this.el);
  }

  show(iconName: IconName, title: string, value: string | null, tone: AlertTone, seconds = 2.6, opts: AlertOptions = {}): void {
    const now = this.now();
    const key = `${tone}|${title}`;
    const same = this.queue.find(key);
    if (same) {
      this.queue.bump(same, now, now + seconds * 1000);
      const el = this.build(iconName, title, value, tone, same.level, same.count);
      el.classList.add('bump');
      same.el.replaceWith(el);
      same.el = el;
      this.order();
      return;
    }
    const level = alertLevel(iconName, tone, opts);
    const el = this.build(iconName, title, value, tone, level, 1);
    const dropped = this.queue.push({ key, level, at: now, until: now + seconds * 1000, count: 1, el });
    if (dropped === null) return;
    for (const d of dropped) this.leave(d.el);
    this.el.appendChild(el);
    this.order();
  }

  update(): void {
    for (const a of this.queue.expire(this.now())) this.leave(a.el);
  }

  /** The alerts showing, most important first (tests). */
  get showing(): ReadonlyArray<{ key: string; level: AlertLevel; count: number }> {
    return this.queue.items;
  }

  private build(iconName: IconName, title: string, value: string | null, tone: AlertTone, level: AlertLevel, count: number): HTMLElement {
    const holder = document.createElement('div');
    holder.innerHTML = alert({
      title,
      value: value ?? undefined,
      icon: iconName,
      severity: SEVERITY[tone],
      count: count > 1 ? `×${count}` : undefined,
      className: 'hud-alert',
      attrs: { 'data-level': level, 'data-tone': tone },
    });
    return holder.firstElementChild as HTMLElement;
  }

  /** Puts the elements in queue order (only moves what is out of place). */
  private order(): void {
    this.queue.items.forEach((a, i) => {
      if (this.el.children[i] !== a.el) this.el.insertBefore(a.el, this.el.children[i] ?? null);
    });
  }

  private leave(el: HTMLElement): void {
    el.classList.add('leaving');
    // Leaving alerts sit after the ones showing until they are gone.
    this.el.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }
}

/**
 * A first-time tip: a short line next to a lightbulb, shown once per save for each thing the
 * player meets for the first time. Click to dismiss; it goes by itself after a while.
 */
export class Tips {
  private readonly el: HTMLElement;
  private until = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tip';
    this.el.setAttribute('role', 'status');
    this.el.hidden = true;
    this.el.addEventListener('click', () => this.hide());
    host.appendChild(this.el);
  }

  show(text: string, keys: string[] = [], seconds = 7): void {
    const kbd = keys.map((k) => glyph({ key: k })).join('');
    this.el.innerHTML = `${icon('tip', 'icon tip-icon')}<span>${esc(text)}</span>${kbd ? `<span class="tip-keys">${kbd}</span>` : ''}`;
    this.el.hidden = false;
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
    this.until = performance.now() + seconds * 1000;
  }

  hide(): void {
    this.el.hidden = true;
    this.until = 0;
  }

  update(): void {
    if (this.until && performance.now() > this.until) this.hide();
  }
}

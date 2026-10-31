import { esc } from './dom';
import { icon, type IconName } from './icons';

export type AlertTone = 'good' | 'bad' | 'warn' | 'info';

interface Live {
  key: string;
  el: HTMLElement;
  until: number;
  count: number;
}

/** Alerts at once; older ones make way. */
const MAX = 3;

/**
 * Alerts below the objective: an icon, a title of one to three words and at most one number.
 * Coloured by severity. At most three show at once; an alert that is already up is not repeated
 * but counts up (×2), and each one goes away by itself.
 */
export class Alerts {
  private readonly el: HTMLElement;
  private readonly live: Live[] = [];

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'alerts';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    host.appendChild(this.el);
  }

  show(iconName: IconName, title: string, value: string | null, tone: AlertTone, seconds = 2.6): void {
    const now = performance.now();
    const key = `${tone}|${title}`;
    const same = this.live.find((a) => a.key === key);
    if (same) {
      same.count++;
      same.until = now + seconds * 1000;
      const count = same.el.querySelector('.al-count') as HTMLElement;
      count.textContent = `×${same.count}`;
      count.hidden = false;
      if (value !== null) (same.el.querySelector('.al-value') as HTMLElement).textContent = value;
      same.el.classList.remove('bump');
      void same.el.offsetWidth;
      same.el.classList.add('bump');
      return;
    }
    const el = document.createElement('div');
    el.className = 'alert';
    el.dataset.tone = tone;
    el.innerHTML = `${icon(iconName, 'icon al-icon')}<b class="al-title">${esc(title)}</b>${value !== null ? `<span class="al-value">${esc(value)}</span>` : ''}<span class="al-count" hidden></span>`;
    this.el.prepend(el);
    this.live.unshift({ key, el, until: now + seconds * 1000, count: 1 });
    while (this.live.length > MAX) this.drop(this.live[this.live.length - 1]);
  }

  update(): void {
    const now = performance.now();
    for (const a of [...this.live]) if (now > a.until) this.drop(a);
  }

  private drop(a: Live): void {
    this.live.splice(this.live.indexOf(a), 1);
    a.el.classList.add('leaving');
    a.el.addEventListener('animationend', () => a.el.remove(), { once: true });
    setTimeout(() => a.el.remove(), 400);
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
    this.el.hidden = true;
    this.el.addEventListener('click', () => this.hide());
    host.appendChild(this.el);
  }

  show(text: string, keys: string[] = [], seconds = 7): void {
    const kbd = keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('');
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

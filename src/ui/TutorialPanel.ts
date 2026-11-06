import { bar, button, card, glyph } from './components';
import { bindButton, esc, toggle } from './dom';
import { icon } from './icons';
import { SAY } from './strings';
import type { TutorialView } from './views';

/**
 * The tutorial's step, top centre under the objective: "3 / 10", what to do and the controls for
 * it, with a way out. Redrawn only when the step (or the device's labels) change.
 */
export class TutorialPanel {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private key = '';

  constructor(host: HTMLElement, onSkip: () => void) {
    host.insertAdjacentHTML('beforeend', card({
      className: 'tutorial', label: SAY.tutorial, tone: 'friend',
      bodyHtml: `<div class="tu-body"></div>${button({ label: 'Skip tutorial', size: 'small', className: 'tu-skip', attrs: { 'data-nav': 'tutorial-skip' } })}`,
    }));
    this.el = host.lastElementChild as HTMLElement;
    this.el.hidden = true;
    this.body = this.el.querySelector<HTMLElement>('.tu-body')!;
    bindButton(this.el.querySelector<HTMLElement>('.tu-skip')!, onSkip);
  }

  render(v: TutorialView | null, hidden: boolean): void {
    toggle(this.el, v !== null && !hidden);
    if (!v || hidden) return;
    const key = JSON.stringify(v);
    if (key === this.key) return;
    this.key = key;
    // The labels already name the device's controls (controlLabel): shown as written.
    const keys = v.keys.map((k) => glyph({ key: k }, { literal: true })).join('');
    this.body.innerHTML =
      `<div class="tu-head">${icon('tip', 'icon tu-icon')}<span class="tu-count num">${v.step} / ${v.total}</span><b class="tu-title">${esc(v.title)}</b></div>` +
      `<div class="tu-text">${esc(v.text)}</div>` +
      (keys ? `<div class="tu-keys">${keys}</div>` : '') +
      bar({ value: (v.step - 1) / v.total, label: SAY.tutorial, valueText: `${v.step} / ${v.total}`, kind: 'progress', size: 'thin', className: 'tu-progress' });
    this.el.classList.remove('advance');
    void this.el.offsetWidth;
    this.el.classList.add('advance');
  }
}

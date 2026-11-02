import { bindButton, esc, toggle } from './dom';
import { icon } from './icons';
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
    this.el = document.createElement('div');
    this.el.className = 'tutorial card';
    this.el.hidden = true;
    this.body = document.createElement('div');
    this.body.className = 'tu-body';
    const skip = document.createElement('button');
    skip.className = 'btn tiny ghost tu-skip';
    skip.dataset.nav = 'tutorial-skip';
    skip.textContent = 'Skip tutorial';
    bindButton(skip, onSkip);
    this.el.append(this.body, skip);
    host.appendChild(this.el);
  }

  render(v: TutorialView | null, hidden: boolean): void {
    toggle(this.el, v !== null && !hidden);
    if (!v || hidden) return;
    const key = JSON.stringify(v);
    if (key === this.key) return;
    this.key = key;
    const keys = v.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('');
    this.body.innerHTML =
      `<div class="tu-head">${icon('tip', 'icon tu-icon')}<span class="tu-count">${v.step} / ${v.total}</span><b class="tu-title">${esc(v.title)}</b></div>` +
      `<div class="tu-text">${esc(v.text)}</div>` +
      (keys ? `<div class="tu-keys">${keys}</div>` : '') +
      `<div class="tu-progress"><i style="width:${Math.round(((v.step - 1) / v.total) * 100)}%"></i></div>`;
    this.el.classList.remove('advance');
    void this.el.offsetWidth;
    this.el.classList.add('advance');
  }
}

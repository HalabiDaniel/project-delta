import type { LoadProgress } from '../assets/AssetLibrary';
import { esc } from './dom';
import { brand, kmeter, panel } from './kit';
import { T } from './strings';
import './screens/screens.css';

/**
 * The loading screen of the multiplayer page (single-player shows the same screen through its
 * front end, src/ui/screens/Frontend.ts): the wooden desk, the logo top left, and a 420px panel
 * in the lower third with a segmented meter and one line ("Folding planes… 18 / 25"). If a model
 * fails to load the game still starts on its stand-ins; the line says so for a moment.
 */
export class LoadingScreen {
  private readonly el: HTMLElement | null;

  constructor(parent: HTMLElement | null = typeof document === 'undefined' ? null : document.body) {
    if (!parent) {
      this.el = null;
      return;
    }
    const el = document.createElement('div');
    el.className = 'front loading-screen';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', T.loading.label);
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.innerHTML = `<div class="front-stage"><div class="front-scene-screen"><div class="front-brand">${brand(T.front.brand)}</div>${panel({ className: 'boot-panel', bodyHtml: `${this.meter(0)}<p class="boot-line" data-label>${esc(T.loading.folding)}</p>` })}</div></div>`;
    parent.appendChild(el);
    this.el = el;
    const fit = () => {
      const s = Math.max(0.6, Math.min(2.4, Math.min(window.innerWidth / 1440, window.innerHeight / 900)));
      el.style.setProperty('--fs', String(s));
      el.style.setProperty('--stage-w', `${window.innerWidth / s}px`);
      el.style.setProperty('--stage-h', `${window.innerHeight / s}px`);
    };
    fit();
    window.addEventListener('resize', fit);
  }

  private meter(v: number): string {
    return kmeter({ label: T.front.loading, value: v, segments: 20, hideLabel: true, className: 'boot-meter' });
  }

  progress(p: LoadProgress): void {
    const pct = loadPercent(p);
    const m = this.el?.querySelector('.boot-meter');
    if (m) m.outerHTML = this.meter(pct / 100);
    this.el?.setAttribute('aria-valuenow', String(pct));
    const label = this.el?.querySelector('[data-label]');
    if (label) label.textContent = p.total > 0 ? T.front.folding(String(p.done), String(p.total)) : T.loading.folding;
  }

  /** Loading finished: fades out, after a short note if some models fell back to stand-ins. */
  done(failures: readonly string[] = []): void {
    const el = this.el;
    if (!el) return;
    const m = el.querySelector('.boot-meter');
    if (m) m.outerHTML = this.meter(1);
    const hold = failures.length > 0 ? 1800 : 0;
    const label = el.querySelector('[data-label]');
    if (failures.length > 0 && label) {
      label.textContent = T.loading.standIns(failures.length);
      console.warn('paperwars: models that fell back to stand-ins', failures);
    }
    setTimeout(() => {
      el.classList.add('leaving');
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 250);
    }, hold);
  }
}

/** Share of the load done, 0–100 (a load with nothing to fetch is complete). */
export function loadPercent(p: Pick<LoadProgress, 'done' | 'total'>): number {
  if (p.total <= 0) return 100;
  return Math.round((Math.min(p.done, p.total) / p.total) * 100);
}

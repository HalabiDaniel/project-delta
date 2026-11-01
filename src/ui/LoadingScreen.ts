import type { LoadProgress } from '../assets/AssetLibrary';

/**
 * The loading screen (v0.0.11): a sheet of paper with a progress bar while the models load, so a
 * slow connection shows progress instead of a blank page. If any model fails to load, the game
 * still starts on its built-in stand-ins and the screen says so for a moment before it fades.
 *
 * Self-contained (inline styles): it shows before the HUD and its stylesheet exist.
 */
export class LoadingScreen {
  private readonly el: HTMLElement | null;
  private readonly bar: HTMLElement | null = null;
  private readonly label: HTMLElement | null = null;

  constructor(parent: HTMLElement | null = typeof document === 'undefined' ? null : document.body) {
    if (!parent) {
      this.el = null;
      return;
    }
    const el = document.createElement('div');
    el.className = 'loading-screen';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', 'Loading paperwars.io');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      background: '#bcdbf5',
      zIndex: '50',
      transition: 'opacity 0.4s',
      font: '600 16px/1.4 system-ui, sans-serif',
      color: '#1f2937',
    } satisfies Partial<CSSStyleDeclaration>);
    el.innerHTML = `
      <div style="background:#fffdf6;border:2px solid #1f2937;border-radius:6px;padding:22px 26px;min-width:260px;max-width:80vw;box-shadow:4px 5px 0 rgba(31,41,55,.25);transform:rotate(-0.6deg)">
        <div style="font-size:22px;font-weight:800;margin-bottom:12px">paperwars.io</div>
        <div style="height:12px;border:2px solid #1f2937;border-radius:3px;background:#fff;overflow:hidden">
          <div data-bar style="height:100%;width:0;background:#3a7cf0;transition:width .15s"></div>
        </div>
        <div data-label style="margin-top:8px;font-weight:500;font-size:13px;color:#4b5563">Folding the paper…</div>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.bar = el.querySelector('[data-bar]');
    this.label = el.querySelector('[data-label]');
  }

  progress(p: LoadProgress): void {
    const pct = loadPercent(p);
    if (this.bar) this.bar.style.width = `${pct}%`;
    this.el?.setAttribute('aria-valuenow', String(pct));
    if (this.label) this.label.textContent = p.total > 0 ? `Loading models ${p.done} / ${p.total}` : 'Folding the paper…';
  }

  /** Loading finished: fades out, after a short note if some models fell back to stand-ins. */
  done(failures: readonly string[] = []): void {
    const el = this.el;
    if (!el) return;
    if (this.bar) this.bar.style.width = '100%';
    const hold = failures.length > 0 ? 1800 : 0;
    if (failures.length > 0 && this.label) {
      this.label.textContent = `${failures.length} model${failures.length > 1 ? 's' : ''} didn't load: using simpler stand-ins.`;
      console.warn('paperwars: models that fell back to stand-ins', failures);
    }
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 450);
    }, hold);
  }
}

/** Share of the load done, 0–100 (a load with nothing to fetch is complete). */
export function loadPercent(p: Pick<LoadProgress, 'done' | 'total'>): number {
  if (p.total <= 0) return 100;
  return Math.round((Math.min(p.done, p.total) / p.total) * 100);
}

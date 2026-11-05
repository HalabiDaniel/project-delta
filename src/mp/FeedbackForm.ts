import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS, type FeedbackCategory, type FeedbackDTO, type FeedbackReplyDTO } from '../net/protocol';
import { esc } from '../ui/dom';
import { icon } from '../ui/icons';

/**
 * The playtest feedback log (v0.0.14): F8, or the pause menu's Feedback button. A category, what
 * happened, optional steps to reproduce and an enjoyment rating; the version, frame rate, ping,
 * device and browser are attached here, and the server adds the session, desk, position and mode.
 * Entries go to the `feedback` table; `npm run admin -- feedback export` reads them.
 */

const NAMES: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  frustration: 'Frustrating',
  interface: 'Confusing',
  performance: 'Slow / laggy',
  balance: 'Balance',
  missing: 'Missing',
  enjoyment: 'Enjoyment',
};

const HINTS: Record<FeedbackCategory, string> = {
  bug: 'Something broke or behaved wrongly',
  frustration: 'Gameplay that felt unfair or annoying',
  interface: 'Something on screen that was hard to understand',
  performance: 'Stutter, low frame rate, lag',
  balance: 'Too strong, too weak, too expensive, too slow',
  missing: 'Something you wanted to do and couldn\'t',
  enjoyment: 'How it feels overall, what you liked',
};

export interface FeedbackHost {
  /** Sends the entry to the server (false: not connected). */
  send(entry: FeedbackDTO): boolean;
  /** What the game knows right now (ping, graphics, mode). */
  context(): Record<string, string | number | boolean | null>;
  /** The form opened or closed (the game pauses its input meanwhile). */
  opened(open: boolean): void;
}

export class FeedbackForm {
  private readonly root: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly repro: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly sendButton: HTMLButtonElement;
  private category: FeedbackCategory | null = null;
  private rating: number | null = null;
  private waiting = false;
  /** Frame times (ms) over the last few seconds, for the attached frame rate. */
  private readonly frames: number[] = [];
  private lastFrame = 0;

  constructor(parent: HTMLElement, private readonly host: FeedbackHost) {
    this.root = document.createElement('div');
    this.root.className = 'mp-feedback';
    this.root.hidden = true;
    this.root.innerHTML = /* html */ `
      <div class="mp-card card" role="dialog" aria-label="Send feedback">
        <div class="mp-head"><b class="brand">paperwars<span>.io</span></b><h2>Feedback</h2><kbd>F8</kbd></div>
        <div class="fb-cats" data-u="cats">${FEEDBACK_CATEGORIES.map((c) => `<button type="button" data-v="${c}" title="${esc(HINTS[c])}">${esc(NAMES[c])}</button>`).join('')}</div>
        <label class="mp-field"><span>${icon('pencil')}What happened?</span><textarea data-u="text" rows="4" maxlength="${FEEDBACK_LIMITS.text}" placeholder="As much or as little as you like"></textarea></label>
        <label class="mp-field"><span>${icon('book')}Steps to reproduce (optional)</span><textarea data-u="repro" rows="2" maxlength="${FEEDBACK_LIMITS.repro}" placeholder="1. … 2. … 3. …"></textarea></label>
        <div class="mp-row"><span class="fb-label">Enjoyment</span><span class="seg" data-u="rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}">${n}</button>`).join('')}</span><small class="fb-note">Version, session, position, ping, frame rate and browser are attached.</small></div>
        <div class="mp-foot"><span class="mp-status" data-u="status"></span><button class="btn ghost small" data-u="cancel">${icon('close')}<span>Cancel</span><kbd>Esc</kbd></button><button class="btn primary" data-u="send">${icon('ok')}<span>Send</span></button></div>
      </div>`;
    parent.appendChild(this.root);
    const el = <T extends HTMLElement>(u: string) => this.root.querySelector<T>(`[data-u="${u}"]`)!;
    this.text = el<HTMLTextAreaElement>('text');
    this.repro = el<HTMLTextAreaElement>('repro');
    this.status = el('status');
    this.sendButton = el<HTMLButtonElement>('send');
    for (const b of el('cats').querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => this.setCategory(b.dataset.v as FeedbackCategory));
    for (const b of el('rating').querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => this.setRating(Number(b.dataset.v)));
    el('cancel').addEventListener('click', () => this.close());
    this.sendButton.addEventListener('click', () => this.submit());
    this.text.addEventListener('input', () => this.refresh());
    // Typing here is never for the game; Esc closes, Ctrl+Enter sends.
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.submit();
    });
    this.root.addEventListener('keyup', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => e.target === this.root && this.close());
    const tick = (t: number) => {
      if (this.lastFrame > 0) {
        this.frames.push(t - this.lastFrame);
        if (this.frames.length > 180) this.frames.shift();
      }
      this.lastFrame = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    if (this.open) return;
    this.root.hidden = false;
    this.status.textContent = '';
    this.refresh();
    this.host.opened(true);
    setTimeout(() => this.text.focus(), 0);
  }

  close(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.text.blur();
    this.repro.blur();
    this.host.opened(false);
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** The server's answer. */
  reply(r: FeedbackReplyDTO): void {
    this.waiting = false;
    if (r.ok) {
      this.text.value = '';
      this.repro.value = '';
      this.setRating(null);
      this.setCategory(null);
      this.close();
      return;
    }
    this.status.textContent = r.error ?? 'Not sent.';
    this.status.className = 'mp-status bad';
    this.refresh();
  }

  private setCategory(c: FeedbackCategory | null): void {
    this.category = c;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-u="cats"] button')) b.classList.toggle('on', b.dataset.v === c);
    this.refresh();
  }

  private setRating(n: number | null): void {
    this.rating = this.rating === n ? null : n;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-u="rating"] button')) b.classList.toggle('on', Number(b.dataset.v) === this.rating);
  }

  private refresh(): void {
    this.sendButton.disabled = this.waiting || !this.category || this.text.value.trim().length === 0;
    if (!this.waiting && !this.status.classList.contains('bad')) this.status.textContent = !this.category ? 'Pick what it is about.' : '';
  }

  private submit(): void {
    if (this.sendButton.disabled || !this.category) return;
    const entry: FeedbackDTO = { category: this.category, text: this.text.value.trim(), repro: this.repro.value.trim() || undefined, rating: this.rating, context: { ...this.browserContext(), ...this.host.context() } };
    this.status.className = 'mp-status';
    if (!this.host.send(entry)) {
      this.status.textContent = 'Not connected to a session: join one, then send it.';
      this.status.className = 'mp-status bad';
      return;
    }
    this.waiting = true;
    this.status.textContent = 'Sending…';
    this.refresh();
  }

  /** Version, frame rate, device and browser. */
  private browserContext(): Record<string, string | number | boolean | null> {
    const sorted = [...this.frames].sort((a, b) => a - b);
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const worst = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean }; deviceMemory?: number };
    const pads = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter((g) => g).map((g) => g!.id.slice(0, 60)) : [];
    return {
      version: __APP_VERSION__,
      fps: mean > 0 ? Math.round(1000 / mean) : null,
      frameP95: worst > 0 ? Math.round(worst) : null,
      browser: navigator.userAgent.slice(0, 300),
      device: `${nav.userAgentData?.platform ?? navigator.platform ?? '?'}${nav.userAgentData?.mobile ? ' (mobile)' : ''}, ${screen.width}x${screen.height} @${window.devicePixelRatio}x, window ${window.innerWidth}x${window.innerHeight}${nav.deviceMemory ? `, ${nav.deviceMemory} GB` : ''}, ${navigator.hardwareConcurrency ?? '?'} cores`,
      controller: pads.length > 0 ? pads.join(' | ') : null,
      language: navigator.language,
    };
  }
}

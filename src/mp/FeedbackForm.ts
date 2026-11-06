import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS, type FeedbackCategory, type FeedbackDTO, type FeedbackReplyDTO } from '../net/protocol';
import { button, glyph } from '../ui/components';
import { icon } from '../ui/icons';
import { esc } from '../ui/dom';
import { count } from '../ui/format';
import { T } from '../ui/strings';

/**
 * The playtest feedback log (v0.0.14): F8, or the pause menu's Feedback button. A category, what
 * happened, optional steps to reproduce and an enjoyment rating; the version, frame rate, ping,
 * device and browser are attached here, and the server adds the session, desk, position and mode.
 * Entries go to the `feedback` table; `npm run admin -- feedback export` reads them.
 */

const F = T.feedback;
const NAMES: Readonly<Record<FeedbackCategory, string>> = F.names;
const HINTS: Readonly<Record<FeedbackCategory, string>> = F.hints;

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
    this.root.className = 'mp-feedback mp-overlay';
    this.root.hidden = true;
    // A modal dialog on the shared components: the focus manager keeps the controller's highlight
    // inside it (every button and both text boxes are reachable with the pad; A types into a box),
    // B / Esc presses Cancel.
    const toggleButton = (v: string, label: string, tip?: string): string => button({ label, size: 'small', tip, attrs: { 'data-v': v, 'aria-pressed': 'false' } });
    this.root.innerHTML = /* html */ `
      <div class="ui-dialog mp-card mp-feedback-card" role="dialog" aria-modal="true" aria-labelledby="mp-feedback-title">
        <div class="mp-head"><b class="mp-brand">paperwars<span>.io</span></b><h2 id="mp-feedback-title">${esc(F.title)}</h2>${glyph({ key: 'F8' })}</div>
        <div class="mp-field"><span>${icon('info')}${esc(F.about)}</span><div class="mp-toggles" role="group" aria-label="${esc(F.about)}" data-u="cats">${FEEDBACK_CATEGORIES.map((c) => toggleButton(c, NAMES[c], HINTS[c])).join('')}</div></div>
        <label class="mp-field"><span>${icon('pencil')}${esc(F.happened)}</span><textarea class="mp-input" data-u="text" data-nav-default rows="4" maxlength="${FEEDBACK_LIMITS.text}" placeholder="${esc(F.happenedPlaceholder)}"></textarea></label>
        <label class="mp-field"><span>${icon('book')}${esc(F.repro)}</span><textarea class="mp-input" data-u="repro" rows="2" maxlength="${FEEDBACK_LIMITS.repro}" placeholder="${esc(F.reproPlaceholder)}"></textarea></label>
        <div class="mp-row"><span class="mp-label">${esc(F.enjoyment)}</span><span class="mp-toggles" role="group" aria-label="${esc(F.enjoyment)}" data-u="rating">${[1, 2, 3, 4, 5].map((n) => toggleButton(String(n), count(n))).join('')}</span><small class="mp-note">${esc(F.attached)}</small></div>
        <div class="ui-dialog-actions mp-foot"><span class="mp-status" data-u="status" role="status"></span>${button({ label: F.cancel, icon: 'close', key: { key: 'Esc' }, attrs: { 'data-u': 'cancel', 'data-dialog-cancel': '' } })}${button({ label: F.send, icon: 'ok', variant: 'primary', key: { key: 'Ctrl+Enter' }, attrs: { 'data-u': 'send' } })}</div>
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
    // Typing here is never for the game; Esc closes, Ctrl+Enter sends. Arrow keys outside a text
    // box go on to the focus manager, so the keyboard can move the highlight as a pad does.
    this.root.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (typing || !e.key.startsWith('Arrow')) e.stopPropagation();
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
    delete this.status.dataset.tone;
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
    this.status.textContent = r.error ?? F.notSent;
    this.status.dataset.tone = 'bad';
    this.refresh();
  }

  private setCategory(c: FeedbackCategory | null): void {
    this.category = c;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-u="cats"] button')) pressed(b, b.dataset.v === c);
    this.refresh();
  }

  private setRating(n: number | null): void {
    this.rating = this.rating === n ? null : n;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-u="rating"] button')) pressed(b, Number(b.dataset.v) === this.rating);
  }

  private refresh(): void {
    this.sendButton.disabled = this.waiting || !this.category || this.text.value.trim().length === 0;
    if (!this.waiting && this.status.dataset.tone !== 'bad') this.status.textContent = !this.category ? F.pickCategory : '';
  }

  private submit(): void {
    if (this.sendButton.disabled || !this.category) return;
    const entry: FeedbackDTO = { category: this.category, text: this.text.value.trim(), repro: this.repro.value.trim() || undefined, rating: this.rating, context: { ...this.browserContext(), ...this.host.context() } };
    delete this.status.dataset.tone;
    if (!this.host.send(entry)) {
      this.status.textContent = F.notConnected;
      this.status.dataset.tone = 'bad';
      return;
    }
    this.waiting = true;
    this.status.textContent = F.sending;
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

/** A toggle button's on state: pressed for screen readers, the primary look for the eye. */
function pressed(b: HTMLButtonElement, on: boolean): void {
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.dataset.variant = on ? 'primary' : 'secondary';
}

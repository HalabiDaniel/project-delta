import { caption } from './components';
import type { IconName } from './icons';
import type { SoundName } from './Sounds';
import { CAPTION_TEXT, CAPTIONS_LABEL, DIRECTION_TEXT } from './strings';

/** The sounds that get a caption (plan v0.0.15 §8D; the list in docs/UI_AUDIT.md §7). */
export type CueId = keyof typeof CAPTION_TEXT;

/** Sound → caption. Sounds not listed (whoosh, ink, combat music…) get none. */
export const SOUND_CUES: Readonly<Partial<Record<SoundName, CueId>>> = {
  spotted: 'spotted', lock: 'lock', launch: 'launch', hit: 'hit', bandit: 'bandit', raid: 'raid',
};

export const CUE_ICONS: Readonly<Record<CueId, IconName>> = {
  spotted: 'radar', lock: 'launcher', launch: 'rocket', hit: 'damage', bandit: 'fighter', raid: 'raid',
};

/** The ones that mean danger now: drawn with the critical outline. */
const URGENT: ReadonlySet<CueId> = new Set<CueId>(['lock', 'launch', 'hit', 'raid']);

/** How long a caption stays after its sound (a continuous sound, the lock tone, keeps it up). */
export const CAPTION_SECONDS = 2.4;
/** At most this many at once; the oldest goes first. */
export const MAX_CAPTIONS = 3;

/** A direction (radians from the nose, positive right) as words for screen readers. */
export function directionWord(angle: number): string {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const q = Math.abs(a);
  if (q <= Math.PI / 4) return DIRECTION_TEXT.ahead;
  if (q >= (Math.PI * 3) / 4) return DIRECTION_TEXT.behind;
  return a > 0 ? DIRECTION_TEXT.right : DIRECTION_TEXT.left;
}

interface Line {
  cue: CueId;
  el: HTMLElement;
  until: number;
  angleKey: string;
}

/**
 * Sound captions, like subtitles above the instruments: "[Rocket lock]" with the sound's icon and
 * an arrow toward its source when the game knows it. On by default while the sound is off, or by
 * setting (src/ui/access.ts). The game reports every sound (`Sounds.onCue`); repeats of the same
 * caption refresh it instead of stacking.
 */
export class Captions {
  readonly el: HTMLElement;
  private readonly lines: Line[] = [];
  private on = false;

  constructor(host: HTMLElement, private readonly now: () => number = () => performance.now()) {
    this.el = document.createElement('div');
    this.el.className = 'captions';
    this.el.setAttribute('role', 'log');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-label', CAPTIONS_LABEL);
    this.el.dataset.critical = '';
    this.el.hidden = true;
    host.prepend(this.el);
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (!on) this.clear();
  }

  /** A sound played: its caption, if it has one and captions are on. */
  sound(name: SoundName, angle: number | null = null): void {
    const cue = SOUND_CUES[name];
    if (cue) this.show(cue, angle);
  }

  show(cue: CueId, angle: number | null = null): void {
    if (!this.on) return;
    const until = this.now() + CAPTION_SECONDS * 1000;
    const angleKey = angle === null ? '' : String(Math.round((angle * 180) / Math.PI / 15));
    const same = this.lines.find((l) => l.cue === cue);
    if (same) {
      same.until = until;
      if (same.angleKey !== angleKey) {
        same.angleKey = angleKey;
        same.el.outerHTML = this.html(cue, angle);
        same.el = this.el.querySelector<HTMLElement>(`[data-cue="${cue}"]`)!;
      }
      return;
    }
    this.el.insertAdjacentHTML('beforeend', this.html(cue, angle));
    this.lines.push({ cue, el: this.el.lastElementChild as HTMLElement, until, angleKey });
    while (this.lines.length > MAX_CAPTIONS) this.lines.shift()!.el.remove();
    this.el.hidden = false;
  }

  /** Each frame: captions past their time go. */
  update(): void {
    if (this.lines.length === 0) return;
    const t = this.now();
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (this.lines[i].until > t) continue;
      this.lines[i].el.remove();
      this.lines.splice(i, 1);
    }
    if (this.lines.length === 0) this.el.hidden = true;
  }

  /** The captions showing, oldest first (tests). */
  get showing(): CueId[] {
    return this.lines.map((l) => l.cue);
  }

  clear(): void {
    for (const l of this.lines) l.el.remove();
    this.lines.length = 0;
    this.el.hidden = true;
  }

  private html(cue: CueId, angle: number | null): string {
    return caption({
      text: CAPTION_TEXT[cue],
      icon: CUE_ICONS[cue],
      direction: angle,
      directionLabel: angle === null ? undefined : directionWord(angle),
      state: URGENT.has(cue) ? 'critical' : undefined,
      attrs: { 'data-cue': cue },
    });
  }
}

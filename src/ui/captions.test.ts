// @vitest-environment happy-dom
/** Sound captions (plan v0.0.15 §8D): every important sound triggers its caption, muted or not. */
import { describe, expect, it } from 'vitest';
import { CAPTION_SECONDS, Captions, CUE_ICONS, directionWord, MAX_CAPTIONS, SOUND_CUES, type CueId } from './Captions';
import { Sounds, type SoundName } from './Sounds';
import { CAPTION_TEXT, DIRECTION_TEXT } from './strings';
import { icon } from './icons';

function rig(): { sounds: Sounds; captions: Captions; clock: { t: number }; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const clock = { t: 1000 };
  const captions = new Captions(host, () => clock.t);
  const sounds = new Sounds();
  sounds.onCue((name, angle) => captions.sound(name, angle));
  return { sounds, captions, clock, host };
}

const IMPORTANT: Array<[SoundName, CueId]> = [['spotted', 'spotted'], ['lock', 'lock'], ['launch', 'launch'], ['hit', 'hit'], ['bandit', 'bandit'], ['raid', 'raid']];

describe('sound captions', () => {
  it('covers the plan §8D list: rocket lock, launch, raid incoming, bandit, being hit, defenses spotting you', () => {
    expect(Object.keys(SOUND_CUES).sort()).toEqual(IMPORTANT.map(([s]) => s).sort());
  });

  for (const [sound, cue] of IMPORTANT) {
    it(`"${sound}" shows [${CAPTION_TEXT[cue]}] with its icon, also while muted and before audio is allowed`, () => {
      const { sounds, captions, host } = rig();
      sounds.muted = true;
      captions.enabled = true;
      sounds.play(sound, { angle: Math.PI / 2 });
      expect(captions.showing).toEqual([cue]);
      const el = host.querySelector<HTMLElement>(`[data-cue="${cue}"]`)!;
      expect(el.querySelector('.ui-caption-text')!.textContent).toBe(CAPTION_TEXT[cue]);
      const want = document.createElement('div');
      want.innerHTML = icon(CUE_ICONS[cue], 'icon ui-icon');
      expect(el.querySelector('svg.ui-icon')!.innerHTML).toBe(want.firstElementChild!.innerHTML);
      expect(el.querySelector('.ui-caption-dir')!.getAttribute('aria-label')).toBe(DIRECTION_TEXT.right);
      host.remove();
    });
  }

  it('the lock tone keeps its caption up while it beeps, with the way to the launcher', () => {
    const { sounds, captions, clock, host } = rig();
    captions.enabled = true;
    sounds.lockTone(1, 0.5, -Math.PI / 2);
    expect(captions.showing).toEqual(['lock']);
    expect(host.querySelector('.ui-caption-dir')!.getAttribute('aria-label')).toBe(DIRECTION_TEXT.left);
    for (let i = 0; i < 10; i++) {
      clock.t += 500;
      sounds.lockTone(0.5, 0.8, -Math.PI / 2);
      captions.update();
    }
    expect(captions.showing).toEqual(['lock']); // refreshed, never stacked
    expect(host.querySelectorAll('[data-cue="lock"]')).toHaveLength(1);
    clock.t += CAPTION_SECONDS * 1000 + 1;
    captions.update();
    expect(captions.showing).toEqual([]);
    host.remove();
  });

  it('shows nothing when off, for uncaptioned sounds, or for a use marked caption: false', () => {
    const { sounds, captions, host } = rig();
    sounds.play('hit');
    expect(captions.showing).toEqual([]);
    captions.enabled = true;
    for (const s of ['whoosh', 'ink', 'pop', 'kill', 'collapse', 'crumple'] as SoundName[]) sounds.play(s);
    sounds.play('spotted', { caption: false }); // the build blip
    expect(captions.showing).toEqual([]);
    host.remove();
  });

  it('keeps at most three, oldest out first, and turning off clears them', () => {
    const { sounds, captions, host } = rig();
    captions.enabled = true;
    for (const s of ['spotted', 'bandit', 'hit', 'raid'] as SoundName[]) sounds.play(s);
    expect(captions.showing).toHaveLength(MAX_CAPTIONS);
    expect(captions.showing).toEqual(['bandit', 'hit', 'raid']);
    captions.enabled = false;
    expect(captions.showing).toEqual([]);
    expect(captions.el.hidden).toBe(true);
    host.remove();
  });

  it('names directions for screen readers', () => {
    expect(directionWord(0)).toBe(DIRECTION_TEXT.ahead);
    expect(directionWord(Math.PI)).toBe(DIRECTION_TEXT.behind);
    expect(directionWord(-Math.PI)).toBe(DIRECTION_TEXT.behind);
    expect(directionWord(1.2)).toBe(DIRECTION_TEXT.right);
    expect(directionWord(-1.2)).toBe(DIRECTION_TEXT.left);
  });
});

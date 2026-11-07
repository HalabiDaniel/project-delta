// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { accessTokens, captionsShown, DEFAULT_ACCESS, normaliseAccess, reducedMotion, TEXT_SCALES } from './access';
import { applyTokens, tokenOptions } from './tokens';

describe('accessibility settings (plan v0.0.15 §8)', () => {
  it('defaults: standard palette, 100% text, normal panels, motion follows the system, captions while muted, 16:9 HUD', () => {
    expect(DEFAULT_ACCESS).toEqual({ theme: 'daylight', palette: 'standard', textScale: 1, highContrast: false, motion: 'auto', captions: 'auto', safeArea: true, prompts: 'auto' });
    expect(TEXT_SCALES).toEqual([0.9, 1, 1.15, 1.3]);
  });

  it('normalises field by field', () => {
    expect(normaliseAccess(undefined)).toEqual(DEFAULT_ACCESS);
    expect(normaliseAccess('x')).toEqual(DEFAULT_ACCESS);
    expect(normaliseAccess({ theme: 'lightsOut', palette: 'colourblind', textScale: 1.15, highContrast: true, motion: 'reduced', captions: 'off', safeArea: false, prompts: 'playstation' }))
      .toEqual({ theme: 'lightsOut', palette: 'colourblind', textScale: 1.15, highContrast: true, motion: 'reduced', captions: 'off', safeArea: false, prompts: 'playstation' });
    expect(normaliseAccess({ theme: 'dark', palette: 'deuter', textScale: 1.2, highContrast: 1, motion: 'slow', captions: true, safeArea: 'on' })).toEqual(DEFAULT_ACCESS);
  });

  it('reduced motion follows prefers-reduced-motion on auto; the setting overrides it', () => {
    expect(reducedMotion('auto', true)).toBe(true);
    expect(reducedMotion('auto', false)).toBe(false);
    expect(reducedMotion('full', true)).toBe(false);
    expect(reducedMotion('reduced', false)).toBe(true);
  });

  it('captions: on by default while the sound is off', () => {
    expect(captionsShown('auto', true)).toBe(true);
    expect(captionsShown('auto', false)).toBe(false);
    expect(captionsShown('on', false)).toBe(true);
    expect(captionsShown('off', true)).toBe(false);
  });

  it('applies through the tokens, live', () => {
    const s = { ...DEFAULT_ACCESS, palette: 'colourblind' as const, textScale: 1.3, highContrast: true, motion: 'auto' as const };
    expect(accessTokens(s, { reducedMotion: true })).toEqual({ theme: 'daylight', palette: 'colourblind', highContrast: true, reducedMotion: true, textScale: 1.3 });
    const root = document.documentElement;
    applyTokens(root, accessTokens(s, { reducedMotion: false }));
    expect(root.dataset.palette).toBe('colourblind');
    expect(root.dataset.contrast).toBe('high');
    expect(root.dataset.motion).toBe('full');
    expect(root.style.getPropertyValue('--t-m')).toBe('19.5px');
    applyTokens(root, accessTokens(DEFAULT_ACCESS, { reducedMotion: false }));
    expect(tokenOptions()).toMatchObject({ palette: 'standard', highContrast: false, textScale: 1 });
    // The theme applies the same way, and the palette and contrast stay on top of it.
    applyTokens(root, accessTokens({ ...s, theme: 'lightsOut' }, { reducedMotion: false }));
    expect(root.dataset.theme).toBe('lights-out');
    expect(root.dataset.palette).toBe('colourblind');
    expect(root.dataset.contrast).toBe('high');
    applyTokens(root, accessTokens(DEFAULT_ACCESS, { reducedMotion: false }));
    expect(root.dataset.theme).toBe('daylight');
  });
});

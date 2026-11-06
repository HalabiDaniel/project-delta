// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTokens, colour, COLOUR_NAMES, cssColour, DEFAULT_TOKEN_OPTIONS, DURATIONS, ownerColour, PALETTES, parseColour, tokenCss, tokenOptions, tokenVars,
} from './tokens';

/** Every custom property the stylesheets (hud.css, mp.css, components.css) used before v0.0.15. */
const LEGACY = [
  '--paper', '--paper-solid', '--paper-2', '--edge', '--ink', '--ink-2', '--ink-3', '--friend', '--hostile', '--warn', '--good', '--off',
  '--gold', '--silver', '--bronze', '--threat-1', '--threat-2', '--threat-3', '--tracking', '--locking', '--firing',
  '--r', '--r-s', '--s1', '--s2', '--s3', '--s4', '--t-xl', '--t-l', '--t-m', '--t-s', '--shadow', '--shadow-lift', '--font', '--num', '--fast', '--ui-scale',
];

afterEach(() => {
  applyTokens(document.documentElement, DEFAULT_TOKEN_OPTIONS);
});

describe('design tokens', () => {
  it('has every colour in both palettes, as a valid colour', () => {
    for (const name of ['standard', 'colourblind'] as const) {
      const p = PALETTES[name];
      expect(Object.keys(p).sort()).toEqual([...COLOUR_NAMES].sort());
      for (const n of COLOUR_NAMES) expect(() => parseColour(p[n]), `${name} ${n}`).not.toThrow();
    }
  });

  it('keeps the v0.0.7 to v0.0.14 values, so the existing HUD renders the same', () => {
    const v = tokenVars();
    for (const name of LEGACY) expect(v[name], name).toBeTruthy();
    expect(v['--paper']).toBe('rgba(251, 248, 241, 0.93)');
    expect(v['--friend']).toBe('#2f6fe4');
    expect(v['--hostile']).toBe('#d6372e');
    expect(v['--s4']).toBe('16px');
    expect(v['--t-m']).toBe('15px');
    expect(v['--r']).toBe('10px');
    expect(v['--fast']).toBe('160ms cubic-bezier(0.2, 0.9, 0.3, 1.2)');
    expect(v['--ui-scale']).toBe('1');
  });

  it('adds the plan §1A tokens: objective, neutral, pill radius, flat elevation, motion, focus, chips', () => {
    const v = tokenVars();
    for (const name of ['--objective', '--neutral', '--r-pill', '--shadow-flat', '--elev-flat', '--elev-raised', '--elev-floating',
      '--dur-fold', '--dur-pop', '--dur-fade', '--dur-slide', '--ease-pop', '--motion-fold', '--focus', '--focus-width', '--focus-offset',
      '--chip-good-bg', '--chip-good-fg', '--chip-streak-bg', '--t-xs', '--t-display', '--s8', '--backdrop', '--on-colour']) {
      expect(v[name], name).toBeTruthy();
    }
    // Owners as the art direction colours them.
    expect(ownerColour('player')).toBe(colour('friend'));
    expect(ownerColour('hostile')).toBe(colour('hostile'));
    expect(ownerColour('neutral')).toBe(colour('neutral'));
    expect(ownerColour('objective')).toBe(colour('objective'));
  });

  it('swaps colours (not names) for the colour-blind palette', () => {
    const a = tokenVars({ palette: 'standard' });
    const b = tokenVars({ palette: 'colourblind' });
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(b['--friend']).not.toBe(a['--friend']);
    expect(b['--hostile']).not.toBe(a['--hostile']);
    expect(b['--good']).not.toBe(a['--good']);
    // Surfaces stay.
    expect(b['--paper']).toBe(a['--paper']);
  });

  it('writes CSS: a :root block with every token', () => {
    const css = tokenCss();
    expect(css.startsWith(':root {')).toBe(true);
    for (const name of LEGACY) expect(css).toContain(`${name}:`);
  });

  it('zeroes every motion duration with reduced motion', () => {
    const v = tokenVars({ reducedMotion: true });
    for (const name of Object.keys(DURATIONS)) expect(v[`--${name}`]).toBe('0ms');
    expect(v['--fast'].startsWith('0ms')).toBe(true);
    expect(v['--motion-pop'].startsWith('0ms')).toBe(true);
    expect(tokenVars()['--dur-pop']).not.toBe('0ms');
  });

  it('scales type with text scale and writes the HUD scale', () => {
    const v = tokenVars({ textScale: 1.2, hudScale: 1.15 });
    expect(v['--t-m']).toBe('18px');
    expect(v['--t-s']).toBe('14.4px');
    expect(v['--s2']).toBe('8px'); // spacing does not follow text scale
    expect(v['--ui-scale']).toBe('1.15');
  });

  it('makes panels solid with high contrast', () => {
    const v = tokenVars({ highContrast: true });
    expect(parseColour(v['--paper'])[3]).toBe(1);
    expect(v['--ink-3']).not.toBe(tokenVars()['--ink-3']);
  });

  it('applies on :root, and colour() matches the CSS', () => {
    const root = document.documentElement;
    applyTokens(root, { palette: 'colourblind' });
    expect(root.dataset.palette).toBe('colourblind');
    for (const n of COLOUR_NAMES) expect(root.style.getPropertyValue(`--${n}`).trim(), n).toBe(colour(n));
    expect(colour('friend')).toBe(PALETTES.colourblind.friend);
    // Options not given keep their value.
    applyTokens(root, { reducedMotion: true });
    expect(tokenOptions().palette).toBe('colourblind');
    expect(root.dataset.motion).toBe('reduced');
    expect(root.style.getPropertyValue('--dur-fold').trim()).toBe('0ms');
    expect(cssColour('friend')).toBe('var(--friend)');
  });
});

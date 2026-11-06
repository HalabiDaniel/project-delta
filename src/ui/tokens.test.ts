// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTokens, BASE_COLOUR_NAMES, colour, COLOUR_NAMES, cssColour, DEFAULT_TOKEN_OPTIONS, DURATIONS, ownerColour, PALETTES, parseColour, THEME_PALETTES, THEME_NAMES, tokenCss, tokenOptions, tokenVars,
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
  it('has every colour in both themes and both palettes, as a valid colour', () => {
    for (const theme of THEME_NAMES) {
      for (const name of ['standard', 'colourblind'] as const) {
        const p = THEME_PALETTES[theme][name];
        expect(Object.keys(p).sort()).toEqual([...COLOUR_NAMES].sort());
        for (const n of COLOUR_NAMES) expect(() => parseColour(p[n]), `${theme} ${name} ${n}`).not.toThrow();
      }
    }
    expect(THEME_PALETTES.daylight).toBe(PALETTES);
  });

  it('keeps every v0.0.7 to v0.0.14 name, as an alias onto the style guide values', () => {
    const v = tokenVars();
    for (const name of LEGACY) expect(v[name], name).toBeTruthy();
    // The developer's style guide (docs/style-guide/design-system/tokens.json), Daylight.
    expect(v['--paper-100']).toBe('#fbf8f1');
    expect(v['--ink-900']).toBe('#26242c');
    expect(v['--pencil-400']).toBe('#f5c23a');
    expect(v['--sky-500']).toBe('#2f6fc0');
    expect(v['--team-8']).toBe('#e86fa8');
    expect(v['--paper']).toBe(v['--paper-50']);
    expect(v['--ink']).toBe(v['--ink-900']);
    expect(v['--ink-2']).toBe(v['--ink-600']);
    expect(v['--friend']).toBe(v['--sky-500']);
    expect(v['--hostile']).toBe(v['--raid-500']);
    expect(v['--good']).toBe(v['--win-500']);
    expect(v['--focus']).toBe(v['--sky-500']);
    expect(v['--on-colour']).toBe(v['--on-signal']);
    expect(v['--s4']).toBe('16px');
    expect(v['--space-12']).toBe('48px');
    expect(v['--t-m']).toBe('15px');
    expect(v['--r']).toBe('12px');
    expect(v['--radius-lg']).toBe('20px');
    expect(v['--stroke-line']).toBe('2px');
    expect(v['--fast']).toBe('220ms cubic-bezier(0.3, 1.6, 0.5, 1)');
    expect(v['--ui-scale']).toBe('1');
  });

  it('has the Lights out theme: the dark values of the guide, the same names', () => {
    const day = tokenVars({ theme: 'daylight' });
    const night = tokenVars({ theme: 'lightsOut' });
    expect(Object.keys(night)).toEqual(Object.keys(day));
    expect(night['--paper-100']).toBe('#1e2926');
    expect(night['--ink-900']).toBe('#f3efe4');
    expect(night['--paper']).toBe(night['--paper-50']);
    expect(night['--friend']).toBe('#7fb0ef');
    // Graphite and pencil never flip.
    expect(night['--graphite']).toBe(day['--graphite']);
    expect(night['--pencil-400']).toBe(day['--pencil-400']);
    // The colour-blind palette and high contrast apply on top of either theme.
    expect(tokenVars({ theme: 'lightsOut', palette: 'colourblind' })['--hostile']).not.toBe(night['--hostile']);
    expect(tokenVars({ theme: 'lightsOut', highContrast: true })['--ink-3']).not.toBe(night['--ink-3']);
    for (const n of BASE_COLOUR_NAMES) expect(night[`--${n}`], n).toBeTruthy();
  });

  it('draws shadows hard: offset, no blur, in both themes', () => {
    for (const theme of THEME_NAMES) {
      const v = tokenVars({ theme });
      for (const name of ['--shadow-press', '--shadow-card', '--shadow-lift', '--shadow', '--elev-raised', '--elev-floating', '--shadow-hard']) {
        // "x y 0 colour": the third length (blur) is 0.
        expect(v[name], `${theme} ${name}`).toMatch(/^-?\d+(px)? -?\d+px 0 #/);
      }
    }
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
    // Springs give way to a short fade.
    expect(v['--dur-calm']).toBe('120ms');
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
    expect(root.dataset.theme).toBe('daylight');
    for (const n of COLOUR_NAMES) expect(root.style.getPropertyValue(`--${n}`).trim(), n).toBe(colour(n));
    expect(colour('friend')).toBe(PALETTES.colourblind.friend);
    // Options not given keep their value.
    applyTokens(root, { reducedMotion: true });
    expect(tokenOptions().palette).toBe('colourblind');
    expect(root.dataset.motion).toBe('reduced');
    expect(root.style.getPropertyValue('--dur-fold').trim()).toBe('0ms');
    expect(cssColour('friend')).toBe('var(--friend)');
    // The theme swaps values and keeps the palette.
    applyTokens(root, { theme: 'lightsOut' });
    expect(root.dataset.theme).toBe('lights-out');
    expect(colour('friend')).toBe(THEME_PALETTES.lightsOut.colourblind.friend);
    expect(colour('friend', 'standard')).toBe(THEME_PALETTES.lightsOut.standard.friend);
  });
});

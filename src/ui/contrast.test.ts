/**
 * Contrast on card stock (plan v0.0.15 §8B): WCAG 2 contrast of the text and icon tokens on the
 * panels, in both themes (Daylight, Lights out), both palettes and with high contrast. Body text needs 4.5:1; large text, bold pills
 * and icons 3:1.
 */
import { describe, expect, it } from 'vitest';
import { paletteFor, parseColour, type ColourName, type PaletteName, type ThemeName } from './tokens';

function luminance(c: string): number {
  const [r, g, b] = parseColour(c).slice(0, 3).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, minimum ratio, what it is]. */
const PAIRS: Array<[ColourName, ColourName, number, string]> = [
  ['ink', 'paper-solid', 4.5, 'body text'],
  ['ink', 'paper-2', 4.5, 'body text on recessed panels'],
  ['ink-2', 'paper-solid', 4.5, 'secondary text'],
  ['ink-2', 'paper-2', 4.5, 'secondary text on recessed panels (segmented controls)'],
  ['ink-3', 'paper-solid', 4.5, 'quiet small text'],
  ['ink-3', 'paper-2', 4.5, 'quiet small text on recessed panels'],
  ['chip-good-fg', 'chip-good-bg', 4.5, 'good chip'],
  ['chip-friend-fg', 'chip-friend-bg', 4.5, 'friend chip'],
  ['chip-hostile-fg', 'chip-hostile-bg', 4.5, 'hostile chip'],
  ['chip-warn-fg', 'chip-warn-bg', 4.5, 'warning chip'],
  ['chip-gold-fg', 'chip-gold-bg', 4.5, 'gold chip'],
  ['on-colour', 'friend', 4.5, 'primary button text'],
  ['on-colour', 'hostile', 4.5, 'danger button text'],
  ['on-colour', 'ink', 4.5, 'tooltip and key cap text'],
  ['on-colour', 'good', 3, 'bold text and icons on good pills'],
  ['on-colour', 'warn', 3, 'icons on warning pills'],
  ['on-colour', 'objective', 3, 'objective fills'],
  ['friend', 'paper-solid', 3, 'friend icons'],
  ['hostile', 'paper-solid', 3, 'hostile icons'],
  ['good', 'paper-solid', 3, 'good icons'],
  ['warn', 'paper-solid', 3, 'warning icons'],
  ['objective', 'paper-solid', 3, 'objective icons'],
  ['locking', 'paper-solid', 3, 'lock icons'],
  ['gold', 'paper-solid', 3, 'medal icons'],
  ['threat-3', 'paper-solid', 3, 'highest threat'],
  // The style guide's own pairs (docs/style-guide/design-system/README.md, Accessibility).
  ['ink-900', 'paper-100', 4.5, 'primary text on the page'],
  ['ink-900', 'paper-50', 4.5, 'primary text on cards'],
  ['ink-900', 'desk-200', 4.5, 'primary text in wells and the HUD tray'],
  ['ink-600', 'paper-100', 4.5, 'secondary text on the page'],
  ['ink-600', 'paper-50', 4.5, 'secondary text on cards'],
  ['graphite', 'pencil-400', 4.5, 'text on pencil buttons and the paper counter'],
  ['graphite', 'cardboard-400', 4.5, 'text on cardboard'],
  ['graphite', 'eraser-300', 4.5, 'text on new badges'],
  ['graphite', 'sticky-200', 4.5, 'coach mark text'],
  ['cardboard-700', 'paper-50', 4.5, 'costs and building names on paper'],
  ['sky-500', 'paper-50', 4.5, 'friendly text and links'],
  ['raid-500', 'paper-50', 4.5, 'danger text (risk lines, alert titles)'],
  ['win-500', 'paper-50', 4.5, 'success text (rewards)'],
  ['on-signal', 'sky-500', 4.5, 'text on sky fills'],
  ['on-signal', 'raid-500', 4.5, 'text on raid fills'],
  ['on-signal', 'win-500', 4.5, 'text on win fills'],
  ['paper-50', 'ink-900', 4.5, 'selected segment (ink fill)'],
];

const VARIANTS: Array<{ theme: ThemeName; palette: PaletteName; highContrast: boolean }> = (['daylight', 'lightsOut'] as const).flatMap((theme) => [
  { theme, palette: 'standard' as const, highContrast: false },
  { theme, palette: 'colourblind' as const, highContrast: false },
  { theme, palette: 'standard' as const, highContrast: true },
  { theme, palette: 'colourblind' as const, highContrast: true },
]);

describe('contrast on card stock', () => {
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const v of VARIANTS) {
    it(`meets the minimum ratios: ${v.theme}, ${v.palette}${v.highContrast ? ', high contrast' : ''}`, () => {
      const p = paletteFor(v);
      const fails = PAIRS.filter(([fg, bg, min]) => contrast(p[fg], p[bg]) < min)
        .map(([fg, bg, min, what]) => `${what}: ${fg} on ${bg} = ${contrast(p[fg], p[bg]).toFixed(2)} < ${min}`);
      expect(fails).toEqual([]);
    });
  }
});

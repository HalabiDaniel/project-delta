import { describe, expect, it } from 'vitest';
import { layoutFor, MIN_FIT, REFERENCE } from './layout';
import { TYPE } from './tokens';

/** The plan §7A targets, in CSS pixels. */
const TARGETS = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '21x9': [2560, 1080],
  '21x9-1440': [3440, 1440],
  '16x10': [1920, 1200],
} as const;

describe('resolution scaling (plan v0.0.15 §7)', () => {
  it('keeps the 1080p reference layout and scales in proportion above it', () => {
    expect(layoutFor(1920, 1080).fit).toBe(REFERENCE.fit);
    expect(layoutFor(1920, 1080).overlay).toBe(1);
    expect(layoutFor(2560, 1440).fit).toBeCloseTo(1.867, 2);
    expect(layoutFor(3840, 2160).fit).toBeCloseTo(2.8, 5);
    expect(layoutFor(3840, 2160).overlay).toBe(2);
    expect(layoutFor(2560, 1440).overlay).toBeCloseTo(1.333, 2);
  });

  it('gives every target the same proportions as 1080p (no tiny text at 4K), and 720p stays usable', () => {
    for (const [name, [w, h]] of Object.entries(TARGETS)) {
      const { fit, safeWidth } = layoutFor(w, h, { safeArea: true });
      // Body text on the zones, as a share of the 16:9 area that fits the screen, against the reference.
      const share = (TYPE['t-m'] * fit) / Math.min(h, (safeWidth * 9) / 16);
      const ref = (TYPE['t-m'] * REFERENCE.fit) / REFERENCE.height;
      expect(share / ref, name).toBeGreaterThan(0.95);
      expect(share / ref, name).toBeLessThan(1.42);
      expect(fit * TYPE['t-s'], `${name}: small text in CSS px`).toBeGreaterThanOrEqual(11);
    }
    expect(layoutFor(1280, 720).fit).toBeCloseTo(0.933, 2);
    expect(layoutFor(800, 450).fit).toBe(MIN_FIT);
  });

  it('16:10 follows the width, so nothing clips', () => {
    expect(layoutFor(1920, 1200).fit).toBe(REFERENCE.fit);
    expect(layoutFor(1920, 1200).safeX).toBe(0);
  });

  it('keeps the HUD in a centred 16:9 area on ultrawide with the setting on, and uses the whole width without it', () => {
    expect(layoutFor(2560, 1080, { safeArea: true })).toEqual({ fit: 1.4, overlay: 1, safeX: 320, safeWidth: 1920 });
    expect(layoutFor(2560, 1080, { safeArea: false })).toEqual({ fit: 1.4, overlay: 1, safeX: 0, safeWidth: 2560 });
    const uw = layoutFor(3440, 1440, { safeArea: true });
    expect(uw.safeWidth).toBe(2560);
    expect(uw.safeX).toBe(440);
    expect(uw.fit).toBeCloseTo(1.867, 2);
    // A 16:9 or narrower screen has no bars, setting or not.
    expect(layoutFor(1920, 1080, { safeArea: true }).safeX).toBe(0);
    expect(layoutFor(1920, 1200, { safeArea: true }).safeX).toBe(0);
  });

  it('works in CSS pixels: the device pixel ratio does not change the layout, browser zoom only enlarges', () => {
    // A 4K screen at 200% system scaling has a 1920 x 1080 CSS viewport: the reference layout, drawn sharp.
    expect(layoutFor(1920, 1080)).toEqual(layoutFor(3840 / 2, 2160 / 2));
    // 150% browser zoom on a 1080p screen: a 1280 x 720 CSS viewport; on screen that is 0.933 × 1.5 = 1.4.
    expect(layoutFor(1280, 720).fit * 1.5).toBeCloseTo(REFERENCE.fit, 1);
    expect(layoutFor(0, 0).fit).toBe(MIN_FIT);
  });
});

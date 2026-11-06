import { describe, expect, it } from 'vitest';
import { layoutFor, MIN_FIT, REFERENCE } from './layout';

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

describe('resolution scaling (v0.0.16: the design canvas frame, 1440 × 900)', () => {
  it('is 1 at the design frame and scales in proportion above it', () => {
    expect(REFERENCE).toEqual({ width: 1440, height: 900, fit: 1 });
    expect(layoutFor(1440, 900).fit).toBe(1);
    expect(layoutFor(1920, 1080).fit).toBeCloseTo(1.2, 5);
    expect(layoutFor(2560, 1440).fit).toBeCloseTo(1.6, 5);
    expect(layoutFor(3840, 2160).fit).toBeCloseTo(2.4, 5);
    // Overlays (pause, dialogs, tooltips) keep their 1080p reference.
    expect(layoutFor(1920, 1080).overlay).toBe(1);
    expect(layoutFor(3840, 2160).overlay).toBe(2);
  });

  it('never shrinks the HUD below the design sizes, so 12px stays the smallest text', () => {
    for (const [name, [w, h]] of Object.entries(TARGETS)) {
      const { fit } = layoutFor(w, h, { safeArea: true });
      expect(fit * 12, name).toBeGreaterThanOrEqual(12);
    }
    expect(layoutFor(1280, 720).fit).toBe(MIN_FIT);
    expect(layoutFor(800, 450).fit).toBe(MIN_FIT);
  });

  it('16:10 follows the shorter side, so nothing clips', () => {
    expect(layoutFor(1920, 1200).fit).toBeCloseTo(1.333, 2);
    expect(layoutFor(1920, 1200).safeX).toBe(0);
  });

  it('keeps the HUD in a centred 16:9 area on ultrawide with the setting on, and uses the whole width without it', () => {
    expect(layoutFor(2560, 1080, { safeArea: true })).toEqual({ fit: 1.2, overlay: 1, safeX: 320, safeWidth: 1920 });
    expect(layoutFor(2560, 1080, { safeArea: false })).toEqual({ fit: 1.2, overlay: 1, safeX: 0, safeWidth: 2560 });
    const uw = layoutFor(3440, 1440, { safeArea: true });
    expect(uw.safeWidth).toBe(2560);
    expect(uw.safeX).toBe(440);
    expect(uw.fit).toBeCloseTo(1.6, 2);
    expect(layoutFor(1920, 1080, { safeArea: true }).safeX).toBe(0);
    expect(layoutFor(1920, 1200, { safeArea: true }).safeX).toBe(0);
  });

  it('works in CSS pixels: the device pixel ratio does not change the layout', () => {
    expect(layoutFor(1920, 1080)).toEqual(layoutFor(3840 / 2, 2160 / 2));
    expect(layoutFor(0, 0).fit).toBe(MIN_FIT);
  });
});

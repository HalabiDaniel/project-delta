import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS,
  loadGraphics,
  matchesPreset,
  normalizeGraphics,
  outlineChoice,
  PRESETS,
  saveGraphics,
  withIntensity,
  withOutlines,
  withPreset,
} from './GraphicsSettings';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

describe('graphics settings', () => {
  it('starts on High, which matches its preset', () => {
    expect(DEFAULT_GRAPHICS.preset).toBe('high');
    expect(matchesPreset(DEFAULT_GRAPHICS)).toBe(true);
  });

  it('presets scale shadows, decoration, outline quality and resolution together', () => {
    const low = withPreset(DEFAULT_GRAPHICS, 'low');
    expect(low).toMatchObject({ shadows: 'off', detail: 1, outlineQuality: 'low', resolution: 1 });
    expect(PRESETS.medium.detail).toBeGreaterThan(PRESETS.low.detail);
    expect(PRESETS.high.resolution).toBeGreaterThan(PRESETS.medium.resolution);
  });

  it('keeps the outline intensity when the preset changes', () => {
    const bold = withIntensity(DEFAULT_GRAPHICS, 1.4);
    expect(withPreset(bold, 'low').outlineIntensity).toBe(1.4);
  });

  it('turns outlines off and on without losing the rest of the preset', () => {
    const off = withOutlines(withPreset(DEFAULT_GRAPHICS, 'medium'), 'off');
    expect(outlineChoice(off)).toBe('off');
    expect(off.shadows).toBe('low');
    expect(matchesPreset(off)).toBe(false);
    const back = withOutlines(off, 'medium');
    expect(matchesPreset(back)).toBe(true);
  });

  it('snaps intensity to the offered steps', () => {
    expect(withIntensity(DEFAULT_GRAPHICS, 1.3).outlineIntensity).toBe(1.4);
    expect(withIntensity(DEFAULT_GRAPHICS, -5).outlineIntensity).toBe(0.6);
  });

  it('repairs damaged or unknown stored values', () => {
    expect(normalizeGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    expect(normalizeGraphics('nonsense')).toEqual(DEFAULT_GRAPHICS);
    const fixed = normalizeGraphics({ preset: 'ultra', outlines: 'yes', outlineQuality: 'max', outlineIntensity: NaN, shadows: 2, detail: 9, resolution: 100 });
    expect(fixed).toEqual({ ...DEFAULT_GRAPHICS, resolution: 3 });
    expect(normalizeGraphics({ preset: 'low' })).toEqual(withPreset(DEFAULT_GRAPHICS, 'low'));
  });

  it('saves and loads through storage, and survives blocked or broken storage', () => {
    const store = memory();
    const s = withIntensity(withPreset(DEFAULT_GRAPHICS, 'medium'), 0.6);
    saveGraphics(store, s);
    expect(loadGraphics(store)).toEqual(s);
    store.setItem('paperwars.graphics', '{not json');
    expect(loadGraphics(store)).toEqual(DEFAULT_GRAPHICS);
    expect(loadGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadGraphics(throwing)).toEqual(DEFAULT_GRAPHICS);
    expect(() => saveGraphics(throwing, s)).not.toThrow();
  });
});

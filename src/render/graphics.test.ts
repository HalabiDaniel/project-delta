import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS,
  loadGraphics,
  matchesPreset,
  normalizeGraphics,
  PRESETS,
  saveGraphics,
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
  it('starts on Medium, which matches its preset', () => {
    expect(DEFAULT_GRAPHICS.preset).toBe('medium');
    expect(matchesPreset(DEFAULT_GRAPHICS)).toBe(true);
  });

  it('presets scale shadows, decoration and resolution together', () => {
    const low = withPreset(DEFAULT_GRAPHICS, 'low');
    expect(low).toMatchObject({ shadows: 'off', detail: 1, resolution: 1 });
    expect(PRESETS.medium.detail).toBeGreaterThan(PRESETS.low.detail);
    expect(PRESETS.high.resolution).toBeGreaterThan(PRESETS.medium.resolution);
  });

  it('repairs damaged or unknown stored values', () => {
    expect(normalizeGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    expect(normalizeGraphics('nonsense')).toEqual(DEFAULT_GRAPHICS);
    const fixed = normalizeGraphics({ preset: 'ultra', shadows: 2, detail: 9, resolution: 100 });
    expect(fixed).toEqual({ ...DEFAULT_GRAPHICS, resolution: 3 });
    expect(normalizeGraphics({ preset: 'low' })).toEqual(withPreset(DEFAULT_GRAPHICS, 'low'));
  });

  it('loads settings saved before v0.0.15, ignoring the removed outline fields', () => {
    const store = memory();
    store.setItem('paperwars.graphics.v2', JSON.stringify({ preset: 'high', outlines: true, outlineQuality: 'high', outlineIntensity: 1.4, shadows: 'low', detail: 3, resolution: 2 }));
    expect(loadGraphics(store)).toEqual({ preset: 'high', shadows: 'low', detail: 3, resolution: 2 });
  });

  it('saves and loads through storage, and survives blocked or broken storage', () => {
    const store = memory();
    const s = { ...withPreset(DEFAULT_GRAPHICS, 'high'), detail: 1 as const };
    saveGraphics(store, s);
    expect(loadGraphics(store)).toEqual(s);
    store.setItem('paperwars.graphics.v2', '{not json');
    expect(loadGraphics(store)).toEqual(DEFAULT_GRAPHICS);
    expect(loadGraphics(null)).toEqual(DEFAULT_GRAPHICS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadGraphics(throwing)).toEqual(DEFAULT_GRAPHICS);
    expect(() => saveGraphics(throwing, s)).not.toThrow();
  });
});

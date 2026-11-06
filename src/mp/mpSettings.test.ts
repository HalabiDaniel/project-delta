import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCESS } from '../ui/access';
import { DEFAULT_MP_SETTINGS, hintsShown, loadMpSettings, MP_SETTINGS_KEY, normaliseMpSettings, saveMpSettings } from './MpSettings';

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe('multiplayer settings', () => {
  it('saves and loads the HUD size and hints next to the other paperwars.mp keys', () => {
    const store = memory();
    expect(loadMpSettings(store)).toEqual(DEFAULT_MP_SETTINGS);
    const access = { ...DEFAULT_ACCESS, palette: 'colourblind' as const, textScale: 1.15, highContrast: true, captions: 'on' as const, safeArea: false };
    saveMpSettings({ hints: 'off', uiScale: 1.15, access }, store);
    expect(MP_SETTINGS_KEY.startsWith('paperwars.mp.')).toBe(true);
    expect(JSON.parse(store.data.get(MP_SETTINGS_KEY)!)).toEqual({ hints: 'off', uiScale: 1.15, access });
    expect(loadMpSettings(store)).toEqual({ hints: 'off', uiScale: 1.15, access });
  });

  it('ignores what it does not recognise', () => {
    const store = memory();
    store.setItem(MP_SETTINGS_KEY, '{not json');
    expect(loadMpSettings(store)).toEqual(DEFAULT_MP_SETTINGS);
    expect(normaliseMpSettings({ hints: 'loud', uiScale: 3 })).toEqual(DEFAULT_MP_SETTINGS);
    expect(normaliseMpSettings({ hints: 'on', uiScale: 0.9 })).toEqual({ hints: 'on', uiScale: 0.9, access: DEFAULT_ACCESS });
    // A settings record from before phase 7 gets the default accessibility settings; bad fields fall back one by one.
    expect(normaliseMpSettings({ hints: 'on', uiScale: 1, access: { palette: 'neon', textScale: 1.3, motion: 'reduced', safeArea: 'yes' } }).access)
      .toEqual({ ...DEFAULT_ACCESS, textScale: 1.3, motion: 'reduced' });
    expect(loadMpSettings(null)).toEqual(DEFAULT_MP_SETTINGS);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadMpSettings(broken)).toEqual(DEFAULT_MP_SETTINGS);
    expect(() => saveMpSettings({ hints: 'on', uiScale: 1, access: DEFAULT_ACCESS }, broken)).not.toThrow();
  });

  it('hints: on, off (H still shows them), auto for the first missions', () => {
    expect(hintsShown('on', false, false)).toBe(true);
    expect(hintsShown('off', false, true)).toBe(false);
    expect(hintsShown('off', true, false)).toBe(true);
    expect(hintsShown('auto', false, true)).toBe(true);
    expect(hintsShown('auto', false, false)).toBe(false);
  });
});

describe('mp.css is retired', () => {
  it('no source file imports it, and it is gone', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|css|html)$/.test(name) && !name.endsWith('.test.ts')) files.push(p);
      }
    };
    walk(root);
    const importers = files.filter((f) => /(import|@import)[^\n]*mp\.css/.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
    expect(files.some((f) => f.endsWith('mp.css'))).toBe(false);
  });
});

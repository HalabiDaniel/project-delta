import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringLiterals, userFacing } from './literalScan';
import { buildDictionary, dictionaryKeys, pseudoText, SAY, t, T } from './strings';
import { en } from './locale/en';
import { clock, compass, count, fixed, fmt, km, longClock, metres, minutes, num, paper, pct, percent, seconds, signed, speed, times } from './format';

const SRC = join(__dirname, '..');

/**
 * Files that may keep English of their own (docs/DESIGN_SYSTEM.md §11): developer tools, the
 * dictionary itself, and the scanner.
 */
const SKIP_FILES: Record<string, string> = {
  'ui/DevPanel.ts': 'developer panel (` or ?dev), not player UI',
  'ui/PerfOverlay.ts': 'performance overlay (?perf), developer only',
  'ui/gallery/Gallery.ts': 'design-system gallery (?ui-gallery), developer only; ?pseudo stretches its text in the DOM',
  'ui/locale/en.ts': 'the English dictionary',
  'ui/strings.ts': 'the dictionary machinery',
  'ui/literalScan.ts': 'this scanner',
};

/** Literals that read like words but are not text a player sees, each with why. */
const ALLOW: Array<[file: string, text: RegExp, why: string]> = [
  ['ui/tokens.ts', /, (sans-serif|cursive)$/, 'CSS font stacks'],
  ['mp/MultiplayerGame.ts', /^already claimed$/, "the server's refusal code, compared, never shown"],
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** User-facing literals in one file, minus console and error messages (developer text). */
function literalsIn(file: string): Array<{ line: number; text: string }> {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const rel = relative(SRC, file).replace(/\\/g, '/');
  return stringLiterals(source)
    .filter((l) => !/console\.\w+\(|new Error\(|throw /.test(lines[l.line - 1] ?? ''))
    .flatMap((l) => userFacing(l.text).map((text) => ({ line: l.line, text })))
    .filter((h) => !ALLOW.some(([f, re]) => f === rel && re.test(h.text)));
}

describe('localisation: no literal user-facing text in components', () => {
  const files = [...sources(join(SRC, 'ui')), ...sources(join(SRC, 'mp'))].filter((f) => !(relative(SRC, f).replace(/\\/g, '/') in SKIP_FILES));

  it('scans the component sources', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    it(`${rel} reads every word from the dictionary`, () => {
      const hits = literalsIn(file).map((h) => `${rel}:${h.line} "${h.text.replace(/\u0000/g, '…')}"`);
      expect(hits, 'move these into src/ui/locale/en.ts (or allowlist them in this test, with a reason)').toEqual([]);
    });
  }

  it('finds literal text (the scan is not vacuous)', () => {
    expect(userFacing('<b class="x">Paused</b>')).toEqual(['Paused']);
    expect(userFacing('<span data-tip="Base condition">${x}</span>'.replace('${x}', '\u0000'))).toEqual(['Base condition']);
    expect(userFacing('is raiding your desk')).toEqual(['is raiding your desk']);
    expect(userFacing('Rearm')).toEqual(['Rearm']);
    const found = stringLiterals("const a = `Hello ${name}, welcome`; // 'Not this'\nconst b = 'ui-button primary';").map((l) => userFacing(l.text));
    expect(found).toEqual([['Hello \u0000, welcome'], []]);
  });

  it('leaves code alone: classes, ids, keys, paths, events', () => {
    for (const code of ['ui-button primary', 'keydown', 'KeyB', 'Escape', '../ui/strings', '[data-u="name"]', 'aria-pressed', 'mp-card mp-claim', 'data-nav-default']) {
      expect(userFacing(code), code).toEqual([]);
    }
  });
});

describe('localisation: the dictionary', () => {
  const keys = dictionaryKeys();

  it('has an English value for every key', () => {
    expect(keys.length).toBeGreaterThan(500);
    const blank = keys.filter(([k, v]) => typeof v === 'string' && v.trim() === '' && k !== 'territoryState.peaceful');
    expect(blank).toEqual([]);
    for (const [k, v] of keys) if (typeof v === 'function') expect(typeof call(v), k).toBe('string');
  });

  it('keeps the old views as parts of it', () => {
    expect(SAY).toBe(T.say);
    expect(SAY.launch).toBe(en.say.launch);
    expect(t('say.launch')).toBe('Launch');
    expect(t('menus.missionsCompleted', 2)).toBe('Missions completed (2 failed)');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('lets a locale override any part, falling back to English', () => {
    const d = buildDictionary({ say: { launch: 'Starten' }, report: { repairs: (n: number) => `${n} Reparaturen` } });
    expect(d.say.launch).toBe('Starten');
    expect(d.say.takeOff).toBe('Take off');
    expect(d.report.repairs(3)).toBe('3 Reparaturen');
    // A value of the wrong kind is ignored.
    expect(buildDictionary({ say: { launch: (() => 'x') as unknown as string } }).say.launch).toBe('Launch');
  });
});

describe('localisation: pseudo-localisation', () => {
  const pseudo = buildDictionary(undefined, true);

  it('accents, brackets and lengthens by about 40 %', () => {
    const p = pseudoText('Fold the Swift');
    expect(p).toMatch(/^\[Ƒöļð ţĥé Šŵîƒţ ·+\]$/);
    for (const s of ['Launch', 'Repair everything on the home desk', 'Defense report']) expect(pseudoText(s).length).toBeGreaterThanOrEqual(Math.round(s.length * 1.4));
    expect(pseudoText('')).toBe('');
  });

  it('keeps placeholders, markup, key caps and arguments', () => {
    expect(pseudoText('Fold it ({fold}), then {base} opens your base.')).toContain('({fold})');
    expect(pseudoText('Fold it ({fold}), then {base} opens your base.')).toContain('{base}');
    expect(pseudoText('a <b class="x">b</b> &amp; c')).toContain('<b class="x">');
    expect(pseudoText('a <b class="x">b</b> &amp; c')).toContain('&amp;');
    expect(pseudo.report.inHangar('Swift', '12')).toContain('Swift');
    expect(pseudo.report.inHangar('Swift', '12')).toContain('12');
    expect(pseudo.mpHud.raiding('\u0001')).toContain('\u0001');
    expect(pseudo.base.hit(['Ink turret', 'Radar'])).toContain('Ink turret');
    expect(pseudo.tip.desk).toContain('{fold}');
    expect(pseudo.keys).toEqual(en.keys);
    expect(pseudo.units.km('1.2')).toBe('1.2 km');
  });

  it('reaches every string in the dictionary', () => {
    for (const [k, v] of dictionaryKeys(pseudo)) {
      if (k.startsWith('keys.') || k.startsWith('units.')) continue;
      const text = typeof v === 'function' ? call(v) : v;
      if (text === '') continue;
      expect(text, k).toMatch(/^\[.*·\]$/s);
    }
  });
});

describe('localisation: numbers through format functions', () => {
  it('formats English as before', () => {
    expect(fmt(950)).toBe('950');
    expect(fmt(1234)).toBe('1.2k');
    expect(fmt(12345)).toBe('12k');
    expect(fmt(2000)).toBe('2k');
    expect(fmt(1234567)).toBe('1235k');
    expect(signed(12)).toBe('+12');
    expect(signed(-8)).toBe('−8');
    expect(signed(0)).toBe('0');
    expect(clock(65)).toBe('1:05');
    expect(clock(45, true)).toBe('45s');
    expect(longClock(3720)).toBe('1:02:00');
    expect(longClock(2525)).toBe('42:05');
    expect(pct(0.456)).toBe('46%');
    expect(pct(1.4)).toBe('100%');
    expect(percent(1.15)).toBe('115%');
    expect(metres(850.4)).toBe('850 m');
    expect(metres(1234)).toBe('1.2 km');
    expect(km(1234, 2)).toBe('1.23 km');
    expect(count(12.6)).toBe('13');
    expect(paper(1200)).toBe('1200');
    expect(num(2.345, 1)).toBe('2.3');
    expect(fixed(1.5, 2)).toBe('1.50');
    expect(minutes(12)).toBe('12m');
    expect(seconds(4)).toBe('4 s');
    expect(speed(12.34, 1)).toBe('12.3 m/s');
    expect(times(2.25)).toBe('2.3×');
    expect(compass(1, 0)).toBe('N');
    expect(compass(0, 1)).toBe('E');
    expect(compass(-1, -1)).toBe('SW');
  });

  it('takes the locale for digits and decimal marks', () => {
    expect(fmt(1234, 'de')).toBe('1,2k');
    expect(num(2.5, 1, 'de')).toBe('2,5');
    expect(km(1500, 1, 'fr')).toBe('1,5 km');
    expect(count(1234567, 'de')).toBe('1234567'); // no grouping: tabular numbers stay short
  });
});

/** Calls a dictionary function with sample arguments: text, counts or lists, whichever it takes. */
function call(fn: unknown): string {
  const f = fn as (...a: unknown[]) => string;
  const tries: unknown[][] = [['X', 2, 'X', 2], [2, 'X', 2, 'X'], [2, 2, 2, 2], [['X', 'Y'], ['X', 'Y']], ['X', ['X', 'Y']]];
  for (const args of tries) {
    try {
      return f(...args);
    } catch {
      // the next shape
    }
  }
  throw new Error('no sample arguments fit');
}

import type { SlotKind, TerritoryState } from '../config';
import type { MissionType } from '../missions/Mission';
import type { IconName } from './icons';
import { en } from './locale/en';

/**
 * The interface's words (docs/DESIGN_SYSTEM.md §11): the English base dictionary
 * (src/ui/locale/en.ts), any locale laid over it, and the pseudo-localisation used to test that
 * layouts survive longer text.
 *
 * Components read text from `T` (or one of the views below, `SAY`, `CONFIRM_TEXT`, …, which are
 * parts of it) and never write words of their own; `t('menus.hints')` looks a key up by name.
 *
 * - A locale is a file `src/ui/locale/<code>.ts` whose default export has the shape of `en`, any
 *   part of it (missing keys stay English). It is picked with `?lang=<code>` (or the
 *   `paperwars.lang` entry in localStorage); no code changes.
 * - `?pseudo` accents every string and makes it about 40 % longer, in brackets:
 *   "Fold the Swift" → "[Ƒöļð ţĥé Šŵîƒţ ···]". Arguments, `{control}` names, markup and key caps
 *   (`T.keys`) survive as they are, so hints and glyphs still work.
 */

/** A dictionary entry: text, or a function of its arguments that returns text. */
type Entry = string | ((...args: never[]) => string);

/** The shape of a dictionary: `en` with its literal strings widened to `string`. */
export type Dictionary = Widen<typeof en>;
type Widen<T> = T extends string ? string : T extends (...args: infer A) => string ? (...args: A) => string : { readonly [K in keyof T]: Widen<T[K]> };

/** What a locale file provides: any part of the dictionary. */
export type LocaleDictionary = DeepPartial<Dictionary>;
type DeepPartial<T> = T extends string | ((...args: never[]) => string) ? T : { readonly [K in keyof T]?: DeepPartial<T[K]> };

/**
 * Sections pseudo leaves alone: key caps (matched by the glyph layer, src/input/glyphs.ts) and the
 * units around numbers (so numbers stay readable).
 */
const PSEUDO_SKIP = new Set(['keys', 'units']);

const query = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : new URLSearchParams();

function storedLang(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('paperwars.lang') : null;
  } catch {
    return null;
  }
}

/**
 * Locale files next to en.ts, found at build time. `import.meta.glob` exists only under Vite (the
 * game, the tests); the multiplayer server runs this module under plain Node (through the
 * tutorial's control labels), where it is English only.
 */
const LOCALE_FILES: Record<string, { default: LocaleDictionary }> = import.meta.env
  ? import.meta.glob<{ default: LocaleDictionary }>(['./locale/*.ts', '!./locale/en.ts', '!./locale/*.test.ts'], { eager: true })
  : {};

/** The locale codes there are files for, besides English. */
export const AVAILABLE_LOCALES: string[] = ['en', ...Object.keys(LOCALE_FILES).map((p) => p.replace(/^.*\/(.+)\.ts$/, '$1'))];

const wanted = query.get('lang') ?? storedLang() ?? 'en';
/** The locale in use: 'en' unless a locale file for the asked one exists. Number formats follow it (src/ui/format.ts). */
export const LOCALE: string = AVAILABLE_LOCALES.includes(wanted) ? wanted : 'en';

/** Pseudo-localisation on (`?pseudo`, or `paperwars.pseudo(true)` from the console). */
export const PSEUDO: boolean = query.has('pseudo');

// ---- Pseudo-localisation --------------------------------------------------------------------------------

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** Spans pseudo never changes: `{control}` names, markup, entities. */
const PROTECTED = /\{\w+\}|<[^>]*>|&[#\w]+;/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pseudo-localises one string: accented letters, about 40 % longer (padding dots), in brackets.
 * `keep` are substrings (the entry's arguments) that stay exactly as they are. Empty stays empty.
 */
export function pseudoText(text: string, keep: readonly string[] = []): string {
  if (text === '') return text;
  const parts = keep.filter((k) => k.length > 0).sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp([PROTECTED.source, ...parts].join('|'), 'g');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += accent(text.slice(last, m.index));
    out += m[0];
    last = m.index! + m[0].length;
  }
  out += accent(text.slice(last));
  const pad = Math.max(1, Math.ceil(text.length * 0.4) - 3);
  return `[${out} ${'·'.repeat(pad)}]`;
}

function accent(s: string): string {
  let out = '';
  for (const c of s) out += ACCENTED[c] ?? c;
  return out;
}

/**
 * Pseudo-localises text already in the DOM: for pages whose sample text is not from the
 * dictionary (the developer's gallery, ?ui-gallery). Key caps (`kbd`), icons and numbers stay.
 */
export function pseudoDom(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const wordy = (v: string) => /[A-Za-z]{2,}/.test(v) && !v.trim().startsWith('[');
  for (const n of nodes) {
    if (n.parentElement?.closest('kbd, svg, style, script, code')) continue;
    if (wordy(n.data)) n.data = n.data.replace(/\S.*\S|\S/s, (m) => pseudoText(m));
  }
  for (const el of root.querySelectorAll('[aria-label], [data-tip], [data-tip-text], [title], [placeholder]')) {
    for (const a of ['aria-label', 'data-tip', 'data-tip-text', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && wordy(v)) el.setAttribute(a, pseudoText(v));
    }
  }
}

// ---- Building the dictionary -----------------------------------------------------------------------

function isEntry(v: unknown): v is Entry {
  return typeof v === 'string' || typeof v === 'function';
}

/** English, with `over` laid on top (keys it lacks, or gives with the wrong kind, stay English). */
function merge(base: Record<string, unknown>, over: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    const o = over?.[k];
    if (isEntry(v)) out[k] = typeof o === typeof v ? o : v;
    else out[k] = merge(v as Record<string, unknown>, o && typeof o === 'object' ? (o as Record<string, unknown>) : undefined);
  }
  return out;
}

function pseudoAll(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (PSEUDO_SKIP.has(k)) out[k] = v;
    else if (typeof v === 'string') out[k] = pseudoText(v);
    else if (typeof v === 'function') {
      const fn = v as (...args: unknown[]) => string;
      out[k] = (...args: unknown[]) => pseudoText(fn(...args), args.flat().filter((a) => typeof a === 'string' || typeof a === 'number').map(String));
    } else out[k] = pseudoAll(v as Record<string, unknown>);
  }
  return out;
}

/** The dictionary for a locale (English when there is no file), pseudo-localised on request. */
export function buildDictionary(over?: LocaleDictionary, pseudo = false): Dictionary {
  const merged = merge(en as unknown as Record<string, unknown>, over as Record<string, unknown> | undefined);
  return (pseudo ? pseudoAll(merged) : merged) as unknown as Dictionary;
}

const localeFile = Object.entries(LOCALE_FILES).find(([p]) => p.endsWith(`/${LOCALE}.ts`))?.[1].default;

/** The dictionary in use. */
export const T: Dictionary = buildDictionary(localeFile, PSEUDO);

/** A dictionary entry by its dotted key ("menus.hints"); the key itself when there is none. */
export function t(key: string, ...args: unknown[]): string {
  let v: unknown = T;
  for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
  if (typeof v === 'function') return (v as (...a: unknown[]) => string)(...args);
  return typeof v === 'string' ? v : key;
}

/** Every key with its English entry (tests, and a translator's checklist). */
export function dictionaryKeys(d: object = en, prefix = ''): Array<[string, Entry]> {
  const out: Array<[string, Entry]> = [];
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isEntry(v)) out.push([key, v]);
    else out.push(...dictionaryKeys(v as object, key));
  }
  return out;
}

/** Turns pseudo-localisation on or off (the page reloads with or without `?pseudo`). */
export function setPseudo(on: boolean): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('pseudo', '');
  else url.searchParams.delete('pseudo');
  window.location.href = url.toString();
}

// ---- Views onto the dictionary, for readable call sites -------------------------------------------

/** Every short label the HUD uses, in one place, so wording stays consistent and short. */
export const SAY = T.say;
/** The confirm dialogs for destructive actions (src/ui/confirm.ts). */
export const CONFIRM_TEXT = T.confirm;
/** First-time tips that name controls ("{action}" becomes a glyph, src/ui/Alerts.ts `withKeys`). */
export const TIP_TEXT = T.tip;
/** The accessibility settings in the pause menu (src/ui/access.ts). */
export const ACCESS_TEXT = T.access;
/** Sound captions (src/ui/Captions.ts). */
export const CAPTION_TEXT = T.caption;
/** Where a captioned sound came from, for screen readers. */
export const DIRECTION_TEXT = T.direction;
/** The mini-map's frame. */
export const MAP_TEXT = T.map;
/** Labels added with the developer's style guide. */
export const STYLE_TEXT = T.style;
/** Sound captions, as a group (the region's accessible name). */
export const CAPTIONS_LABEL = T.captionsLabel;
export const MISSION_TYPE_LABELS: Readonly<Record<MissionType, string>> = T.missionType;
export const SLOT_KIND_LABELS: Readonly<Record<SlotKind, string>> = T.slotKind;
export const STATE_LABELS: Readonly<Record<TerritoryState, string>> = T.territoryState;

/** One icon per mission type, for cards and the objective strip. */
export const MISSION_ICONS: Record<MissionType, IconName> = {
  bombing: 'bomb',
  precision: 'bomb',
  recon: 'recon',
  delivery: 'reach',
  return: 'land',
  'multi-bomb': 'bomb',
  rings: 'ring',
  practice: 'practice',
  suppression: 'turret',
  'danger-recon': 'recon',
  fortified: 'supply',
  'multi-stage': 'radar',
  survival: 'survive',
  'low-attack': 'bomb',
  dogfight: 'fighter',
  'scout-intercept': 'scout',
  'bomber-intercept': 'bomber',
  escort: 'escort',
  patrol: 'patrol',
  combined: 'fighter',
  shipment: 'supply',
  convoy: 'bomber',
  'supply-run': 'escort',
  stunt: 'maneuver',
  'time-trial': 'timer',
  discovery: 'map',
};

export const SLOT_KIND_ICONS: Record<SlotKind, IconName> = { defense: 'shield', radar: 'radar', economy: 'paper', utility: 'slot' };

/**
 * A rough scanner for literal user-facing text in component source (docs/DESIGN_SYSTEM.md §11).
 * Used by src/ui/localisation.test.ts: it lexes a TypeScript file well enough to pull out string
 * and template literals (skipping comments and regular expressions), then keeps the ones that
 * read like words a player would see: text between HTML tags, the attributes a tooltip or screen
 * reader reads, and plain strings with a capitalised word or a phrase of several words.
 *
 * A heuristic, not a parser: false positives go on the small allowlist in the test, with a reason.
 */

export interface Literal {
  /** The literal's static text; `${…}` holes are replaced by "\u0000". */
  text: string;
  line: number;
}

/** Every string and template literal in `source`, with its line. */
export function stringLiterals(source: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  /** The last significant character in code, to tell a regular expression from a division. */
  let prev = '';

  const readQuoted = (q: string): string => {
    let s = '';
    i++;
    while (i < n && source[i] !== q) {
      if (source[i] === '\\') {
        s += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (source[i] === '\n') line++;
      s += source[i++];
    }
    i++;
    return s;
  };

  const readRegex = (): void => {
    i++;
    let cls = false;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '\n') return;
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) break;
      i++;
    }
    i++;
    while (i < n && /[a-z]/i.test(source[i])) i++;
  };

  /** Code until the matching `}` (for a template hole) or the end. */
  const readCode = (inHole: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = source[i];
      const d = source[i + 1];
      if (c === '\n') {
        line++;
        i++;
        continue;
      }
      if (c === '/' && d === '/') {
        while (i < n && source[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && d === '*') {
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
          if (source[i] === '\n') line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const at = line;
        out.push({ text: readQuoted(c), line: at });
        prev = 'a';
        continue;
      }
      if (c === '`') {
        readTemplate();
        prev = 'a';
        continue;
      }
      if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\breturn\s*$/.test(source.slice(Math.max(0, i - 8), i)))) {
        readRegex();
        prev = 'a';
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (inHole && depth === 0) {
          i++;
          return;
        }
        depth--;
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  };

  const readTemplate = (): void => {
    const at = line;
    let s = '';
    i++;
    while (i < n && source[i] !== '`') {
      const c = source[i];
      if (c === '\\') {
        s += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '$' && source[i + 1] === '{') {
        i += 2;
        s += '\u0000';
        const keep = prev;
        prev = '';
        readCode(true);
        prev = keep;
        continue;
      }
      if (c === '\n') line++;
      s += c;
      i++;
    }
    i++;
    out.push({ text: s, line: at });
  };

  readCode(false);
  return out;
}

/** Attributes a player reads or hears. */
const READ_ATTRS = ['aria-label', 'title', 'data-tip', 'placeholder', 'alt', 'aria-valuetext', 'aria-roledescription'];

/** Words that are code, not text: keyboard key names and the like (compared, never shown). */
const CODE_WORDS = /^(Key[A-Z]|Digit\d|Numpad\w+|Arrow(Up|Down|Left|Right)|Enter|Escape|Esc|Tab|Shift(Left|Right)?|Space|Backspace|Delete|Control(Left|Right)?|Alt(Left|Right)?|Meta(Left|Right)?|F\d{1,2}|NaN|Infinity|POST|GET|Content-Type|application\/json|Ctrl\+Enter|Arrow)$/;

/** Does this bit of text (no markup) read as words? */
function isWords(raw: string): boolean {
  const t = raw.replace(/\u0000/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (CODE_WORDS.test(t)) return false;
  if (/^\.{1,2}\//.test(t)) return false; // an import path
  // Identifiers, CSS classes and selectors, ids, URLs, paths, units: no spaces, lower case or kebab.
  if (/^[a-z0-9_\-.:#[\]=*>+~(),%/?&@!]+$/.test(t) && !/^[a-z]{3,}$/.test(t.replace(/\W/g, '')) ) return false;
  if (/^[a-z0-9_\-.:#[\]=*>+~(),%/?&@]+$/.test(t)) return false; // a single lower-case word is a key, a class or an event
  if (/^[a-zA-Z_$][\w$]*$/.test(t) && /[a-z][A-Z]/.test(t)) return false; // camelCase identifier
  // A class list or selector list: several lower-case kebab tokens.
  if (/^[a-z0-9_\-.#[\]="':*>+~()\s,]+$/.test(t)) {
    const tokens = t.split(/\s+/);
    if (tokens.filter((w) => /[-_#.[\]=]/.test(w)).length * 2 >= tokens.length && !/[a-z]'[a-z]|[a-z]\.$/.test(t)) return false;
  }
  // A capitalised word, or a phrase of words.
  return /\b[A-Z][a-z]+/.test(t) || /[a-z]{2,}\s+[a-z]{2,}/.test(t) || /[^\x00-\x7f]/.test(t.replace(/[·–—…→←↑↓×−●○✓✕★☆•]/g, '')) ;
}

/** User-facing text in one literal: text between tags, read attributes, or the plain string. */
export function userFacing(literal: string): string[] {
  const found: string[] = [];
  if (/<[a-z][\w-]*[\s>/]|<\/[a-z]/i.test(literal)) {
    const tagRe = /<\/?[a-z][\w-]*((?:\s+[\w:-]+(?:="[^"]*"|='[^']*')?|\s*\u0000)*)\s*\/?>/gi;
    for (const m of literal.matchAll(tagRe)) {
      for (const a of m[1].matchAll(/([\w:-]+)=("([^"]*)"|'([^']*)')/g)) {
        const v = a[3] ?? a[4] ?? '';
        if (READ_ATTRS.includes(a[1].toLowerCase()) && /[A-Za-z]{2,}/.test(v.replace(/\u0000/g, ''))) found.push(v.trim());
      }
    }
    for (const part of literal.replace(tagRe, '\u0001').split('\u0001')) if (isWords(part)) found.push(part.trim());
    return found;
  }
  return isWords(literal) ? [literal.trim()] : [];
}

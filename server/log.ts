/**
 * Structured logs (v0.0.13): one JSON line per event, with the time, the level, the event's name,
 * the session and the player when there are any, and whatever else describes it. Ready for the
 * host's log viewer (v0.0.14):
 *
 *   {"t":"2026-11-05T14:02:11.204Z","level":"info","event":"place","session":"c3plz6qcV","player":"m5hiv6vj","desk":"T14","base":"new"}
 *
 * LOG_FORMAT=text prints the same as a readable line instead (development).
 *
 * Errors repeating (v0.0.14): the same error event with the same message is written once; repeats
 * within the next minute are counted, and one line says how many there were
 * (`"repeated": 41, "over": 60`), so a failing database doesn't bury everything else in the log.
 */
export type Level = 'info' | 'warn' | 'error';

export interface LogFields {
  session?: string;
  player?: string;
  [key: string]: unknown;
}

const text = process.env.LOG_FORMAT === 'text';
/** Tests set this to capture lines. */
export let sink: ((line: string, level: Level) => void) | null = null;

export function setLogSink(next: ((line: string, level: Level) => void) | null): void {
  sink = next;
}

/** Errors seen lately: key → when the first was written, how many repeats since, the last fields. */
const recent = new Map<string, { at: number; repeats: number; fields: LogFields }>();
let repeatWindow = 60_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Tests: a shorter window. */
export function setRepeatWindow(ms: number): void {
  repeatWindow = ms;
}

/** Writes the count of every repeated error whose window is over (all of them with `all`). */
export function flushRepeats(all = false, now: number = Date.now()): void {
  for (const [key, r] of recent) {
    if (!all && now - r.at < repeatWindow) continue;
    recent.delete(key);
    if (r.repeats > 0) write('error', key.split('|')[0], { ...r.fields, repeated: r.repeats, over: Math.round((now - r.at) / 1000) });
  }
}

export function log(level: Level, event: string, fields: LogFields = {}): void {
  if (level === 'error') {
    const message = Object.values(fields).find((v) => v instanceof Error)?.toString() ?? String(fields.error ?? '');
    const key = `${event}|${message}`;
    const now = Date.now();
    const r = recent.get(key);
    if (r && now - r.at < repeatWindow) {
      r.repeats++;
      r.fields = fields;
      return;
    }
    if (r) flushRepeats(false, now);
    recent.set(key, { at: now, repeats: 0, fields });
    if (!flushTimer && !sink) {
      flushTimer = setInterval(() => flushRepeats(), 15_000);
      flushTimer.unref?.();
    }
  }
  write(level, event, fields);
}

function write(level: Level, event: string, fields: LogFields): void {
  const out: Record<string, unknown> = { t: new Date().toISOString(), level, event };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = v instanceof Error ? v.message : v;
  }
  const line = text
    ? `${out.t} ${level.toUpperCase()} ${event}${fields.session ? ` [${fields.session}]` : ''}${fields.player ? ` ${fields.player}` : ''} ${Object.entries(out).filter(([k]) => !['t', 'level', 'event', 'session', 'player'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}`
    : JSON.stringify(out);
  if (sink) return sink(line, level);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

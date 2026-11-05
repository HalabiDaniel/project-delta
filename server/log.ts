/**
 * Structured logs (v0.0.13): one JSON line per event, with the time, the level, the event's name,
 * the session and the player when there are any, and whatever else describes it. Ready for the
 * host's log viewer (v0.0.14):
 *
 *   {"t":"2026-11-05T14:02:11.204Z","level":"info","event":"place","session":"c3plz6qcV","player":"m5hiv6vj","desk":"T14","base":"new"}
 *
 * LOG_FORMAT=text prints the same as a readable line instead (development).
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

export function log(level: Level, event: string, fields: LogFields = {}): void {
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

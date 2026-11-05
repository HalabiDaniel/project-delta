import type { FeedbackRecord } from './store/Store';

/** The playtest feedback log (v0.0.14), exported by `npm run admin -- feedback export`. */

const CATEGORY_NAMES: Record<string, string> = {
  bug: 'Bug',
  frustration: 'Gameplay frustration',
  interface: 'Confusing interface',
  performance: 'Performance problem',
  balance: 'Balance concern',
  missing: 'Missing feature',
  enjoyment: 'General enjoyment',
};

/** The feedback log as CSV (one row per entry) or Markdown (grouped by category). */
export function exportFeedback(rows: FeedbackRecord[], format: 'csv' | 'md'): string {
  const c = (f: FeedbackRecord, k: string) => {
    const v = f.context[k];
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  if (format === 'csv') {
    const cell = (v: unknown) => {
      const t = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['id', 'created_at', 'player', 'category', 'rating', 'text', 'repro', 'version', 'session', 'desk', 'mode', 'aircraft', 'position', 'ping_ms', 'fps', 'browser', 'device', 'context'];
    const lines = rows.map((f) =>
      [f.id, f.createdAt.toISOString(), f.playerName ?? f.playerId ?? '', f.category, f.rating ?? '', f.body, f.repro ?? '', c(f, 'version'), c(f, 'session'), c(f, 'desk'), c(f, 'mode'), c(f, 'aircraft'), c(f, 'position'), c(f, 'ping') || c(f, 'serverPing'), c(f, 'fps'), c(f, 'browser'), c(f, 'device'), JSON.stringify(f.context)].map(cell).join(','),
    );
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
  }
  const out: string[] = [`# Playtest feedback`, '', `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}, exported ${new Date().toISOString()}.`, ''];
  const ratings = rows.map((f) => f.rating).filter((r): r is number => r !== null);
  if (ratings.length > 0) out.push(`Average enjoyment: ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)} / 5 (${ratings.length} rated).`, '');
  for (const [key, name] of Object.entries(CATEGORY_NAMES)) {
    const group = rows.filter((f) => f.category === key);
    if (group.length === 0) continue;
    out.push(`## ${name} (${group.length})`, '');
    for (const f of group) {
      out.push(`### #${f.id}, ${f.playerName ?? 'unknown player'}, ${f.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${f.rating ? `, enjoyment ${f.rating}/5` : ''}`, '');
      out.push(...f.body.split('\n').map((l) => `> ${l}`), '');
      if (f.repro) out.push('**Steps to reproduce:**', '', ...f.repro.split('\n').map((l) => `    ${l}`), '');
      const facts = [
        ['Version', c(f, 'version')],
        ['Session', c(f, 'sessionTitle') ? `${c(f, 'sessionTitle')} (${c(f, 'session')})` : c(f, 'session')],
        ['Desk', c(f, 'desk')],
        ['Mode', c(f, 'mode')],
        ['Aircraft', c(f, 'aircraft')],
        ['Position', c(f, 'position')],
        ['Ping', c(f, 'ping') || c(f, 'serverPing') ? `${c(f, 'ping') || c(f, 'serverPing')} ms` : ''],
        ['Frame rate', c(f, 'fps') ? `${c(f, 'fps')} fps` : ''],
        ['Graphics', c(f, 'graphics')],
        ['Browser', c(f, 'browser')],
        ['Device', c(f, 'device')],
      ].filter(([, v]) => v);
      out.push(`<sub>${facts.map(([k, v]) => `${k}: ${v}`).join(' · ')}</sub>`, '');
    }
  }
  return out.join('\n');
}

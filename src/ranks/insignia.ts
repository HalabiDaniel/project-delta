import type { InsigniaView } from '../mp/MpHud';
import { stepAt, type RankStep } from './Ranks';

/**
 * v0.0.17: the developer's insignia art, as small copies (assets/ranks/web, tools/rank-art.py), bundled by Vite. Client-only: the server
 * never imports this file (it knows ranks by number, Ranks.ts).
 */
const FILES = import.meta.glob('../../assets/ranks/web/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const URLS = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) URLS.set(path.slice(path.lastIndexOf('/') + 1, -'.png'.length), url);

/** The insignia image's URL for a step ("" if the art is missing, which a test rules out). */
export function insigniaUrl(step: RankStep): string {
  return URLS.get(step.insignia) ?? '';
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The insignia as an <img>, with its stars for the Honor Roll. */
export function insigniaHtml(step: RankStep, className = 'rank-insignia'): string {
  const stars = step.stars > 0 ? `<span class="rank-stars" aria-hidden="true">★${step.stars}</span>` : '';
  return `<img class="${className}" src="${esc(insigniaUrl(step))}" alt="" draggable="false" decoding="async">${stars}`;
}

/** What the HUD's insignia slot takes (MpHud.insigniaSlot). */
export function insigniaView(step: RankStep | number | null | undefined): InsigniaView | null {
  if (step === null || step === undefined) return null;
  const s = typeof step === 'number' ? stepAt(step) : step;
  return { id: s.rank, label: s.label, html: insigniaHtml(s) };
}

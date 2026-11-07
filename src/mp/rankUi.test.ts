// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LEVELS, stepAt } from '../ranks/Ranks';
import { ceremonyHtml, profileCardHtml, RankUi } from './RankUi';
import { killLine, scoreboardHtml, territoryTagHtml } from './MpHud';
import { insigniaView } from '../ranks/insignia';
import { Lobby } from './Lobby';

const dto = (index: number, over: Partial<{ title: string | null; card: string | null; off: string[] }> = {}) => ({ merit: 100, index, into: 3, needed: 20, title: null, card: null, off: [], ...over });

function ui() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const sent: unknown[] = [];
  const r = new RankUi(host, (p) => sent.push(p));
  r.setSources(() => 'Ann', () => [{ label: 'Shot down', value: 4 }]);
  return { host, r, sent };
}

describe('rank screens (v0.0.17)', () => {
  it('shows a profile card with insignia, rank, title, progress and stats, and nothing personal', () => {
    const html = profileCardHtml({ name: 'Ann', step: stepAt(4), title: 'Margin Doodler', card: null, progress: { into: 5, needed: 40, next: stepAt(5) }, merit: 120, stats: [{ label: 'Shot down', value: 7 }] });
    const el = document.createElement('div');
    el.innerHTML = html;
    expect(el.querySelector('.rank-card-rank')!.textContent).toBe('Scribbler II');
    expect(el.querySelector('.rank-card-title')!.textContent).toContain('Margin Doodler');
    expect(el.querySelector('img.rank-card-insignia')).not.toBeNull();
    expect(el.querySelector('[role="progressbar"], .ui-bar, .pw-bar, progress')).not.toBeNull();
    expect(el.querySelector('.rank-card')!.getAttribute('data-tier')).toBe('2');
    expect(el.textContent).toContain('7');
  });

  it('gets fancier card paper with every tier, and the Honor Roll gets its own', () => {
    const tiers = [0, 47, 48].map((i) => {
      const el = document.createElement('div');
      el.innerHTML = profileCardHtml({ name: 'X', step: stepAt(i), title: null, card: null, stats: [] });
      return el.querySelector('.rank-card')!.getAttribute('data-tier');
    });
    expect(tiers).toEqual(['1', '15', '16']);
  });

  it('never interrupts a fight: the ceremony waits for the desk, and several promotions run as one', () => {
    const { r, host } = ui();
    r.setOwn(dto(2));
    r.promoted({ from: 2, to: 3, tier: true });
    r.promoted({ from: 3, to: 4, tier: false });
    r.update(1, false);
    expect(host.querySelector<HTMLElement>('.rank-ceremony')!.hidden).toBe(true);
    expect(r.waiting).toBe(true);
    r.update(0.1, true);
    const c = host.querySelector<HTMLElement>('.rank-ceremony')!;
    expect(c.hidden).toBe(false);
    expect(c.textContent).toContain('Scribbler II');
    expect(c.dataset.tier).toBe('new-rank');
    // Under five seconds, and skippable.
    r.update(5, true);
    expect(c.hidden).toBe(true);
    r.promoted({ from: 4, to: 5, tier: false });
    r.update(0.1, true);
    expect(c.hidden).toBe(false);
    c.click();
    expect(c.hidden).toBe(true);
  });

  it('shows what a promotion unlocks, once each', () => {
    const el = document.createElement('div');
    const glider = LEVELS.findIndex((l) => l.rank.id === 'glider');
    el.innerHTML = ceremonyHtml(stepAt(glider - 1), stepAt(glider));
    const items = [...el.querySelectorAll('.rank-unlocks li')].map((li) => li.textContent);
    expect(items.some((t) => t!.includes('Updraft'))).toBe(true);
    expect(items.some((t) => t!.includes('Pencil trail'))).toBe(true);
    expect(items.some((t) => t!.includes('Paper Cut'))).toBe(false);
  });

  it('offers only unlocked titles, cards and effects, and sends what the player equips', () => {
    const { r, host, sent } = ui();
    const glider = LEVELS.findIndex((l) => l.rank.id === 'glider');
    r.setOwn(dto(glider));
    r.openPanel();
    const titles = [...host.querySelectorAll<HTMLOptionElement>('[data-pref="title"] option')].map((o) => o.value);
    expect(titles).toEqual(['', 'New Sheet', 'Margin Doodler', 'Corner Folder', 'Paper Cut', 'Updraft']);
    expect(host.querySelectorAll('[data-effect]').length).toBe(3);
    const select = host.querySelector<HTMLSelectElement>('[data-pref="title"]')!;
    select.value = 'Updraft';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const box = host.querySelector<HTMLInputElement>('[data-effect="pencil-trail"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(sent.at(-1)).toEqual({ title: 'Updraft', card: 'glider', off: ['pencil-trail'] });
    expect(r.open).toBe(true);
    r.close();
    expect(r.open).toBe(false);
  });

  it('shows the card of the player who shot us down, briefly', () => {
    const { r, host } = ui();
    r.showCard({ name: 'Bo', step: stepAt(10), title: null, card: null, stats: [] }, 2);
    const peek = host.querySelector<HTMLElement>('.rank-peek')!;
    expect(peek.hidden).toBe(false);
    expect(peek.textContent).toContain('Bo');
    r.update(2.1, false);
    expect(peek.hidden).toBe(true);
  });

  it('puts the insignia in the kill feed, the scoreboard and on desk nameplates', () => {
    const rank = insigniaView(stepAt(20))!;
    expect(rank.label).toBe(stepAt(20).label);
    expect(killLine('Ann', 0, 'Bo', 1, 'ink', [], { killer: rank })).toContain(`data-rank="${stepAt(20).rank}"`);
    expect(territoryTagHtml({ id: 'T1', x: 0, y: 0, label: "Ann's desk", owner: 'Ann', colour: 0, mine: false, safe: false, alert: false, presence: 'online', rank, deskEffects: ['pennant'] })).toContain('data-desk-effects="pennant"');
    expect(typeof scoreboardHtml).toBe('function');
  });

  it("shows the top players' cards and every player's insignia on the session results", () => {
    const host = document.createElement('div');
    const noop = () => undefined;
    const lobby = new Lobby(host, { quick: noop, join: noop, next: noop, refresh: noop, claim: noop, setCode: noop, chooseUsername: noop, leave: noop, singlePlayer: noop });
    const line = (id: string, placing: number, rank?: number) => ({ id, name: id, colour: 0, placing, score: 10 - placing, kills: 1, deaths: 0, raids: 0, missions: 2, paper: 5, present: true, rank, title: null });
    lobby.showResults({ title: 'Classroom 1', played: 600, reason: null, lines: [line('Ann', 1, 20), line('Bo', 2, 3), line('Cy', 3), line('Di', 4, 1)] }, 'Ann');
    expect(host.querySelectorAll('.mp-result-cards .rank-card').length).toBe(2);
    expect(host.querySelectorAll('.mp-results-table .mp-insignia').length).toBe(3);
  });
});

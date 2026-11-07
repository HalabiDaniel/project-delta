// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incomingHtml, MpHud, scoreboardHtml, type MpHudView, type PlayersPanelView, type ScoreRow } from './MpHud';

/** v0.0.19: the players panel, the challenge card and the scoreboard's social chips. */
function view(extra: Partial<MpHudView> = {}): MpHudView {
  return {
    status: 'connected', ping: 42, players: 3, maxPlayers: 16, room: 'Room 4', tags: [], territories: [], scoreboard: null, incoming: null, outgoing: null,
    protection: null, emoteKeys: false, sessionLeft: 1800, closing: false, ...extra,
  };
}

function zones() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const z = () => root.appendChild(document.createElement('div'));
  return { root, zones: { tl: z(), tc: z(), tr: z(), centre: z() } };
}

const panel: PlayersPanelView = {
  welcome: 'allies',
  reporting: 'bo',
  inAlliance: true,
  rows: [
    { id: 'bo', name: 'Bo', colour: 1, rep: 'raider', nemesis: true, wins: 1, losses: 3, alliance: 'asked', muted: false, reported: false },
    { id: 'cy', name: 'Cy', colour: 2, rep: null, nemesis: false, wins: 0, losses: 0, alliance: 'ally', muted: true, reported: true },
  ],
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the players panel', () => {
  it('offers alliance answers, mute, report reasons and who may escort your bombers, and sends each action', () => {
    const actions = { emote: vi.fn(), intercept: vi.fn(), ally: vi.fn(), mute: vi.fn(), report: vi.fn(), reporting: vi.fn(), welcome: vi.fn(), closePlayers: vi.fn() };
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, actions);
    hud.render(view({ playersPanel: panel }));
    const card = z.centre.querySelector<HTMLElement>('.mp-players')!;
    expect(card.hidden).toBe(false);
    const click = (sel: string) => card.querySelector<HTMLElement>(sel)!.click();
    click('[data-act="ally-accept"][data-id="bo"]');
    expect(actions.ally).toHaveBeenCalledWith('accept', 'bo');
    click('[data-act="mute"][data-id="bo"]');
    expect(actions.mute).toHaveBeenCalledWith('bo', true);
    click('[data-act="mute"][data-id="cy"]');
    expect(actions.mute).toHaveBeenCalledWith('cy', false);
    // Bo's report reasons are open: six categories, no free text.
    const reasons = card.querySelectorAll('[data-act="report"][data-id="bo"]');
    expect(reasons).toHaveLength(6);
    expect(card.querySelector('textarea, input[type="text"]')).toBeNull();
    (reasons[1] as HTMLElement).click();
    expect(actions.report).toHaveBeenCalledWith('bo', 'harassment');
    click('[data-act="welcome"][data-w="anyone"]');
    expect(actions.welcome).toHaveBeenCalledWith('anyone');
    click('[data-act="ally-leave"]');
    expect(actions.ally).toHaveBeenCalledWith('leave');
    // Cy, already reported, has no report button; the nemesis and reputation show.
    expect(card.querySelector('[data-act="report-open"][data-id="cy"]')).toBeNull();
    expect(card.textContent).toContain('Nemesis');
    expect(card.textContent).toContain('Raider');
    hud.render(view({ playersPanel: null }));
    expect(card.hidden).toBe(true);
  });
});

describe('the challenge card and the scoreboard', () => {
  it('a challenge offers Take off and Decline; a raid with escorts says how many', () => {
    const base = { attacker: 'Bo', colour: 1, detected: true, distance: 80, eta: 12, direction: 'N', ready: 1, total: 2, reward: 35, response: { key: 'F', label: 'Answer' } };
    const challenge = document.createElement('div');
    challenge.innerHTML = incomingHtml({ ...base, kind: 'challenge' });
    expect(challenge.querySelector('[data-act="decline"]')).not.toBeNull();
    expect(challenge.textContent).toContain('challenged you');
    const raid = document.createElement('div');
    raid.innerHTML = incomingHtml({ ...base, kind: 'bombing', escorts: 2 });
    expect(raid.querySelector('[data-act="decline"]')).toBeNull();
    expect(raid.textContent).toContain('2 escorts');
  });

  it('marks allies, your nemesis and reputations on the scoreboard', () => {
    const r = (id: string, extra: Partial<ScoreRow>): ScoreRow => ({
      id, name: id, colour: 1, territory: 'T3', score: 1, kills: 0, deaths: 0, assists: 0, raids: 0, defends: 0, missions: 0, ping: 40, connected: true, me: false,
      status: 'Flying', protect: 0, shield: 0, presence: 'online', ...extra,
    });
    const el = document.createElement('div');
    el.innerHTML = scoreboardHtml([r('a', { allied: true, ally: 1 }), r('b', { nemesis: { wins: 1, losses: 2 }, rep: 'ace' })]);
    expect(el.querySelector('tr[data-id="a"]')!.textContent).toContain('Ally');
    expect(el.querySelector('tr[data-id="b"]')!.textContent).toContain('Nemesis');
    expect(el.querySelector('tr[data-id="b"]')!.textContent).toContain('Ace');
  });
});

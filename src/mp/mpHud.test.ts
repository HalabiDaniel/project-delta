// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionState, EMOTES, incomingHtml, killLine, MpHud, scoreboardHtml, territoryTagHtml, type MpHudView, type ScoreRow } from './MpHud';
import { presenceOf, PRESENCES, PRESENCE_LABELS, type Presence } from './presence';

function row(id: string, presence: Presence, extra: Partial<ScoreRow> = {}): ScoreRow {
  return {
    id, name: `P-${id}`, colour: 1, territory: 'T3', score: 120, kills: 3, deaths: 1, assists: 2, raids: 1, defends: 0, missions: 4,
    ping: 40, connected: presence !== 'away' && presence !== 'offline', me: false, status: 'Flying', protect: presence === 'protected' ? 90 : 0, shield: 0, presence, ...extra,
  };
}

function view(extra: Partial<MpHudView> = {}): MpHudView {
  return {
    status: 'connected', ping: 42, players: 2, maxPlayers: 8, room: 'Room 4', tags: [], territories: [], scoreboard: null, incoming: null, outgoing: null,
    protection: null, emoteKeys: false, sessionLeft: 1800, closing: false, ...extra,
  };
}

function zones() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const z = (n: string) => {
    const el = document.createElement('div');
    el.className = `zone zone-${n}`;
    root.appendChild(el);
    return el;
  };
  return { root, zones: { tl: z('tl'), tc: z('tc'), tr: z('tr'), centre: z('centre') } };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('presence', () => {
  it('derives online, away, offline and protected from what the server sends', () => {
    expect(presenceOf({ present: true, connected: true, protect: 0, shield: 0, desk: 'player' })).toBe('online');
    expect(presenceOf({ present: true, connected: false, protect: 0, shield: 0, desk: 'draining' })).toBe('away');
    expect(presenceOf({ present: false, connected: false, protect: 0, shield: 0 })).toBe('offline');
    expect(presenceOf({ present: true, connected: false, protect: 0, shield: 0, desk: 'empty' })).toBe('offline');
    expect(presenceOf({ present: true, connected: true, protect: 30, shield: 0 })).toBe('protected');
    expect(presenceOf({ present: true, connected: true, protect: 0, shield: 12 })).toBe('protected');
  });
});

describe('scoreboard', () => {
  it('shows every column and a presence chip (icon and word) for each state', () => {
    const host = document.createElement('div');
    host.innerHTML = scoreboardHtml(PRESENCES.map((p, i) => row(String(i), p, { me: i === 0 })));
    const rows = [...host.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(4);
    PRESENCES.forEach((p, i) => {
      const r = rows[i] as HTMLElement;
      expect(r.dataset.presence).toBe(p);
      const c = r.querySelector<HTMLElement>(`.ui-chip[data-presence="${p}"]`)!;
      expect(c.textContent).toContain(PRESENCE_LABELS[p]);
      // Never colour alone: the chip carries an icon and a tone.
      expect(c.querySelector('svg')).not.toBeNull();
      expect(c.dataset.tip).toBeTruthy();
    });
    expect(rows[0].hasAttribute('data-me')).toBe(true);
    expect(rows[0].textContent).toContain('You');
    // Away and offline players show no ping; protected shows the time left.
    expect(rows[1].querySelector('.mp-ping')!.textContent).toBe('—');
    expect(rows[3].querySelector('[data-presence="protected"]')!.textContent).toContain('1:30');
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.getAttribute('aria-label'));
    expect(headers).toEqual(['Pilot', 'Desk', 'Score', 'Shot down', 'Assists', 'Times shot down', 'Raids that got through', 'Raiders stopped', 'Missions done', 'Doing now', 'Presence', 'Ping (ms)']);
    // The player's tape colour comes with a shape (a plane).
    expect(rows[0].querySelector<HTMLElement>('.mp-pilot')!.style.getPropertyValue('--owner')).toMatch(/^rgb\(/);
    expect(rows[0].querySelector('.mp-pilot .mp-swatch')).not.toBeNull();
  });

  it('escapes names', () => {
    const host = document.createElement('div');
    host.innerHTML = scoreboardHtml([row('x', 'online', { name: '<img src=x>' })]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x>');
  });

  it('shows while held and hides again', () => {
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, { emote: () => undefined, intercept: () => undefined });
    const board = z.centre.querySelector<HTMLElement>('.mp-board')!;
    expect(board.hidden).toBe(true);
    hud.render(view({ scoreboard: [row('a', 'online'), row('b', 'away')] }));
    expect(board.hidden).toBe(false);
    expect(board.querySelector('[role="group"]')!.getAttribute('aria-labelledby')).toBeNull();
    expect(board.querySelectorAll('tbody tr')).toHaveLength(2);
    hud.render(view());
    expect(board.hidden).toBe(true);
  });
});

describe('kill feed', () => {
  it('is icon-led: killer as a plane, the weapon, the victim crumpled, each in their colour', () => {
    const host = document.createElement('div');
    host.innerHTML = killLine('Ann', 0, 'Bob', 3, 'rocket', ['Cy']);
    const who = host.querySelectorAll<HTMLElement>('.mp-who');
    expect(who).toHaveLength(2);
    expect(who[0].textContent).toBe('Ann');
    expect(who[1].textContent).toBe('Bob');
    expect(who[0].style.getPropertyValue('--owner')).not.toBe(who[1].style.getPropertyValue('--owner'));
    expect(host.querySelector('.mp-weapon')!.getAttribute('aria-label')).toBe('Rocket');
    expect(host.querySelector('.mp-assist')!.textContent).toBe('+Cy');
  });

  it('an AI victim has no tape colour; a crash has no killer', () => {
    const host = document.createElement('div');
    host.innerHTML = killLine(null, null, 'Falcon', null, 'crash', []);
    expect(host.querySelectorAll('.mp-who')).toHaveLength(1);
    expect(host.querySelector('.mp-who')!.hasAttribute('data-ai')).toBe(true);
    expect(host.querySelector('.mp-weapon')!.getAttribute('aria-label')).toBe('Crashed');
  });

  it('marks our own lines, keeps five, and fades them', () => {
    vi.useFakeTimers();
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, { emote: () => undefined, intercept: () => undefined });
    // Top right, under the chips (the developer's style guide, 2026-11-06).
    const feed = z.tr.querySelector<HTMLElement>('.mp-feed')!;
    expect(z.tr.firstElementChild!.classList.contains('mp-net')).toBe(true);
    expect(z.tr.lastElementChild).toBe(feed);
    hud.kill('Me', 0, 'Bob', 2, 'ink', [], 'killer');
    hud.kill('Bob', 2, 'Me', 0, 'ink', [], 'victim');
    hud.news('Ann joined', 'info');
    expect((feed.children[0] as HTMLElement).dataset.self).toBe('killer');
    expect((feed.children[1] as HTMLElement).dataset.self).toBe('victim');
    expect((feed.children[2] as HTMLElement).dataset.kind).toBe('news');
    for (let i = 0; i < 6; i++) hud.kill('A', 1, 'B', 2, 'bomb', [], null);
    expect(feed.children).toHaveLength(5);
    vi.advanceTimersByTime(6100);
    expect(feed.querySelectorAll('.fade').length).toBe(5);
    vi.advanceTimersByTime(1000);
    expect(feed.children).toHaveLength(0);
  });
});

describe('connection, raid card, desk tags, emotes', () => {
  it('the connection line says its state in words and icons; reconnecting is a standard alert', () => {
    expect(connectionState('connected', 40).label).toBe('Online');
    expect(connectionState('connected', 300).label).toBe('Slow');
    expect(connectionState('lost', 0).tone).toBe('hostile');
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, { emote: () => undefined, intercept: () => undefined });
    hud.render(view({ sessionLeft: 45, closing: true }));
    expect(z.tr.querySelector('.ui-chip[data-status="connected"]')!.textContent).toContain('Online');
    expect(z.tr.querySelector('.mp-session')!.getAttribute('data-state')).toBe('critical');
    expect(z.tc.querySelector<HTMLElement>('.mp-connection')!.hidden).toBe(true);
    hud.render(view({ status: 'reconnecting' }));
    const alert = z.tc.querySelector('.mp-connection .ui-alert')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('Connection lost');
  });

  it('the raid card names the attacker and offers one press', () => {
    const intercept = vi.fn();
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, { emote: () => undefined, intercept });
    hud.render(view({ incoming: { attacker: 'Rex', colour: 4, detected: true, distance: 120, eta: 9.2, direction: 'NE', ready: 1, total: 2, reward: 30, response: { key: 'F', label: 'Intercept' } } }));
    const raid = z.tc.querySelector<HTMLElement>('.mp-raid')!;
    expect(raid.hidden).toBe(false);
    expect(raid.textContent).toContain('Rex');
    expect(raid.textContent).toContain('10s');
    const go = raid.querySelector<HTMLButtonElement>('[data-act="intercept"]')!;
    expect(go.querySelector('kbd')!.textContent).toBe('F');
    go.click();
    expect(intercept).toHaveBeenCalledTimes(1);
    const hidden = document.createElement('div');
    hidden.innerHTML = incomingHtml({ attacker: 'Rex', colour: 4, detected: false, distance: null, eta: null, direction: null, ready: 0, total: 0, reward: 30, response: null });
    expect(hidden.textContent).toContain('Not on radar yet');
    expect(hidden.querySelector('[data-act="intercept"]')).toBeNull();
  });

  it('a desk tag reads "{username}\'s desk" with presence as icon and word', () => {
    const base = { id: 'T4', x: 0, y: 0, label: "Daniel's desk", owner: 'Daniel', colour: 2, mine: false, safe: false, alert: false };
    const host = document.createElement('div');
    host.innerHTML = territoryTagHtml({ ...base, presence: 'online' });
    expect(host.textContent).toBe("Daniel's desk");
    host.innerHTML = territoryTagHtml({ ...base, presence: 'away', alert: true });
    expect(host.querySelector('[data-presence="away"]')!.textContent).toBe('Away');
    expect(host.querySelector('.mp-terr-raid')).not.toBeNull();
  });

  it('the emote bar shows in flight, one button per emote with its key', () => {
    const emote = vi.fn();
    const { root, zones: z } = zones();
    const hud = new MpHud(root, z, { emote, intercept: () => undefined });
    const bar = z.tr.querySelector<HTMLElement>('.mp-emotes')!;
    expect(bar.hidden).toBe(true);
    hud.render(view({ emoteKeys: true }));
    expect(bar.hidden).toBe(false);
    const buttons = bar.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons).toHaveLength(EMOTES.length);
    expect([...buttons].map((b) => b.getAttribute('aria-label'))).toEqual(['Waggle', 'Confetti', 'Heart']);
    expect([...bar.querySelectorAll('button kbd')].map((k) => k.getAttribute('data-pad'))).toEqual(['up', 'left', 'right']);
    buttons[2].click();
    expect(emote).toHaveBeenCalledWith('heart');
  });
});

describe('rank insignia slot (v0.0.17)', () => {
  it('renders nothing without a rank, and the insignia in front of the name with one', async () => {
    const { insigniaSlot } = await import('./MpHud');
    expect(insigniaSlot(null)).toBe('');
    expect(killLine('Ann', 0, 'Bob', 3, 'ink', [])).not.toContain('mp-insignia');
    const rank = { id: 'sergeant', label: 'Sergeant', html: '<svg></svg>' };
    const host = document.createElement('div');
    host.innerHTML = killLine('Ann', 0, 'Bob', 3, 'ink', [], { killer: rank });
    expect(host.querySelector('.mp-who .mp-insignia')!.getAttribute('aria-label')).toBe('Sergeant');
    host.innerHTML = scoreboardHtml([row('a', 'online', { rank })]);
    expect(host.querySelector('.mp-pilot .mp-insignia + b')!.textContent).toBe('P-a');
  });
});

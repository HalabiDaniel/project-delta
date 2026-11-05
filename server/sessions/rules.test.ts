import { describe, expect, it } from 'vitest';
import { SESSION } from '../../src/config';
import { mayCloseEmpty, needsSpare, quickPick, SessionClock, spokenTime, type SessionSummary } from './rules';

/** The session rules (v0.0.13): quick join, spare sessions, closing empty ones, and the clock. */

const now = 1_000_000;
const session = (id: string, players: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id, title: id, players, capacity: 16, startedAt: now - 60_000, endsAt: now + 3000_000, length: 3600, status: 'open', ...extra,
});

describe('choosing a session', () => {
  it('quick join picks the busiest session with space, then the one with the most time left', () => {
    const sessions = [session('a', 3), session('b', 9), session('c', 9, { endsAt: now + 3500_000 }), session('full', 16), session('ending', 12, { status: 'closing' })];
    expect(quickPick(sessions, now)?.id).toBe('c');
    expect(quickPick([session('full', 16), session('ending', 1, { status: 'closing' })], now)).toBeNull();
    expect(quickPick([], now)).toBeNull();
  });

  it('opens a spare when every running session is full or closing, and not when nobody plays', () => {
    expect(needsSpare([], now)).toBe(false);
    expect(needsSpare([session('a', 5)], now)).toBe(false);
    expect(needsSpare([session('full', 16)], now)).toBe(true);
    expect(needsSpare([session('ending', 4, { status: 'closing' })], now)).toBe(true);
    expect(needsSpare([session('full', 16), session('spare', 0)], now)).toBe(false);
    expect(needsSpare([session('over', 3, { status: 'ended' })], now)).toBe(false);
  });

  it('closes empty sessions, except the spare others rely on', () => {
    const spare = session('spare', 0, { startedAt: null, endsAt: null });
    expect(mayCloseEmpty(spare, [spare], now)).toBe(true);
    expect(mayCloseEmpty(spare, [spare, session('full', 16)], now)).toBe(false);
    expect(mayCloseEmpty(spare, [spare, session('full', 16), session('other', 3)], now)).toBe(true);
    expect(mayCloseEmpty(session('busy', 2), [session('busy', 2)], now)).toBe(false);
    const ending = session('ending', 0, { status: 'closing' });
    expect(mayCloseEmpty(ending, [ending, session('full', 16)], now)).toBe(true);
  });
});

describe("a session's clock", () => {
  it("doesn't run until the first player arrives, then warns, closes joining and ends", () => {
    const clock = new SessionClock();
    expect(clock.update(now)).toEqual([]);
    expect(clock.left(now)).toBe(SESSION.length);
    clock.start(now);
    clock.start(now + 5000);
    expect(clock.endsAt).toBe(now + SESSION.length * 1000);
    const at = (left: number) => now + (SESSION.length - left) * 1000;
    expect(clock.update(at(601))).toEqual([]);
    expect(clock.update(at(600))).toEqual([{ kind: 'warning', seconds: 600 }]);
    expect(clock.update(at(599))).toEqual([]);
    expect(clock.update(at(SESSION.joinCloses))).toEqual([{ kind: 'closing' }]);
    expect(clock.status).toBe('closing');
    expect(clock.update(at(120))).toEqual([{ kind: 'warning', seconds: 120 }]);
    expect(clock.update(at(30))).toEqual([{ kind: 'warning', seconds: 30 }]);
    expect(clock.update(at(0))).toEqual([{ kind: 'end' }]);
    expect(clock.status).toBe('ended');
    expect(clock.update(at(-10))).toEqual([]);
  });

  it('says only the nearest warning when several fall due at once, and none longer than the session', () => {
    const clock = new SessionClock();
    clock.start(now);
    expect(clock.update(now + (SESSION.length - 100) * 1000)).toEqual([{ kind: 'warning', seconds: 120 }, { kind: 'closing' }]);
    const short = new SessionClock(60);
    short.start(now);
    expect(short.joinCloses).toBe(30);
    expect(short.update(now + 31_000)).toEqual([{ kind: 'warning', seconds: 30 }, { kind: 'closing' }]);
    expect(short.update(now + 60_000)).toEqual([{ kind: 'end' }]);
  });

  it('speaks times plainly', () => {
    expect(spokenTime(600)).toBe('10 minutes');
    expect(spokenTime(60)).toBe('1 minute');
    expect(spokenTime(30)).toBe('30 seconds');
  });
});

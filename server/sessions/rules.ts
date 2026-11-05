import { SESSION } from '../../src/config';

/**
 * The rules for choosing, opening and closing sessions (v0.0.13), as pure functions over what
 * every running session reports about itself. The session directory (directory.ts) applies them
 * to the rooms of this process; tests drive them directly.
 *
 *   open     – players can join (if there is space).
 *   closing  – joining has closed (the end is near); players already in it play on.
 *   ended    – the results are up; nobody joins, everyone is on their way out.
 */
export type SessionStatus = 'open' | 'closing' | 'ended';

/** One running session, as the directory and the lobby see it. Times are clock times (ms). */
export interface SessionSummary {
  id: string;
  title: string;
  players: number;
  capacity: number;
  /** When its first player arrived (the clock starts then); null while nobody has. */
  startedAt: number | null;
  /** When it ends; null until it has started. */
  endsAt: number | null;
  /** Its length (seconds), for one that hasn't started yet. */
  length: number;
  status: SessionStatus;
}

/** Seconds of play a session has left (its full length before it has started). */
export function timeLeft(s: Pick<SessionSummary, 'endsAt' | 'length'>, now: number): number {
  return s.endsAt === null ? s.length : Math.max(0, (s.endsAt - now) / 1000);
}

/** A new player can join it: open (joining hasn't closed), and a desk to spare. */
export function joinable(s: SessionSummary, _now: number): boolean {
  return s.status === 'open' && s.players < s.capacity;
}

/**
 * Quick join: the open session with the most players that has space and time left (players want
 * company); between equals, the one with the most time left. Null: a new session is needed.
 */
export function quickPick(sessions: readonly SessionSummary[], now: number): SessionSummary | null {
  let best: SessionSummary | null = null;
  for (const s of sessions) {
    if (!joinable(s, now)) continue;
    if (!best || s.players > best.players || (s.players === best.players && timeLeft(s, now) > timeLeft(best, now))) best = s;
  }
  return best;
}

/**
 * A new session opens when every open session is full or closing, so a player arriving finds one
 * waiting. Only while a session is running at all: with nobody playing, quick join opens one.
 */
export function needsSpare(sessions: readonly SessionSummary[], now: number): boolean {
  return sessions.some((s) => s.status !== 'ended') && !sessions.some((s) => joinable(s, now));
}

/**
 * An empty session closes after SESSION.emptyClose, unless it is the spare: the only one a new
 * player could join while others are running (closing it would only open another).
 */
export function mayCloseEmpty(s: SessionSummary, sessions: readonly SessionSummary[], now: number): boolean {
  if (s.players > 0) return false;
  if (!joinable(s, now)) return true;
  const others = sessions.filter((o) => o.id !== s.id);
  const running = others.some((o) => o.status !== 'ended' && o.players > 0);
  const anotherJoinable = others.some((o) => joinable(o, now));
  return !running || anotherJoinable;
}

/** Something a session's clock says has happened. */
export type ClockEvent = { kind: 'warning'; seconds: number } | { kind: 'closing' } | { kind: 'end' };

/**
 * A session's time: it starts when the first player arrives (an empty session waiting for players
 * doesn't run down), warns before the end, closes joining, and ends. Clock times (ms), so a session
 * restored after a restart (v0.0.13 phase 5) ends when it would have.
 */
export class SessionClock {
  startedAt: number | null = null;
  endsAt: number | null = null;
  status: SessionStatus = 'open';
  /**
   * Joining closes this long before the end (seconds): SESSION.joinCloses, or halfway through a
   * session too short for it (tests).
   */
  readonly joinCloses: number;
  private readonly warned = new Set<number>();

  /** `length`: seconds of play (SESSION.length; tests use short ones). */
  constructor(readonly length: number = SESSION.length) {
    this.joinCloses = Math.min(SESSION.joinCloses, length / 2);
  }

  get started(): boolean {
    return this.startedAt !== null;
  }

  /** The first player arrived: the hour starts now (once). */
  start(now: number): void {
    if (this.startedAt !== null) return;
    this.startedAt = now;
    this.endsAt = now + this.length * 1000;
    // Warnings already past at the start (a very short session) are not given.
    for (const w of SESSION.warnings) if (w >= this.length) this.warned.add(w);
  }

  /** Picks up a clock that was running before (a restart). */
  resume(startedAt: number, endsAt: number): void {
    this.startedAt = startedAt;
    this.endsAt = endsAt;
  }

  left(now: number): number {
    return timeLeft(this, now);
  }

  /**
   * The session ends `seconds` from now (the admin endpoint, v0.0.14), or at its own end if that is
   * sooner. The usual warnings for times already past aren't given (the caller announces the end).
   */
  endEarly(now: number, seconds: number): void {
    if (this.status === 'ended') return;
    if (this.startedAt === null) this.startedAt = now;
    this.endsAt = Math.min(this.endsAt ?? Infinity, now + Math.max(0, seconds) * 1000);
    const left = this.left(now);
    for (const w of SESSION.warnings) if (w >= left) this.warned.add(w);
  }

  /** What has happened since the last call: warnings due, joining closing, the end. */
  update(now: number): ClockEvent[] {
    if (this.endsAt === null || this.status === 'ended') return [];
    const out: ClockEvent[] = [];
    const left = this.left(now);
    for (const w of SESSION.warnings) {
      if (left <= w && !this.warned.has(w)) {
        this.warned.add(w);
        // Only the nearest of several due at once (a stalled server) is worth saying.
        if (!SESSION.warnings.some((x) => x < w && left <= x)) out.push({ kind: 'warning', seconds: w });
      }
    }
    if (this.status === 'open' && left <= this.joinCloses) {
      this.status = 'closing';
      out.push({ kind: 'closing' });
    }
    if (left <= 0) {
      this.status = 'ended';
      out.push({ kind: 'end' });
    }
    return out;
  }
}

/** "10 minutes", "2 minutes", "30 seconds". */
export function spokenTime(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${Math.round(seconds)} second${Math.round(seconds) === 1 ? '' : 's'}`;
}

import { matchMaker } from '@colyseus/core';
import { randomBytes } from 'node:crypto';
import { ROOM, type SessionListing } from '../../src/net/protocol';
import { joinable, mayCloseEmpty, needsSpare, quickPick, timeLeft, type SessionSummary } from './rules';

/**
 * The sessions running in this process (v0.0.13): which there are, which one quick join sends a
 * player to, and when a new one opens. Sessions are opened by the server only: a room refuses to be
 * created without SESSION_KEY in its options, which only this process knows (a client asking
 * Colyseus to create a room, or passing its own seed or protection time, is refused).
 *
 * One process holds every session for now (v0.0.14 runs one server); matchmaking across servers and
 * regions is v0.0.22.
 */

/** What a running session tells the directory about itself. */
export interface SessionHandle {
  summary(now: number): SessionSummary;
}

/** Room options only the server can give (a client can't know this key). */
export const SESSION_KEY = randomBytes(18).toString('base64url');

const live = new Map<string, SessionHandle>();
let opening: Promise<string> | null = null;
/** Options every session this process opens gets (tests and tools: a seed, short sessions). */
let defaults: Record<string, unknown> = {};

export function setSessionDefaults(options: Record<string, unknown>): void {
  defaults = { ...options };
}

export function register(id: string, handle: SessionHandle): void {
  live.set(id, handle);
}

export function unregister(id: string): void {
  live.delete(id);
}

/** Every running session, newest information. */
export function sessions(now: number = Date.now()): SessionSummary[] {
  return [...live.values()].map((h) => h.summary(now));
}

/** Room options for a session the server opens (tests add their own seed, length and so on). */
export function serverOptions<T extends object>(options: T = {} as T): T & { sessionKey: string } {
  return { ...options, sessionKey: SESSION_KEY };
}

/** Opens a new session and returns its id. Only one opens at a time (two quick joins share it). */
export function openSession(options: Record<string, unknown> = {}): Promise<string> {
  if (!opening) {
    opening = matchMaker
      .createRoom(ROOM, serverOptions({ ...defaults, ...options }))
      .then((room) => room.roomId)
      .finally(() => (opening = null));
  }
  return opening;
}

/** The session a player should join now: the busiest one with space and time left, or a new one. */
export async function quickJoin(now: number = Date.now()): Promise<string> {
  const pick = quickPick(sessions(now), now);
  return pick ? pick.id : openSession();
}

/** Opens a spare session when every open one is full or closing (called when one changes). */
export function ensureSpare(now: number = Date.now()): void {
  if (opening || !needsSpare(sessions(now), now)) return;
  openSession().catch((error) => console.error('[sessions] could not open a new session:', error));
}

/** Whether an empty session may close now (it isn't the spare everyone else needs). */
export function mayClose(id: string, now: number = Date.now()): boolean {
  const all = sessions(now);
  const s = all.find((x) => x.id === id);
  return !s || mayCloseEmpty(s, all, now);
}

/** The lobby's list: every session that isn't over, joinable ones first. */
export function listing(now: number = Date.now()): SessionListing[] {
  return sessions(now)
    .filter((s) => s.status !== 'ended')
    .map((s) => ({ id: s.id, title: s.title, players: s.players, capacity: s.capacity, left: Math.round(timeLeft(s, now)), status: s.status, joinable: joinable(s, now) }))
    .sort((a, b) => Number(b.joinable) - Number(a.joinable) || b.players - a.players || b.left - a.left);
}

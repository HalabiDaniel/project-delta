/**
 * The online services the menus talk to (v0.0.16), behind small interfaces so the screens never
 * care what is real yet.
 *
 * Real today:
 *   - Matchmaking: POST /sessions/quick picks a live session with room (or a fresh one), GET
 *     /sessions names it. The multiplayer client then joins it (?mp&session=<id>).
 *   - Joining with a code: the code is the server's invite / transfer code (?invite=<code>).
 *
 * Stubs (no server support yet; see docs/roadmap/v0.0.26.md for matchmaking across servers):
 *   - Accounts (email + password): kept in this browser only, never sent anywhere.
 *   - Private rooms (hosting), friends, regions, the global leaderboard.
 * Each stub says so through `available: false` (or `online: false`) so a screen can show it.
 */

import { serverHttp } from './endpoint';
import type { SessionListing } from './protocol';

// ---- Accounts -------------------------------------------------------------------------------------

export interface Profile {
  /** The name everyone sees. */
  callsign: string;
  email: string | null;
  guest: boolean;
  /** The team colour, 1–8. */
  team: number;
}

export type SignInProblem = 'email' | 'password' | 'unknown' | 'offline';
export type SignUpProblem = 'callsign' | 'email' | 'password' | 'terms' | 'offline';

export interface AccountService {
  /** Accounts are a real server feature (false: this browser only). */
  readonly online: boolean;
  current(): Profile | null;
  signIn(email: string, password: string, keep: boolean): Promise<{ ok: true; profile: Profile } | { ok: false; problem: SignInProblem }>;
  signUp(callsign: string, email: string, password: string): Promise<{ ok: true; profile: Profile } | { ok: false; problem: SignUpProblem }>;
  continueAsGuest(): Profile;
  signOut(): void;
  /** Sends a reset link (stub: resolves false, nothing to send it from). */
  requestPasswordReset(email: string): Promise<boolean>;
  onChange(fn: (p: Profile | null) => void): () => void;
}

export const CALLSIGN_RULE = /^[A-Za-z0-9]{3,16}$/;
export const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;

/** Why an email does not look right: 'empty', 'domain' (no @something.tld), 'at' (no @), or null. */
export function emailProblem(email: string): 'empty' | 'at' | 'domain' | null {
  const e = email.trim();
  if (!e) return 'empty';
  if (!e.includes('@')) return 'at';
  return EMAIL_RULE.test(e) ? null : 'domain';
}

/** Password strength, 0–4 segments: length, then a mix of cases, digits and symbols. */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= PASSWORD_MIN ? 1 : 0;
  if (score === 0) return pw.length >= 4 ? 1 : 0;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score++;
  return Math.min(4, score);
}

interface Stored {
  profile: Profile;
  keep: boolean;
}

const KEY = 'paperwars.profile';
const ACCOUNTS = 'paperwars.accounts';

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A cheap one-way scramble so the local stub never keeps a password as typed. Not security. */
function scramble(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * The account stub: a guest profile or a "signed in" profile kept in this browser. Sign-up keeps
 * the email, callsign and a scrambled password locally so sign-in works on this computer.
 */
export class LocalAccountService implements AccountService {
  readonly online = false;
  private profile: Profile | null;
  private readonly listeners = new Set<(p: Profile | null) => void>();

  constructor() {
    this.profile = this.read();
  }

  current(): Profile | null {
    return this.profile;
  }

  async signIn(email: string, password: string, keep: boolean) {
    if (emailProblem(email)) return { ok: false as const, problem: 'email' as const };
    if (password.length < 1) return { ok: false as const, problem: 'password' as const };
    const accounts = this.accounts();
    const found = accounts[email.trim().toLowerCase()];
    if (!found || found.pw !== scramble(password)) return { ok: false as const, problem: 'unknown' as const };
    return { ok: true as const, profile: this.set({ callsign: found.callsign, email: email.trim(), guest: false, team: found.team }, keep) };
  }

  async signUp(callsign: string, email: string, password: string) {
    if (!CALLSIGN_RULE.test(callsign)) return { ok: false as const, problem: 'callsign' as const };
    if (emailProblem(email)) return { ok: false as const, problem: 'email' as const };
    if (password.length < PASSWORD_MIN) return { ok: false as const, problem: 'password' as const };
    const accounts = this.accounts();
    const team = this.profile?.team ?? 2;
    accounts[email.trim().toLowerCase()] = { callsign, pw: scramble(password), team };
    try {
      storage('local')?.setItem(ACCOUNTS, JSON.stringify(accounts));
    } catch {
      /* private mode: the account lasts this visit */
    }
    // The guest desk and paper come along: the save is this browser's, whoever is signed in.
    return { ok: true as const, profile: this.set({ callsign, email: email.trim(), guest: false, team }, true) };
  }

  continueAsGuest(): Profile {
    return this.set({ callsign: '', email: null, guest: true, team: this.profile?.team ?? 2 }, true);
  }

  signOut(): void {
    this.profile = null;
    try {
      storage('local')?.removeItem(KEY);
      storage('session')?.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    for (const l of this.listeners) l(null);
  }

  async requestPasswordReset(): Promise<boolean> {
    return false;
  }

  /** The player's team colour (solo setup). */
  setTeam(team: number): void {
    if (!this.profile) return;
    this.set({ ...this.profile, team }, true);
  }

  onChange(fn: (p: Profile | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(profile: Profile, keep: boolean): Profile {
    this.profile = profile;
    const raw = JSON.stringify({ profile, keep } satisfies Stored);
    try {
      storage(keep ? 'local' : 'session')?.setItem(KEY, raw);
      storage(keep ? 'session' : 'local')?.removeItem(KEY);
    } catch {
      /* private mode */
    }
    for (const l of this.listeners) l(profile);
    return profile;
  }

  private read(): Profile | null {
    for (const kind of ['local', 'session'] as const) {
      try {
        const raw = storage(kind)?.getItem(KEY);
        if (!raw) continue;
        const s = JSON.parse(raw) as Partial<Stored>;
        const p = s.profile;
        if (p && typeof p.callsign === 'string' && typeof p.guest === 'boolean') {
          return { callsign: p.callsign, email: typeof p.email === 'string' ? p.email : null, guest: p.guest, team: Number.isInteger(p.team) ? Math.min(8, Math.max(1, p.team)) : 2 };
        }
      } catch {
        /* a bad entry is no profile */
      }
    }
    return null;
  }

  private accounts(): Record<string, { callsign: string; pw: string; team: number }> {
    try {
      return JSON.parse(storage('local')?.getItem(ACCOUNTS) ?? '{}') as Record<string, { callsign: string; pw: string; team: number }>;
    } catch {
      return {};
    }
  }
}

// ---- Matchmaking ------------------------------------------------------------------------------------

export type Region = 'auto' | 'europe' | 'americas' | 'asia';

export interface MatchFound {
  id: string;
  title: string;
  players: number;
  capacity: number;
}

export interface Matchmaking {
  /** Regions are a server feature to come; today every region finds the same server. */
  readonly regions: boolean;
  find(region: Region, signal?: AbortSignal): Promise<MatchFound>;
  /** Round trip to the server in ms, or null when it can't be reached. */
  ping(signal?: AbortSignal): Promise<number | null>;
}

export class HttpMatchmaking implements Matchmaking {
  readonly regions = false;

  constructor(private readonly http: string = serverHttp()) {}

  async find(_region: Region, signal?: AbortSignal): Promise<MatchFound> {
    const response = await fetch(`${this.http}/sessions/quick`, { method: 'POST', signal });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !body.id) throw new Error(body.error ?? String(response.status));
    const list = await fetch(`${this.http}/sessions`, { signal }).then((r) => (r.ok ? (r.json() as Promise<SessionListing[]>) : []), () => []);
    const s = list.find((x) => x.id === body.id);
    return { id: body.id, title: s?.title ?? '', players: s?.players ?? 0, capacity: s?.capacity ?? 0 };
  }

  async ping(signal?: AbortSignal): Promise<number | null> {
    const started = performance.now();
    try {
      const r = await fetch(`${this.http}/health`, { signal });
      return r.ok ? Math.round(performance.now() - started) : null;
    } catch {
      return null;
    }
  }
}

// ---- Private rooms and friends (stubs) ----------------------------------------------------------------

export interface RoomSlot {
  name: string;
  team: number;
  status: 'host' | 'ready' | 'joining' | 'ai';
}

export interface HostedRoom {
  code: string;
  slots: RoomSlot[];
}

export interface RoomSettings {
  classroom: string;
  minutes: 10 | 15 | 20;
  fillWithAi: boolean;
  friendsWithoutCode: boolean;
}

export interface Friend {
  name: string;
  team: number;
  room: string;
  players: number;
  capacity: number;
}

export interface RoomService {
  /** False until the server can open private rooms (it opens every session itself today). */
  readonly available: boolean;
  host(me: { name: string; team: number }, settings: RoomSettings): HostedRoom;
  friends(): Promise<Friend[]>;
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** A room code shaped like the design's ("7KQ-2MF"). */
export function roomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** The stub: a room that only exists on this screen, the host and seven AI rivals; no friends list. */
export class LocalRoomService implements RoomService {
  readonly available = false;

  host(me: { name: string; team: number }): HostedRoom {
    const slots: RoomSlot[] = [{ name: me.name, team: me.team, status: 'host' }];
    for (let i = 1; i < 8; i++) slots.push({ name: '', team: i + 1, status: 'ai' });
    return { code: roomCode(), slots };
  }

  async friends(): Promise<Friend[]> {
    return [];
  }
}

// ---- Leaderboard (stub) --------------------------------------------------------------------------------

export type LeaderboardPeriod = 'week' | 'all' | 'friends';

export interface LeaderRow {
  rank: number;
  name: string;
  team: number;
  paper: number;
  kills: number;
  winRate: number;
  you: boolean;
  /** The plane they fly most (podium art). */
  plane: string | null;
}

export interface LeaderboardService {
  readonly available: boolean;
  rows(period: LeaderboardPeriod, me: { name: string; team: number; paper: number; kills: number; plane: string | null }): Promise<LeaderRow[]>;
}

/**
 * No ranking server yet: the board holds only the player's own multiplayer-style numbers from
 * this browser, so the screen is honest about what it knows.
 */
export class LocalLeaderboard implements LeaderboardService {
  readonly available = false;

  async rows(_period: LeaderboardPeriod, me: { name: string; team: number; paper: number; kills: number; plane: string | null }): Promise<LeaderRow[]> {
    return [{ rank: 1, name: me.name, team: me.team, paper: me.paper, kills: me.kills, winRate: 0, you: true, plane: me.plane }];
  }
}

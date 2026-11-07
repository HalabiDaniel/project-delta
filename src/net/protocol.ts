import { AIRCRAFT_ORDER, BASE, ESCORT_ORDER, ESCORT_ORDERS, MANEUVER_ORDER, SESSION, type AircraftId, type BuildingKind, type EscortKind, type EscortOrder, type ManeuverId } from '../config';
import type { BaseSave } from '../base/Base';
import type { RaidReport } from '../base/Raids';
import type { MissionFailure, MissionSpec, MissionStatus } from '../missions/Mission';
import type { BuildKind, GamePhase, SortieLog } from '../systems/GameState';
import type { BoundaryState } from '../systems/Boundary';
import type { IncomeState } from '../systems/HomeIncome';

/**
 * The multiplayer protocol shared by the server (server/) and the browser (src/mp/): the room's
 * name, the network rates, how input frames, commands, private state and events look on the wire,
 * and the validation the server applies to everything a client sends. Gameplay rules are not here;
 * they are the same rule classes single-player uses (GameState, Base, MissionDirector, ...).
 */

/** The Colyseus room type every classroom session uses. */
export const ROOM = 'classroom';
/** Bumped when the wire format changes; a client with another version is refused. */
export const PROTOCOL_VERSION = 6;

/**
 * What a browser sends when it joins (v0.0.10): its device token if it has one, or a code (an
 * invite for a first join, a transfer code to move a player to this computer).
 */
export interface JoinOptions {
  v: number;
  name?: string;
  /** The username the player wants (v0.0.12): their first, or a change (at most once a week). */
  username?: string;
  token?: string;
  code?: string;
}

/** The first message after joining: who you are in this world. */
export interface WelcomeDTO {
  /** Your public player id (stable across sessions; other players' clients know you by it). */
  id: string;
  name: string;
  tick: number;
  reconnected?: boolean;
  /** A new device token, only when one was issued just now: keep it, it is how you come back. */
  token?: string;
  /** Your username (v0.0.12); null until you have chosen one (you can't place your base before). */
  username?: string | null;
  /** Why the username you asked for wasn't given ("That username is taken"), if it wasn't. */
  usernameNote?: string | null;
  /** The session's name ("Classroom 3", v0.0.13). */
  title?: string;
}

/** v0.0.17: your own rank, sent when you join and whenever it or what you equipped changes. */
export interface RankDTO {
  /** Your total Merit. */
  merit: number;
  /** Your step on the ladder (src/ranks/Ranks.ts stepAt). */
  index: number;
  /** Merit into this step, and the Merit it takes to reach the next. */
  into: number;
  needed: number;
  /** What you have equipped (null: the default). */
  title: string | null;
  card: string | null;
  /** Effects you turned off for your own plane. */
  off: string[];
}

/** v0.0.17: you were promoted (the ceremony waits until you're back at your desk). */
export interface PromotionDTO {
  from: number;
  to: number;
  /** A new rank name, not just a new level. */
  tier: boolean;
}

/** The answer to a `username` request. */
export interface UsernameDTO {
  ok: boolean;
  username: string | null;
  error: string | null;
}

/** A one-time code for moving this player to another computer. */
export interface TransferDTO {
  code: string;
  /** Seconds it stays valid. */
  expires: number;
}

/** Close code for a connection replaced by a newer one of the same player ("opened in another tab"). */
export const CLOSE_TAKEN_OVER = 4011;
/** Close code for the end of a session: the results card stays up, with "Join next session". */
export const CLOSE_SESSION_ENDED = 4012;
/** Close code for a server restart (v0.0.13): the session comes back in a moment; rejoin it. */
export const CLOSE_RESTARTING = 4013;
/** Close code for a player removed by the developer (v0.0.14 admin endpoint): no automatic rejoin. */
export const CLOSE_KICKED = 4014;

// ---- Sessions (v0.0.13) ----------------------------------------------------------------------------

/** A running session, as the lobby lists it (GET /sessions). */
export interface SessionListing {
  id: string;
  title: string;
  players: number;
  capacity: number;
  /** Seconds of play left (the full length before anyone has joined). */
  left: number;
  status: 'open' | 'closing' | 'ended';
  /** A new player can join it now. */
  joinable: boolean;
}

/** The answer to POST /sessions/quick: the session to join. */
export interface QuickJoinDTO {
  id: string;
}

/**
 * A desk's place in the territory lifecycle (v0.0.13), TerritoryState.state:
 *   ai        – the AI's installations defend it; a joining player can be placed here at once.
 *   player    – a player's base is on it.
 *   draining  – its player has left or dropped; the base stays, defenses active, until the
 *               reconnect grace is over and any raid on it is settled.
 *   empty     – bare; nobody can be placed here until the gap is over.
 *   open      – bare; a joining player may be placed here; the AI moves in if nobody comes.
 */
export const DESK_STATES = ['ai', 'player', 'draining', 'empty', 'open'] as const;
export type DeskState = (typeof DESK_STATES)[number];

/** Where a session's clock stands (WorldState.session). */
export const SESSION_STATUSES = ['open', 'closing', 'ended'] as const;

/** One line of the session results card. */
export interface ResultLineDTO {
  id: string;
  name: string;
  colour: number;
  placing: number;
  score: number;
  kills: number;
  deaths: number;
  raids: number;
  missions: number;
  /** Paper earned in this session. */
  paper: number;
  /** Still in the session at the end (or left before it). */
  present: boolean;
  /** v0.0.17: their rank (step on the ladder) and chosen title, for the results' cards. */
  rank?: number;
  title?: string | null;
}

/** Sent to everyone when a session ends. */
export interface SessionResultsDTO {
  title: string;
  /** Seconds the session ran. */
  played: number;
  lines: ResultLineDTO[];
  /** Why it ended early, if it did ("The server is restarting"). */
  reason: string | null;
}

export const NET = {
  /** Fixed simulation rate, server and client prediction alike (Hz), and its step. */
  tickRate: 60,
  step: 1 / 60,
  /** Schema patches (and the per-patch messages that go with them), in milliseconds. */
  patchMs: 50,
  /** Players per session: one per desk (SESSION.capacity, v0.0.13). */
  maxPlayers: SESSION.capacity,
  /** Input frames the server keeps queued per player before dropping the oldest. */
  inputQueueMax: 150,
  /** Input frames accepted per message. */
  framesPerMessage: 12,
  /**
   * How long the server waits for a player's next input before flying their plane on by itself
   * (straight on, guns quiet). The frames that arrive late for those steps are discarded.
   */
  stallTimeout: 1,
  /** The most a player's clock may run ahead of real time on the server (speed-hack bound). */
  clockSlack: 0.5,
  /** Remote aircraft are shown this far in the past, between two known states. */
  interpolationDelay: 0.1,
  /** Lag compensation never rewinds further than this. */
  maxRewind: 0.3,
  /** A dropped player keeps their territory and plane for this long (seconds). */
  reconnectGrace: 60,
  /** Private state goes out at most this often (seconds). */
  privateInterval: 0.1,
  /** Server pings for its own round-trip measurement (seconds). */
  pingInterval: 1,
  nameMax: 16,
  /** Seconds between two emotes from one player. */
  emoteCooldown: 1.5,
  /** Commands accepted per second per player before the rest are ignored. */
  commandsPerSecond: 20,
} as const;

// ---- Input frames ---------------------------------------------------------------------------------

/** One fixed step's controls, numbered. The server flies the plane with exactly these. */
export interface InputFrame {
  seq: number;
  /** Mouse movement during the step, in pixels. */
  mx: number;
  my: number;
  /** +1 speed up, -1 slow down. */
  throttle: -1 | 0 | 1;
  /** +1 bank left, -1 bank right. */
  bank: -1 | 0 | 1;
  boost: boolean;
  autoLevel: boolean;
  /** Trigger held. */
  fire: boolean;
  /** A bomb release was asked for during this step. */
  bomb: boolean;
  /** v0.0.16: the Maneuver key was pressed during this step (absent: no). */
  maneuver?: boolean;
}

export const NEUTRAL_FRAME: Omit<InputFrame, 'seq'> = { mx: 0, my: 0, throttle: 0, bank: 0, boost: false, autoLevel: true, fire: false, bomb: false, maneuver: false };

/** Mouse movement per step is clamped to this (a frame can't turn the plane round). */
const MAX_MOUSE = 400;
const FIELDS = 4;

function axisBits(v: -1 | 0 | 1): number {
  return v === 1 ? 1 : v === -1 ? 2 : 0;
}

function bitsAxis(b: number): -1 | 0 | 1 {
  return b === 1 ? 1 : b === 2 ? -1 : 0;
}

/** Frames as a flat number array: [seq, mx, my, flags] per frame. */
export function packFrames(frames: readonly InputFrame[]): number[] {
  const out: number[] = [];
  for (const f of frames) {
    const flags =
      axisBits(f.throttle) | (axisBits(f.bank) << 2) | (f.boost ? 16 : 0) | (f.autoLevel ? 32 : 0) | (f.fire ? 64 : 0) | (f.bomb ? 128 : 0) | (f.maneuver ? 256 : 0);
    out.push(f.seq, Math.round(f.mx * 10) / 10, Math.round(f.my * 10) / 10, flags);
  }
  return out;
}

/** Reads frames a client sent. Anything malformed is dropped; mouse movement is clamped. */
export function unpackFrames(data: unknown): InputFrame[] {
  if (!Array.isArray(data) || data.length % FIELDS !== 0 || data.length > NET.framesPerMessage * FIELDS) return [];
  const frames: InputFrame[] = [];
  for (let i = 0; i < data.length; i += FIELDS) {
    const [seq, mx, my, flags] = data.slice(i, i + FIELDS);
    if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(mx) || !Number.isFinite(my) || !Number.isInteger(flags) || flags < 0 || flags > 511) continue;
    frames.push({
      seq,
      mx: clamp(mx, -MAX_MOUSE, MAX_MOUSE),
      my: clamp(my, -MAX_MOUSE, MAX_MOUSE),
      throttle: bitsAxis(flags & 3),
      bank: bitsAxis((flags >> 2) & 3),
      boost: (flags & 16) !== 0,
      autoLevel: (flags & 32) !== 0,
      fire: (flags & 64) !== 0,
      bomb: (flags & 128) !== 0,
      maneuver: (flags & 256) !== 0,
    });
  }
  return frames;
}

// ---- Commands -------------------------------------------------------------------------------------

/** Everything a player can ask for besides flying. The server checks every one against the rules. */
export type Command =
  | { a: 'select'; i: number }
  | { a: 'aircraft'; id: AircraftId }
  /** v0.0.16: put this maneuver in the slot (at home only; the server checks the plane carries it). */
  | { a: 'maneuver'; id: ManeuverId }
  | { a: 'build' }
  | { a: 'launch' }
  | { a: 'rearm' }
  | { a: 'takeoff' }
  | { a: 'end' }
  | { a: 'continue' }
  | { a: 'swap' }
  | { a: 'base-build'; slot: string; kind: BuildingKind }
  | { a: 'base-upgrade'; slot: string }
  | { a: 'base-repair'; key: string }
  | { a: 'base-repair-all' }
  | { a: 'base-remove'; slot: string }
  /** v0.0.19: the escorts to buy at the next launch (empty: none; at most ESCORTS.perSortie). */
  | { a: 'escorts'; kinds: EscortKind[] }
  /** v0.0.19: an order to the escorts in the air (the order wheel). */
  | { a: 'escort-order'; o: EscortOrder }
  /** v0.0.19: alliances for the session: offer one to a player, accept or decline theirs, or leave yours. */
  | { a: 'ally'; o: 'offer' | 'accept' | 'decline' | 'leave'; id?: string }
  /** v0.0.19: who may fly escort on your bombing missions. */
  | { a: 'coop'; w: 'allies' | 'anyone' | 'none' }
  /** v0.0.19: decline a challenge to a dogfight (it costs what not showing up costs). */
  | { a: 'challenge-decline' }
  /** v0.0.19: mute (or unmute) another player's emotes and ink markings, for good. */
  | { a: 'mute'; id: string; on: boolean }
  /** v0.0.19: report another player, with a reason (kept for the developer). */
  | { a: 'report'; id: string; reason: ReportReason };

const BUILDINGS = Object.keys(BASE.buildings) as BuildingKind[];
const SLOT_IDS = new Set<string>(BASE.slots.map((s) => s.id));

/** A command from a client, or null if it isn't a well-formed one. */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.a) {
    case 'select':
      return Number.isInteger(c.i) && (c.i as number) >= 0 && (c.i as number) < 16 ? { a: 'select', i: c.i as number } : null;
    case 'aircraft':
      return AIRCRAFT_ORDER.includes(c.id as AircraftId) ? { a: 'aircraft', id: c.id as AircraftId } : null;
    case 'maneuver':
      return MANEUVER_ORDER.includes(c.id as ManeuverId) ? { a: 'maneuver', id: c.id as ManeuverId } : null;
    case 'challenge-decline':
    case 'build':
    case 'launch':
    case 'rearm':
    case 'takeoff':
    case 'end':
    case 'continue':
    case 'swap':
    case 'base-repair-all':
      return { a: c.a };
    case 'base-build':
      return SLOT_IDS.has(c.slot as string) && BUILDINGS.includes(c.kind as BuildingKind) ? { a: 'base-build', slot: c.slot as string, kind: c.kind as BuildingKind } : null;
    case 'base-upgrade':
    case 'base-remove':
      return SLOT_IDS.has(c.slot as string) ? { a: c.a, slot: c.slot as string } : null;
    case 'base-repair':
      return c.key === 'store' || SLOT_IDS.has(c.key as string) ? { a: 'base-repair', key: c.key as string } : null;
    case 'escorts':
      return Array.isArray(c.kinds) && c.kinds.length <= 4 && c.kinds.every((k) => ESCORT_ORDER.includes(k as EscortKind)) ? { a: 'escorts', kinds: c.kinds as EscortKind[] } : null;
    case 'escort-order':
      return ESCORT_ORDERS.includes(c.o as EscortOrder) ? { a: 'escort-order', o: c.o as EscortOrder } : null;
    case 'ally': {
      const o = c.o as string;
      if (o === 'leave') return { a: 'ally', o };
      if ((o === 'offer' || o === 'accept' || o === 'decline') && typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.id)) return { a: 'ally', o, id: c.id };
      return null;
    }
    case 'coop':
      return c.w === 'allies' || c.w === 'anyone' || c.w === 'none' ? { a: 'coop', w: c.w } : null;
    case 'mute':
      return typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.id) && typeof c.on === 'boolean' ? { a: 'mute', id: c.id, on: c.on } : null;
    case 'report':
      return typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.id) && REPORT_REASONS.includes(c.reason as ReportReason) ? { a: 'report', id: c.id, reason: c.reason as ReportReason } : null;
    default:
      return null;
  }
}

/** A display name: printable, trimmed, at most NET.nameMax characters; a stand-in if nothing is left. */
export function cleanName(raw: unknown, fallback = 'Pilot'): string {
  const text = typeof raw === 'string' ? raw : '';
  const clean = text.replace(/[^\p{L}\p{N} _.\-']/gu, '').replace(/\s+/g, ' ').trim().slice(0, NET.nameMax);
  return clean.length > 0 ? clean : fallback;
}

// ---- Emotes ---------------------------------------------------------------------------------------

/**
 * Playful gestures: a wing waggle, a burst of paper confetti, an ink heart; v0.0.19 adds a salute,
 * a laugh, a tease and an ink splat (it marks the aircraft ahead with ink that fades).
 */
export type Emote = 'waggle' | 'confetti' | 'heart' | 'salute' | 'laugh' | 'tease' | 'splat';
export const EMOTES: readonly Emote[] = ['waggle', 'confetti', 'heart', 'salute', 'laugh', 'tease', 'splat'];

/** v0.0.19: why a player is reported (no free text: the moderation queue is v0.0.26). */
export const REPORT_REASONS = ['cheating', 'harassment', 'griefing', 'name', 'farming', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// ---- Player colours -------------------------------------------------------------------------------

/** One tape colour per player slot: their territory border, flag, plane trim and name tag. */
export const PLAYER_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [0.2, 0.45, 0.95],
  [0.92, 0.42, 0.12],
  [0.18, 0.66, 0.36],
  [0.62, 0.3, 0.86],
  [0.9, 0.74, 0.12],
  [0.1, 0.66, 0.72],
  [0.86, 0.32, 0.56],
  [0.45, 0.33, 0.24],
  // v0.0.13: sixteen players a session.
  [0.84, 0.18, 0.2],
  [0.3, 0.3, 0.72],
  [0.52, 0.72, 0.16],
  [0.98, 0.56, 0.66],
  [0.12, 0.44, 0.4],
  [0.7, 0.52, 0.86],
  [0.62, 0.62, 0.62],
  [0.96, 0.86, 0.44],
];

export function colourCss(index: number): string {
  const [r, g, b] = PLAYER_COLOURS[((index % PLAYER_COLOURS.length) + PLAYER_COLOURS.length) % PLAYER_COLOURS.length];
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ---- Ids ------------------------------------------------------------------------------------------

/** A player's aircraft as targets, rounds and kills refer to it. */
export function planeId(playerId: string): string {
  return `pl:${playerId}`;
}

/** The player an aircraft id belongs to, if it is a player's plane. */
export function planeOwner(id: string): string | null {
  return id.startsWith('pl:') ? id.slice(3) : null;
}

// ---- Private state (server → that player only) ---------------------------------------------------

export interface EconomyDTO {
  paper: number;
  capacity: number;
  /** Paper per minute right now (production, the low-balance boost, or 0 when full). */
  rate: number;
  state: IncomeState;
  progress: number;
  protectedPaper: number;
  vulnerable: number;
  production: number;
  /** v0.0.18: ink and rubber balls, with their store limits, rates and protected reserves. */
  stores?: StoreDTO[];
}

/** One store beyond paper (v0.0.18). */
export interface StoreDTO {
  id: 'ink' | 'rubber';
  amount: number;
  capacity: number;
  /** Per minute right now (boost, full, upkeep and being offline included). */
  rate: number;
  protected: number;
}

export interface GarageDTO {
  chosen: AircraftId;
  /** v0.0.16: the maneuver in the slot of the plane on the pad or in the air (else the chosen design's); null: none. */
  maneuver?: ManeuverId | null;
  hangar: Array<{ id: AircraftId; condition: 'ready' | 'recovered'; health: number }>;
  /** `materials`: ink and rubber balls on top of the paper (v0.0.18; absent: none). */
  costs: Record<AircraftId, { kind: BuildKind; cost: number; materials?: { ink?: number; rubber?: number } }>;
  emergency: boolean;
}

export interface PlaneDTO {
  id: AircraftId;
  /** v0.0.18: heavy cargo slows the plane by this (absent: 1), for the client's prediction. */
  cargoFactor?: number;
  /** v0.0.18: a stealth plane's detection state, decided by the server (absent: not a stealth plane). */
  detection?: 'hidden' | 'detected' | 'locked';
  emergency: boolean;
  health: number;
  maxHealth: number;
  ammo: number;
  ammoMax: number;
  gunReady: boolean;
  bombs: number;
  bombsMax: number;
  falling: number;
  cooldown: number;
  rearm: number | null;
  build: number;
  buildKind: BuildKind;
  stopped: boolean;
}

/**
 * What kind of player-versus-player card it is, and against whom. v0.0.19 adds bounties (`bounty`:
 * the bounty's id).
 */
export interface PvpTag {
  kind: 'raid' | 'recon' | 'hunt' | 'intercept' | 'bounty' | 'escort' | 'defend' | 'joint' | 'strike' | 'challenge' | 'challenged' | 'mischief';
  target: string;
  name: string;
  territoryId: string | null;
  /** v0.0.19: the bounty, or the joint attack, this card is for. */
  bounty?: number;
  joint?: number;
  /** v0.0.19: a mischief card's kind. */
  mischief?: 'banner' | 'flyby' | 'stunt';
  /** v0.0.19: a raid card's kind (bombing or staged; strikes and challenges have their own card kinds). */
  raid?: 'bombing' | 'staged' | 'strike' | 'challenge';
  /** v0.0.19: why the director offered it, in words ("Rematch with Bo"), when there is a reason to tell. */
  why?: string;
}

/** v0.0.19: an open bounty, as everyone in the session sees it. */
export interface BountyDTO {
  id: number;
  kind: 'bomber' | 'raid' | 'installation' | 'ace';
  target: string;
  targetName: string;
  pot: number;
  /** Seconds left. */
  left: number;
  reason: string;
}

/** v0.0.19: who you have fought (and helped), from your side. */
export interface RivalsDTO {
  /** Whoever has beaten you most often (null: nobody often enough). */
  nemesis: { id: string; name: string; wins: number; losses: number } | null;
  list: Array<{ id: string; name: string; wins: number; losses: number; helps: number }>;
  /** What you are known for (null: nothing yet), and the counts behind it. */
  reputation: 'raider' | 'defender' | 'ace' | 'helper' | null;
  counts: { raids: number; defends: number; kills: number; helps: number };
}

/** v0.0.19: your alliance for the session. */
export interface AllianceDTO {
  /** Its number (null: not in one), and its members (public ids, you included). */
  id: number | null;
  members: string[];
  /** Players who offered you an alliance, waiting for your answer; players you offered one to. */
  offers: string[];
  sent: string[];
  /** Who may fly escort on your bombing missions. */
  welcome: 'allies' | 'anyone' | 'none';
}

/** v0.0.19: how the director sees you. */
export interface SituationDTO {
  tier: 'newcomer' | 'intermediate' | 'advanced';
  /** Threat, rounded to one decimal: how aggressive you have been lately. */
  threat: number;
}

export interface CardDTO {
  /** Stable while the card stays on the board. */
  key: string;
  spec: MissionSpec;
  slot: 'safe' | 'balanced' | 'risky' | 'event' | 'pvp';
  slotLabel: string;
  pvp: PvpTag | null;
  /** v0.0.18: the operation this card is a stage of (absent: none). */
  operation?: OperationDTO;
}

/** An operation in multiplayer (v0.0.18): a short chain of sorties with a shared payout. */
export interface OperationDTO {
  codename: string;
  territoryId: string;
  stage: number;
  stages: Array<{ label: string; status: 'done' | 'locked' | 'open'; optional: string; met: boolean | null; skipped: boolean }>;
  bonus: number;
  earned: number;
  remaining: number;
  active: boolean;
}

export interface MissionProgressDTO {
  key: string;
  status: MissionStatus;
  failure: MissionFailure | null;
  elapsed: number;
  progress: number[];
}

/** Protection from other players' raids, in seconds left (0: none). */
export interface ProtectionDTO {
  newPlayer: number;
  shield: number;
}

/** A raid by one player on another, as either of them sees it. */
export interface AttackDTO {
  id: number;
  attacker: string;
  attackerName: string;
  victim: string;
  victimName: string;
  territoryId: string;
  /** The defender's radar (or lookouts) has the attacker. */
  detected: boolean;
  /** Seconds since it started. */
  age: number;
  distance: number | null;
  /** v0.0.19: the kind of raid, and the escorts flying with the raider (once detected). */
  kind?: 'bombing' | 'staged' | 'strike' | 'challenge';
  escorts?: number;
  /** v0.0.19 staged raids: the stage under way (0, 1; 2: both done). */
  stage?: number;
}

export interface ResultDTO {
  recovered: boolean;
  missionTitle: string;
  status: MissionStatus;
  failure: MissionFailure | null;
  reward: number;
  elapsed: number;
  sortie: SortieLog;
  pvp: PvpTag | null;
  /** v0.0.18: decided by the server: the medal, new records and achievements unlocked. */
  medal?: 'bronze' | 'silver' | 'gold' | null;
  records?: string[];
  achievements?: Array<{ title: string; detail: string }>;
}

/** The defender's (or attacker's) report on a raid between players. */
export interface AttackReportDTO {
  id: number;
  role: 'attacker' | 'defender';
  other: string;
  territoryId: string;
  /**
   * v0.0.19 adds: struck (a strike got through), won (the challenger won the dogfight), declined (the
   * challenged player didn't show up), draw (a challenge nobody won).
   */
  outcome: 'bombed' | 'repelled' | 'abandoned' | 'struck' | 'won' | 'declined' | 'draw';
  /** v0.0.19: the kind of raid, each stage and whether it was done, and what decided it, in words. */
  kind?: 'bombing' | 'staged' | 'strike' | 'challenge';
  stages?: Array<{ label: string; done: boolean }>;
  decided?: string;
  paperLost: number;
  /** v0.0.18: ink and rubber balls lost (absent: none). */
  inkLost?: number;
  rubberLost?: number;
  reward: number;
  structures: Array<{ name: string; destroyed: boolean }>;
  defenseReward: number;
}

/**
 * The private state, in sections. The server sends only the sections that changed since the
 * last message, so a message is small unless something big (a new board of cards) happened.
 */
export interface MeDTO {
  phase?: GamePhase;
  territory?: string | null;
  selected?: number;
  swaps?: number;
  economy?: EconomyDTO;
  garage?: GarageDTO;
  plane?: PlaneDTO | null;
  offers?: CardDTO[];
  /** The mission flown on this sortie (spec only when it changes). */
  mission?: CardDTO | null;
  progress?: MissionProgressDTO | null;
  base?: (BaseSave & { capacity: number; production: number; protectedPaper: number }) | null;
  protection?: ProtectionDTO;
  attacks?: AttackDTO[];
  result?: ResultDTO | null;
  report?: AttackReportDTO | null;
  raid?: RaidReport | null;
  /** v0.0.19: your escorts: chosen for the next sortie, and in the air. */
  escorts?: EscortsDTO;
  /** v0.0.19: the bounties open in the session, and how the director sees you. */
  bounties?: BountyDTO[];
  situation?: SituationDTO;
  /** v0.0.19: your alliance for this session, the offers waiting, and who may escort your bombers. */
  alliance?: AllianceDTO;
  /** v0.0.19: your nemesis, your rivals and your reputation. */
  rivals?: RivalsDTO;
  /** v0.0.19: the players you muted (public ids), and the players you already reported this session. */
  mutes?: string[];
  reported?: string[];
  /**
   * v0.0.19: aircraft (and installations) your mini-map shows wherever they are: what your spotter,
   * or a Specter flown by you or someone you cooperate with, reveals. Position only, never a lock.
   */
  reveal?: string[];
}

/** v0.0.19: your escorts. */
export interface EscortsDTO {
  /** Chosen for the next sortie, and what they cost together. */
  plan: EscortKind[];
  cost: { paper?: number; ink?: number; rubber?: number };
  /** The order they are flying under. */
  order: EscortOrder;
  /** In the air now: their AI aircraft ids and kinds. */
  active: Array<{ id: string; kind: EscortKind }>;
}

/** The pilot's own flight, sent with every patch while it flies: for reconciliation. */
export interface OwnFlight {
  /** Last input frame the server applied. */
  seq: number;
  flight: number[];
  boundary: BoundaryState;
  countdown: number;
  /** The server's input counters for this player: frames applied, steps it flew alone, frames dropped, frames queued. */
  inputs: [number, number, number, number];
}

// ---- Events (server → clients, batched with each patch) ------------------------------------------

export type Weapon = 'ink' | 'rocket' | 'bomb' | 'ram' | 'crash';

export type NetEvent =
  /** A round or rocket left a weapon. `o`: the player whose plane fired it, if one did. */
  | { t: 'shot'; id: number; k: 'ink' | 'rocket'; p: number[]; v: number[]; side: string; tg: string | null; o?: string; r?: number; tr?: number }
  /** It ended: on an aircraft or installation (`tg`), on the ground, or spent. `fx`: what to draw. */
  | { t: 'end'; id: number; p: number[]; fx: 'hit' | 'ground' | 'spent' | 'pop'; k: 'ink' | 'rocket' }
  /** Damage dealt to an aircraft or installation. `by`: the player who dealt it, if any. */
  | { t: 'dmg'; tg: string; n: number; p: number[]; by?: string; fatal?: boolean; k: Weapon }
  /** A bomb left a plane (other players' bombs, drawn falling). */
  | { t: 'drop'; o: string; p: number[]; v: number[]; kind: 'standard' | 'small' }
  /** A bomb landed. */
  | { t: 'boom'; p: number[]; on: boolean; o?: string }
  /** An aircraft went down (player or AI). */
  | { t: 'down'; id: string; p: number[]; v: number[]; kind: string; side: string }
  /** The kill feed: a player shot something down, or was shot down. */
  | { t: 'kill'; killer: string | null; killerName: string; victim: string; victimName: string; weapon: Weapon; assists: string[]; bomber: boolean }
  | { t: 'emote'; o: string; e: Emote }
  /**
   * A note for the HUD's alert strip (private). `cue`: the sound (and caption) it stands for, keyed
   * so the client never reads the wording: a rocket lock, or a raid on the way (v0.0.15 §8D).
   */
  | { t: 'note'; icon: string; title: string; value: string | null; tone: 'good' | 'bad' | 'warn' | 'info'; cue?: NoteCue }
  /** Session news for everyone: someone joined, claimed, dropped, came back or left. */
  | { t: 'news'; text: string; tone: 'good' | 'bad' | 'info' }
  /** An installation was wrecked or rebuilt. */
  | { t: 'inst'; id: string; wrecked: boolean };

/** The sounds a note can stand for. */
export type NoteCue = 'lock' | 'raid';

/** Rounds a vector for the wire (centimetre precision is plenty for effects). */
export function vec(x: number, y: number, z: number): number[] {
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- Playtest feedback (v0.0.14) ------------------------------------------------------------------

/** What a feedback entry is about (the `feedback` table's categories). */
export const FEEDBACK_CATEGORIES = ['bug', 'frustration', 'interface', 'performance', 'balance', 'missing', 'enjoyment'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Limits the client and the server both apply. */
export const FEEDBACK_LIMITS = { text: 4000, repro: 4000, contextKeys: 30, contextValue: 300 } as const;

/** Client → server, "feedback": an entry from the F8 form. */
export interface FeedbackDTO {
  category: FeedbackCategory;
  text: string;
  repro?: string;
  /** Enjoyment, 1 to 5 (optional). */
  rating?: number | null;
  /** What the browser knows: version, frame rate, ping, device and browser, graphics. */
  context?: Record<string, string | number | boolean | null>;
}

/** Server → client, "feedback": stored, or why not. */
export interface FeedbackReplyDTO {
  ok: boolean;
  error?: string;
}

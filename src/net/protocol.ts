import { AIRCRAFT_ORDER, BASE, type AircraftId, type BuildingKind } from '../config';
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
export const PROTOCOL_VERSION = 1;

export const NET = {
  /** Fixed simulation rate, server and client prediction alike (Hz), and its step. */
  tickRate: 60,
  step: 1 / 60,
  /** Schema patches (and the per-patch messages that go with them), in milliseconds. */
  patchMs: 50,
  /** Players per session (eight of the nine territories can be claimed; the centre stays the AI's). */
  maxPlayers: 8,
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
}

export const NEUTRAL_FRAME: Omit<InputFrame, 'seq'> = { mx: 0, my: 0, throttle: 0, bank: 0, boost: false, autoLevel: true, fire: false, bomb: false };

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
      axisBits(f.throttle) | (axisBits(f.bank) << 2) | (f.boost ? 16 : 0) | (f.autoLevel ? 32 : 0) | (f.fire ? 64 : 0) | (f.bomb ? 128 : 0);
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
    if (!Number.isInteger(seq) || seq < 0 || !Number.isFinite(mx) || !Number.isFinite(my) || !Number.isInteger(flags) || flags < 0 || flags > 255) continue;
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
    });
  }
  return frames;
}

// ---- Commands -------------------------------------------------------------------------------------

/** Everything a player can ask for besides flying. The server checks every one against the rules. */
export type Command =
  | { a: 'select'; i: number }
  | { a: 'aircraft'; id: AircraftId }
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
  | { a: 'base-remove'; slot: string };

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

/** Playful gestures: a wing waggle, a burst of paper confetti, an ink heart. */
export type Emote = 'waggle' | 'confetti' | 'heart';
export const EMOTES: readonly Emote[] = ['waggle', 'confetti', 'heart'];

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
}

export interface GarageDTO {
  chosen: AircraftId;
  hangar: Array<{ id: AircraftId; condition: 'ready' | 'recovered'; health: number }>;
  costs: Record<AircraftId, { kind: BuildKind; cost: number }>;
  emergency: boolean;
}

export interface PlaneDTO {
  id: AircraftId;
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
  range: number;
  rangeMax: number;
  rearm: number | null;
  build: number;
  buildKind: BuildKind;
  stopped: boolean;
}

/** What kind of player-versus-player card it is, and against whom. */
export interface PvpTag {
  kind: 'raid' | 'recon' | 'hunt' | 'intercept';
  target: string;
  name: string;
  territoryId: string | null;
}

export interface CardDTO {
  /** Stable while the card stays on the board. */
  key: string;
  spec: MissionSpec;
  slot: 'safe' | 'balanced' | 'risky' | 'event' | 'pvp';
  slotLabel: string;
  pvp: PvpTag | null;
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
}

/** The defender's (or attacker's) report on a raid between players. */
export interface AttackReportDTO {
  id: number;
  role: 'attacker' | 'defender';
  other: string;
  territoryId: string;
  outcome: 'bombed' | 'repelled' | 'abandoned';
  paperLost: number;
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
}

/** The pilot's own flight, sent with every patch while it flies: for reconciliation. */
export interface OwnFlight {
  /** Last input frame the server applied. */
  seq: number;
  flight: number[];
  range: number;
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
  /** A note for the HUD's alert strip (private). */
  | { t: 'note'; icon: string; title: string; value: string | null; tone: 'good' | 'bad' | 'warn' | 'info' }
  /** Session news for everyone: someone joined, claimed, dropped, came back or left. */
  | { t: 'news'; text: string; tone: 'good' | 'bad' | 'info' }
  /** An installation was wrecked or rebuilt. */
  | { t: 'inst'; id: string; wrecked: boolean };

/** Rounds a vector for the wire (centimetre precision is plenty for effects). */
export function vec(x: number, y: number, z: number): number[] {
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

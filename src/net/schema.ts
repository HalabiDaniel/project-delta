import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * The public world state, synchronised to every client by Colyseus (delta-encoded, 20 times a
 * second). Only what other players need to see is here: who is in the session and owns what,
 * every plane's pose, the AI aircraft, and the state of every installation. Each player's
 * economy, missions and base details go to that player alone (MeDTO in protocol.ts).
 *
 * Positions and angles are quantized: 16 bits over the world gives about a centimetre, plenty for
 * interpolated drawing (the pilot's own plane is reconciled from the exact OwnFlight message).
 */

const position = () => t.quantized({ min: -420, max: 420, bits: 16 }).default(0);
const height = () => t.quantized({ min: -60, max: 140, bits: 16 }).default(0);

/** A player's aircraft as others see it. */
export const PlaneState = schema(
  {
    kind: t.string().default('dart'),
    /** Index into AircraftStatus ('hidden', 'parked', 'flying', 'rolling', 'stopped', 'crashed'). */
    status: t.uint8().default(0),
    x: position(),
    y: height(),
    z: position(),
    yaw: t.angle(),
    pitch: t.angle(),
    roll: t.angle(),
    speed: t.quantized({ min: 0, max: 64, bits: 8 }).default(0),
    /** Health, 0–255 of the maximum. */
    hp: t.uint8().default(255),
    boost: t.boolean().default(false),
    /** Folding on the pad, 0–255. */
    fold: t.uint8().default(255),
    bombs: t.uint8().default(0),
    emergency: t.boolean().default(false),
  },
  'PlaneState',
);
export type PlaneState = SchemaType<typeof PlaneState>;

export const PlayerState = schema(
  {
    name: t.string().default(''),
    colour: t.uint8().default(0),
    /** The territory claimed, or '' before claiming. */
    territory: t.string().default(''),
    connected: t.boolean().default(true),
    /** Seconds of new-player protection left. */
    protect: t.uint16().default(0),
    /** Seconds of raid shield left (after being raided). */
    shield: t.uint16().default(0),
    kills: t.uint16().default(0),
    deaths: t.uint16().default(0),
    assists: t.uint16().default(0),
    raids: t.uint16().default(0),
    defends: t.uint16().default(0),
    missions: t.uint16().default(0),
    score: t.uint32().default(0),
    /** Round trip as the server measured it, in milliseconds. */
    ping: t.uint16().default(0),
    /** Index into GamePhase, for the scoreboard. */
    phase: t.uint8().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** An AI aircraft: ambient patrols, mission aircraft, raiders, friendly bombers. */
export const AiState = schema(
  {
    kind: t.string().default('falcon'),
    role: t.string().default('fighter'),
    side: t.string().default('enemy'),
    x: position(),
    y: height(),
    z: position(),
    yaw: t.angle(),
    pitch: t.angle(),
    roll: t.angle(),
    hp: t.uint8().default(255),
    /** The aircraft it is after ('' for none), and whether it is attacking it now. */
    target: t.string().default(''),
    attacking: t.boolean().default(false),
    /** It is heading out of the world. */
    leaving: t.boolean().default(false),
  },
  'AiState',
);
export type AiState = SchemaType<typeof AiState>;

/** An installation: the AI's on unclaimed territories, a player's buildings on theirs. */
export const InstallationState = schema(
  {
    kind: t.string().default('turret'),
    /** The owning player's id, or '' for the AI's. */
    owner: t.string().default(''),
    /** A player building's slot ('store' for the paper store), '' for the AI's. */
    slot: t.string().default(''),
    level: t.uint8().default(1),
    hp: t.uint8().default(255),
    /** Index into InstallationState ('idle', 'tracking', 'locking', 'firing', 'destroyed'). */
    state: t.uint8().default(0),
    yaw: t.angle(),
    pitch: t.angle(),
    lock: t.uint8().default(0),
    /** The aircraft it is following ('' for none). */
    target: t.string().default(''),
  },
  'InstallationState',
);
export type InstallationState = SchemaType<typeof InstallationState>;

export const TerritoryState = schema(
  {
    /** The player who claimed it, or ''. */
    owner: t.string().default(''),
    threat: t.uint8().default(0),
    /** Can't be raided now (new player, shield after a raid, or its owner is offline). */
    safe: t.boolean().default(false),
    /** A player is raiding it. */
    alert: t.boolean().default(false),
    /** Players may claim it (the centre never). */
    claimable: t.boolean().default(true),
  },
  'TerritoryState',
);
export type TerritoryState = SchemaType<typeof TerritoryState>;

export const WorldState = schema(
  {
    /** Server simulation time in seconds, and the step count. */
    time: t.float64().default(0),
    tick: t.uint32().default(0),
    players: t.map(PlayerState),
    planes: t.map(PlaneState),
    ai: t.map(AiState),
    installations: t.map(InstallationState),
    territories: t.map(TerritoryState),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;

export const PLANE_STATUSES = ['hidden', 'parked', 'flying', 'rolling', 'stopped', 'crashed'] as const;
export const INSTALLATION_STATES = ['idle', 'tracking', 'locking', 'firing', 'destroyed'] as const;
export const PHASES = ['desk', 'building', 'ready', 'flying', 'landed', 'debrief', 'crashed'] as const;

/** An angle read back from the wire ([0, 2π)) as (-π, π]. */
export function signedAngle(a: number): number {
  return a > Math.PI ? a - Math.PI * 2 : a;
}

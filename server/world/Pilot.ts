import type { AirSpawn } from '../../src/ai/AirTraffic';
import type { Base } from '../../src/base/Base';
import type { RaidReport } from '../../src/base/Raids';
import { AIRCRAFT, type PlayerSide } from '../../src/config';
import type { MissionDirector } from '../../src/director/MissionDirector';
import type { Mission } from '../../src/missions/Mission';
import { PilotFlight } from '../../src/net/PilotFlight';
import { NET, planeId, type AttackReportDTO, type MeDTO, type PvpTag, type ResultDTO, type Weapon } from '../../src/net/protocol';
import { sideOf } from '../../src/net/World';
import type { GameState } from '../../src/systems/GameState';
import { ResourceManager } from '../../src/systems/ResourceManager';
import type { Territory } from '../../src/world/Territory';
import type { DamageEntry } from './Attacks';
import { InputClock } from './InputClock';

export interface PilotStats {
  kills: number;
  deaths: number;
  assists: number;
  raids: number;
  defends: number;
  missions: number;
  score: number;
}

/** A card against another player on this pilot's board. */
export interface PvpCard {
  key: string;
  mission: Mission;
  tag: PvpTag;
}

/**
 * One player in a session: who they are, their connection, and their share of the world. Their
 * economy, base, mission board and sortie are the same rule classes single-player uses (made when
 * they claim a territory); their flight is a PilotFlight driven by their input frames.
 */
export class Pilot {
  readonly side: PlayerSide;
  readonly plane: string;
  connected = true;
  /** World time they dropped (while waiting to reconnect). */
  droppedAt = 0;
  readonly joinedAt: number;
  home: Territory | null = null;
  readonly resources = new ResourceManager();
  base: Base | null = null;
  director: MissionDirector | null = null;
  state: GameState | null = null;
  readonly flight = new PilotFlight(AIRCRAFT.dart);
  readonly inputs = new InputClock();
  /** Round trip as measured by the server's pings (seconds). */
  rtt = 0.1;
  readonly stats: PilotStats = { kills: 0, deaths: 0, assists: 0, raids: 0, defends: 0, missions: 0, score: 0 };
  /** Raid protections, as world times. */
  protectUntil = 0;
  shieldUntil = 0;
  /** The last emote and command budget. */
  emoteAt = -Infinity;
  commandTokens: number = NET.commandsPerSecond;
  /** What last hurt the plane (for the kill feed). */
  lastWeapon: Weapon | null = null;
  /** Damage taken by the plane on this sortie, for kill and assist credit. */
  readonly damageLog: DamageEntry[] = [];
  /** Who this pilot hurt lately (player id → world time): their defenses stay angry at them. */
  readonly aggression = new Map<string, number>();
  /** Cards against other players on the board. */
  pvp: PvpCard[] = [];
  /** The mission's AI aircraft still to go up, and time since launch. */
  spawns: AirSpawn[] = [];
  missionTime = 0;
  /** When the plane last took off, and when it crashed (world time). */
  launchedAt = -Infinity;
  crashedAt = -Infinity;
  /** The plane has rolled to a stop after landing (the ground crew can work). */
  stopped = false;
  /** The last sortie's report, the last raid report, the last AI raid's report. */
  result: ResultDTO | null = null;
  report: AttackReportDTO | null = null;
  raidReport: RaidReport | null = null;
  /** The private state last sent, per section (JSON), and when. */
  readonly sent = new Map<keyof MeDTO, string>();
  sentAt = -Infinity;

  constructor(
    readonly id: string,
    public name: string,
    readonly colour: number,
    now: number,
  ) {
    this.side = sideOf(id);
    this.plane = planeId(id);
    this.joinedAt = now;
  }

  /** The territory claimed, if any (for the raid rules). */
  get territory(): string | null {
    return this.home?.id ?? null;
  }

  get flying(): boolean {
    return this.state?.phase === 'flying' && this.flight.model.status === 'flying';
  }

  /** Every card on the board: the director's, then the ones against other players. */
  cards(): Mission[] {
    return [...(this.director?.missions ?? []), ...this.pvp.map((c) => c.mission)];
  }

  pvpCard(mission: Mission | null): PvpCard | undefined {
    return mission ? this.pvp.find((c) => c.mission === mission) : undefined;
  }

  /** At home, where base management and the garage are open: at the desk or landed and stopped. */
  get atHome(): boolean {
    const phase = this.state?.phase;
    return phase === 'desk' || phase === 'building' || phase === 'ready' || (phase === 'landed' && this.stopped);
  }

  addScore(points: number): void {
    this.stats.score += points;
  }
}

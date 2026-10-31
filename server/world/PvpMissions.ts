import { MISSIONS, PVP, RAIDS, type AiRole } from '../../src/config';
import type { MissionSpec } from '../../src/missions/Mission';
import { planeId } from '../../src/net/protocol';
import { territoryName } from '../../src/net/World';
import type { Territory } from '../../src/world/Territory';

/**
 * Missions against other players, built from the same objectives single-player missions use, so
 * GameState flies, scores and pays them like any other card:
 *
 *   raid      – bomb a structure on another player's base (bombing).
 *   recon     – fly low over another player's base for a while (recon).
 *   hunt      – shoot down another player's plane (dogfight).
 *   intercept – shoot down the raider coming for your own base (bomber interception).
 *
 * Whether a player may be raided, and what a raid pays, is decided in Attacks.ts.
 */

export interface RaidTarget {
  /** Installation id of the structure to hit, and where it is. */
  installationId: string;
  name: string;
  x: number;
  z: number;
}

export function raidMission(victimName: string, victimHome: Territory, target: RaidTarget, reward: number): MissionSpec {
  const place = territoryName(victimHome.id);
  return {
    type: 'bombing',
    difficulty: 'medium',
    tier: 'hard',
    title: `Raid ${victimName}`,
    description: `Bomb ${victimName}'s ${target.name.toLowerCase()} on ${place} (${victimHome.id}). Their guns are awake, and they may come up to meet you.`,
    reward,
    bombs: 4,
    timeLimit: PVP.raidTime,
    ordered: false,
    objectives: [
      {
        kind: 'bomb',
        territoryId: victimHome.id,
        zone: { x: target.x, z: target.z, radius: RAIDS.hitRadius, top: victimHome.top + MISSIONS.targetHeight },
        precision: false,
      },
    ],
    codename: `Raid on ${place}`,
  };
}

export function reconMission(victimName: string, victimHome: Territory): MissionSpec {
  const ceiling = MISSIONS.reconCeiling.medium;
  return {
    type: 'recon',
    difficulty: 'medium',
    tier: 'medium',
    title: `Scout ${victimName}`,
    description: `Fly low over ${victimName}'s base on ${territoryName(victimHome.id)} (below ${ceiling} m) for ${PVP.reconDuration} s. Their guns will notice.`,
    reward: PVP.reconReward,
    bombs: 0,
    timeLimit: PVP.reconTime,
    ordered: false,
    objectives: [
      {
        kind: 'recon',
        territoryId: victimHome.id,
        airspace: { x: victimHome.x, z: victimHome.z, half: victimHome.half, ceiling },
        duration: PVP.reconDuration,
      },
    ],
    codename: `Look at ${territoryName(victimHome.id)}`,
  };
}

export function huntMission(rivalId: string, rivalName: string, rivalHome: Territory | null, role: AiRole | 'aircraft'): MissionSpec {
  return {
    type: 'dogfight',
    difficulty: 'hard',
    tier: 'hard',
    title: `Shoot down ${rivalName}`,
    description: `${rivalName} is in the air. Find them and shoot them down before the clock runs out.`,
    reward: PVP.huntReward,
    bombs: 0,
    timeLimit: PVP.huntTime,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: rivalHome?.id ?? 'T5', targets: [planeId(rivalId)], count: 1, what: role }],
    codename: `Hunt for ${rivalName}`,
  };
}

export function interceptMission(attackerId: string, attackerName: string, home: Territory): MissionSpec {
  return {
    type: 'bomber-intercept',
    difficulty: 'medium',
    tier: 'medium',
    title: `Stop ${attackerName}`,
    description: `${attackerName} is raiding your base on ${territoryName(home.id)}. Get up there and shoot them down.`,
    reward: PVP.interceptReward,
    bombs: 0,
    timeLimit: PVP.interceptTime,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: home.id, targets: [planeId(attackerId)], count: 1, what: 'bomber' }],
    codename: `Defend ${territoryName(home.id)}`,
  };
}

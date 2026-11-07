import { BOUNTIES, COOP, MISSIONS, PVP, RAIDS, type AiRole } from '../../src/config';
import type { Bounty } from './Bounties';
import type { JointAttack } from './Coop';
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
    objectives: [{ kind: 'intercept', territoryId: rivalHome?.id ?? PVP.centre, targets: [planeId(rivalId)], count: 1, what: role }],
    codename: `Hunt for ${rivalName}`,
  };
}

/** v0.0.19: a bounty card. Flying it pays a little; the pot is shared by everyone who contributed. */
export function bountyMission(b: Bounty, targetHome: Territory | null, role: AiRole | 'aircraft'): MissionSpec {
  const pot = `${b.pot} paper shared by everyone who helps`;
  if (b.kind === 'installation' && b.installation) {
    const i = b.installation;
    return {
      type: 'suppression',
      difficulty: 'hard',
      tier: 'hard',
      title: `Bounty: ${b.targetName}'s ${i.name.toLowerCase()}`,
      description: `${b.reason}. Wreck ${b.targetName}'s ${i.name.toLowerCase()} on ${territoryName(i.territoryId)}: ${pot}. Their guns will answer.`,
      reward: BOUNTIES.cardReward,
      bombs: 2,
      timeLimit: BOUNTIES.duration,
      ordered: false,
      objectives: [{ kind: 'destroy', territoryId: i.territoryId, targets: [i.id], count: 1 }],
      codename: `Bounty on ${b.targetName}`,
    };
  }
  const what = b.kind === 'bomber' ? 'their bomber' : b.kind === 'raid' ? 'them before their bombs land' : 'them';
  return {
    type: 'dogfight',
    difficulty: 'hard',
    tier: 'hard',
    title: `Bounty: ${b.targetName}`,
    description: `${b.reason}. Shoot down ${what}: ${pot}.`,
    reward: BOUNTIES.cardReward,
    bombs: 0,
    timeLimit: BOUNTIES.duration,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: targetHome?.id ?? PVP.centre, targets: [planeId(b.target)], count: 1, what: role }],
    codename: `Bounty on ${b.targetName}`,
  };
}

/** v0.0.19: fly escort on another player's bomber until its bombs are on target. */
export function coopEscortMission(bomberId: string, bomberName: string, territoryId: string, zone: { x: number; z: number; radius: number; top: number }): MissionSpec {
  return {
    type: 'escort',
    difficulty: 'medium',
    tier: 'medium',
    title: `Escort ${bomberName}`,
    description: `${bomberName} is on a bombing run over ${territoryName(territoryId)}. Stay close and keep their bomber in the air until its bombs are on target. Paid once, by how much of the flight you spent at their side.`,
    reward: COOP.cardReward,
    bombs: 0,
    timeLimit: PVP.raidTime,
    ordered: false,
    objectives: [{ kind: 'escort', territoryId, escort: planeId(bomberId), zone }],
    codename: `Wing for ${bomberName}`,
  };
}

/** v0.0.19: help another player shoot down the raider over their base (joint defense). */
export function jointDefenseMission(raiderId: string, raiderName: string, defenderName: string, home: Territory): MissionSpec {
  return {
    type: 'bomber-intercept',
    difficulty: 'medium',
    tier: 'medium',
    title: `Help ${defenderName}`,
    description: `${raiderName} is raiding ${defenderName}'s base on ${territoryName(home.id)}. Help bring them down: ${defenderName} keeps priority on the defense reward, helpers share the rest by damage.`,
    reward: COOP.cardReward,
    bombs: 0,
    timeLimit: PVP.interceptTime,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: home.id, targets: [planeId(raiderId)], count: 1, what: 'bomber' }],
    codename: `Defend ${territoryName(home.id)} together`,
  };
}

/** v0.0.19: a joint attack card: the same target offered to two players, shared by contribution. */
export function jointAttackMission(j: JointAttack, partnerName: string, targetHome: Territory | null, role: AiRole | 'aircraft'): MissionSpec {
  const shared = `${j.pot} paper shared with ${partnerName} by damage`;
  if (j.kind === 'installation' && j.installation) {
    const i = j.installation;
    return {
      type: 'suppression', difficulty: 'hard', tier: 'hard',
      title: `Joint attack: ${j.targetName}'s ${i.name.toLowerCase()}`,
      description: `You and ${partnerName} both have this one. Wreck ${j.targetName}'s ${i.name.toLowerCase()} on ${territoryName(i.territoryId)}: ${shared}.`,
      reward: COOP.cardReward, bombs: 2, timeLimit: COOP.jointTime, ordered: false,
      objectives: [{ kind: 'destroy', territoryId: i.territoryId, targets: [i.id], count: 1 }],
      codename: `Together on ${j.targetName}`,
    };
  }
  return {
    type: 'dogfight', difficulty: 'hard', tier: 'hard',
    title: `Joint attack: ${j.targetName}`,
    description: `You and ${partnerName} both have this one: bring down ${j.targetName}'s bomber. ${shared}.`,
    reward: COOP.cardReward, bombs: 0, timeLimit: COOP.jointTime, ordered: false,
    objectives: [{ kind: 'intercept', territoryId: targetHome?.id ?? PVP.centre, targets: [planeId(j.target)], count: 1, what: role }],
    codename: `Together on ${j.targetName}`,
  };
}

/** v0.0.19: the target of a joint attack defends their base for a while. */
export function holdHomeMission(home: Territory, against: string): MissionSpec {
  const ceiling = 40;
  return {
    type: 'patrol', difficulty: 'medium', tier: 'medium',
    title: 'Hold your desk',
    description: `${against} are coming for your base on ${territoryName(home.id)}. Patrol over it for a minute and see them off.`,
    reward: COOP.cardReward * 2, bombs: 0, timeLimit: COOP.jointTime, ordered: false,
    objectives: [{ kind: 'patrol', territoryId: home.id, airspace: { x: home.x, z: home.z, half: home.half + PVP.airspace, ceiling }, duration: 60 }],
    codename: `Hold ${territoryName(home.id)}`,
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

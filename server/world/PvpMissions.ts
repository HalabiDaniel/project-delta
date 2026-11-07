import { BOUNTIES, COOP, MISSIONS, PVP, RAID_KINDS, RAIDS, SOCIAL, type AiRole, type MischiefKind } from '../../src/config';
import type { Bounty } from './Bounties';
import type { JointAttack } from './Coop';
import type { MissionSpec } from '../../src/missions/Mission';
import { planeId } from '../../src/net/protocol';
import { bannerPoint, territoryName } from '../../src/net/World';
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

/**
 * A bombing raid: one structure, or (v0.0.19) several on a well-built base, chosen from what is
 * actually standing on it. All of them must be hit.
 */
export function raidMission(victimName: string, victimHome: Territory, target: RaidTarget | RaidTarget[], reward: number): MissionSpec {
  const place = territoryName(victimHome.id);
  const targets = Array.isArray(target) ? target : [target];
  const names = targets.map((t) => t.name.toLowerCase());
  const what = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return {
    type: targets.length > 1 ? 'multi-bomb' : 'bombing',
    difficulty: 'medium',
    tier: 'hard',
    title: `Raid ${victimName}`,
    description: `Bomb ${victimName}'s ${what} on ${place} (${victimHome.id}). Their guns are awake, and they may come up to meet you.`,
    reward,
    bombs: Math.min(6, 2 + 2 * targets.length),
    timeLimit: PVP.raidTime,
    ordered: false,
    objectives: targets.map((t) => ({
      kind: 'bomb' as const,
      territoryId: victimHome.id,
      zone: { x: t.x, z: t.z, radius: RAIDS.hitRadius, top: victimHome.top + MISSIONS.targetHeight },
      precision: false,
    })),
    codename: `Raid on ${place}`,
  };
}

/**
 * v0.0.19: a staged raid: suppress a radar or turret first (wreck it, guns, rockets or bombs), then
 * bomb the store. Each stage has its own clock (RAID_KINDS.stageTime), kept by the server.
 */
export function stagedRaidMission(victimName: string, victimHome: Territory, first: RaidTarget, store: RaidTarget, reward: number): MissionSpec {
  const place = territoryName(victimHome.id);
  return {
    type: 'multi-stage',
    difficulty: 'hard',
    tier: 'hard',
    title: `Staged raid on ${victimName}`,
    description: `Two stages on ${place}: first knock out ${victimName}'s ${first.name.toLowerCase()}, then bomb their store. ${RAID_KINDS.stageTime} s for each stage. Stage one alone pays a little; the store pays the rest.`,
    reward,
    bombs: 4,
    timeLimit: RAID_KINDS.stageTime * 2,
    ordered: true,
    objectives: [
      { kind: 'destroy', territoryId: victimHome.id, targets: [first.installationId], count: 1 },
      { kind: 'bomb', territoryId: victimHome.id, zone: { x: store.x, z: store.z, radius: RAIDS.hitRadius, top: victimHome.top + MISSIONS.targetHeight }, precision: false },
    ],
    codename: `Two-step on ${place}`,
  };
}

/** v0.0.19: a strike: wreck infrastructure low, with guns and rockets. Takes no resources. */
export function strikeMission(victimName: string, victimHome: Territory, targets: RaidTarget[], reward: number): MissionSpec {
  const place = territoryName(victimHome.id);
  return {
    type: 'low-attack',
    difficulty: 'hard',
    tier: 'hard',
    title: `Strike ${victimName}`,
    description: `Fly in low over ${place} and wreck ${victimName}'s ${targets.map((t) => t.name.toLowerCase()).join(' and ')} with guns and rockets. Their guns are awake; they may take off to meet you.`,
    reward,
    bombs: 0,
    timeLimit: RAID_KINDS.strikeTime,
    ordered: false,
    objectives: [{ kind: 'destroy', territoryId: victimHome.id, targets: targets.map((t) => t.installationId), count: targets.length }],
    codename: `Strike on ${place}`,
  };
}

/** v0.0.19: a challenge: call another player out to a dogfight over their own desk. */
export function challengeMission(victimId: string, victimName: string, victimHome: Territory, noShowReward: number): MissionSpec {
  const c = RAID_KINDS.challenge;
  return {
    type: 'dogfight',
    difficulty: 'hard',
    tier: 'hard',
    title: `Challenge ${victimName}`,
    description: `Call ${victimName} out over their own desk on ${territoryName(victimHome.id)}. They have ${c.answer} s to take off. Win the dogfight for ${c.reward}; if they don't show, you get ${noShowReward}.`,
    reward: noShowReward,
    bombs: 0,
    timeLimit: c.answer + c.fight,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: victimHome.id, targets: [planeId(victimId)], count: 1, what: 'aircraft' }],
    codename: `Showdown over ${territoryName(victimHome.id)}`,
  };
}

/** v0.0.19: the challenged player's card: take off and win the dogfight over your desk. */
export function challengedMission(challengerId: string, challengerName: string, home: Territory): MissionSpec {
  const c = RAID_KINDS.challenge;
  return {
    type: 'dogfight',
    difficulty: 'hard',
    tier: 'hard',
    title: `${challengerName} challenged you`,
    description: `${challengerName} is calling you out over your desk. Take off within ${c.answer} s and shoot them down for ${c.reward}. Staying home costs you a little paper (never your reserve).`,
    reward: c.reward,
    bombs: 0,
    timeLimit: c.answer + c.fight,
    ordered: false,
    objectives: [{ kind: 'intercept', territoryId: home.id, targets: [planeId(challengerId)], count: 1, what: 'aircraft' }],
    codename: `Answer ${challengerName}`,
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

/**
 * v0.0.19: harmless mischief on another player's desk (GDD §7.2): mark their banner with ink (fly
 * through the hoop at it), fly through their airspace without a scratch, or fly a maneuver through a
 * hoop over their desk. Nothing is destroyed and nothing is taken.
 */
export function mischiefMission(kind: MischiefKind, victimName: string, home: Territory): MissionSpec {
  const place = territoryName(home.id);
  const m = SOCIAL.mischief;
  const base = { difficulty: 'easy' as const, tier: 'medium' as const, reward: m.reward, bombs: 0, timeLimit: m.time, ordered: false, codename: `Mischief on ${place}` };
  switch (kind) {
    case 'banner': {
      const b = bannerPoint(home);
      return {
        ...base, type: 'rings', title: `Ink ${victimName}'s banner`,
        description: `Fly through the hoop at ${victimName}'s banner on ${place} and leave an ink splat on it. It washes off. Their guns may object.`,
        objectives: [{ kind: 'ring', gate: { x: b.x, y: b.y, z: b.z, yaw: Math.PI / 4, radius: 5 }, number: 1 }],
      };
    }
    case 'stunt':
      return {
        ...base, type: 'rings', title: `Show off over ${victimName}'s desk`,
        description: `Fly a maneuver through the hoop over ${victimName}'s desk on ${place}. Pure showing off: nothing gets broken.`,
        objectives: [{ kind: 'ring', gate: { x: home.x, y: home.top + 14, z: home.z, yaw: 0, radius: 6, maneuver: true }, number: 1 }],
      };
    default:
      return {
        ...base, type: 'recon', title: `Buzz ${victimName}'s desk`,
        description: `Fly right through ${victimName}'s airspace over ${place} without taking a single hit. One scratch and the fun's over.`,
        objectives: [{ kind: 'reach', territoryId: home.id, airspace: { x: home.x, z: home.z, half: home.half, ceiling: 40 } }],
      };
  }
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

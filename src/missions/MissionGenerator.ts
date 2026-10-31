import type { Strike } from '../ai/AiAircraft';
import type { AirSpawn } from '../ai/AirTraffic';
import { flightTime, friendlyBomberPlan, interceptorPlan, patrolPlan, raidPlan, scoutPlan } from '../ai/FlightPlans';
import { neighbours } from '../ai/Navigation';
import { AI, MISSIONS, RAIDS, THREAT, WORLD, type AiRole, type Difficulty, type Side, type ThreatLevel } from '../config';
import { pick, randRange, shuffled, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import { Mission, type MissionSpec, type MissionThreat, type MissionType, type Objective, type RingGate, type TargetZone } from './Mission';

export const MISSION_TYPES: readonly MissionType[] = [
  'bombing', 'precision', 'recon', 'delivery', 'return', 'multi-bomb', 'rings', 'practice',
  'suppression', 'danger-recon', 'fortified', 'multi-stage', 'survival', 'low-attack',
  'dogfight', 'scout-intercept', 'bomber-intercept', 'escort', 'patrol', 'combined',
];

/** Mission types built around the defenses. Every deal includes one, when the world has defenses. */
export const DEFENSE_TYPES: readonly MissionType[] = ['suppression', 'danger-recon', 'fortified', 'multi-stage', 'survival', 'low-attack'];

/** Mission types against (or with) AI aircraft. Every deal includes one. */
export const AIR_TYPES: readonly MissionType[] = ['dogfight', 'scout-intercept', 'bomber-intercept', 'escort', 'patrol', 'combined'];

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** A defensive installation, as far as missions care. */
export interface InstallationInfo {
  id: string;
  kind: 'turret' | 'launcher' | 'radar' | 'supply';
  territoryId: string;
  /** T1's own guns and store are the player's; missions only ever go up against the enemy's. */
  side?: Side;
  x: number;
  z: number;
  range: number;
}

/** What the generator needs to know about the world. */
export interface MissionContext {
  territories: readonly Territory[];
  homeId: string;
  /** Where sorties start, for distances and time limits. */
  launch: { x: number; z: number };
  gridSize?: number;
  /** Distance between neighbouring territory centres. */
  spacing?: number;
  /** Practice planes standing on the territories, for target practice missions. */
  dummies?: ReadonlyArray<{ id: string; territoryId: string }>;
  /** Ground taken by props and stands, which precision spots keep clear of. */
  obstacles?: ReadonlyArray<{ x: number; z: number; r: number }>;
  /** Defenses standing on the territories, for the missions against them and the threat on every card. */
  installations?: readonly InstallationInfo[];
}

/**
 * Offers `count` mission cards with different mission types. With three cards there is one of
 * each difficulty: the easy one always goes to unprotected or lightly defended ground (with rookie
 * pilots, if any), so there is always a safe choice, and the hard one into guarded or fortified
 * ground. When the world has defenses, one card is a mission against them, and one is a mission
 * in the air.
 */
export function generateOffers(ctx: MissionContext, rng: Rng, count: number = MISSIONS.offers): Mission[] {
  const order = shuffled(rng, DIFFICULTIES);
  const slots = Array.from({ length: count }, (_, i) => order[i % order.length]);
  const chosen: Array<MissionType | null> = slots.map(() => null);
  const used = new Set<MissionType>();
  for (const pool of [DEFENSE_TYPES, AIR_TYPES]) {
    for (const type of shuffled(rng, pool)) {
      const slot = shuffled(rng, slots.map((_, i) => i)).find((i) => !chosen[i] && supports(type, slots[i], ctx));
      if (slot === undefined) continue;
      chosen[slot] = type;
      used.add(type);
      break;
    }
  }
  slots.forEach((difficulty, i) => {
    if (chosen[i]) return;
    const type = shuffled(rng, MISSION_TYPES).find((t) => !used.has(t) && supports(t, difficulty, ctx));
    if (!type) return;
    chosen[i] = type;
    used.add(type);
  });
  return chosen.flatMap((type, i) => (type ? [new Mission(generateMission(type, slots[i], ctx, rng))] : []));
}

/** Can a mission of this type be offered at this difficulty: is there a fitting target in its threat window? */
export function supports(type: MissionType, difficulty: Difficulty, ctx: MissionContext): boolean {
  if (type === 'rings') return true;
  const needed = type === 'multi-bomb' ? 2 : 1;
  return eligible(type, difficulty, ctx).filter((t) => inWindow(t.threat, type, difficulty)).length >= needed;
}

/**
 * The threat levels (lowest, highest) a mission of this type and difficulty may go into. A bomber
 * interception is fought over home ground, wherever the raider sets out from.
 */
export function threatWindow(type: MissionType, difficulty: Difficulty): [ThreatLevel, ThreatLevel] {
  if (type === 'bomber-intercept') return [0, 0];
  const [lo, hi] = THREAT.byDifficulty[difficulty];
  const min = (MISSIONS.minThreat as Partial<Record<MissionType, number>>)[type] ?? 0;
  return [Math.max(lo, min) as ThreatLevel, hi];
}

export function generateMission(type: MissionType, difficulty: Difficulty, ctx: MissionContext, rng: Rng): MissionSpec {
  const home = ctx.territories.find((t) => t.id === ctx.homeId)!;
  const distanceTo = (t: { x: number; z: number }, from: { x: number; z: number } = ctx.launch) =>
    Math.hypot(t.x - from.x, t.z - from.z);
  const spareBombs = MISSIONS.spareBombs[difficulty];
  const target = () => pick(rng, candidates(type, difficulty, ctx));
  const on = (t: Territory) => (ctx.installations ?? []).filter((i) => i.territoryId === t.id);
  const make = (distance: number, parts: Parts) => spec(type, difficulty, distance, parts, ctx, rng);

  switch (type) {
    case 'bombing': {
      const t = target();
      return make(distanceTo(t), {
        title: `Bomb ${t.id}`,
        description: `Hit the bullseye on ${t.id}.`,
        bombs: 1 + spareBombs,
        objectives: [bombObjective(t, MISSIONS.bullseyeRadius[difficulty])],
      });
    }
    case 'precision': {
      const t = target();
      const radius = MISSIONS.precisionRadius[difficulty];
      const spot = precisionSpot(t, radius, ctx.obstacles ?? [], rng);
      return make(distanceTo(t), {
        title: `Precision strike: ${t.id}`,
        description: `Hit the small ink-blue spot on ${t.id}. Aim carefully.`,
        bombs: 1 + spareBombs,
        objectives: [bombObjective(t, radius, spot.x, spot.z)],
      });
    }
    case 'recon': {
      const t = target();
      const ceiling = MISSIONS.reconCeiling[difficulty];
      const duration = MISSIONS.reconTime[difficulty];
      return make(distanceTo(t), {
        title: `Scout ${t.id}`,
        description: `Fly low over ${t.id} (below ${ceiling} m) for ${duration} s in total.`,
        objectives: [{ kind: 'recon', territoryId: t.id, airspace: airspace(t, ceiling), duration }],
      });
    }
    case 'delivery': {
      const t = target();
      const distance = distanceTo(t) - t.half;
      const limit = Math.ceil((distance / MISSIONS.referenceSpeed) * MISSIONS.deliverySlack[difficulty] + MISSIONS.deliveryExtraTime);
      return make(distanceTo(t), {
        title: `Rush delivery to ${t.id}`,
        description: `Reach ${t.id}'s airspace within ${limit} s.`,
        timeLimit: limit,
        objectives: [{ kind: 'reach', territoryId: t.id, airspace: airspace(t, MISSIONS.deliveryCeiling) }],
      });
    }
    case 'return': {
      const t = target();
      return make(distanceTo(t) * 2, {
        title: `Strike & return: ${t.id}`,
        description: `Bomb ${t.id}, then land safely back on ${home.id}.`,
        bombs: 1 + spareBombs,
        ordered: true,
        objectives: [bombObjective(t, MISSIONS.bullseyeRadius[difficulty]), { kind: 'land', territoryId: home.id }],
      });
    }
    case 'multi-bomb': {
      const [a, b] = shuffled(rng, candidates(type, difficulty, ctx, 2))
        .slice(0, 2)
        .sort((p, q) => distanceTo(p) - distanceTo(q));
      return make(distanceTo(a) + distanceTo(b, a), {
        title: `Double strike: ${a.id} + ${b.id}`,
        description: 'Hit both bullseyes in one flight, in any order.',
        bombs: 2 + spareBombs,
        objectives: [bombObjective(a, MISSIONS.bullseyeRadius[difficulty]), bombObjective(b, MISSIONS.bullseyeRadius[difficulty])],
      });
    }
    case 'rings': {
      const gates = ringCourse(ctx, MISSIONS.ringCount[difficulty], MISSIONS.ringRadius[difficulty], rng);
      let length = 0;
      let from = { x: ctx.launch.x, z: ctx.launch.z };
      for (const g of gates) {
        length += distanceTo(g, from);
        from = g;
      }
      const limit = difficulty === 'hard' ? Math.ceil((length / MISSIONS.referenceSpeed) * MISSIONS.ringSlackHard + 4) : null;
      return make(length, {
        title: 'Ring run',
        description: `Fly through ${gates.length} paper rings in order${limit ? ` within ${limit} s` : ''}.`,
        timeLimit: limit,
        ordered: true,
        objectives: gates.map((gate, i) => ({ kind: 'ring', gate, number: i + 1 })),
      });
    }
    case 'practice': {
      const t = target();
      const dummies = (ctx.dummies ?? []).filter((d) => d.territoryId === t.id).map((d) => d.id);
      if (dummies.length === 0) throw new Error('Target practice needs practice planes on the territories');
      const count = Math.min(MISSIONS.practiceCount[difficulty], dummies.length);
      const limit = difficulty === 'hard' ? Math.ceil(distanceTo(t) / MISSIONS.referenceSpeed + MISSIONS.practiceTimeHard) : null;
      const all = count === dummies.length;
      return make(distanceTo(t), {
        title: `Target practice: ${t.id}`,
        description: `Shoot down ${all ? `all ${count}` : `${count} of the`} practice planes over ${t.id}${limit ? ` within ${limit} s` : ''}.`,
        timeLimit: limit,
        objectives: [{ kind: 'destroy', territoryId: t.id, targets: dummies, count, what: 'practice' }],
      });
    }
    case 'suppression': {
      const t = target();
      const weapons = on(t).filter((i) => i.kind === 'turret' || i.kind === 'launcher');
      if (weapons.length === 0) throw new Error('Suppression needs weapons on the territories');
      const turrets = weapons.filter((i) => i.kind === 'turret');
      // Easy: one turret. Medium: every turret. Hard: every weapon, rocket launchers included.
      const targets = difficulty === 'hard' || turrets.length === 0 ? weapons : turrets;
      const count = difficulty === 'easy' ? 1 : targets.length;
      const what = defenseList(targets.filter((i) => i.kind === 'turret').length, targets.filter((i) => i.kind === 'launcher').length, 'the');
      return make(distanceTo(t), {
        title: `Suppress ${t.id}`,
        description:
          count === targets.length
            ? `Destroy ${what} on ${t.id}, with ink or bombs.`
            : `Destroy one of the ${targets.length} ink turrets on ${t.id}, with ink or bombs.`,
        bombs: 1 + spareBombs,
        objectives: [{ kind: 'destroy', territoryId: t.id, targets: targets.map((i) => i.id), count, what: 'defense' }],
      });
    }
    case 'danger-recon': {
      const t = target();
      const ceiling = MISSIONS.dangerReconCeiling[difficulty];
      const duration = MISSIONS.dangerReconTime[difficulty];
      const escape = escapeDistance(t, on(t));
      return make(distanceTo(t) + escape / 2, {
        title: `Dangerous recon: ${t.id}`,
        description: `Spend ${duration} s over ${t.id} (below ${ceiling} m) under its guns, then escape more than ${escape} m from it.`,
        ordered: true,
        objectives: [
          { kind: 'recon', territoryId: t.id, airspace: airspace(t, ceiling), duration },
          { kind: 'escape', territoryId: t.id, x: t.x, z: t.z, distance: escape },
        ],
      });
    }
    case 'fortified': {
      const t = target();
      const depot = on(t).find((i) => i.kind === 'supply');
      if (!depot) throw new Error('A fortified strike needs a supply depot');
      return make(distanceTo(t), {
        title: `Fortified strike: ${t.id}`,
        description: `Destroy the marked supply depot inside ${THREAT.levels[t.threat].label.toLowerCase()} ${t.id}. Ink barely dents it: bomb it.`,
        bombs: 1 + spareBombs,
        objectives: [{ kind: 'destroy', territoryId: t.id, targets: [depot.id], count: 1, what: 'supply' }],
      });
    }
    case 'multi-stage': {
      const t = target();
      const radar = on(t).find((i) => i.kind === 'radar');
      const depot = on(t).find((i) => i.kind === 'supply');
      if (!radar || !depot) throw new Error('A multi-stage strike needs a radar and a supply depot');
      // There and home again, but the trip shouldn't outweigh the three jobs on the way.
      return make(distanceTo(t) * 1.5, {
        title: `Multi-stage strike: ${t.id}`,
        description: `Knock out ${t.id}'s radar, then destroy its supply depot, then land on ${home.id}.`,
        bombs: 1 + spareBombs,
        ordered: true,
        objectives: [
          { kind: 'destroy', territoryId: t.id, targets: [radar.id], count: 1, what: 'radar' },
          { kind: 'destroy', territoryId: t.id, targets: [depot.id], count: 1, what: 'supply' },
          { kind: 'land', territoryId: home.id },
        ],
      });
    }
    case 'survival': {
      const t = target();
      const duration = MISSIONS.survivalTime[difficulty];
      const ceiling = MISSIONS.survivalCeiling;
      return make(distanceTo(t), {
        title: `Hold out over ${t.id}`,
        description: `Stay in ${t.id}'s airspace (below ${ceiling} m) for ${duration} s in total while its defenses shoot at you.`,
        objectives: [{ kind: 'survive', territoryId: t.id, airspace: airspace(t, ceiling), duration }],
      });
    }
    case 'low-attack': {
      const t = target();
      const ceiling = MISSIONS.lowCeiling[difficulty];
      const radius = MISSIONS.lowApproachRadius;
      const objective = bombObjective(t, MISSIONS.bullseyeRadius[difficulty]);
      if (objective.kind === 'bomb') objective.approach = { x: t.x, z: t.z, radius, ceiling };
      return make(distanceTo(t), {
        title: `Low-level strike: ${t.id}`,
        description: `Hit the bullseye on ${t.id}. Within ${radius} m of it, stay below ${ceiling} m or the run doesn't count.`,
        bombs: 1 + spareBombs,
        objectives: [objective],
      });
    }
    case 'dogfight': {
      const t = target();
      const id = airId(type, 'fighter');
      return make(distanceTo(t), {
        title: `Dogfight over ${t.id}`,
        description: `A ${pilot(difficulty)} enemy Falcon patrols ${t.id}. Shoot it down: it fights back.`,
        objectives: [{ kind: 'intercept', territoryId: t.id, targets: [id], count: 1, what: 'fighter' }],
        aircraft: [{ orders: patrolPlan(ctx.territories, [t.id], 'fighter', difficulty, id, rng, 'mission') }],
      });
    }
    case 'scout-intercept': {
      const path = flightPath(target(), type, difficulty, ctx, rng);
      const id = airId(type, 'scout');
      const last = path[path.length - 1];
      return make(distanceTo(path[Math.floor(path.length / 2)]), {
        title: 'Intercept the scout',
        description: `A ${pilot(difficulty)} enemy Dart is scouting ${listing(path.map((t) => t.id))}. Shoot it down before it slips away beyond ${last.id}: once it spots you, it runs.`,
        objectives: [{ kind: 'intercept', territoryId: path[0].id, targets: [id], count: 1, what: 'scout', before: 'escape' }],
        aircraft: [{ orders: scoutPlan(ctx.territories, path.map((t) => t.id), difficulty, id, rng, 'mission', true), delay: 2 }],
      });
    }
    case 'bomber-intercept': {
      const origin = target();
      const store = homeStore(ctx);
      if (!store) throw new Error('A bomber interception needs the paper store on home');
      const id = airId(type, 'bomber');
      const escort = difficulty === 'hard';
      const plan = raidPlan(origin, store, difficulty, id, rng, escort);
      return make(distanceTo(origin) * 0.6, {
        title: `Stop the raid on ${home.id}`,
        description: `A ${pilot(difficulty)} enemy Widewing${escort ? ' with a fighter escort' : ''} sets out from beyond ${origin.id} for your paper store. Shoot it down before it releases its bomb.`,
        objectives: [{ kind: 'intercept', territoryId: home.id, targets: [id], count: 1, what: 'bomber', before: 'release' }],
        aircraft: plan.map((orders) => ({ orders, raid: true })),
      });
    }
    case 'escort': {
      const t = target();
      const zone = bombObjective(t, MISSIONS.bullseyeRadius[difficulty]);
      if (zone.kind !== 'bomb') throw new Error('expected a bullseye');
      const id = airId(type, 'bomber');
      const bomber = friendlyBomberPlan(home, t, zone.zone, 'hard', id);
      const from = farSide(t, home, ctx);
      const count = difficulty === 'easy' ? 1 : 2;
      const eta = flightTime(bomber);
      const fighters = Array.from({ length: count }, (_, i) => ({
        orders: interceptorPlan(from, id, difficulty, airId(type, 'fighter'), rng, 'mission'),
        // Early enough to meet the bomber on its way in, before its run.
        delay: Math.round(Math.max(0, eta * 0.2 - 2) + i * 4),
      }));
      return make(distanceTo(t) * 1.5, {
        title: `Escort the bomber to ${t.id}`,
        description: `Your Widewing is going to bomb ${t.id}. ${count === 1 ? `A ${pilot(difficulty)} enemy fighter` : `Two ${pilot(difficulty)} enemy fighters`} will come for it: keep them off until its bomb hits.`,
        objectives: [{ kind: 'escort', territoryId: t.id, escort: id, zone: zone.zone }],
        aircraft: [{ orders: bomber }, ...fighters],
      });
    }
    case 'patrol': {
      const t = target();
      const duration = MISSIONS.patrolTime[difficulty];
      const plan: Array<[AiRole, number]> =
        difficulty === 'easy' ? [['scout', 0.2]] : difficulty === 'medium' ? [['scout', 0.15], ['fighter', 0.5]] : [['fighter', 0.1], ['scout', 0.35], ['fighter', 0.6]];
      const crossing = [...shuffled(rng, neighbours(ctx.territories, t).filter((n) => n.id !== ctx.homeId))];
      const intruders: AirSpawn[] = plan.map(([role, after]) => {
        const id = airId(type, role);
        // Scouts crossing a patrol are a step less wily than the card: they run, but can be caught.
        const orders =
          role === 'scout'
            ? scoutPlan(ctx.territories, [...crossing.slice(0, 1), t, ...crossing.slice(1, 2)].map((x) => x.id), easier(difficulty), id, rng, 'mission')
            : patrolPlan(ctx.territories, [t.id], 'fighter', difficulty, id, rng, 'mission');
        return { orders, afterPatrol: after };
      });
      const ids = intruders.map((i) => i.orders.id);
      return make(distanceTo(t), {
        title: `Patrol over ${t.id}`,
        description: `Fly ${duration} s in the airspace over ${t.id} and shoot down every intruder: ${ids.length === 1 ? 'one is' : `${ids.length} are`} expected.`,
        objectives: [
          { kind: 'patrol', territoryId: t.id, airspace: { x: t.x, z: t.z, half: t.half + MISSIONS.patrolMargin, ceiling: MISSIONS.patrolCeiling }, duration },
          { kind: 'intercept', territoryId: t.id, targets: ids, count: ids.length, what: 'aircraft', before: 'escape' },
        ],
        aircraft: intruders,
      });
    }
    case 'combined': {
      const t = target();
      const id = airId(type, 'fighter');
      return make(distanceTo(t), {
        title: `Combined strike: ${t.id}`,
        description: `Hit the bullseye on ${t.id}. Its guns are manned, and a ${pilot(difficulty)} Falcon patrols overhead: dodge it or shoot it down.`,
        bombs: 1 + spareBombs,
        objectives: [bombObjective(t, MISSIONS.bullseyeRadius[difficulty])],
        aircraft: [{ orders: patrolPlan(ctx.territories, [t.id], 'fighter', difficulty, id, rng, 'mission') }],
      });
    }
  }
}

let airSerial = 0;

/** A unique id for an aircraft a mission sends up. */
function airId(type: MissionType, role: string): string {
  return `${type}-${++airSerial}-${role}`;
}

/** One skill level down (rookies stay rookies). */
function easier(difficulty: Difficulty): Difficulty {
  return difficulty === 'hard' ? 'medium' : 'easy';
}

/** "rookie", "regular" or "veteran". */
function pilot(difficulty: Difficulty): string {
  return AI.skill[difficulty].label.toLowerCase();
}

/** "T3, T6 and T9". */
function listing(ids: readonly string[]): string {
  return ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/** What raiders bomb: the paper store on home. */
function homeStore(ctx: MissionContext): Strike | null {
  const store = (ctx.installations ?? []).find((i) => i.territoryId === ctx.homeId && i.kind === 'supply');
  return store ? { territoryId: ctx.homeId, x: store.x, y: 0, z: store.z, radius: RAIDS.hitRadius } : null;
}

/** Up to three neighbouring territories, starting at `start`, all fit for the mission: a scout's beat. */
function flightPath(start: Territory, type: MissionType, difficulty: Difficulty, ctx: MissionContext, rng: Rng): Territory[] {
  const path = [start];
  while (path.length < 3) {
    const next = shuffled(rng, neighbours(ctx.territories, path[path.length - 1])).find(
      (t) => t.id !== ctx.homeId && !path.includes(t) && inWindow(t.threat, type, difficulty),
    );
    if (!next) break;
    path.push(next);
  }
  return path;
}

/** Where enemy fighters come from to meet a bomber heading for `t`: its neighbour furthest from home. */
function farSide(t: Territory, home: Territory, ctx: MissionContext): Territory {
  const away = (x: Territory) => Math.hypot(x.x - home.x, x.z - home.z);
  return neighbours(ctx.territories, t).reduce((best, n) => (away(n) > away(best) ? n : best), t);
}

/**
 * The defenses a mission leads into: every defended territory it has objectives on, and for a
 * ring course, every territory whose weapons reach one of its rings.
 */
export function missionThreat(objectives: readonly Objective[], ctx: MissionContext): MissionThreat {
  const ids = new Set<string>();
  const installations = (ctx.installations ?? []).filter((i) => i.side !== 'player');
  for (const o of objectives) {
    if (o.kind === 'ring') {
      for (const w of installations) {
        if ((w.kind === 'turret' || w.kind === 'launcher') && Math.hypot(w.x - o.gate.x, o.gate.y - 2, w.z - o.gate.z) <= w.range) ids.add(w.territoryId);
      }
    } else if (o.kind !== 'land') {
      ids.add(o.territoryId);
    }
  }
  const territories = ctx.territories.filter((t) => ids.has(t.id) && t.threat > 0);
  const count = (kind: InstallationInfo['kind']) => installations.filter((i) => i.kind === kind && territories.some((t) => t.id === i.territoryId)).length;
  return {
    level: territories.reduce<ThreatLevel>((max, t) => (t.threat > max ? t.threat : max), 0),
    territories: territories.map((t) => t.id),
    turrets: count('turret'),
    launchers: count('launcher'),
    radars: count('radar'),
  };
}

/** "2 ink turrets + 1 rocket launcher", or with an article: "both ink turrets and the rocket launcher". */
export function defenseList(turrets: number, launchers: number, article: 'counts' | 'the' = 'counts'): string {
  const parts: string[] = [];
  if (article === 'counts') {
    if (turrets) parts.push(`${turrets} ink turret${turrets === 1 ? '' : 's'}`);
    if (launchers) parts.push(`${launchers} rocket launcher${launchers === 1 ? '' : 's'}`);
    return parts.join(' + ') || 'no weapons';
  }
  if (turrets) parts.push(turrets === 1 ? 'the ink turret' : turrets === 2 ? 'both ink turrets' : `all ${turrets} ink turrets`);
  if (launchers) parts.push(launchers === 1 ? 'the rocket launcher' : `all ${launchers} rocket launchers`);
  return parts.join(' and ');
}

/**
 * Reward = (type base + distance bonus + threat bonus + air bonus) × difficulty multiplier, rounded
 * to a multiple of 5. The threat bonus adds up each defended territory's level bonus, scaled by how
 * long the mission type keeps the player under fire, so danger pays without being the only thing
 * that does; the air bonus pays for each enemy aircraft by its pilot's skill.
 */
export function missionReward(
  type: MissionType,
  difficulty: Difficulty,
  distance: number,
  threats: readonly ThreatLevel[] = [],
  pilots: readonly Difficulty[] = [],
): number {
  const danger = threats.reduce<number>((sum, level) => sum + THREAT.rewardBonus[level], 0) * MISSIONS.exposure[type];
  const air = pilots.reduce((sum, skill) => sum + MISSIONS.airBonus[skill], 0);
  const raw = (MISSIONS.baseReward[type] + distance * MISSIONS.distanceReward + danger + air) * MISSIONS.difficulty[difficulty].multiplier;
  return Math.max(5, Math.round(raw / 5) * 5);
}

const CODE_ADJECTIVES = ['Paper', 'Ink', 'Crease', 'Origami', 'Pencil', 'Graphite', 'Staple', 'Eraser', 'Cardboard', 'Crayon', 'Folded', 'Inkwell'];
const CODE_NOUNS = ['Storm', 'Hawk', 'Comet', 'Lantern', 'Crane', 'Thunder', 'Arrow', 'Kite', 'Sparrow', 'Tempest', 'Owl', 'Meteor', 'Gale', 'Heron'];

export function codename(rng: Rng): string {
  return `Operation ${pick(rng, CODE_ADJECTIVES)} ${pick(rng, CODE_NOUNS)}`;
}

/** Territories a mission of this type could target, whatever their threat. */
function eligible(type: MissionType, difficulty: Difficulty, ctx: MissionContext): Territory[] {
  const on = (t: Territory) => (ctx.installations ?? []).filter((i) => i.territoryId === t.id);
  return ctx.territories.filter((t) => {
    if (t.id === ctx.homeId) return false;
    switch (type) {
      case 'practice':
        return (ctx.dummies ?? []).filter((d) => d.territoryId === t.id).length >= MISSIONS.practiceCount[difficulty];
      case 'suppression':
        return on(t).some((i) => i.kind === 'turret' || i.kind === 'launcher');
      case 'fortified':
        return on(t).some((i) => i.kind === 'supply');
      case 'multi-stage':
        return on(t).some((i) => i.kind === 'radar') && on(t).some((i) => i.kind === 'supply');
      case 'bomber-intercept':
        return MISSIONS.raidOrigins[difficulty].includes(t.id) && homeStore(ctx) !== null;

      default:
        return t.threat >= ((MISSIONS.minThreat as Partial<Record<MissionType, number>>)[type] ?? 0) && t.threat <= (MISSIONS.maxThreat[type] ?? 3);
    }
  });
}

/**
 * Targets for a mission: eligible territories inside its threat window. If none (an unusual
 * world), the eligible ones nearest the window, so a mission can always be made.
 */
function candidates(type: MissionType, difficulty: Difficulty, ctx: MissionContext, needed = 1): Territory[] {
  const all = eligible(type, difficulty, ctx);
  const fitting = all.filter((t) => inWindow(t.threat, type, difficulty));
  if (fitting.length >= needed) return fitting;
  const [lo, hi] = threatWindow(type, difficulty);
  const gap = (t: Territory) => (t.threat < lo ? lo - t.threat : t.threat > hi ? t.threat - hi : 0);
  const sorted = [...all].sort((a, b) => gap(a) - gap(b));
  if (sorted.length === 0) throw new Error(`No territory can host a ${type} mission`);
  const cut = gap(sorted[Math.min(needed, sorted.length) - 1]);
  return sorted.filter((t) => gap(t) <= cut);
}

function inWindow(level: ThreatLevel, type: MissionType, difficulty: Difficulty): boolean {
  // A raider can set out from anywhere far: the fight comes to home.
  if (type === 'bomber-intercept') return true;
  const [lo, hi] = threatWindow(type, difficulty);
  return level >= lo && level <= hi;
}

/** How far from a territory's centre the plane is clear of all its weapons, plus a margin. */
function escapeDistance(t: Territory, installations: readonly InstallationInfo[]): number {
  let reach = t.half + 30;
  for (const w of installations) {
    if (w.kind === 'turret' || w.kind === 'launcher') reach = Math.max(reach, Math.hypot(w.x - t.x, w.z - t.z) + w.range);
  }
  return Math.ceil((reach + MISSIONS.escapeMargin) / 5) * 5;
}

/**
 * A spot away from the centre, on the territory, clear of props, stands and installations. On a
 * crowded territory, if no random spot is fully clear, the one with the most room is used.
 */
function precisionSpot(t: Territory, radius: number, obstacles: ReadonlyArray<{ x: number; z: number; r: number }>, rng: Rng) {
  let best = { x: t.x, z: t.z };
  let bestRoom = -Infinity;
  for (let attempt = 0; attempt < 150; attempt++) {
    const angle = rng() * Math.PI * 2;
    const offset = randRange(rng, 5, t.half - 6);
    const spot = { x: t.x + Math.cos(angle) * offset, z: t.z + Math.sin(angle) * offset };
    const room = Math.min(...obstacles.map((o) => Math.hypot(o.x - spot.x, o.z - spot.z) - o.r - radius));
    if (room > bestRoom) {
      best = spot;
      bestRoom = room;
    }
    if (room >= MISSIONS.precisionClearance) break;
  }
  return best;
}

type Parts = Pick<MissionSpec, 'title' | 'description' | 'objectives'> & Partial<Pick<MissionSpec, 'bombs' | 'timeLimit' | 'ordered' | 'aircraft'>>;

function spec(type: MissionType, difficulty: Difficulty, distance: number, parts: Parts, ctx: MissionContext, rng: Rng): MissionSpec {
  const threat = missionThreat(parts.objectives, ctx);
  const levels = threat.territories.map((id) => ctx.territories.find((t) => t.id === id)!.threat);
  const enemies = (parts.aircraft ?? []).map((a) => a.orders).filter((o) => o.side === 'enemy');
  if (enemies.length > 0) {
    const count = (role: AiRole) => enemies.filter((o) => o.role === role).length;
    threat.air = { fighters: count('fighter'), scouts: count('scout'), bombers: count('bomber'), skill: difficulty };
  }
  return {
    type,
    difficulty,
    reward: missionReward(type, difficulty, distance, levels, enemies.map((o) => o.skill)),
    bombs: 0,
    timeLimit: null,
    ordered: false,
    threat,
    codename: codename(rng),
    ...parts,
  };
}

function bombObjective(t: Territory, radius: number, x = t.x, z = t.z): Objective {
  const zone: TargetZone = { x, z, radius, top: t.top + MISSIONS.targetHeight };
  return { kind: 'bomb', territoryId: t.id, zone, precision: x !== t.x || z !== t.z };
}

function airspace(t: Territory, ceiling: number) {
  return { x: t.x, z: t.z, half: t.half, ceiling };
}

/**
 * Lays out a ring course over the gaps between territories. Gap crossings and the gaps between
 * neighbouring platforms form a grid of waypoints; the course is a random walk along it that
 * starts at the crossing nearest home, prefers to keep going straight and never turns twice in a
 * row, so every ring can be reached with a comfortable turn.
 */
export function ringCourse(ctx: MissionContext, count: number, radius: number, rng: Rng): RingGate[] {
  const gridSize = ctx.gridSize ?? WORLD.gridSize;
  const spacing = ctx.spacing ?? WORLD.territorySize + WORLD.gap;
  const offset = gridSize - 1;
  const max = 2 * (gridSize - 1);
  // Half-step grid coordinates: even = a row/column of territory centres, odd = a gap.
  const coord = (k: number) => ((k - offset) / 2) * spacing;
  const valid = (i: number, j: number) => i >= 0 && j >= 0 && i <= max && j <= max && (i % 2 === 1 || j % 2 === 1);
  const home = ctx.territories.find((t) => t.id === ctx.homeId)!;
  const toHalf = (v: number) => Math.round((v / spacing) * 2 + offset);
  const hi = toHalf(home.x);
  const hj = toHalf(home.z);
  // The gap crossing diagonally inward from home.
  const start: [number, number] = [hi + (hi < offset ? 1 : -1), hj + (hj < offset ? 1 : -1)];
  const startDir: [number, number] = [Math.sign(start[0] - hi), Math.sign(start[1] - hj)];

  let path: Array<[number, number]> = [start];
  for (let attempt = 0; attempt < 30; attempt++) {
    path = [start];
    let dir = startDir;
    let turnedLast = false;
    while (path.length < count) {
      const [ci, cj] = path[path.length - 1];
      const options: Array<{ step: [number, number]; weight: number; turn: boolean }> = [];
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const ni = ci + step[0];
        const nj = cj + step[1];
        if (!valid(ni, nj) || path.some(([pi, pj]) => pi === ni && pj === nj)) continue;
        const dot = step[0] * dir[0] + step[1] * dir[1];
        if (dot < 0) continue;
        const turn = dir[0] !== 0 && dir[1] !== 0 ? false : dot === 0;
        options.push({ step, turn, weight: turn ? (turnedLast ? 0.15 : 1) : 3 });
      }
      if (options.length === 0) break;
      let roll = rng() * options.reduce((sum, o) => sum + o.weight, 0);
      const choice = options.find((o) => (roll -= o.weight) <= 0) ?? options[options.length - 1];
      path.push([ci + choice.step[0], cj + choice.step[1]]);
      dir = choice.step;
      turnedLast = choice.turn;
    }
    if (path.length >= count) break;
  }

  const points = path.map(([i, j]) => ({ x: coord(i), z: coord(j) }));
  const gates: RingGate[] = [];
  let height = randRange(rng, 10, 16);
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const prev = k > 0 ? points[k - 1] : ctx.launch;
    const next = points[k + 1];
    let dx = unit(p.x - prev.x, p.z - prev.z);
    if (next) {
      const out = unit(next.x - p.x, next.z - p.z);
      dx = unit(dx[0] + out[0], dx[1] + out[1]);
    }
    if (k > 0) height = clamp(height + randRange(rng, -7, 7), MISSIONS.ringMinHeight, MISSIONS.ringMaxHeight);
    gates.push({ x: p.x, y: height, z: p.z, yaw: Math.atan2(-dx[0], -dx[1]), radius });
  }
  return gates;
}

function unit(x: number, z: number): [number, number] {
  const len = Math.hypot(x, z) || 1;
  return [x / len, z / len];
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

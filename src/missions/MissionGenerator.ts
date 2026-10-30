import { MISSIONS, WORLD, type Difficulty } from '../config';
import { pick, randRange, shuffled, type Rng } from '../systems/Random';
import type { Territory } from '../world/Territory';
import { Mission, type MissionSpec, type MissionType, type Objective, type RingGate, type TargetZone } from './Mission';

export const MISSION_TYPES: readonly MissionType[] = ['bombing', 'precision', 'recon', 'delivery', 'return', 'multi-bomb', 'rings', 'practice'];

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

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
}

/**
 * Offers `count` mission cards with different mission types. With three cards there is one of
 * each difficulty, so there is always a safe choice and a lucrative one.
 */
export function generateOffers(ctx: MissionContext, rng: Rng, count: number = MISSIONS.offers): Mission[] {
  const available = MISSION_TYPES.filter((type) => type !== 'practice' || practiceTerritories(ctx, 'hard').length > 0);
  const types = shuffled(rng, available).slice(0, count);
  const difficulties = shuffled(rng, DIFFICULTIES);
  return types.map((type, i) => new Mission(generateMission(type, difficulties[i % difficulties.length], ctx, rng)));
}

export function generateMission(type: MissionType, difficulty: Difficulty, ctx: MissionContext, rng: Rng): MissionSpec {
  const targets = ctx.territories.filter((t) => t.id !== ctx.homeId);
  const home = ctx.territories.find((t) => t.id === ctx.homeId)!;
  const distanceTo = (t: { x: number; z: number }, from: { x: number; z: number } = ctx.launch) =>
    Math.hypot(t.x - from.x, t.z - from.z);
  const spareBombs = MISSIONS.spareBombs[difficulty];

  switch (type) {
    case 'bombing': {
      const t = pick(rng, targets);
      return spec(type, difficulty, distanceTo(t), {
        title: `Bomb ${t.id}`,
        description: `Hit the bullseye on ${t.id}.`,
        bombs: 1 + spareBombs,
        objectives: [bombObjective(t, MISSIONS.bullseyeRadius[difficulty])],
      });
    }
    case 'precision': {
      const t = pick(rng, targets);
      const radius = MISSIONS.precisionRadius[difficulty];
      const spot = precisionSpot(t, radius, ctx.obstacles ?? [], rng);
      return spec(type, difficulty, distanceTo(t), {
        title: `Precision strike: ${t.id}`,
        description: `Hit the small ink-blue spot on ${t.id}. Aim carefully.`,
        bombs: 1 + spareBombs,
        objectives: [bombObjective(t, radius, spot.x, spot.z)],
      });
    }
    case 'recon': {
      const t = pick(rng, targets);
      const ceiling = MISSIONS.reconCeiling[difficulty];
      const duration = MISSIONS.reconTime[difficulty];
      return spec(type, difficulty, distanceTo(t), {
        title: `Scout ${t.id}`,
        description: `Fly low over ${t.id} (below ${ceiling} m) for ${duration} s in total.`,
        objectives: [{ kind: 'recon', territoryId: t.id, airspace: airspace(t, ceiling), duration }],
      });
    }
    case 'delivery': {
      const t = pick(rng, targets);
      const distance = distanceTo(t) - t.half;
      const limit = Math.ceil((distance / MISSIONS.referenceSpeed) * MISSIONS.deliverySlack[difficulty] + MISSIONS.deliveryExtraTime);
      return spec(type, difficulty, distanceTo(t), {
        title: `Rush delivery to ${t.id}`,
        description: `Reach ${t.id}'s airspace within ${limit} s.`,
        timeLimit: limit,
        objectives: [{ kind: 'reach', territoryId: t.id, airspace: airspace(t, MISSIONS.deliveryCeiling) }],
      });
    }
    case 'return': {
      const t = pick(rng, targets);
      return spec(type, difficulty, distanceTo(t) * 2, {
        title: `Strike & return: ${t.id}`,
        description: `Bomb ${t.id}, then land safely back on ${home.id}.`,
        bombs: 1 + spareBombs,
        ordered: true,
        objectives: [bombObjective(t, MISSIONS.bullseyeRadius[difficulty]), { kind: 'land', territoryId: home.id }],
      });
    }
    case 'multi-bomb': {
      const [a, b] = shuffled(rng, targets)
        .slice(0, 2)
        .sort((p, q) => distanceTo(p) - distanceTo(q));
      return spec(type, difficulty, distanceTo(a) + distanceTo(b, a), {
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
      return spec(type, difficulty, length, {
        title: 'Ring run',
        description: `Fly through ${gates.length} paper rings in order${limit ? ` within ${limit} s` : ''}.`,
        timeLimit: limit,
        ordered: true,
        objectives: gates.map((gate, i) => ({ kind: 'ring', gate, number: i + 1 })),
      });
    }
    case 'practice': {
      const candidates = practiceTerritories(ctx, difficulty);
      if (candidates.length === 0) throw new Error('Target practice needs practice planes on the territories');
      const id = pick(rng, candidates);
      const t = targets.find((x) => x.id === id)!;
      const dummies = (ctx.dummies ?? []).filter((d) => d.territoryId === id).map((d) => d.id);
      const count = Math.min(MISSIONS.practiceCount[difficulty], dummies.length);
      const limit = difficulty === 'hard' ? Math.ceil(distanceTo(t) / MISSIONS.referenceSpeed + MISSIONS.practiceTimeHard) : null;
      const all = count === dummies.length;
      return spec(type, difficulty, distanceTo(t), {
        title: `Target practice: ${t.id}`,
        description: `Shoot down ${all ? `all ${count}` : `${count} of the`} practice planes over ${t.id}${limit ? ` within ${limit} s` : ''}.`,
        timeLimit: limit,
        objectives: [{ kind: 'destroy', territoryId: t.id, targets: dummies, count }],
      });
    }
  }
}

/** Territories with enough practice planes for a target practice mission at this difficulty. */
function practiceTerritories(ctx: MissionContext, difficulty: Difficulty): string[] {
  const counts = new Map<string, number>();
  for (const d of ctx.dummies ?? []) if (d.territoryId !== ctx.homeId) counts.set(d.territoryId, (counts.get(d.territoryId) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= MISSIONS.practiceCount[difficulty]).map(([id]) => id);
}

/** A spot away from the centre, on the territory, clear of props and stands. */
function precisionSpot(t: Territory, radius: number, obstacles: ReadonlyArray<{ x: number; z: number; r: number }>, rng: Rng) {
  let spot = { x: t.x, z: t.z };
  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = rng() * Math.PI * 2;
    const offset = randRange(rng, 5, t.half - 6);
    spot = { x: t.x + Math.cos(angle) * offset, z: t.z + Math.sin(angle) * offset };
    const clear = obstacles.every((o) => Math.hypot(o.x - spot.x, o.z - spot.z) >= o.r + radius + MISSIONS.precisionClearance);
    if (clear) break;
  }
  return spot;
}

/** Reward = (type base + distance bonus) × difficulty multiplier, rounded to a multiple of 5. */
export function missionReward(type: MissionType, difficulty: Difficulty, distance: number): number {
  const raw = (MISSIONS.baseReward[type] + distance * MISSIONS.distanceReward) * MISSIONS.difficulty[difficulty].multiplier;
  return Math.max(5, Math.round(raw / 5) * 5);
}

function spec(
  type: MissionType,
  difficulty: Difficulty,
  distance: number,
  parts: Pick<MissionSpec, 'title' | 'description' | 'objectives'> & Partial<Pick<MissionSpec, 'bombs' | 'timeLimit' | 'ordered'>>,
): MissionSpec {
  return {
    type,
    difficulty,
    reward: missionReward(type, difficulty, distance),
    bombs: 0,
    timeLimit: null,
    ordered: false,
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

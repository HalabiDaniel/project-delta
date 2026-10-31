import type { Shape } from '../combat/Collision';
import { BASE, DEFENSES, MISSIONS, THREAT, WORLD, type BuildingKind, type Side, type ThreatLevel } from '../config';
import type { Territory } from '../world/Territory';

/**
 * turret   – an ink turret: rapid fire, short range, a blind spot behind it.
 * launcher – a paper rocket launcher: slow, long range, homing rockets.
 * radar    – a radar station: spots planes early for every weapon on its territory.
 * supply   – a supply depot: no weapon, but the marked target of fortified and multi-stage strikes.
 *            On T1 it is the player's paper store.
 * workshop – a paper workshop (T1, player-built): more paper per minute.
 * storage  – a storage box (T1, player-built): holds and protects more paper.
 */
export type InstallationKind = 'turret' | 'launcher' | 'radar' | 'supply' | 'workshop' | 'storage';

/** A weapon's numbers where they differ from the defaults in DEFENSES (player buildings by level). */
export interface WeaponStats {
  damage?: number;
  /** Turrets: seconds between rounds; rounds per magazine and seconds to reload it. */
  interval?: number;
  magazine?: number;
  reloadTime?: number;
  /** Launchers: seconds between rockets. */
  reload?: number;
}

export interface InstallationSpec {
  id: string;
  kind: InstallationKind;
  territoryId: string;
  /** The enemy's on T2–T9; the player's own on T1. A weapon only shoots at aircraft of the other side. */
  side: Side;
  /** Shown on the label: "Ink turret". */
  name: string;
  /** Shown under the name: "Rapid fire · short range". */
  role: string;
  /** Centre of its base. */
  x: number;
  z: number;
  /** The platform top it stands on. */
  ground: number;
  /** Height above the ground of the gun pivot, the rocket rails or the radar dish. */
  pivot: number;
  /** Rest heading (scene yaw). Weapons face the middle of their territory; their arc is centred on it. */
  facing: number;
  /** How far either side of `facing` a weapon can turn; null all round. */
  arc: number | null;
  /** Engagement range for weapons, detection range for radars, 0 for depots. */
  range: number;
  maxHealth: number;
  /** Ground it takes up, for keeping things apart. */
  footprint: number;
  /** What ink rounds and bombs can hit. */
  shapes: Shape[];
  /** What a plane flies into. */
  solids: Shape[];
  /** Player buildings: the construction slot it stands in, and its level (1–3). */
  slot?: string;
  level?: number;
  stats?: WeaponStats;
  /** Which aircraft it deals with first: the nearest (default), or bombers before anything else. */
  prefer?: 'nearest' | 'bomber';
}

/** A low cardboard wall around a turret's back: scenery, but solid. */
export interface BarrierSpec {
  id: string;
  territoryId: string;
  x: number;
  z: number;
  yaw: number;
  length: number;
  height: number;
  thickness: number;
  solids: Shape[];
}

/** A paper flag in the threat level's colour, planted on every defended territory. */
export interface FlagSpec {
  territoryId: string;
  x: number;
  z: number;
  level: ThreatLevel;
}

export interface DefenseLayout {
  installations: InstallationSpec[];
  barriers: BarrierSpec[];
  flags: FlagSpec[];
}

/** Ground already taken (props, pencil stands), as circles. */
export interface Footprint {
  x: number;
  z: number;
  r: number;
}

type SlotTag = 'corner' | 'edge' | 'inner';

interface Slot {
  x: number;
  z: number;
  tag: SlotTag;
}

/** Placement styles, so territories don't all look alike: towers in the corners, near the middle, or along the edges. */
const STYLES: ReadonlyArray<readonly SlotTag[]> = [
  ['corner', 'edge', 'inner'],
  ['inner', 'corner', 'edge'],
  ['edge', 'inner', 'corner'],
];

/** Distance from a weapon to the next one on its territory it prefers to keep. */
const WEAPON_SPACING = 14;
/** Gap kept between neighbouring footprints. */
const CLEARANCE = 1.2;
/** Barrier walls stand this far from the turret's centre. */
const BARRIER_RING = 2.4;

/**
 * Places the defenses on every territory according to its threat level: weapons first (they have
 * the strictest needs), then the radar and the supply depot. Each territory picks its spots in its
 * own style and rotation, keeps the middle clear for bullseyes, keeps clear of `occupied` ground
 * (the target range), and keeps its weapons' reach off the home platform and the first stretch
 * after take-off where it can. Home gets the player's own guns and paper store (see homeDefenses).
 */
export function layoutDefenses(territories: readonly Territory[], occupied: readonly Footprint[] = []): DefenseLayout {
  const layout: DefenseLayout = { installations: [], barriers: [], flags: [] };
  const home = territories.find((t) => t.isHome);
  if (home) layout.installations.push(...homeDefenses(home));
  territories
    .filter((t) => !t.isHome)
    .forEach((t, k) => {
      if (t.threat === 0) return;
      const profile = THREAT.levels[t.threat];
      const taken: Footprint[] = occupied.filter((o) => t.containsXZ(o.x, o.z, 2));
      const slots = orderedSlots(t, k);
      const weapons: Footprint[] = [];
      type Placed = 'turret' | 'launcher' | 'radar' | 'supply';
      const plan: Placed[] = [
        ...Array<Placed>(profile.launchers).fill('launcher'),
        ...Array<Placed>(profile.turrets).fill('turret'),
        ...(profile.radar ? (['radar'] as const) : []),
        ...(profile.supply ? (['supply'] as const) : []),
      ];
      const counts: Partial<Record<Placed, number>> = {};
      for (const kind of plan) {
        const slot = pickSlot(t, kind, slots, taken, weapons, home);
        if (!slot) continue;
        const n = (counts[kind] = (counts[kind] ?? 0) + 1);
        const total = plan.filter((p) => p === kind).length;
        const spec = installation(t, kind, slot, total > 1 ? `${kind}${n}` : kind);
        layout.installations.push(spec);
        taken.push({ x: slot.x, z: slot.z, r: spec.footprint });
        if (kind === 'turret' || kind === 'launcher') weapons.push({ x: slot.x, z: slot.z, r: spec.range });
        if (kind === 'turret') layout.barriers.push(...barriers(spec));
      }
      // The flag goes on the first free spot near the rim.
      const rim = t.half - 2;
      for (let j = 0; j < 8; j++) {
        const a = ((j + k * 3) * Math.PI) / 4;
        const x = t.x + Math.round(Math.cos(a)) * rim;
        const z = t.z + Math.round(Math.sin(a)) * rim;
        if (taken.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + 0.6 + CLEARANCE)) {
          layout.flags.push({ territoryId: t.id, x, z, level: t.threat });
          break;
        }
      }
    });
  return layout;
}

/**
 * T1's fixed structure: the paper store, where the player's paper is kept and raiders aim. It
 * belongs to the player. Everything else on T1 is built by the player in its slots (buildingSpec).
 */
export function homeDefenses(home: Territory, side: Side = 'player'): InstallationSpec[] {
  const c = DEFENSES.home;
  const store = installation(home, 'supply', homePoint(home, c.store), 'store', side);
  return [{ ...store, name: c.storeName, role: c.storeRole, maxHealth: c.storeHealth }];
}

/**
 * A point on T1 given as (along the runway towards the world centre, to its right) from the
 * middle of the platform.
 */
export function homePoint(home: Territory, [u, v]: readonly [number, number]): { x: number; z: number; tag: SlotTag } {
  const len = Math.hypot(home.x, home.z) || 1;
  const fx = -home.x / len;
  const fz = -home.z / len;
  return { x: home.x + u * fx - v * fz, z: home.z + u * fz + v * fx, tag: 'inner' };
}

/** Where T1's construction slot `slotId` is, or null if there is no such slot. */
export function slotPoint(home: Territory, slotId: string): { x: number; z: number } | null {
  const slot = BASE.slots.find((s) => s.id === slotId);
  return slot ? homePoint(home, slot.at) : null;
}

/**
 * A building the player put up on T1: a building of `kind` at `level` in slot `slotId`. Weapons
 * face outward from the middle of T1 (so where a slot is decides what a turret covers), take their
 * numbers from the level, and shoot only at hostile aircraft. Launchers deal with bombers first.
 */
export function buildingSpec(home: Territory, slotId: string, kind: BuildingKind, level: number, side: Side = 'player'): InstallationSpec {
  const at = homePoint(home, BASE.slots.find((s) => s.id === slotId)?.at ?? [0, 0]);
  const b = BASE.buildings[kind];
  const lv = b.levels[Math.max(0, Math.min(b.levels.length, level) - 1)];
  const outward = Math.atan2(home.x - at.x, home.z - at.z);
  const base = installation(home, kind, at, slotId, side);
  const spec: InstallationSpec = { ...base, name: b.name, role: b.purpose, facing: outward, maxHealth: lv.health, slot: slotId, level };
  switch (kind) {
    case 'turret':
      return { ...spec, range: lv.range!, stats: { damage: lv.damage, interval: lv.interval, magazine: lv.magazine, reloadTime: lv.reloadTime } };
    case 'launcher':
      return { ...spec, range: lv.range!, stats: { damage: lv.damage, reload: lv.reload }, prefer: 'bomber' };
    case 'radar':
      return { ...spec, range: lv.range! };
    default:
      return spec;
  }
}

/** Is (x, z) over home or close enough to it that nothing may shoot there? */
export function overHome(home: Territory, x: number, z: number): boolean {
  return home.containsXZ(x, z, DEFENSES.homeSafeMargin);
}

/** The gap crossing a plane flies through right after take-off: diagonally inward from home. */
export function departurePoint(home: Territory): { x: number; z: number } {
  const step = home.half + WORLD.gap / 2;
  return { x: home.x - Math.sign(home.x) * step, z: home.z - Math.sign(home.z) * step };
}

/** Does a weapon at (x, z) with this range reach the home platform or the departure point? */
export function reachesHome(home: Territory, x: number, z: number, range: number): boolean {
  const h = home.half + DEFENSES.homeSafeMargin;
  const dx = Math.max(0, Math.abs(x - home.x) - h);
  const dz = Math.max(0, Math.abs(z - home.z) - h);
  if (Math.hypot(dx, dz) <= range) return true;
  const d = departurePoint(home);
  return Math.hypot(x - d.x, z - d.z) <= range + DEFENSES.departureClearance;
}

/** Candidate spots, in this territory's style, each group turned by the territory's index. */
function orderedSlots(t: Territory, k: number): Slot[] {
  const corner = t.half - 4.5;
  const edge = t.half - 4;
  const inner = 11;
  const groups: Record<SlotTag, Slot[]> = { corner: [], edge: [], inner: [] };
  for (let j = 0; j < 4; j++) {
    const a = Math.PI / 4 + ((j + k) * Math.PI) / 2;
    groups.corner.push({ x: t.x + Math.sign(Math.cos(a)) * corner, z: t.z + Math.sign(Math.sin(a)) * corner, tag: 'corner' });
    const b = ((j + k + 1) * Math.PI) / 2;
    groups.edge.push({ x: t.x + Math.round(Math.cos(b)) * edge, z: t.z + Math.round(Math.sin(b)) * edge, tag: 'edge' });
  }
  for (let j = 0; j < 8; j++) {
    const a = ((k * 40 + 22.5 + ((j * 3) % 8) * 45) * Math.PI) / 180;
    groups.inner.push({ x: t.x + Math.cos(a) * inner, z: t.z + Math.sin(a) * inner, tag: 'inner' });
  }
  return STYLES[k % STYLES.length].flatMap((tag) => groups[tag]);
}

/**
 * The first slot that fits. Hard rules: on the platform, clear of the bullseye area and of
 * everything already there. Soft rules, dropped one at a time if nothing fits: weapons keep their
 * reach off home, and keep apart from each other. Depots prefer the inner ring, so bombing runs
 * cross the defended ground.
 */
function pickSlot(
  t: Territory,
  kind: 'turret' | 'launcher' | 'radar' | 'supply',
  slots: readonly Slot[],
  taken: readonly Footprint[],
  weapons: readonly Footprint[],
  home: Territory | undefined,
): Slot | null {
  const r = DEFENSES[kind].footprint;
  const weapon = kind === 'turret' || kind === 'launcher';
  const range = weapon ? DEFENSES[kind].range : 0;
  const centre = MISSIONS.bullseyeRadius.easy + r + 1;
  const fits = (s: Slot) =>
    Math.abs(s.x - t.x) <= t.half - r - 0.5 &&
    Math.abs(s.z - t.z) <= t.half - r - 0.5 &&
    Math.hypot(s.x - t.x, s.z - t.z) >= centre &&
    taken.every((o) => Math.hypot(o.x - s.x, o.z - s.z) >= o.r + r + CLEARANCE);
  const safe = (s: Slot) => !weapon || !home || !reachesHome(home, s.x, s.z, range);
  const spaced = (s: Slot) => !weapon || weapons.every((w) => Math.hypot(w.x - s.x, w.z - s.z) >= WEAPON_SPACING);
  const order = kind === 'supply' ? [...slots.filter((s) => s.tag === 'inner'), ...slots.filter((s) => s.tag !== 'inner')] : slots;
  for (const rules of [[fits, safe, spaced], [fits, safe], [fits]]) {
    const slot = order.find((s) => rules.every((rule) => rule(s)));
    if (slot) return slot;
  }
  return null;
}

function installation(t: Territory, kind: InstallationKind, slot: Slot, suffix: string, side: Side = 'enemy'): InstallationSpec {
  const { x, z } = slot;
  const g = t.top;
  // Facing the middle of the territory (yaw 0 faces -Z).
  const facing = Math.atan2(-(t.x - x), -(t.z - z));
  const base = { id: `${t.id}-${suffix}`, kind, territoryId: t.id, side, x, z, ground: g, facing };
  switch (kind) {
    case 'turret': {
      const c = DEFENSES.turret;
      return {
        ...base, name: c.name, role: c.role, pivot: c.pivot, arc: c.arc, range: c.range, maxHealth: c.health, footprint: c.footprint,
        shapes: [{ kind: 'sphere', x, y: g + 1.5, z, r: 2 }],
        solids: [
          { kind: 'box', x, y: g + 0.6, z, hx: 1.1, hy: 0.6, hz: 1.1, yaw: 0 },
          { kind: 'sphere', x, y: g + c.pivot, z, r: 0.85 },
        ],
      };
    }
    case 'launcher': {
      const c = DEFENSES.launcher;
      return {
        ...base, name: c.name, role: c.role, pivot: c.pivot, arc: null, range: c.range, maxHealth: c.health, footprint: c.footprint,
        shapes: [{ kind: 'sphere', x, y: g + 1.4, z, r: 2.2 }],
        solids: [{ kind: 'box', x, y: g + 0.9, z, hx: 1.1, hy: 0.9, hz: 1.1, yaw: facing }],
      };
    }
    case 'radar': {
      const c = DEFENSES.radar;
      const dish = 5.4;
      return {
        ...base, name: c.name, role: c.role, pivot: dish, arc: null, range: c.range, maxHealth: c.health, footprint: c.footprint,
        shapes: [
          { kind: 'box', x, y: g + dish / 2, z, hx: 0.55, hy: dish / 2, hz: 0.55, yaw: 0 },
          { kind: 'sphere', x, y: g + dish, z, r: 2 },
        ],
        solids: [
          { kind: 'box', x, y: g + dish / 2, z, hx: 0.25, hy: dish / 2, hz: 0.25, yaw: 0 },
          { kind: 'sphere', x, y: g + dish, z, r: 1.3 },
        ],
      };
    }
    case 'supply': {
      const c = DEFENSES.supply;
      const box: Shape = { kind: 'box', x, y: g + 1.3, z, hx: 1.9, hy: 1.3, hz: 1.6, yaw: facing };
      return {
        ...base, name: c.name, role: c.role, pivot: 2.6, arc: null, range: 0, maxHealth: c.health, footprint: c.footprint,
        shapes: [box],
        solids: [box],
      };
    }
    case 'workshop': {
      const b = BASE.buildings.workshop;
      const box: Shape = { kind: 'box', x, y: g + 1.2, z, hx: 1.8, hy: 1.2, hz: 1.5, yaw: facing };
      return {
        ...base, name: b.name, role: b.purpose, pivot: 2.4, arc: null, range: 0, maxHealth: b.levels[0].health, footprint: 2.8,
        shapes: [box, { kind: 'box', x, y: g + 3, z, hx: 0.35, hy: 0.6, hz: 0.35, yaw: facing }],
        solids: [box],
      };
    }
    case 'storage': {
      const b = BASE.buildings.storage;
      const box: Shape = { kind: 'box', x, y: g + 1.1, z, hx: 1.7, hy: 1.1, hz: 1.7, yaw: facing };
      return {
        ...base, name: b.name, role: b.purpose, pivot: 2.2, arc: null, range: 0, maxHealth: b.levels[0].health, footprint: 2.6,
        shapes: [box],
        solids: [box],
      };
    }
  }
}

/** Three low walls around a turret's back and sides, open towards where it faces. */
function barriers(turret: InstallationSpec): BarrierSpec[] {
  const length = 2.4;
  const height = 1;
  const thickness = 0.35;
  return [Math.PI, Math.PI / 2, -Math.PI / 2].map((offset, i) => {
    const yaw = turret.facing + offset;
    const x = turret.x - Math.sin(yaw) * BARRIER_RING;
    const z = turret.z - Math.cos(yaw) * BARRIER_RING;
    return {
      id: `${turret.id}-wall${i + 1}`,
      territoryId: turret.territoryId,
      x, z, yaw, length, height, thickness,
      solids: [{ kind: 'box', x, y: turret.ground + height / 2, z, hx: length / 2, hy: height / 2, hz: thickness / 2, yaw }],
    };
  });
}

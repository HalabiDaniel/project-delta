/**
 * Every tuning number lives here so playtesting can adjust them in one place.
 * All values are provisional. Distances are world units (shown as "m" in the HUD), times are
 * seconds, angles are radians unless the name says otherwise.
 */

const DEG = Math.PI / 180;

/**
 * Whose side something is on: the player's (their plane, T1's guns, a friendly AI bomber) or the
 * enemy's. In multiplayer every player is a side of their own (`p:<id>`): their plane, their base
 * and their friendly AI. Rounds and weapons only ever compare sides, so this is all they need.
 */
export type PlayerSide = `p:${string}`;
export type Side = 'player' | 'enemy' | PlayerSide;

/** How targets, shots and kills refer to the player's own plane. */
export const PLAYER_ID = 'player';

export const ECONOMY = {
  startingPaper: 100,
  /**
   * Enemy raids never take the balance below this, so the player can always fold a plane. Storage
   * boxes protect more on top (BASE.buildings.storage).
   */
  protectedPaper: 50,
  /**
   * The free emergency Swift (STARTER_AIRCRAFT's pattern), offered only when the player can afford no
   * plane at all: folded from scrap, with half the ink and no bomb, for one sortie
   * (it is not kept afterwards). Before v0.0.11 it was an emergency Dart.
   */
  emergency: { ammo: 35 },
  /**
   * v0.0.18: ink and rubber balls (GDD §4.2). A new player starts with these, and raids never take
   * either below its protected reserve (storage boxes protect more on top). Provisional values, for
   * the developer to approve against the simulator's reports.
   */
  startingInk: 60,
  startingRubber: 12,
  protectedInk: 20,
  protectedRubber: 4,
  /**
   * Arming a plane at launch, and topping it up on the runway, draws on the territory's stores: ink
   * for gun rounds, rubber balls for bombs (per bomb, by kind). Nobody is grounded by an empty store: a plane always
   * takes off with `basicLoad` of its rounds and up to `freeBombs` bombs (when the mission needs
   * them) for free, and simply carries less of anything the stores can't pay for.
   */
  arming: {
    /** Gun rounds one ink buys. */
    roundsPerInk: 10,
    rubberPerBomb: { standard: 2, small: 1 } as Record<'standard' | 'small', number>,
    basicLoad: 0.35,
    freeBombs: 1,
  },
  /** Transactions kept in the paper log. */
  ledgerSize: 60,
} as const;

export const WORLD = {
  /**
   * Territories per side; the grid is gridSize × gridSize. Since v0.0.11 they are the 16 student
   * desks of the classroom (4 × 4), 1.6 m apart as in the Environment Lab's layout.
   */
  gridSize: 4,
  /** Edge length of one square territory: the sheet on a desk top. */
  territorySize: 40,
  /** Empty space between neighbouring territories (desk centres are 128 apart). */
  gap: 88,
  /** Platform thickness. Platform tops sit at y = 0. */
  thickness: 1.2,
  homeId: 'T1',
  /** Anything that sinks below this height has fallen too far: off the desks, towards the classroom floor. */
  voidY: -30,
  /** Soft altitude limit for the plane. */
  ceilingY: 70,
  /**
   * Where the airspace ends, measured from the world centre. The classroom is boxy, so the boundary
   * is a square (|x| and |z| both within this), inside the walls.
   */
  boundaryRadius: 262,
  /** Seconds the player gets to turn back before the autopilot takes over. */
  boundaryCountdown: 5,
  /** The autopilot hands control back once the plane is this far inside the boundary. */
  boundaryReturnMargin: 35,
  /** The painted runway on the home platform, along the launch heading. */
  runwayLength: 30,
  runwayWidth: 7,
} as const;

/** Handling shared by every aircraft. Each design's own performance is in AIRCRAFT below. */
export const PLANE = {
  /** Steepest climb or dive. */
  maxPitch: 60 * DEG,
  /** How far the mouse aim may lead the plane's nose before it is held back. */
  maxAimLead: 50 * DEG,
  /** Aim rotation per pixel of mouse movement. */
  mouseSensitivity: 0.0022,
  /** Aim rotation per second while holding A or D (assisted banking). */
  keyTurnRate: 1.2,
  /** With the mouse left alone this long, the aim eases back to level flight… */
  autoLevelDelay: 1.5,
  /** …at this rate (1/s). Turned off on the landing approach so a steady descent holds. */
  autoLevelRate: 0.7,
  /** Height of the plane's centre above the platform while parked. */
  parkedHeight: 0.35,
  /** Nose-up angle held during the automatic climb-out after launch. */
  launchPitch: 20 * DEG,
  /** Length of the climb-out. The home platform cannot crash the plane during it. */
  launchGrace: 1.2,
  /** Seconds to fold a new plane from a flat sheet, to refit a recovered one, and to roll a stowed one out. */
  buildTime: 2,
  refitTime: 0.9,
  rolloutTime: 0.5,
  /** Seconds the ground crew takes to top up ink after a landing (R). */
  rearmTime: 1.5,
} as const;

/**
 * v0.0.16: the automatic maneuvers. A plane carries one in its maneuver slot, chosen at the pad
 * before each take-off, and flies it on the Maneuver key (Left Alt, A / Cross). Bombers have none.
 * The shapes of the moves are in aircraft/maneuvers.ts; these are their tuning numbers.
 */
export type ManeuverId =
  | 'craneFlip' | 'foldBack' | 'diveFold' | 'slipRoll' | 'updraftRoll' | 'paperHang' | 'spiralDrill' | 'paperPivot';

export const MANEUVER_ORDER: readonly ManeuverId[] = [
  'craneFlip', 'foldBack', 'diveFold', 'slipRoll', 'updraftRoll', 'paperHang', 'spiralDrill', 'paperPivot',
];

export interface ManeuverSpec {
  id: ManeuverId;
  name: string;
  /** What it does, in one line (pad picker, garage card, HUD tooltip). */
  summary: string;
  /** The real aerobatic figure it is based on. */
  inspiredBy: string;
  /** Seconds the move takes on a plane with the reference turn rate (scaled per plane). */
  duration: number;
  /** Seconds before it can be flown again, counted from the end of the move. */
  cooldown: number;
  /**
   * Slowest entry, as a fraction of the way from the plane's minimum to its maximum speed (the
   * boost counts). 0 = any speed.
   */
  minEntry: number;
}

export const MANEUVERS: Record<ManeuverId, ManeuverSpec> = {
  craneFlip: { id: 'craneFlip', name: 'Crane Flip', inspiredBy: 'Kulbit', duration: 1.4, cooldown: 7, minEntry: 0.45,
    summary: 'Air-brakes and flips the nose a full turn while sliding on: a chaser overshoots and you come out behind it.' },
  foldBack: { id: 'foldBack', name: 'Fold Back', inspiredBy: 'Immelmann turn', duration: 1.9, cooldown: 6, minEntry: 0.3,
    summary: 'Half loop up and roll upright: flying the other way, higher and a little slower.' },
  diveFold: { id: 'diveFold', name: 'Dive Fold', inspiredBy: 'Split-S', duration: 1.9, cooldown: 6, minEntry: 0.1,
    summary: 'Half roll onto the back and pull through a half loop down: the other way, lower and faster.' },
  slipRoll: { id: 'slipRoll', name: 'Slip Roll', inspiredBy: 'Barrel roll', duration: 1.0, cooldown: 4.5, minEntry: 0,
    summary: 'A fast roll with a sideways shove of about two wingspans (towards A or D): spoils aim and homing rockets.' },
  updraftRoll: { id: 'updraftRoll', name: 'Updraft Roll', inspiredBy: 'Pop-up attack', duration: 2.2, cooldown: 6, minEntry: 0.2,
    summary: 'A boosted climb with a full roll on the way up, levelling off higher on the same heading.' },
  paperHang: { id: 'paperHang', name: 'Paper Hang', inspiredBy: 'Hammerhead (stall turn)', duration: 3.2, cooldown: 8, minEntry: 0.45,
    summary: 'Straight up, hangs at the top, pivots on a wingtip and drops back down the way it came.' },
  spiralDrill: { id: 'spiralDrill', name: 'Spiral Drill', inspiredBy: 'Rolling dive', duration: 2.2, cooldown: 6, minEntry: 0,
    summary: 'A corkscrew dive that comes out lower and faster on the same heading: shakes off a tail.' },
  paperPivot: { id: 'paperPivot', name: 'Paper Pivot', inspiredBy: 'Flat 180° (drift)', duration: 1.6, cooldown: 7, minEntry: 0.2,
    summary: 'Swings the tail round flat and drifts, then boosts out the other way at the same height.' },
};

/** Shared maneuver rules (provisional). */
export const MANEUVER = {
  /** Turn rate the durations in MANEUVERS are written for; a nimbler plane flies them faster. */
  referenceTurnRate: 1.6,
  /** How strongly the turn rate changes a move's length (0 = not at all). */
  agilityScale: 0.6,
  /** The clearance check: the move's path, sampled this often (s), must stay this far from anything. */
  clearanceStep: 0.1,
  clearanceMargin: 1.2,
  /** How far the move's path may sink below the lowest desk top before it counts as "too low". */
  floorMargin: 8,
  /** Seconds the HUD shows why the Maneuver key did nothing. */
  refusalTime: 1.6,
  /** Seconds for steering to blend back in after a move. */
  exitBlend: 0.25,
  /** Speed of the Slip Roll's sideways shove at its peak (m/s). */
  slipShove: 14,
} as const;

/**
 * v0.0.16: what the flight model allows for manual maneuvers (no script, just the pilot's flying).
 * See docs/roadmap/v0.0.16.md section 2.
 */
export const ACRO = {
  /** Holding S at the bottom of the throttle opens the air brake: the speed falls to this share of minSpeed. */
  airbrakeFloor: 0.45,
  /** How fast the air brake bites (1/s). */
  airbrakeResponse: 2.2,
  /** Below minSpeed the plane mushes down, up to this many m/s at the air-brake floor. */
  slowSink: 3,
  /** Slower turns tighter: up to this much more turn and pitch rate at the air-brake floor. */
  slowTurnBonus: 0.55,
  /**
   * Pulling (or pushing) past the pitch limit by this much extra mouse aim (rad) lifts the limit:
   * the plane loops through vertical. Fighters, multiroles and recon planes only.
   */
  loopEntry: 0.22,
  /** Pitch rate while looping, as a multiple of the plane's maxPitchRate. */
  loopRate: 1.15,
  /** In a loop, A/D roll the plane at this rate (rad/s). */
  loopRollRate: 2.6,
  /** Mouse aim (rad) the loop's pull holds at most: how far the nose carries on after letting go. */
  loopDemandMax: 0.3,
  /** Mouse aim used up per radian the nose turns in a loop: a full loop takes about 2π × this of pull. */
  loopDemandUse: 0.25,
  /** With no pull for this long, the plane rolls itself upright and hands back to normal flight. */
  loopIdle: 0.35,
  /** Roll rate of that automatic recovery (rad/s). */
  loopRecoverRate: 3.2,
} as const;

/** How one aircraft design flies. All the flight physics read these; nothing is hard-coded per plane. */
export interface FlightProfile {
  minSpeed: number;
  cruiseSpeed: number;
  maxSpeed: number;
  /** Throttle setting change per second while holding W or S. */
  throttleAccel: number;
  /** How quickly the actual speed settles on the throttle setting (1/s). Low = heavy, lots of inertia. */
  speedResponse: number;
  /** Speed lost per second in a vertical climb (and gained in a dive), scaled by sin(pitch). */
  pitchSpeedEffect: number;
  /** Fastest the plane can yaw, reached at full bank. */
  maxTurnRate: number;
  /** Fastest the plane can pitch towards the aim direction. */
  maxPitchRate: number;
  /** How eagerly the plane chases the aim direction (1/s). Higher = snappier. */
  aimGain: number;
  /** How quickly the wings roll into a bank (1/s). The plane turns by banking, so this is the turn inertia. */
  rollResponse: number;
  /** How quickly the pitch rate follows the aim (1/s). */
  pitchResponse: number;
  /** Bank angle at full turn rate. */
  maxBank: number;
  /** Shift boost: extra speed, how fast it kicks in (1/s), longest burst and recharge time. */
  boostSpeed: number;
  boostResponse: number;
  boostDuration: number;
  boostCooldown: number;
  /** Radius of the collision sphere around the plane. */
  collisionRadius: number;
}

export interface GunSpec {
  /** Guns firing in turn; the model provides a muzzle for each. */
  barrels: number;
  /** Ink rounds carried. Rearming at home refills them for free. */
  ammo: number;
  /** Seconds between two shots. */
  interval: number;
  damage: number;
  /** Muzzle speed, added to the plane's own velocity. */
  speed: number;
  /** Distance a round travels before it dries up. */
  range: number;
  /**
   * v0.0.18: damage against structures and defenses is multiplied by this (the Thug's cannon);
   * absent: 1. Depots still shrug off most ink on top (DEFENSES.supply.inkFactor).
   */
  structureFactor?: number;
}

export type BombKind = 'standard' | 'small';
export type AircraftId =
  | 'dart'
  | 'falcon'
  | 'swift'
  | 'widewing'
  | 'raptor'
  | 'lightning'
  | 'thug'
  | 'jumper'
  | 'specter'
  | 'lancer'
  | 'ghost';
/** The four designs the code-built stand-in shapes exist for (aircraft/PlaneShapes.ts). */
export type BaseShapeId = 'dart' | 'falcon' | 'swift' | 'widewing';
export type AircraftRole = 'recon' | 'fighter' | 'multirole' | 'bomber';

export interface AircraftSpec {
  id: AircraftId;
  name: string;
  role: AircraftRole;
  roleLabel: string;
  /** Folding a new one from a sheet. */
  cost: number;
  /** Re-creasing (and repairing) one that landed safely. */
  refitCost: number;
  /**
   * v0.0.18: ink and rubber balls folded into a new one on top of its paper `cost` (special
   * weapons, markings, payload fittings). Not charged for a refit. The Swift needs none: the
   * starter is always reachable with paper alone.
   */
  materials?: { ink?: number; rubber?: number };
  /**
   * Seconds to fold a new one; `PLANE.buildTime` if not set. A refit takes `PLANE.refitTime`
   * scaled the same way (aircraft/Aircraft.ts `buildDuration`). Since v0.0.15.
   */
  buildTime?: number;
  tagline: string;
  flight: FlightProfile;
  maxHealth: number;
  gun: GunSpec;
  gunLabel: string;
  bombs: { capacity: number; kind: BombKind };
  /**
   * How noticeable the plane is: defenses spot it at their detection range times this. Small
   * planes slip in closer before anything reacts.
   */
  signature: number;
  /** How big a target it is for enemy ink and rockets (a sphere around its centre). */
  hitRadius: number;
  accent: readonly [number, number, number];
  /** The real aircraft it is a paper interpretation of (garage card). */
  inspiration: string;
  /**
   * The code-built shape it borrows while its model loads (and where its guns and bomb racks
   * sit): one of the original four designs.
   */
  shape: BaseShapeId;
  /** Special abilities beyond the numbers above. */
  traits?: AircraftTraits;
  /**
   * v0.0.18: armour: this share of every enemy round, rocket and blast is absorbed (the Thug). Absent:
   * none. Collisions and rough landings are not armoured against. Counted in the durability rating.
   */
  armour?: number;
  /**
   * v0.0.16: the automatic maneuvers this design can carry in its maneuver slot, the first being
   * the default. Empty for bombers.
   */
  maneuvers: readonly ManeuverId[];
}

export interface AircraftTraits {
  /**
   * Stealth (v0.0.18, the radar signature system): the plane's signature drops further while it is
   * quiet (STEALTH.quiet) and rocket locks on it take longer. Firing, opening the bomb bay or
   * boosting reveals it for a moment. It is never invisible: within visual range it is always seen.
   */
  stealth?: boolean;
  /** Reconnaissance dwell time counts this many times faster (recon and dangerous recon objectives). */
  reconRate?: number;
}

/** New players start with this design chosen; it is also the pattern of the free emergency plane. */
export const STARTER_AIRCRAFT: AircraftId = 'swift';

/**
 * The aircraft patterns the player can fold. Stats and costs are first balancing guesses. To add a
 * plane, add an entry here and a shape in aircraft/PlaneShapes.ts: the flight physics, garage,
 * ratings and suitability all work from this data.
 */
export const AIRCRAFT: Record<AircraftId, AircraftSpec> = {
  // ---- v0.0.11: the original four re-roled. Swift is the starter, Falcon the agile fighter, Dart
  // the fast recon plane, Widewing unchanged. Values are starting points for playtesting.
  dart: {
    id: 'dart',
    name: 'Dart',
    role: 'recon',
    roleLabel: 'Fast recon',
    cost: 40,
    refitCost: 10,
    materials: { ink: 4 },
    tagline: 'The fastest plane in the classroom. A light gun, no bombs: it looks, it runs.',
    flight: {
      minSpeed: 11, cruiseSpeed: 24, maxSpeed: 38,
      throttleAccel: 22, speedResponse: 3.4, pitchSpeedEffect: 6,
      maxTurnRate: 1.45, maxPitchRate: 1.25, aimGain: 3.2, rollResponse: 7, pitchResponse: 6.5, maxBank: 55 * DEG,
      boostSpeed: 17, boostResponse: 5.5, boostDuration: 1.5, boostCooldown: 3,
      collisionRadius: 0.6,
    },
    maxHealth: 50,
    gun: { barrels: 1, ammo: 40, interval: 0.18, damage: 4, speed: 62, range: 60 },
    gunLabel: 'Light ink gun',
    bombs: { capacity: 0, kind: 'small' },
    signature: 0.65,
    hitRadius: 0.9,
    accent: [0.08, 0.62, 0.56],
    inspiration: 'SR-71 Blackbird',
    shape: 'dart',
    maneuvers: ['slipRoll', 'diveFold', 'updraftRoll', 'spiralDrill'],
    traits: { reconRate: 1.5 },
  },
  falcon: {
    id: 'falcon',
    name: 'Falcon',
    role: 'fighter',
    roleLabel: 'Agile fighter',
    cost: 45,
    refitCost: 11,
    materials: { ink: 10 },
    tagline: 'Turns tighter than anything else, with twin ink guns. No bombs: built to dogfight.',
    flight: {
      minSpeed: 10, cruiseSpeed: 21, maxSpeed: 33,
      throttleAccel: 16, speedResponse: 2.4, pitchSpeedEffect: 9,
      maxTurnRate: 1.9, maxPitchRate: 1.5, aimGain: 3.5, rollResponse: 8.5, pitchResponse: 7.2, maxBank: 64 * DEG,
      boostSpeed: 14, boostResponse: 5, boostDuration: 1.2, boostCooldown: 3.2,
      collisionRadius: 0.8,
    },
    maxHealth: 100,
    gun: { barrels: 2, ammo: 130, interval: 0.08, damage: 7, speed: 78, range: 85 },
    gunLabel: 'Twin ink guns',
    bombs: { capacity: 0, kind: 'standard' },
    signature: 0.85,
    hitRadius: 1.0,
    accent: [0.2, 0.45, 0.95],
    inspiration: 'Su-57',
    shape: 'falcon',
    maneuvers: ['craneFlip', 'foldBack', 'diveFold', 'slipRoll', 'updraftRoll', 'paperHang'],
    traits: { stealth: true },
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    role: 'multirole',
    roleLabel: 'Basic fighter',
    cost: 15,
    refitCost: 5,
    tagline: 'The starter: cheap, forgiving and balanced. Twin guns and one small bomb.',
    flight: {
      minSpeed: 9, cruiseSpeed: 20, maxSpeed: 30,
      throttleAccel: 15, speedResponse: 2.2, pitchSpeedEffect: 8,
      maxTurnRate: 1.5, maxPitchRate: 1.2, aimGain: 3, rollResponse: 6.5, pitchResponse: 6, maxBank: 55 * DEG,
      boostSpeed: 13, boostResponse: 5, boostDuration: 1.2, boostCooldown: 3.5,
      collisionRadius: 0.8,
    },
    maxHealth: 90,
    gun: { barrels: 2, ammo: 70, interval: 0.12, damage: 5, speed: 70, range: 75 },
    gunLabel: 'Twin ink guns',
    bombs: { capacity: 1, kind: 'small' },
    signature: 1.0,
    hitRadius: 1.0,
    accent: [0.95, 0.58, 0.1],
    inspiration: 'F-16',
    shape: 'swift',
    maneuvers: ['craneFlip', 'foldBack', 'diveFold', 'slipRoll'],
  },
  widewing: {
    id: 'widewing',
    name: 'Widewing',
    role: 'bomber',
    roleLabel: 'Bomber',
    cost: 75,
    refitCost: 19,
    materials: { rubber: 6 },
    tagline: 'Slow, heavy and tough. Carries four bombs and turns like a barge.',
    flight: {
      minSpeed: 9, cruiseSpeed: 17, maxSpeed: 26,
      throttleAccel: 9, speedResponse: 1.2, pitchSpeedEffect: 11,
      maxTurnRate: 1.05, maxPitchRate: 0.85, aimGain: 2.4, rollResponse: 3.2, pitchResponse: 3.5, maxBank: 45 * DEG,
      boostSpeed: 10, boostResponse: 3.5, boostDuration: 1, boostCooldown: 4.5,
      collisionRadius: 1,
    },
    maxHealth: 150,
    gun: { barrels: 1, ammo: 50, interval: 0.2, damage: 6, speed: 60, range: 65 },
    gunLabel: 'Nose ink gun',
    bombs: { capacity: 4, kind: 'standard' },
    signature: 1.25,
    hitRadius: 1.4,
    accent: [0.82, 0.2, 0.32],
    inspiration: 'B-52 Stratofortress',
    shape: 'widewing',
    maneuvers: [],
  },
  // ---- v0.0.15: the Raptor's final role and stats. The strongest pure dogfighter: it wins on
  // energy (the fastest fighter, the best climb, quickest to pick speed back up) and on guns, and
  // turns slightly wider than the Falcon, which keeps its agility niche. No bombs. The dearest
  // fighter (above the Jumper, "VTOL fighter", at 70; the Lightning at 80 is a bomb-carrying
  // multirole, and bombers stay dearest), and the slowest of the fighters to fold.
  raptor: {
    id: 'raptor',
    name: 'Raptor',
    role: 'fighter',
    roleLabel: 'Air superiority',
    cost: 72,
    refitCost: 16,
    materials: { ink: 14 },
    buildTime: 3,
    tagline: 'The fastest fighter, the best climber and the heaviest guns. No bombs: it rules the air.',
    flight: {
      minSpeed: 11, cruiseSpeed: 23, maxSpeed: 36,
      throttleAccel: 18, speedResponse: 2.8, pitchSpeedEffect: 6.5,
      maxTurnRate: 1.75, maxPitchRate: 1.45, aimGain: 3.4, rollResponse: 8, pitchResponse: 7, maxBank: 62 * DEG,
      boostSpeed: 15, boostResponse: 5.5, boostDuration: 1.4, boostCooldown: 3.2,
      collisionRadius: 0.85,
    },
    maxHealth: 120,
    gun: { barrels: 2, ammo: 140, interval: 0.075, damage: 8, speed: 82, range: 90 },
    gunLabel: 'Twin heavy ink guns',
    bombs: { capacity: 0, kind: 'standard' },
    signature: 0.75,
    hitRadius: 1.05,
    accent: [0.35, 0.38, 0.45],
    inspiration: 'F-22',
    shape: 'falcon',
    maneuvers: ['craneFlip', 'paperHang', 'foldBack', 'diveFold', 'slipRoll', 'paperPivot'],
  },
  // ---- v0.0.11: the rest of the roster built so far. Stats are first guesses for playtesting. ----
  lightning: {
    id: 'lightning',
    name: 'Lightning',
    role: 'multirole',
    roleLabel: 'Stealth multirole',
    cost: 80,
    refitCost: 18,
    materials: { ink: 8, rubber: 3 },
    tagline: 'The lowest-signature fighter: a gun for a fight, two mini bombs in an internal bay. Good at everything, best at nothing.',
    flight: {
      minSpeed: 10, cruiseSpeed: 21, maxSpeed: 31,
      throttleAccel: 14, speedResponse: 2.1, pitchSpeedEffect: 8,
      maxTurnRate: 1.5, maxPitchRate: 1.25, aimGain: 3.1, rollResponse: 6.5, pitchResponse: 6.2, maxBank: 56 * DEG,
      boostSpeed: 13, boostResponse: 5, boostDuration: 1.2, boostCooldown: 3.4,
      collisionRadius: 0.8,
    },
    maxHealth: 110,
    gun: { barrels: 1, ammo: 100, interval: 0.1, damage: 7, speed: 74, range: 80 },
    gunLabel: 'Internal ink gun',
    // v0.0.18: a light payload carried inside; opening the bay reveals it (STEALTH.reveal.bomb).
    bombs: { capacity: 2, kind: 'small' },
    signature: 0.65,
    hitRadius: 1.0,
    accent: [0.55, 0.45, 0.3],
    inspiration: 'F-35',
    shape: 'swift',
    maneuvers: ['foldBack', 'diveFold', 'slipRoll', 'updraftRoll', 'spiralDrill'],
    traits: { stealth: true },
  },

  thug: {
    id: 'thug',
    name: 'Thug',
    role: 'multirole',
    roleLabel: 'Ground attack',
    cost: 70,
    refitCost: 16,
    materials: { ink: 12, rubber: 2 },
    buildTime: 2.6,
    tagline: 'Slow, armoured and loud. A rotary ink cannon that chews through defenses, three mini bombs, and no business in a dogfight.',
    flight: {
      minSpeed: 8, cruiseSpeed: 17, maxSpeed: 25,
      throttleAccel: 10, speedResponse: 1.5, pitchSpeedEffect: 10,
      maxTurnRate: 1.3, maxPitchRate: 1.0, aimGain: 2.8, rollResponse: 4.8, pitchResponse: 4.8, maxBank: 52 * DEG,
      boostSpeed: 9, boostResponse: 3.5, boostDuration: 1.1, boostCooldown: 4.2,
      collisionRadius: 0.95,
    },
    maxHealth: 150,
    // v0.0.18: the cannon hits structures and defenses twice as hard as ordinary ink.
    gun: { barrels: 1, ammo: 220, interval: 0.05, damage: 5, speed: 70, range: 70, structureFactor: 2 },
    gunLabel: 'Rotary ink cannon',
    bombs: { capacity: 3, kind: 'small' },
    armour: 0.25,
    signature: 1.15,
    hitRadius: 1.3,
    accent: [0.45, 0.55, 0.3],
    inspiration: 'A-10 Thunderbolt II',
    shape: 'swift',
    maneuvers: ['updraftRoll', 'diveFold', 'foldBack', 'slipRoll', 'spiralDrill'],
  },

  jumper: {
    id: 'jumper',
    name: 'Jumper',
    role: 'multirole',
    roleLabel: 'VTOL fighter',
    cost: 70,
    refitCost: 16,
    materials: { ink: 6, rubber: 2 },
    tagline: 'Flies slower than anything else with jets, and turns tight. Hover mode comes later.',
    flight: {
      minSpeed: 7, cruiseSpeed: 19, maxSpeed: 29,
      throttleAccel: 15, speedResponse: 2.4, pitchSpeedEffect: 8,
      maxTurnRate: 1.6, maxPitchRate: 1.3, aimGain: 3.2, rollResponse: 7, pitchResponse: 6.5, maxBank: 58 * DEG,
      boostSpeed: 12, boostResponse: 5, boostDuration: 1.1, boostCooldown: 3.6,
      collisionRadius: 0.8,
    },
    maxHealth: 100,
    gun: { barrels: 1, ammo: 90, interval: 0.11, damage: 6, speed: 70, range: 75 },
    gunLabel: 'Gun pod',
    bombs: { capacity: 2, kind: 'small' },
    signature: 0.95,
    hitRadius: 1.0,
    accent: [0.3, 0.5, 0.62],
    inspiration: 'AV-8B Harrier',
    shape: 'swift',
    maneuvers: ['paperPivot', 'craneFlip', 'updraftRoll', 'slipRoll'],
  },
  specter: {
    id: 'specter',
    name: 'Specter',
    role: 'recon',
    roleLabel: 'Surveillance drone',
    cost: 50,
    refitCost: 10,
    materials: { ink: 4 },
    tagline: 'A long, quiet glider that is hard to spot. Barely armed, no bombs.',
    flight: {
      minSpeed: 8, cruiseSpeed: 19, maxSpeed: 28,
      throttleAccel: 12, speedResponse: 2, pitchSpeedEffect: 7,
      maxTurnRate: 1.15, maxPitchRate: 0.95, aimGain: 2.6, rollResponse: 4.5, pitchResponse: 4.5, maxBank: 48 * DEG,
      boostSpeed: 10, boostResponse: 4, boostDuration: 1.2, boostCooldown: 4,
      collisionRadius: 0.8,
    },
    maxHealth: 60,
    gun: { barrels: 1, ammo: 30, interval: 0.2, damage: 4, speed: 60, range: 60 },
    gunLabel: 'Light ink gun',
    bombs: { capacity: 0, kind: 'small' },
    signature: 0.55,
    hitRadius: 1.15,
    accent: [0.6, 0.62, 0.66],
    inspiration: 'RQ-4 Global Hawk',
    shape: 'dart',
    maneuvers: ['slipRoll', 'spiralDrill', 'paperPivot'],
  },
  lancer: {
    id: 'lancer',
    name: 'Lancer',
    role: 'bomber',
    roleLabel: 'Supersonic bomber',
    cost: 105,
    refitCost: 23,
    materials: { ink: 4, rubber: 6 },
    tagline: 'A bomber that can outrun fighters: swing wings, three bombs, a quick dash home.',
    flight: {
      minSpeed: 11, cruiseSpeed: 22, maxSpeed: 34,
      throttleAccel: 12, speedResponse: 1.6, pitchSpeedEffect: 10,
      maxTurnRate: 1.15, maxPitchRate: 0.95, aimGain: 2.6, rollResponse: 3.8, pitchResponse: 4, maxBank: 48 * DEG,
      boostSpeed: 13, boostResponse: 4, boostDuration: 1.3, boostCooldown: 4,
      collisionRadius: 1,
    },
    maxHealth: 135,
    gun: { barrels: 1, ammo: 50, interval: 0.18, damage: 6, speed: 64, range: 65 },
    gunLabel: 'Tail ink gun',
    bombs: { capacity: 3, kind: 'standard' },
    signature: 1.1,
    hitRadius: 1.3,
    accent: [0.7, 0.35, 0.2],
    inspiration: 'B-1B Lancer',
    shape: 'widewing',
    maneuvers: [],
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    role: 'bomber',
    roleLabel: 'Stealth bomber',
    cost: 120,
    refitCost: 26,
    materials: { ink: 6, rubber: 8 },
    tagline: 'A flying wing defenses barely notice. Four bombs, no dogfighting.',
    flight: {
      minSpeed: 9, cruiseSpeed: 18, maxSpeed: 27,
      throttleAccel: 9, speedResponse: 1.2, pitchSpeedEffect: 10,
      maxTurnRate: 1.0, maxPitchRate: 0.85, aimGain: 2.4, rollResponse: 3.2, pitchResponse: 3.5, maxBank: 45 * DEG,
      boostSpeed: 10, boostResponse: 3.5, boostDuration: 1, boostCooldown: 4.5,
      collisionRadius: 1,
    },
    maxHealth: 140,
    gun: { barrels: 1, ammo: 30, interval: 0.22, damage: 5, speed: 60, range: 60 },
    gunLabel: 'Defensive ink gun',
    bombs: { capacity: 4, kind: 'standard' },
    signature: 0.5,
    hitRadius: 1.45,
    accent: [0.3, 0.3, 0.34],
    inspiration: 'B-2 Spirit',
    shape: 'widewing',
    maneuvers: [],
  },
};

/**
 * v0.0.18: the radar signature system (GDD §5.2, plan v0.0.18 §8). Every plane's `signature`
 * scales how far defenses, AI pilots and threat panels notice it. A plane with the stealth trait
 * is quieter still while it does nothing loud (`quiet`); firing, opening the bomb bay or boosting
 * reveals it (`reveal` added to its signature, fading over `revealTime`). Rocket locks on a plane
 * below signature 1 take longer, by 1 / signature, never more than `maxLock` times: locks stay
 * possible. Visual range is untouched: inside `visual` metres anything is seen, whatever it is.
 */
export const STEALTH = {
  quiet: 0.8,
  reveal: { fire: 0.35, bomb: 0.45, boost: 0.2 },
  revealTime: 3,
  maxLock: 1.8,
  visual: 28,
} as const;

/** Garage order, roughly cheapest first: the starter Swift, then the rest up to the bombers. */
export const AIRCRAFT_ORDER: readonly AircraftId[] = ['swift', 'dart', 'falcon', 'specter', 'thug', 'jumper', 'raptor', 'lightning', 'widewing', 'lancer', 'ghost'];

/**
 * The garage's 1–5 ratings are worked out from the specs, mapped linearly over these ranges, so
 * they always tell the truth about the numbers above.
 */
export const RATINGS = {
  /** Top speed plus half the boost. */
  speed: [28, 42],
  /** Average of turn rate, roll response and pitch rate, each relative to a nimble plane. */
  maneuverability: [0.5, 1],
  durability: [40, 160],
  /** Bombs carried; a mini bomb counts for less. */
  payload: [0.6, 4],
  /** Ink damage per second. */
  firepower: [20, 90],
  /** Detection signature, from easy to spot to hard to spot. */
  stealth: [1.3, 0.6],
} as const;

export const LANDING = {
  /** Touching down on the home platform faster, steeper or more banked than this is a rough landing. */
  maxSpeed: 19,
  maxSink: 5,
  maxRoll: 25 * DEG,
  /** Braking on the ground after touchdown. */
  rolloutDecel: 16,
  /** The landing checklist appears within this distance of home and below this altitude. */
  guideRange: 80,
  guideAltitude: 25,
} as const;

export const BOMB = {
  gravity: 22,
  /** Extra downward speed added on release so the ball visibly drops away from the plane. */
  releaseKick: 2,
  /** How far below the plane's centre the bombs hang while carried. */
  hangOffset: 0.55,
  /** Minimum time between two drops. */
  dropCooldown: 0.8,
  /** A bomb's ball size, and the blast that damages props and practice targets around its impact. */
  kinds: {
    standard: { label: 'Paper bomb', radius: 0.6, blastRadius: 5, damage: 90, weight: 1 },
    small: { label: 'Mini bomb', radius: 0.42, blastRadius: 3.2, damage: 50, weight: 0.6 },
  },
} as const;

export const DAMAGE = {
  /** Contacts with a closing speed (towards the surface) below this do no damage. */
  safeImpactSpeed: 4,
  /** Damage per m/s of closing speed above the safe limit. Head-on into a wall at cruise destroys any plane. */
  impactDamage: 12,
  /** A touchdown at home outside the landing limits: a base amount plus extra for each limit broken. */
  roughLanding: { base: 6, perSpeed: 2.5, perSink: 8, perRollDeg: 0.8 },
  /** Share of the speed into a surface that bounces back. */
  bounce: 0.25,
  /** After bouncing off the home runway, the platform can't hit the plane again for this long… */
  bounceGrace: 0.6,
  /** …and the nose is lifted at least this much so it climbs away. */
  bouncePitch: 7 * DEG,
  /** Below this share of health the plane gets harder to fly… */
  handlingThreshold: 0.4,
  /** …down to this share of its normal turn and roll response at zero health… */
  handlingFloor: 0.7,
  /** …and its wings wobble by up to this much. */
  wobble: 0.12,
  /** Below this share of health the plane trails ink. */
  trailThreshold: 0.6,
  /** Flying into a prop deals this multiple of the plane's impact damage to the prop. */
  ramMultiplier: 1.5,
} as const;

export const WEAPONS = {
  projectileRadius: 0.12,
  /** Wing guns converge on a point this far ahead of the nose. */
  convergence: 45,
  /**
   * Aim assistance against aircraft, which are hard to hit with mouse steering: a round counts as a
   * hit if it passes within this cone of the target (growing with the distance flown), up to `max`
   * metres beyond the plane's own size. No automatic targeting: the round still flies where aimed.
   */
  aimAssist: { cone: 1.6 * DEG, max: 1 },
} as const;

/** Practice targets (paper planes on pencil stands) and cardboard props on the unclaimed territories. */
export const TARGETS = {
  dummyHealth: 40,
  /** Hit sphere around a dummy plane. Generous: practice is about leading the shot, not pixel hunting. */
  dummyRadius: 1.7,
  /** What a plane actually flies into: about the size of the paper plane you can see. */
  dummySolidRadius: 0.9,
  /** Share of the normal impact damage a plane takes flying into each kind: paper is soft, cardboard less so. */
  hardness: { dummy: 0.4, crates: 0.75, board: 0.6 },
  /** Heights of a territory's three stands, and their distance from its centre. */
  dummyHeights: [6, 8.5, 11],
  dummyRing: 14,
  crateHealth: 70,
  boardHealth: 50,
  /** A destroyed target folds itself back up after this long. Everything is restored between sorties. */
  respawnTime: 45,
  /** Name and health labels show for targets this close. */
  labelRange: 90,
} as const;

/** 0 unprotected, 1 light, 2 guarded, 3 fortified. */
export type ThreatLevel = 0 | 1 | 2 | 3;

export interface ThreatProfile {
  label: string;
  /** What stands on a territory of this level. */
  turrets: number;
  launchers: number;
  radar: boolean;
  /** A supply depot: the marked target for fortified and multi-stage strikes. */
  supply: boolean;
}

/**
 * How heavily each territory is defended. T1 is home and always safe; the two territories next to
 * it are unprotected, and the defenses get heavier towards the far side of the map, where the
 * east column and T8 are enemy country.
 */
export const THREAT: {
  map: Record<string, ThreatLevel>;
  levels: Record<ThreatLevel, ThreatProfile>;
  byDifficulty: Record<Difficulty, readonly [ThreatLevel, ThreatLevel]>;
  rewardBonus: Record<ThreatLevel, number>;
} = {
  map: { T2: 0, T5: 0, T3: 1, T6: 1, T9: 1, T4: 1, T13: 1, T7: 2, T10: 2, T8: 2, T11: 2, T14: 2, T12: 3, T15: 3, T16: 3 },
  levels: {
    0: { label: 'Unprotected', turrets: 0, launchers: 0, radar: false, supply: false },
    1: { label: 'Light', turrets: 1, launchers: 0, radar: false, supply: false },
    2: { label: 'Guarded', turrets: 2, launchers: 0, radar: true, supply: true },
    3: { label: 'Fortified', turrets: 2, launchers: 1, radar: true, supply: true },
  },
  /** The threat levels (lowest, highest) a mission of each difficulty sends the player into. */
  byDifficulty: { easy: [0, 1], medium: [1, 2], hard: [2, 3] },
  /** Extra reward for each defended territory a mission goes into, scaled by the type's exposure. */
  rewardBonus: { 0: 0, 1: 5, 2: 10, 3: 16 },
};

/** Automated defenses on the territories. Numbers are first balancing guesses. */
export const DEFENSES = {
  turret: {
    name: 'Ink turret',
    role: 'Rapid fire · short range',
    health: 80,
    /** Engagement range. Planes are noticed at this times their signature. */
    range: 45,
    /** Half-angle it can turn either side of its rest heading. Behind it is a blind spot. */
    arc: 130 * DEG,
    turnRate: 1.7,
    pitchRate: 1.4,
    minPitch: -8 * DEG,
    maxPitch: 80 * DEG,
    /** Height of the gun's pivot above the platform, and the barrel's length. */
    pivot: 2.1,
    barrel: 1.5,
    /** Seconds from first noticing a plane to the first shot (a radar does this in advance). */
    acquireTime: 0.7,
    /** Seconds between shots, and how close to the aim the barrel must be to fire. */
    interval: 0.34,
    fireCone: 7 * DEG,
    /** How much of the plane's motion it leads (1 = all of it). */
    lead: 0.9,
    /** Seconds it takes to notice a change of course: manoeuvring throws its aim off. */
    trackingLag: 0.3,
    /** Scatter at low speed, and extra scatter per 10 m/s of plane speed above DEFENSES.spreadFreeSpeed. */
    spread: 2 * DEG,
    speedSpread: 2 * DEG,
    shot: { speed: 44, damage: 4, travel: 55, radius: 0.22 },
    /** Ground taken, including its barrier walls. */
    footprint: 3.2,
  },
  launcher: {
    name: 'Paper rocket launcher',
    role: 'Homing rockets · long range',
    health: 100,
    range: 75,
    turnRate: 0.9,
    pitchRate: 0.9,
    /** Rockets leave the rails climbing: planes very low on the horizon are out of its reach. */
    minPitch: 6 * DEG,
    maxPitch: 70 * DEG,
    pivot: 1.5,
    /** Seconds it must hold a plane in its sights before a rocket goes, and between rockets. */
    lockTime: 1.6,
    reload: 7,
    footprint: 2.4,
    rocket: {
      launchSpeed: 10,
      speed: 31,
      accel: 30,
      /** Fastest it can turn (rad/s): a hard turn makes it overshoot. */
      turnRate: 1.8,
      life: 5.5,
      damage: 28,
      /** It bursts this close to the plane (plus the plane's size), once armed. */
      fuse: 1.3,
      armTime: 0.4,
      radius: 0.35,
      /** How big a target it is for the player's ink. */
      hitRadius: 1.1,
    },
  },
  radar: {
    name: 'Radar station',
    role: 'Early warning',
    health: 70,
    /** Planes inside this (times their signature) alert every weapon on its territory. */
    range: 85,
    spin: 1.6,
    footprint: 2.2,
  },
  supply: {
    name: 'Supply depot',
    role: 'Cardboard stores',
    /** A bomb landing on it or right beside it finishes it. */
    health: 70,
    /** Ink barely dents the cardboard: share of ink damage it takes. Bombs do the job. */
    inkFactor: 0.25,
    footprint: 2.6,
  },
  /**
   * T1's fixed structure: the paper store, where the player's paper is kept. Everything else on T1
   * is built by the player (BASE). The position is (along the runway towards the world centre, to
   * its right), from the middle of the platform.
   */
  home: {
    store: [-6, 12.5] as readonly [number, number],
    storeName: 'Paper store',
    storeRole: 'Your paper · raid target',
    storeHealth: 120,
  },
  /**
   * v0.0.18: a player's weapons reload from the territory's ink store (GDD §9.3): a turret's
   * magazine, a launcher's next rocket. With the store empty they still reload, `dryFactor` times
   * slower: an empty store degrades defenses, it never switches them off.
   */
  ammo: { magazine: 2, rocket: 3, dryFactor: 2.5 },
  /** Once a territory's radar is gone, its weapons only notice planes this much closer. */
  radarLostDetection: 0.7,
  /** Hysteresis: a weapon keeps a plane it is tracking out to this times its detection range. */
  keepTrack: 1.15,
  /** Seconds a weapon remembers a plane it can no longer see. */
  memory: 1.2,
  /** Plane speed below which aim doesn't scatter more. */
  spreadFreeSpeed: 15,
  /** Over home (and this close to it) nothing shoots and rockets lose track: T1 stays safe. */
  homeSafeMargin: 12,
  /** Weapons are placed so their reach stays clear of home and the first stretch after take-off. */
  departureClearance: 8,
  /** Share of the normal impact damage a plane takes flying into each kind. */
  hardness: { turret: 1, launcher: 1, radar: 0.8, supply: 0.7, workshop: 0.75, storage: 0.7, inkwell: 0.7, barrier: 0.85 },
  /** Name and health labels show for installations this close. */
  labelRange: 110,
  /** The threat panel shows a defended territory once the plane is this close to its weapons' reach. */
  approachMargin: 30,
  /** A weapon's range ring shows once the plane is within this of its reach. */
  ringMargin: 40,
} as const;

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * A territory's state in the world. alert – the player struck it recently: its wrecks stay down
 * and its defenders react at once. under-attack – an enemy raid is heading for it (home). disabled
 * – every weapon on it is destroyed and stays that way for a while. The states reset when the
 * event behind them ends.
 */
export type TerritoryState = 'peaceful' | 'alert' | 'under-attack' | 'disabled';

/**
 * How hard a mission card is, as offered. The first three are the content difficulties; a very
 * hard card is a hard mission with one or two escalations on top (a second fighter, an escort, an
 * extra target, a mandatory return, a stricter clock). Its difficulty multiplier is the D in
 * reward = B × D × M.
 */
export type Tier = 'easy' | 'medium' | 'hard' | 'veryhard';

export const TIERS: Record<Tier, { label: string; stars: number; multiplier: number; content: Difficulty; index: number }> = {
  easy: { label: 'Easy', stars: 1, multiplier: 1, content: 'easy', index: 0 },
  medium: { label: 'Medium', stars: 2, multiplier: 1.5, content: 'medium', index: 1 },
  hard: { label: 'Hard', stars: 3, multiplier: 2, content: 'hard', index: 2 },
  veryhard: { label: 'Very hard', stars: 4, multiplier: 2.5, content: 'hard', index: 3 },
};

export const TIER_ORDER: readonly Tier[] = ['easy', 'medium', 'hard', 'veryhard'];

/** What an AI aircraft is for: scouts look and run, fighters hunt, bombers bomb. */
export type AiRole = 'scout' | 'fighter' | 'bomber';

/** How an AI pilot of one skill level flies and fights. Difficulty changes behaviour, not health. */
export interface PilotSkill {
  label: string;
  /** Seconds from noticing an aircraft to doing something about it. */
  reaction: number;
  /** Seconds it takes to notice a change of course: its idea of the target's velocity lags this much. */
  trackingLag: number;
  /** Share of the target's motion it leads its shots by. */
  lead: number;
  /** Scatter of its rounds (radians, either way), before distance, speed, manoeuvring and tracking time. */
  aimError: number;
  /** It only fires with the nose within this of where it wants to shoot (plus the target's apparent size). */
  fireCone: number;
  /** Trigger discipline: bursts this long, then a pause this long. */
  burst: number;
  pause: number;
  /** Share of the way from cruise to top speed it uses when chasing or running. */
  throttle: number;
  boost: boolean;
  /** Chance per second of a hard evasive turn while something is on its tail. */
  evasive: number;
  /**
   * v0.0.16: chance per second of flying its maneuver while something is on its tail (0: never),
   * and which maneuvers it knows: the first of its plane's set it knows goes in the slot.
   */
  maneuvers: number;
  knows: readonly ManeuverId[];
  /** Breaks off a fight below this share of health (0: never), boosting and weaving away if `cleanBreak`. */
  disengageHealth: number;
  cleanBreak: boolean;
  /** Chance per attack of working its way behind the target first, instead of turning straight at it. */
  positioning: number;
  /** Lowest it follows a target down to, above the platforms. Low flying shakes off rookies. */
  floor: number;
  /** Bombers: how far off (metres, either way) its idea of the release point can be. */
  bombError: number;
}

/**
 * AI-controlled aircraft. They fly the same designs, with the same flight model, health and guns
 * as the player's; a pilot only decides where to point, how fast to go and when to shoot or drop.
 */
export const AI: {
  roles: Record<AiRole, AircraftId>;
  designs: Record<AiRole, readonly AircraftId[]>;
  roleLabels: Record<AiRole, string>;
  skill: Record<Difficulty, PilotSkill>;
  accuracy: { distance: number; speed: number; manoeuvre: number; unsettled: number; settle: number };
  maxActive: number;
  ambient: { count: number; firstDelay: number; respawn: readonly [number, number]; lifetime: readonly [number, number]; weights: Record<AiRole, number>; minThreat: ThreatLevel };
  patrolAltitude: readonly [number, number];
  clearance: number;
  gapFloor: number;
  lookAhead: readonly number[];
  separation: number;
  detection: number;
  maxPursuit: number;
  leash: number;
  disengageTime: number;
  launchShield: number;
  gunReach: number;
  gunDistance: number;
  overshoot: number;
  flee: number;
  safe: number;
  scoutLaps: number;
  missionScoutThrottle: number;
  bombingAltitude: number;
  runIn: number;
  abortHealth: number;
  jink: number;
  formation: readonly [number, number, number];
  exitMargin: number;
  hiddenDistance: number;
  waypointReach: number;
} = {
  /** The plan's line-up: Dart scouts, Falcon fighters, Widewing bombers. */
  roles: { scout: 'dart', fighter: 'falcon', bomber: 'widewing' },
  /**
   * The designs the mission director may order for each role (`AiOrders.aircraft`); anything else
   * flies the role's default above. Bombers need a bomb bay, so the Raptor only ever flies as a
   * fighter (v0.0.15).
   */
  designs: { scout: ['dart'], fighter: ['falcon', 'raptor'], bomber: ['widewing'] },
  roleLabels: { scout: 'Scout', fighter: 'Fighter', bomber: 'Bomber' },
  skill: {
    easy: {
      label: 'Rookie', reaction: 1.0, trackingLag: 0.6, lead: 0.5, aimError: 6.5 * DEG, fireCone: 5 * DEG, burst: 0.35, pause: 1.5,
      throttle: 0.45, boost: false, evasive: 0, disengageHealth: 0, cleanBreak: false, positioning: 0, floor: 10, bombError: 10,
      maneuvers: 0, knows: [],
    },
    medium: {
      label: 'Regular', reaction: 0.6, trackingLag: 0.38, lead: 0.8, aimError: 4.5 * DEG, fireCone: 4 * DEG, burst: 0.45, pause: 1,
      throttle: 0.75, boost: true, evasive: 0.35, disengageHealth: 0.25, cleanBreak: false, positioning: 0.5, floor: 7, bombError: 6,
      maneuvers: 0.15, knows: ['foldBack', 'slipRoll'],
    },
    hard: {
      label: 'Veteran', reaction: 0.32, trackingLag: 0.22, lead: 0.95, aimError: 3.5 * DEG, fireCone: 3.5 * DEG, burst: 0.6, pause: 0.8,
      throttle: 1, boost: true, evasive: 0.7, disengageHealth: 0.35, cleanBreak: true, positioning: 1, floor: 4.5, bombError: 2.5,
      maneuvers: 0.45, knows: ['craneFlip', 'paperHang', 'foldBack', 'slipRoll', 'spiralDrill', 'paperPivot', 'diveFold', 'updraftRoll'],
    },
  },
  /**
   * The scatter grows by `distance` per 10 m to the target, by `speed` per 10 m/s of speed
   * difference, and by `manoeuvre` per rad/s the target is turning; on first sight it is
   * (1 + `unsettled`) times bigger, settling over `settle` seconds of tracking the same target.
   */
  accuracy: { distance: 0.15, speed: 0.2, manoeuvre: 3, unsettled: 1.5, settle: 2 },
  /** At most this many AI aircraft in the air at once: missions and raids first, then ambient patrols. */
  maxActive: 4,
  /**
   * Patrols that keep the world busy outside missions, over enemy country (threat `minThreat` and
   * up). Each flies for `lifetime` seconds, then leaves; a new one comes `respawn` seconds after one
   * is gone. They pay nothing when shot down: there is no farming them.
   */
  ambient: {
    count: 2, firstDelay: 5, respawn: [30, 60], lifetime: [80, 140],
    weights: { scout: 0.45, fighter: 0.4, bomber: 0.15 },
    minThreat: 2,
  },
  /** Cruising heights. */
  patrolAltitude: [20, 30],
  /** Height kept above platforms when not fighting, and above platform level over the gaps. */
  clearance: 12,
  gapFloor: 4,
  /** Seconds ahead it checks for platforms. */
  lookAhead: [0.4, 0.8, 1.2, 1.6],
  /** Keeps this far from other aircraft. */
  separation: 9,
  /** Notices aircraft at this range times their signature. */
  detection: 85,
  /** A fighter chases this far from where the chase began, and no further than `leash` from what it guards. */
  maxPursuit: 140,
  leash: 110,
  /** After breaking off, it ignores everything for this long. */
  disengageTime: 6,
  /** Hostile aircraft hold their fire at the player over home and for this long after take-off. */
  launchShield: 6,
  /** Opens fire inside this share of its gun's range, likes to sit `gunDistance` behind its target, and breaks away and comes round again inside `overshoot`. */
  gunReach: 0.85,
  gunDistance: 18,
  overshoot: 9,
  /** Scouts run from anything this close, and calm down beyond `safe`. */
  flee: 75,
  safe: 140,
  /** A mission's scout circles each territory it scouts this many times before it heads out. */
  scoutLaps: 3,
  /**
   * A mission's scout runs (from a pursuer, and out at the end) at this share of the way from cruise
   * to top speed, without boosting, and stays over the territories it is scouting while chased: any
   * plane can catch it, and it only gets away once it has finished its route.
   */
  missionScoutThrottle: 0.2,
  /** Bombers: bombing height, and how far out they line up for the run. */
  bombingAltitude: 16,
  runIn: 75,
  /** A bomber below this share of health gives up and turns for home (medium and hard pilots). */
  abortHealth: 0.3,
  /** Seconds a bomber or scout jinks when something attacks it. */
  jink: 1.4,
  /** An escort holds this slot off its bomber's wing: (right, up, behind). */
  formation: [10, 4, 12],
  /** Aircraft enter and leave the world this far beyond the airspace edge. */
  exitMargin: 45,
  /** Out of view: aircraft only appear or vanish behind the camera, or at least this far away. */
  hiddenDistance: 170,
  /** A waypoint counts as reached this close (horizontally). */
  waypointReach: 14,
};

/**
 * Enemy bombing raids on T1. Every so often a Widewing sets out from a far enemy territory for
 * the paper store on T1, announced as soon as it sets out. Shoot it down (T1's guns help) for the
 * defense reward; if its bomb hits the store, some paper is lost, never below ECONOMY.protectedPaper.
 */
export const RAIDS = {
  /** Raids start once the player has launched this many sorties in the visit; the first comes `first` seconds after that. */
  afterSorties: 1,
  first: [60, 110] as readonly [number, number],
  /** Seconds between raids, counted only while the game runs (not on the report or paused). */
  interval: [170, 280] as readonly [number, number],
  /** Where raids set out from. */
  origins: ['T16', 'T15', 'T12', 'T14', 'T8'],
  /** Paid for shooting the raider down (or helping to). */
  reward: 60,
  /**
   * A raider's bomb on target destroys this share of the vulnerable paper (above the protected
   * reserve), up to `max`: more when it hits the paper store itself than another building.
   */
  loss: { store: { share: 0.2, max: 80 }, building: { share: 0.1, max: 40 } },
  /**
   * v0.0.18: the same rule for ink and rubber balls, each with its own cap, so one raid touches
   * every stock but never takes much of any. Protected reserves (ECONOMY, storage boxes) are safe.
   */
  lossOther: {
    ink: { store: { share: 0.2, max: 40 }, building: { share: 0.1, max: 20 } },
    rubber: { store: { share: 0.2, max: 8 }, building: { share: 0.1, max: 4 } },
  },
  /** The first two raids come alone; after that, a raid has this chance of a fighter escort. */
  escortAfter: 2,
  escortChance: 0.3,
  /** The bomber's target: how close (beyond the building's own size) the blast must come. */
  hitRadius: 2.5,
  /**
   * How attractive each T1 structure is as a raid target (standing ones only). The paper store
   * gets `perPaper` more for every vulnerable paper in it: a full store draws raids.
   */
  targetWeights: { store: 2, storage: 2, workshop: 2, radar: 2, launcher: 1.5, turret: 1 } as Record<string, number>,
  storePerPaper: 0.01,
  /** After a raid that cost paper or wrecked a building, the next waits at least this long (recovery time). */
  recovery: 150,
} as const;

/**
 * Multiplayer (v0.0.9): attacks between players, kills, protections and score. All provisional.
 * The rules that use them are in server/world/Attacks.ts and server/world/ServerWorld.ts.
 */
export const PVP = {
  /**
   * One of the four middle desks (the one furthest from the single-player home). Until v0.0.13 it was
   * the AI's own desk, which nobody could claim; now every desk can hold a player, and this is only
   * where a card aims when it has no better desk to name.
   */
  centre: 'T11',
  /** A new player's base can't be raided for this long after claiming it (seconds), unless they raid first. */
  newPlayerProtection: 300,
  /** After a raid on a player's base gets through, nobody can raid it again for this long. */
  raidShield: 240,
  /** The same attacker must wait this long before raiding the same base again. */
  pairCooldown: 600,
  /**
   * Raid rewards shrink when one attacker keeps hitting the same base within `farmWindow`
   * seconds: the n-th raid pays `repeat[n]` of the reward (0: nothing).
   */
  farmWindow: 1800,
  repeat: [1, 0.5, 0.25, 0] as readonly number[],
  /** A raid's reward: base, plus this much per weapon standing on the target base when it was offered. */
  raidReward: 55,
  raidPerWeapon: 8,
  /** A base with less vulnerable paper than this is a poor target: the raid pays this share. */
  poorTarget: 25,
  poorFactor: 0.5,
  /** Raid missions must be done within this long (seconds). */
  raidTime: 300,
  /** Recon of another player's base: seconds over it, reward, time limit. */
  reconDuration: 8,
  reconReward: 30,
  reconTime: 240,
  /** "Shoot down a rival" cards: reward, time limit. */
  huntReward: 45,
  huntTime: 240,
  /** "Intercept the raider" cards for the defender. */
  interceptReward: 40,
  interceptTime: 240,
  /** Shooting down a raider on its way to (or over) your base, with or without the card. */
  defenseReward: 35,
  /**
   * Shooting down another player's plane pays `killBase` plus `killShare` of what the plane cost;
   * nothing for an emergency Swift (free planes can't be farmed). The same victim again within
   * `killWindow` pays `killRepeat[n]` of it.
   */
  killBase: 6,
  killShare: 0.4,
  killWindow: 300,
  killRepeat: [1, 0.5, 0.25, 0] as readonly number[],
  /** Helpers who dealt at least `assistMin` of the damage in the last `assistWindow` seconds share the kill. */
  assistMin: 0.2,
  assistWindow: 15,
  assistShare: 0.5,
  /**
   * A player's defenses engage another player who is raiding them, who hurt them in the last
   * `aggression` seconds, or who flies over their territory (platform plus `airspace`).
   */
  aggression: 45,
  airspace: 6,
  /** Player-versus-player cards on the board at once (besides an interception when being raided). */
  cards: 2,
  /** Wrecked AI installations stand up again after this long (seconds). */
  aiRebuild: 120,
  /** Scoreboard points. */
  score: { kill: 10, assist: 4, raid: 15, defend: 10, mission: 5 },
  /** A player just placed on a desk can't be the target of a new raid for this long (v0.0.13, provisional). */
  arrivalGrace: 120,
  /**
   * A plane that took or dealt damage from or to another player, or was on a raid, this recently is
   * "in combat" (v0.0.13, provisional): if its pilot is gone for good, it is lost, with no kill reward.
   */
  combatWindow: 10,
} as const;

/**
 * v0.0.19 (plan §2A–B, GDD §11.2–11.5): the multiplayer director's view of each player. Strength
 * is what a player could bring to a fight (resources, planes, defenses), compared with the
 * session's median to sort players into tiers. Threat is how aggressive they have been lately
 * (raids launched, kills on weaker players), decaying with a half-life; it survives restarts with the
 * player. Bounties look at threat, never at wealth alone. Provisional values.
 * The rules that use them are in server/world/Situation.ts.
 */
export const SITUATION = {
  /** Strength: resources count by these weights, each plane in the hangar by `plane`, each standing weapon by `weapon`. */
  weights: { paper: 1, ink: 1.5, rubber: 3, plane: 40, weapon: 25 },
  /** A newcomer: fewer than `newcomerSorties` sorties flown and below `newcomerStrength` of the median. */
  newcomerSorties: 8,
  newcomerStrength: 0.8,
  /** Advanced: at least `advancedStrength` times the session's median strength, or `advancedSorties` sorties and above the median. */
  advancedStrength: 1.6,
  advancedSorties: 60,
  /** Threat added per raid launched, per kill on a weaker player (strength below `weaker` of the killer's), and its half-life (seconds). */
  raidThreat: 1,
  weakKillThreat: 1.5,
  weaker: 0.7,
  halfLife: 1200,
  /**
   * An advanced player can't be offered a raid on a newcomer (protection from disproportionate
   * attacks, GDD §11.3), unless that newcomer attacked them within `retaliation` seconds.
   */
  retaliation: 900,
  /** An intermediate player raiding a stronger one is paid this much more per tier of difference (GDD §11.4). */
  underdogBonus: 0.25,
  /** Director decisions kept for the developer's debug panel. */
  logSize: 100,
} as const;

/** v0.0.19: what a bounty asks for (plan §2C). */
export type BountyKind = 'bomber' | 'raid' | 'installation' | 'ace';

/**
 * v0.0.19 (plan §2C, GDD §11.6): bounties. The director places one only on a fair objective, only
 * because of aggression or demonstrated threat (never wealth), never on an offline or protected
 * player, at most one per target and `maxOpen` in a session. The pot is shared by contribution
 * (damage dealt, from the damage log), paid once by the server; the target and their allies get
 * nothing from it. Provisional values. The rules that use them are in server/world/Bounties.ts.
 */
export const BOUNTIES = {
  /** The pot for each kind, before the target's threat adds `perThreat` a point (capped at `maxPot`). */
  pot: { bomber: 60, raid: 55, installation: 45, ace: 70 } as Record<BountyKind, number>,
  perThreat: 6,
  maxPot: 120,
  /** What flying the bounty card itself pays on success, on top of a share of the pot. */
  cardReward: 5,
  /** Triggers: an active raid by a player with this much threat (bomber); this many raids by one player within `window` (raid); this many kills on weaker players within `window` (ace); this much threat on an advanced player (installation). */
  bomberThreat: 2,
  repeatRaids: 2,
  streak: 3,
  installationThreat: 3,
  window: 1800,
  /** A bounty lasts this long at most (seconds); a plane bounty also ends when its target lands. */
  duration: 300,
  /** After a bounty on a player ends, the next waits this long. */
  targetCooldown: 600,
  /** Open bounties in one session at once. */
  maxOpen: 3,
  /** Contributors who dealt less than this share of the damage get nothing (no tag-and-run). */
  minShare: 0.1,
  /** The defender's guaranteed share of a "prevent a raid" pot, if they contributed at all. */
  defenderShare: 0.5,
} as const;

/**
 * v0.0.19 (plan "Also B"): alliances that last only for the current session. An offer is sent from
 * the scoreboard and accepted by the other player; it ends when the session ends or either side
 * leaves. Allies can't damage each other, share radar contacts, see each other's raids, and can't
 * raid, challenge or farm each other. Provisional values. The rules are in server/world/Alliances.ts.
 */
export const ALLIANCES = {
  /** At most this many players in one alliance… */
  maxSize: 3,
  /** …and never more than this share of the players online (at least two), so no alliance dominates. */
  sessionShare: 0.5,
  /** After leaving, former allies can't attack each other for this long (seconds). */
  leaveCooldown: 60,
  /** An offer waits this long for an answer (seconds). */
  offerTime: 60,
  /** One player can send this many offers a minute. */
  offersPerMinute: 4,
} as const;

/**
 * v0.0.19 (plan §3, GDD §11.7): cooperation offers between players: escorting another player's
 * bomber, joint defense of a raided base, and joint attacks on a powerful player. Opt-in for both
 * sides, paid once by the server, shared by contribution, within every protection. Provisional
 * values. The rules that use them are in server/world/Coop.ts.
 */
export const COOP = {
  /** Flying a cooperation card itself pays this on success (the rest is paid by contribution). */
  cardReward: 5,
  /** Escorting a bomber: paid on success, scaled by the share of the flight spent within `escortRange` of it (none below `minPresence`). */
  escortReward: 30,
  escortRange: 45,
  minPresence: 0.4,
  /** Joint defense: offered to players whose desk is within `defenseRange` of the raided one (and allies anywhere); helpers share `defensePot` by damage on the raider. */
  defenseRange: 140,
  defensePot: 30,
  /** Joint attack: a pot shared by the two attackers, by damage; at most `maxJoint` at once, the next on a target after `jointCooldown`. */
  jointPot: 70,
  jointTime: 300,
  maxJoint: 1,
  jointCooldown: 900,
  /** The target of a joint attack must be this many times the session's median strength. */
  jointStrength: 1.6,
} as const;

/**
 * v0.0.19 (plan §7, GDD §8.7, §13.6): anti-farming. Every reward that flows between two players
 * (kills, assists, raids, bounties, escorts, cooperation, challenges, mischief) is watched per pair,
 * both directions together. Each new flow within `window` pays `decay[n]` of itself (the same idea as
 * PVP.killRepeat and PVP.repeat, across every source), and a pattern that looks like farming pauses
 * rewards between the pair for `pause` seconds and is logged for the developer: never an automatic
 * ban. Provisional values. The rules are in src/systems/Farming.ts.
 */
export const FARMING = {
  window: 1800,
  /** Counted per direction (what one earns from the other), so two real rivals trading blows keep their rewards longer. */
  decay: [1, 1, 1, 0.8, 0.6, 0.45, 0.3, 0.15, 0] as readonly number[],
  pause: 1800,
  /**
   * Patterns within `window`: `kills` kills between the pair with at least `oneSided` of them going one
   * way; `losses` expensive planes (cost ≥ `expensive`) lost by one to the other; `undefended` raids
   * nobody defended; `bounties` bounty shares on each other; `flowCap` paper earned by one from the other.
   */
  kills: 6,
  oneSided: 0.85,
  /** …or this many kills between them whichever way they went (kills traded in turns). */
  traded: 10,
  losses: 4,
  expensive: 60,
  undefended: 3,
  bounties: 2,
  flowCap: 400,
} as const;

/** v0.0.19: harmless mischief on another player's desk (plan §6B, GDD §7.2). */
export type MischiefKind = 'banner' | 'flyby' | 'stunt';

/**
 * v0.0.19 (plan §6, GDD §7.2, §12.4): playful, non-destructive interactions with safety tools.
 * Ink splats fade; mischief never destroys resources or buildings, is rate-limited per target and
 * never aimed at offline or newly arrived players, or at anyone who muted you. Mutes are kept per
 * player for good; reports (a reason, no free text) are kept for the developer. Provisional values.
 * The rules that use them are in server/world/Social.ts.
 */
export const SOCIAL = {
  /** A splat emote marks the nearest aircraft within `splatRange` ahead (inside `splatCone`); ink fades after `inkFade` seconds. */
  splatRange: 35,
  splatCone: 0.75,
  inkFade: 20,
  /** A banner marked with ink stays marked this long. */
  bannerInk: 90,
  /** Mischief cards: reward, time limit, the low pass's ceiling, and the limits (one per pair per `perPair` s, `perTarget` per target per `targetWindow` s). */
  mischief: { reward: 15, time: 180, perPair: 600, perTarget: 3, targetWindow: 1800 },
  /** Reports one player can send in a session, and per reported player. */
  reportsPerSession: 5,
  reportsPerTarget: 1,
} as const;

/** v0.0.19: what a player is known for (plan §5B). */
export type ReputationKind = 'raider' | 'defender' | 'ace' | 'helper';

/**
 * v0.0.19 (plan §5, GDD §12.3): reputation and rivalries. Every notable interaction between two
 * players is recorded (pvp_records) and remembered for `memory` seconds; the "nemesis" is whoever
 * has beaten a player most often (at least `nemesisMin` times), the most recent breaking a tie. The
 * director weighs rematch and payback cards towards rivals, always within the protections, and
 * says why. Reputation never changes combat. Provisional values. The rules are in server/world/Rivalry.ts.
 */
export const RIVALRY = {
  memory: 14 * 24 * 3600,
  nemesisMin: 2,
  /** A raid or hunt card's target is this many times likelier to be your nemesis, or someone who raided you within `payback` seconds. */
  rematchWeight: 3,
  paybackWeight: 2,
  payback: 1800,
  /** A reputation needs at least this many of what it is about, and the label is the one with the most. */
  reputationMin: 3,
} as const;

/** v0.0.19: the kinds of raid on another player's base (plan "Also A", §4). */
export type RaidKind = 'bombing' | 'staged' | 'strike' | 'challenge';

/**
 * v0.0.19 (plan "Also A", §4): deeper raids. Bases can only be damaged through a raid card; every
 * kind obeys the raid rules in PVP (protections, shields, pair cooldowns, repeat factors, loss caps),
 * applied to the whole raid, never per stage. Provisional values. The rules that use them are in
 * server/world/ServerWorld.ts (raids between players) and server/world/PvpMissions.ts (the cards).
 */
export const RAID_KINDS = {
  /** How often each kind is offered, where the victim's base allows it. */
  weights: { bombing: 0.4, staged: 0.2, strike: 0.2, challenge: 0.2 } as Record<RaidKind, number>,
  /** A bombing raid asks for this many structures when the base has at least `multiFrom` standing, and pays `perTarget` more for each extra one. */
  multiTargets: 2,
  multiFrom: 3,
  perTarget: 15,
  /** Staged raids: suppress a radar or turret, then bomb the store. Each stage has this clock (seconds). */
  stageTime: 150,
  /** Stage one done but the store not hit: this share of the reward, never worth failing for on purpose. */
  stagePartial: 0.3,
  /** Strikes: wreck or damage this many structures (not the store) with guns and rockets, low. Pays this, takes no resources. */
  strikeTargets: 2,
  strikeReward: 50,
  strikeTime: 240,
  /**
   * Challenges: the defender has `answer` seconds to take off, then `fight` seconds to settle it over
   * their desk. The winner is paid `reward`; a no-show (or a decline) pays the challenger `noShow` of
   * it and costs the defender `forfeit.share` of their vulnerable paper, at most `forfeit.max`
   * (never the protected reserve).
   */
  challenge: { answer: 90, fight: 180, reward: 50, noShow: 0.4, forfeit: { share: 0.08, max: 25 } },
} as const;

/** v0.0.19: the AI escort aircraft a player can buy for one sortie. */
export type EscortKind = 'wingman' | 'guard' | 'spotter';
export const ESCORT_ORDER: readonly EscortKind[] = ['wingman', 'guard', 'spotter'];
/** v0.0.19: the choices the escort button steps through at home, round and round. */
export const ESCORT_PLANS: ReadonlyArray<readonly EscortKind[]> = [
  [], ['wingman'], ['guard'], ['spotter'], ['wingman', 'wingman'], ['guard', 'wingman'], ['guard', 'guard'], ['guard', 'spotter'], ['wingman', 'spotter'],
];
/** v0.0.19: the orders a player gives their escorts (the order wheel). */
export type EscortOrder = 'follow' | 'attack' | 'protect' | 'cover';
export const ESCORT_ORDERS: readonly EscortOrder[] = ['follow', 'attack', 'protect', 'cover'];

/**
 * v0.0.19 (plan §1, GDD §10): purchasable, single-use AI escorts. Bought at launch, removed when the
 * sortie ends whether they survived or not, never refunded, capped at two per sortie, flown by
 * rookie or regular AI pilots with less health and weaker guns than a human-flown plane of the same
 * type. Built only from conventional aircraft: no stealth (their radar signature is never below
 * `minSignature`) and no drones. Provisional: the developer approves the roster, costs and cap.
 * The rules that use them are in server/world/Escorts.ts.
 */
export const ESCORTS = {
  roster: {
    wingman: {
      label: 'Paper Wingman', short: 'Wingman', aircraft: 'swift' as AircraftId, role: 'fighter' as AiRole, skill: 'easy' as Difficulty,
      cost: { paper: 16, ink: 5 }, detail: 'Follows you, draws fire from defenses, light guns.',
    },
    guard: {
      label: 'Guard Falcon', short: 'Guard', aircraft: 'falcon' as AircraftId, role: 'fighter' as AiRole, skill: 'medium' as Difficulty,
      cost: { paper: 30, ink: 12 }, detail: 'Goes after hostile aircraft near you; protects bombers.',
    },
    spotter: {
      label: 'Spotter', short: 'Spotter', aircraft: 'dart' as AircraftId, role: 'scout' as AiRole, skill: 'easy' as Difficulty,
      cost: { paper: 12 }, detail: 'Marks hostile aircraft near you on the mini-map. Unarmed in a fight.',
    },
  } as Record<EscortKind, { label: string; short: string; aircraft: AircraftId; role: AiRole; skill: Difficulty; cost: { paper: number; ink?: number; rubber?: number }; detail: string }>,
  /** At most this many escorts on one sortie (GDD §10.3). */
  perSortie: 2,
  /** At most this many escorts in the air in one session, so bandwidth stays predictable (GDD §16.4). */
  perSession: 12,
  /** Weaker than a human: this share of the design's health, and of its guns' damage. */
  health: 0.6,
  gunFactor: 0.55,
  /** Escorts are never quieter to radar than this (escorts add no stealth). */
  minSignature: 1,
  /** Shooting down someone's escort pays this, fixed, and nothing else (escorts can't be farmed). */
  killReward: 3,
  /** A spotter marks hostile aircraft within this distance of itself on its owner's mini-map. */
  spotterReveal: 90,
  /** Orders: "attack my target" picks the hostile nearest the owner's nose within this range and cone. */
  attackRange: 110,
  attackCone: 0.5,
  /** "Cover my retreat": escorts go after anything hostile this close behind their owner. */
  coverRange: 70,
} as const;

/**
 * The territory lifecycle in sessions (v0.0.13): when a player's base is packed, the desk stays
 * empty for `gap`, is then open to joining players, and the AI moves back in after `aiDelay` more if
 * nobody comes. Provisional: the developer confirms them (plan v0.0.13, section 11).
 */
export const TERRITORY_LIFECYCLE = {
  /** Empty → open (seconds). */
  gap: 120,
  /** Open → AI-held (seconds). */
  aiDelay: 300,
} as const;

/**
 * Multiplayer sessions (v0.0.13): there is no permanent world, only timed sessions with a capacity,
 * several at once. Provisional values: the developer confirms them (plan v0.0.13, section 11).
 * The rules that use them are in server/sessions/ and server/WorldRoom.ts.
 */
export const SESSION = {
  /** How long a session lasts (seconds). */
  length: 3600,
  /** Players per session: one per desk (16 now; 32 once the larger classrooms arrive in v0.0.22). */
  capacity: 16,
  /** Everyone is warned this long before the end (seconds). */
  warnings: [600, 120, 30] as readonly number[],
  /** New players can't join a session this close to its end (seconds); players coming back still can. */
  joinCloses: 300,
  /** A session nobody is in closes after this long (seconds). */
  emptyClose: 120,
  /** The results card stays up this long before the session closes everyone's connection (seconds). */
  resultsHold: 30,
  /**
   * After a restart, the sessions that were running are reopened for this long (seconds) with each
   * player's desk held for them, so reconnecting players land back where they were.
   */
  restoreWindow: 300,
} as const;

/** What the player can build on T1, and how the base works. Numbers are first balancing guesses. */
export type BuildingKind = 'turret' | 'launcher' | 'radar' | 'workshop' | 'storage' | 'inkwell';
/** defense – weapons. radar – the radar station. economy – workshops and storage. utility – anything but a radar. */
export type SlotKind = 'defense' | 'radar' | 'economy' | 'utility';

export interface BuildingLevel {
  /** Paper to reach this level from the one before (level 1: the building's cost). */
  cost: number;
  health: number;
  /** Weapons: engagement range. Radar: early-warning range. */
  range?: number;
  /** Weapons: damage per round or rocket. */
  damage?: number;
  /** Turrets: seconds between rounds, rounds per magazine and seconds to reload it. */
  interval?: number;
  magazine?: number;
  reloadTime?: number;
  /** Launchers: seconds between rockets. */
  reload?: number;
  /** Workshops: extra paper per minute. Ink wells (v0.0.18): ink per minute. */
  production?: number;
  /** Storage boxes: extra capacity, and extra paper protected from raids. */
  capacity?: number;
  protection?: number;
  /** Storage boxes (v0.0.18): extra ink and rubber-ball capacity, and how much of each they protect. */
  holds?: { ink: number; rubber: number };
  guards?: { ink: number; rubber: number };
  /**
   * v0.0.18: ink or rubber balls on top of the paper `cost` (higher levels of some buildings), and
   * the upkeep this level costs per minute, paid out of production (BASE.upkeep).
   */
  materials?: { ink?: number; rubber?: number };
  upkeep?: { paper?: number; ink?: number };
}

export interface BuildingSpec {
  kind: BuildingKind;
  name: string;
  /** One word, for buttons and tight spaces. */
  short: string;
  /** Which slots it can go in. */
  slots: readonly SlotKind[];
  levels: readonly BuildingLevel[];
  /** What it is for, in a few words (tooltips). */
  purpose: string;
}

export const BASE = {
  /** Paper T1 holds with no storage boxes. Earnings beyond the capacity are lost. */
  capacity: 300,
  /** Paper per minute with no workshop (v0.0.12: 5 → 3.5, paper comes in more slowly)… */
  production: 3.5,
  /** …times this while the balance is below the protected reserve: the crew scavenges scraps. */
  lowBoost: 3,
  /** …and times this while the paper store lies wrecked. */
  wreckedStore: 0.5,
  /**
   * v0.0.18: ink and rubber balls held with no storage boxes, and what comes in without any building:
   * the crew scrapes ink from old pens and scavenges rubber balls. An ink well adds far more ink;
   * rubber balls stay scarce (missions, deliveries and events pay them). Same low-balance boost.
   */
  inkCapacity: 150,
  rubberCapacity: 30,
  inkProduction: 1.5,
  rubberProduction: 0.6,
  /** Without a radar, raiders are only noticed this close to T1 (m from its middle). */
  detection: 70,
  /** Share of the paper put into a building given back when it is removed (scaled by its health). */
  refund: 0.5,
  /** Repairs cost this share of a building's value per share of health missing… */
  repairShare: 0.5,
  /** …and bringing a wreck back this share of its value. Still cheaper than building it again. */
  rebuildShare: 0.7,
  /** The paper store's value, for its repairs. */
  storeValue: 80,
  /** Seconds a new building takes to fold up into place (just for show). */
  assembleTime: 0.9,
  /** At most one of these on a territory. */
  unique: ['radar'] as readonly BuildingKind[],
  /**
   * T1's construction slots, as (along the runway towards the world centre, to its right) from the
   * middle of the platform, in metres. Kept clear of the runway and the take-off path.
   */
  slots: [
    { id: 'D1', kind: 'defense', at: [9, 11] },
    { id: 'D2', kind: 'defense', at: [9, -11] },
    { id: 'R1', kind: 'radar', at: [2, -17] },
    { id: 'E1', kind: 'economy', at: [-15, 8] },
    { id: 'E2', kind: 'economy', at: [-15, -8] },
    { id: 'U1', kind: 'utility', at: [1, 17] },
    { id: 'U2', kind: 'utility', at: [-5, -10] },
  ] as ReadonlyArray<{ id: string; kind: SlotKind; at: readonly [number, number] }>,
  /** What a brand-new game starts with: one ink turret. */
  starter: [{ slot: 'D1', kind: 'turret' }] as ReadonlyArray<{ slot: string; kind: BuildingKind }>,
  buildings: {
    turret: {
      kind: 'turret', name: 'Ink turret', short: 'Turret', slots: ['defense', 'utility'], purpose: 'Short-range air defense',
      levels: [
        { cost: 60, health: 90, range: 45, damage: 4, interval: 0.34, magazine: 24, reloadTime: 3 },
        { cost: 45, health: 110, range: 50, damage: 5, interval: 0.31, magazine: 28, reloadTime: 2.6 },
        { cost: 70, health: 130, range: 55, damage: 6, interval: 0.28, magazine: 32, reloadTime: 2.2 },
      ],
    },
    launcher: {
      kind: 'launcher', name: 'Paper rocket launcher', short: 'Rockets', slots: ['defense', 'utility'], purpose: 'Long-range defense, bombers first',
      levels: [
        { cost: 110, health: 110, range: 75, damage: 28, reload: 7 },
        { cost: 80, health: 130, range: 80, damage: 32, reload: 6 },
        { cost: 120, health: 150, range: 88, damage: 36, reload: 5 },
      ],
    },
    radar: {
      kind: 'radar', name: 'Radar station', short: 'Radar', slots: ['radar'], purpose: 'Early warning of raids',
      levels: [
        { cost: 70, health: 80, range: 140 },
        { cost: 50, health: 95, range: 190 },
        { cost: 80, health: 110, range: 260 },
      ],
    },
    workshop: {
      kind: 'workshop', name: 'Paper workshop', short: 'Workshop', slots: ['economy', 'utility'], purpose: 'More paper per minute',
      levels: [
        { cost: 80, health: 90, production: 1.5 },
        { cost: 60, health: 105, production: 3.5 },
        { cost: 90, health: 120, production: 6, materials: { ink: 20 }, upkeep: { ink: 0.6 } },
      ],
    },
    storage: {
      kind: 'storage', name: 'Storage box', short: 'Storage', slots: ['economy', 'utility'], purpose: 'Holds and protects more paper',
      levels: [
        { cost: 50, health: 100, capacity: 200, protection: 25, holds: { ink: 100, rubber: 10 }, guards: { ink: 10, rubber: 2 } },
        { cost: 50, health: 115, capacity: 500, protection: 50, holds: { ink: 220, rubber: 24 }, guards: { ink: 20, rubber: 4 } },
        { cost: 80, health: 130, capacity: 900, protection: 80, holds: { ink: 400, rubber: 40 }, guards: { ink: 35, rubber: 6 }, materials: { rubber: 4 }, upkeep: { paper: 0.4 } },
      ],
    },
    inkwell: {
      kind: 'inkwell', name: 'Ink well', short: 'Ink well', slots: ['economy', 'utility'], purpose: 'Ink for guns and turrets',
      levels: [
        { cost: 65, health: 85, production: 2.5 },
        { cost: 50, health: 100, production: 5 },
        { cost: 80, health: 115, production: 8, materials: { rubber: 4 }, upkeep: { paper: 0.5 } },
      ],
    },
  } as Record<BuildingKind, BuildingSpec>,
  /** The order buildings are listed in. */
  order: ['turret', 'launcher', 'radar', 'workshop', 'inkwell', 'storage'] as readonly BuildingKind[],
  /** Sorties during which key hints show on the HUD (after that, hold H). */
  hintSorties: 3,
} as const;


export const MISSIONS = {
  /** Mission cards offered at home. */
  offers: 3,
  difficulty: {
    easy: { label: 'Easy', stars: 1, multiplier: 1 },
    medium: { label: 'Medium', stars: 2, multiplier: 1.5 },
    hard: { label: 'Hard', stars: 3, multiplier: 2 },
  },
  /** Base reward per mission type, before the distance bonus and the difficulty multiplier. */
  baseReward: {
    bombing: 22,
    precision: 30,
    recon: 18,
    delivery: 18,
    return: 28,
    'multi-bomb': 26,
    rings: 10,
    practice: 24,
    suppression: 28,
    'danger-recon': 22,
    fortified: 30,
    'multi-stage': 32,
    survival: 24,
    'low-attack': 30,
    dogfight: 28,
    'scout-intercept': 25,
    'bomber-intercept': 30,
    escort: 28,
    patrol: 24,
    combined: 32,
    shipment: 25,
    convoy: 28,
    'supply-run': 28,
    stunt: 20,
    'time-trial': 18,
    discovery: 18,
    strafe: 30,
  },
  /**
   * How long each type keeps the player in harm's way, scaling the threat bonus: a survival
   * challenge means sitting under the guns, a delivery only touches the edge of the airspace.
   */
  exposure: {
    bombing: 1,
    precision: 1.2,
    recon: 1.2,
    delivery: 0.5,
    return: 1,
    'multi-bomb': 1,
    rings: 0.6,
    practice: 1,
    suppression: 1.4,
    'danger-recon': 1.2,
    fortified: 1.1,
    'multi-stage': 1.4,
    survival: 1.6,
    'low-attack': 1.2,
    dogfight: 1,
    'scout-intercept': 0.6,
    'bomber-intercept': 0.5,
    escort: 1.2,
    patrol: 1,
    combined: 1.2,
    shipment: 1.1,
    convoy: 0.6,
    'supply-run': 0.8,
    stunt: 0.6,
    'time-trial': 0.6,
    discovery: 0.7,
    strafe: 1.3,
  },
  /** Mission types built around defenses need targets with at least this threat level. */
  minThreat: { suppression: 1, 'danger-recon': 1, survival: 1, 'low-attack': 1, fortified: 2, 'multi-stage': 2, combined: 1, strafe: 1 },
  /** v0.0.18 strafing run: structures to wreck (by difficulty), and seconds on top of the flight there. */
  strafeCount: { easy: 2, medium: 3, hard: 4 },
  strafeTime: { easy: 50, medium: 40, hard: 32 },
  /** Extra reward for each enemy aircraft a mission sends up, by its pilot's skill. */
  airBonus: { easy: 6, medium: 8, hard: 10 },
  /** Bomber interception: where the raider sets out from. Harder raids start further off, and with an escort on hard. */
  raidOrigins: { easy: ['T3', 'T9'], medium: ['T7', 'T10', 'T14'], hard: ['T16', 'T12', 'T15'] } as Record<Difficulty, readonly string[]>,
  /**
   * Missions that only go as far as guarded ground: an escorted bomber has to survive the guns too,
   * and a patrol is about the fight in the air, not sitting under rocket launchers.
   */
  maxThreat: { escort: 2, patrol: 2 } as Partial<Record<string, ThreatLevel>>,
  /**
   * Airspace patrol: seconds to spend over the territory, and how far out and how high the patrol
   * area reaches. It reaches above the turrets' range: patrolling high is the safe way.
   */
  patrolTime: { easy: 20, medium: 25, hard: 30 },
  patrolMargin: 15,
  patrolCeiling: 60,
  /** Extra paper per metre between the launch pad and the objective. */
  distanceReward: 0.05,
  /**
   * v0.0.18: ink and rubber balls a mission pays with its paper, by type, before the tier's
   * multiplier (TIERS). Combat pays ink back, bombing pays rubber balls back, deliveries pay well in
   * one or the other (they are the natural way to top up). Rewards stay modest: paper rules.
   */
  supplies: {
    bombing: { rubber: 2 }, precision: { rubber: 2 }, 'multi-bomb': { rubber: 3 }, return: { rubber: 2 }, fortified: { rubber: 3, ink: 4 },
    'low-attack': { rubber: 2, ink: 4 }, suppression: { ink: 10 }, practice: { ink: 8 }, dogfight: { ink: 10 }, patrol: { ink: 8 },
    'scout-intercept': { ink: 6 }, 'bomber-intercept': { ink: 8 }, escort: { ink: 8 }, combined: { ink: 6, rubber: 2 }, 'multi-stage': { ink: 6, rubber: 2 },
    delivery: { ink: 18 }, survival: { ink: 6 }, shipment: { rubber: 3 }, convoy: { ink: 8 }, 'supply-run': { ink: 10, rubber: 3 },
    stunt: { ink: 4 }, 'time-trial': { ink: 4 }, discovery: { rubber: 3 }, strafe: { ink: 10, rubber: 2 },
  } as Partial<Record<string, { ink?: number; rubber?: number }>>,
  /**
   * Seconds a good run spends on the job itself, on top of the flight there at the reference
   * speed: the par time for a gold rating.
   */
  parAllowance: {
    bombing: 15, precision: 22, recon: 14, delivery: 0, return: 25, 'multi-bomb': 30, rings: 6, practice: 28,
    suppression: 30, 'danger-recon': 22, fortified: 25, 'multi-stage': 50, survival: 18, 'low-attack': 28,
    dogfight: 30, 'scout-intercept': 30, 'bomber-intercept': 25, escort: 45, patrol: 35, combined: 35,
    shipment: 25, convoy: 30, 'supply-run': 45, stunt: 14, 'time-trial': 4, discovery: 6, strafe: 35,
  },
  /** Mission time limits are worked out for a plane flying at this speed, whichever plane is chosen. */
  referenceSpeed: 20,
  /** Bullseye radius for ordinary bombing targets, and for the small precision spot. */
  bullseyeRadius: { easy: 6, medium: 5, hard: 4 },
  precisionRadius: { easy: 3, medium: 2.4, hard: 1.8 },
  /** Bombs offered beyond one per target. A plane carries as many of them as its rack holds. */
  spareBombs: { easy: 2, medium: 1, hard: 0 },
  /** Precision spots keep this much clear ground around props and pencil stands. */
  precisionClearance: 2.5,
  /** Height of the bullseye above the platform top. */
  targetHeight: 0.3,
  /** Reconnaissance: time to spend inside the target's airspace, below the ceiling. */
  reconTime: { easy: 3, medium: 4.5, hard: 6 },
  reconCeiling: { easy: 30, medium: 22, hard: 15 },
  /** Timed delivery: time limit = flight time at the reference speed × slack + extra. */
  deliverySlack: { easy: 2.2, medium: 1.6, hard: 1.3 },
  deliveryExtraTime: 4,
  deliveryCeiling: 35,
  /** Flight challenge: number and size of the paper rings, and the time limit on hard. */
  ringCount: { easy: 4, medium: 5, hard: 6 },
  ringRadius: { easy: 5, medium: 4.2, hard: 3.5 },
  ringMinHeight: 8,
  ringMaxHeight: 28,
  ringSlackHard: 1.6,
  /** Target practice: dummies to shoot down on one territory, and the time limit on hard (plus travel). */
  practiceCount: { easy: 2, medium: 3, hard: 3 },
  practiceTimeHard: 28,
  /** Dangerous reconnaissance: a short stay over a defended territory, then get clear of its weapons. */
  dangerReconTime: { easy: 3, medium: 4, hard: 5 },
  dangerReconCeiling: { easy: 32, medium: 28, hard: 24 },
  /** Escaping means getting this far beyond the reach of the territory's longest-ranged weapon. */
  escapeMargin: 12,
  /** Survival challenge: total time to spend in a defended territory's airspace. */
  survivalTime: { easy: 12, medium: 16, hard: 20 },
  survivalCeiling: 32,
  /**
   * v0.0.18 stunts: rings, of which `maneuverGates` must be flown through during a maneuver, and one
   * low gate at `lowGate` metres. Time trials: a desk's fixed circuit (the same rings every time, so
   * a record means something), its time limit = the reference flight × `trialSlack`.
   */
  stuntRings: { easy: 4, medium: 5, hard: 6 },
  maneuverGates: { easy: 1, medium: 2, hard: 2 },
  lowGate: 4.5,
  trialRings: 6,
  trialSlack: { easy: 1.9, medium: 1.6, hard: 1.35 },
  /** Discovery: the airspace over a landmark to reach, and its ceiling. */
  discoveryHalf: 10,
  discoveryCeiling: 32,
  /**
   * v0.0.18 deliveries: from medium up, a delivery may carry fragile cargo (any knock over
   * `fragileImpact` damage fails it) or heavy cargo (top speed and boost times `heavyCargo`).
   */
  cargoChance: { easy: 0, medium: 0.4, hard: 0.6 },
  fragileImpact: 4,
  heavyCargo: 0.85,
  /** Fragile and heavy cargo pay this much more. */
  cargoBonus: 1.25,
  /** Low-level strike: stay below this height within `lowApproachRadius` of the bullseye. */
  lowCeiling: { easy: 16, medium: 13, hard: 10 },
  lowApproachRadius: 60,
} as const;

/**
 * How much each 1–5 rating matters for each mission type, for the suitability badges. A weighted
 * average rating at or above `recommended` earns "Recommended", at or above `good` "Good fit".
 */
export const SUITABILITY = {
  weights: {
    bombing: { payload: 2, durability: 1 },
    precision: { payload: 2, maneuverability: 1 },
    recon: { stealth: 2, speed: 2, durability: 1 },
    delivery: { speed: 3, maneuverability: 1 },
    return: { durability: 2, payload: 2, stealth: 1 },
    'multi-bomb': { payload: 3, maneuverability: 1 },
    rings: { maneuverability: 3, speed: 1 },
    practice: { firepower: 3, maneuverability: 2 },
    suppression: { firepower: 3, maneuverability: 2, durability: 1 },
    'danger-recon': { stealth: 2, maneuverability: 2, speed: 1 },
    fortified: { payload: 3, durability: 3, firepower: 1, maneuverability: 1 },
    'multi-stage': { payload: 1, firepower: 1, durability: 1, maneuverability: 1 },
    survival: { maneuverability: 3, durability: 2, speed: 1 },
    'low-attack': { payload: 2, maneuverability: 2, durability: 1 },
    dogfight: { firepower: 3, maneuverability: 3, speed: 1 },
    'scout-intercept': { speed: 3, firepower: 2, stealth: 1 },
    'bomber-intercept': { firepower: 3, speed: 2, durability: 1 },
    escort: { firepower: 3, maneuverability: 2, durability: 1 },
    patrol: { firepower: 2, maneuverability: 3, durability: 1, speed: 1 },
    combined: { payload: 1, firepower: 1, durability: 1, maneuverability: 1 },
    shipment: { firepower: 2, payload: 2, maneuverability: 1 },
    convoy: { speed: 3, firepower: 2, durability: 1 },
    'supply-run': { firepower: 3, maneuverability: 2, durability: 1 },
    stunt: { maneuverability: 3, speed: 1 },
    'time-trial': { speed: 3, maneuverability: 2 },
    discovery: { speed: 2, stealth: 1, maneuverability: 1 },
    strafe: { firepower: 3, durability: 3, payload: 1 },
  },
  /**
   * Types that need a bit of everything are rated by the plane's weakest weighted rating (plus
   * one) instead of the average, so a specialist with one poor stat doesn't come out on top.
   */
  balanced: ['multi-stage', 'combined'],
  recommended: 4,
  good: 2.75,
} as const;

/**
 * The mission director: which cards it deals, how it adapts to the player, and the world events
 * and operations it builds missions around. All numbers are first balancing guesses.
 */
export const DIRECTOR = {
  /**
   * The three regular cards. Each slot's tier is an index (0 easy … 3 very hard) that grows with
   * the player's skill from `[0]` (skill 0) to `[1]` (skill 1); the fraction is the chance of the
   * tier above. The safe card always stays easy.
   *
   * Skill itself follows the performance rating, mapped from `skill.floor` (skill 0) to
   * `skill.ceiling` (skill 1).
   */
  slots: {
    safe: [0, 0],
    balanced: [0.55, 2.2],
    risky: [1.35, 3],
  } as Record<'safe' | 'balanced' | 'risky', readonly [number, number]>,
  /** Very hard cards get one escalation, and a second with this chance per point of skill above `secondFrom`. */
  secondEscalation: { from: 0.75, chance: 1.6 },
  /** What each modifier is called on a card and what it multiplies the reward by (the M in B × D × M). */
  modifiers: {
    // Escalations that add aircraft, targets or distance are paid through B already.
    wingman: { label: 'Wingman', detail: 'A second enemy fighter', reward: 1 },
    escorted: { label: 'Escorted', detail: 'The bomber has a fighter escort', reward: 1 },
    'extra-target': { label: '+1 target', detail: 'An extra objective', reward: 1 },
    return: { label: 'Return flight', detail: 'Land on T1 to finish', reward: 1 },
    'tight-clock': { label: 'Tight clock', detail: 'A stricter time limit', reward: 1.1 },
    'high-value': { label: 'High value', detail: 'A temporary high-value target', reward: 1.5 },
    alert: { label: 'On alert', detail: 'The target territory is on alert', reward: 1.2 },
    recovery: { label: 'Recovery', detail: 'Low risk, pays enough for a new plane', reward: 1 },
    'short-ink': { label: 'Ink run', detail: 'Pays extra ink: your store is low', reward: 1 },
    'short-rubber': { label: 'Rubber run', detail: 'Pays extra rubber balls: your store is low', reward: 1 },
    emergency: { label: 'Emergency', detail: 'Defend home', reward: 1 },
  },
  /** A recovery mission always pays at least this: enough to fold a Falcon. */
  recoveryReward: 30,
  /**
   * v0.0.18: below these the safe card becomes a recovery card that pays the short resource (the
   * extra on top of the type's own supplies), so a player low on ink or rubber balls tops up by flying.
   */
  shortInk: 25,
  shortRubber: 4,
  recoverySupplies: { ink: 30, rubber: 8 },
  /** Tight clock: the time limit is the par time times this, plus `tightExtra` seconds (existing limits shrink by `tightShrink`). */
  tightSlack: 1.7,
  tightExtra: 10,
  tightShrink: 0.8,
  /**
   * Variety: each of the last `window` missions flown in the same category multiplies a type's
   * weight by `category`, in the same type by `type` again. The last `repeat` flown missions
   * (type and target) are never offered again as they were.
   */
  variety: { window: 6, category: 0.45, type: 0.55, repeat: 3, noise: 0.35 },
  /** Swapping a card: at most `max` swaps in hand, one more back after every sortie. */
  swaps: { max: 3, start: 3, perSortie: 1 },
  /**
   * Skill (0–1) drives the tiers. It starts at `start`, waits for `settle` missions, then moves
   * towards the performance rating by at most `maxStep` per mission: one good sortie never makes
   * the next much harder.
   */
  skill: { start: 0.2, settle: 3, gain: 0.35, maxStep: 0.07, floor: 0.35, ceiling: 0.9 },
  /** The performance rating looks at this many recent missions, the newest counting most. */
  window: 10,
  recency: 0.85,
  /** How much each indicator counts in the rating. */
  weights: { success: 0.3, survival: 0.15, damage: 0.1, speed: 0.1, accuracy: 0.1, landings: 0.1, hard: 0.15 },
  /** Struggling: this many planes lost in the last `lossWindow` sorties, or this many failures in the last `failWindow`. */
  struggle: { losses: 2, lossWindow: 3, failures: 3, failWindow: 4 },
  /** History entries kept for the developer panel and the save. */
  historySize: 80,
} as const;

/** World events: things that happen whether or not the player asked for them. */
export const EVENTS = {
  /** Nothing happens until the player has flown this many sorties. */
  afterSorties: 1,
  /** Seconds before the first event, and between one major event ending and the next starting. */
  first: [70, 120] as readonly [number, number],
  cooldown: [100, 170] as readonly [number, number],
  /** At most this many major events (raids, convoys, shipments, supply runs) at once. */
  maxActive: 1,
  /** How often each kind comes up. Raids keep their own pace (RAIDS) but wait their turn. */
  weights: { 'high-value': 1, convoy: 1, 'supply-run': 0.8 },
  /** Seconds a high-value shipment stays before it is moved away. */
  shipmentTime: 200,
  /** Bounty for destroying a shipment or shooting down a convoy outside the event's own card. */
  bounty: { 'high-value': 45, convoy: 50 },
  /** Supplies delivered to T1 by a supply run that the player escorted. */
  supplies: 50,
  /**
   * v0.0.18: world events in multiplayer sessions (server/world/SessionEvents.ts). One scheduler per
   * session, paced by how many players are connected: the cooldown is scaled by
   * sqrt(`pacePlayers` / players) (never shorter than with 16), so a two-player session is never
   * flooded; one event at a time up to `crowd` players, two above. Rewards for shipments and convoys
   * are the bounties above, split by each player's share of the damage (`shareMin` to count).
   */
  session: {
    first: [120, 200] as readonly [number, number],
    cooldown: [160, 260] as readonly [number, number],
    pacePlayers: 2,
    crowd: 8,
    weights: { 'high-value': 1, convoy: 1, 'supply-drop': 1, 'ink-storm': 0.3 } as Record<string, number>,
    shareMin: 0.1,
    /** A supply drop: a crate of ink or rubber balls on a free desk, to the first to fly low over it. */
    dropTime: 180,
    drop: { ink: 45, rubber: 10, paper: 15 },
    dropHalf: 7,
    dropCeiling: 9,
    /** An ink storm: missions pay `stormFactor` times their ink for `stormTime` seconds. */
    stormTime: 600,
    stormFactor: 2,
  },
  /** A territory stays on alert this long after the player destroys something there, and its wrecks stay down. */
  alertTime: 180,
  /** With every weapon destroyed, a territory's defenses stay disabled this long. */
  disabledTime: 240,
} as const;

/** Operations: short chains of missions against one territory, flown over several sorties. */
export const OPERATIONS = {
  /** Offered once the player has completed this many missions, and not again for `cooldown` missions after one ends. */
  afterMissions: 2,
  cooldown: 2,
  /** Chance a deal includes an operation card when one may be offered. */
  chance: 0.45,
  /** Completing every stage pays this share of the stages' rewards on top (rounded to 5, at least `minBonus`). */
  bonusShare: 0.25,
  minBonus: 20,
  /** Optional objectives: paper for meeting one. */
  optionalBonus: { easy: 10, medium: 15, hard: 20, veryhard: 25 } as Record<Tier, number>,
  /** "Take less than this share of damage" optional objective. */
  lightDamage: 0.25,
} as const;

/** Ratings, records, streaks and achievements. */
export const PROGRESS = {
  /** Silver needs the plane to take at most this share of its health in damage. */
  silverDamage: 0.4,
  /** Gold also needs the mission done within par time, and the plane brought home. */
  /** Air combat efficiency: ink accuracy at least this. */
  silverAccuracy: 0.18,
  /** Streak bonus: +5% from 3 in a row, +10% from 5. Modest, so a failure never hurts much. */
  streak: [[5, 0.1], [3, 0.05]] as ReadonlyArray<readonly [number, number]>,
  /** "Most accurate bombing run" needs at least this many bombs dropped. */
  accuracyMinBombs: 2,
} as const;

/**
 * v0.0.17: Merit, the points behind player ranks. Earned in multiplayer only, decided by the server,
 * written to an idempotent ledger, never lost and never spent. Provisional values, for the developer
 * to approve; the economy simulator (v0.0.18) checks them against real play.
 */
export const MERIT = {
  /** A mission completed, by its tier (1–3+). */
  mission: [6, 9, 13, 18] as readonly number[],
  /** Shooting down another player, and an assist on one. */
  playerKill: 10,
  playerAssist: 4,
  /** Shooting down an AI plane: small, and capped per session. */
  aiKill: 1,
  aiKillCap: 15,
  /** A raid that got through (attacker), a raid repelled by the player being raided (defender). */
  raid: 15,
  defend: 12,
  /** Active time in the air: `active.amount` for every `active.every` seconds flown, capped per session. */
  active: { every: 300, amount: 3, cap: 36 },
  /** End-of-session placement bonus, for 1st, 2nd and 3rd. */
  placement: [15, 10, 5] as readonly number[],
  /** The first multiplayer session of the day (UTC), once. */
  firstOfDay: 10,
  /**
   * v0.0.18: medals and achievements, now decided by the server, are Merit sources too: a medal per
   * mission (by colour), and an achievement once ever.
   */
  medal: { bronze: 2, silver: 4, gold: 7 } as Record<'bronze' | 'silver' | 'gold', number>,
  achievement: 12,
  /**
   * Diminishing returns: the n-th shoot-down of the same player in a session pays `repeatKill[n]` of
   * the value (the last entry from then on); the n-th raid between the same two players likewise.
   */
  repeatKill: [1, 0.5, 0.25, 0] as readonly number[],
  repeatRaid: [1, 0.5, 0] as readonly number[],
  /** A shoot-down of a player under new-player protection pays this share. */
  protectedShare: 0.3,
  /** The Merit to go from one level to the next grows by `growth` each level, from `first`. */
  curve: { first: 20, growth: 1.12 },
  /** Past the top level, every Honor Roll star costs this. */
  honorStar: 4000,
  /** The one-off backfill for players from before v0.0.17: Merit per sortie, mission and kill already played. */
  backfill: { sortie: 2, mission: 5, kill: 6, cap: 2500 },
} as const;

export const CAMERA = {
  distance: 10,
  /** Extra follow distance at full speed, and while boosting: the view pulls back as you speed up. */
  speedDistance: 4,
  boostDistance: 2,
  /** v0.0.16: extra distance during a maneuver or a loop, so the pilot sees a chaser fly past. */
  maneuverDistance: 4,
  height: 5,
  /** The camera aims this far ahead of the plane and this far below its flight line, so the ground
   * under the plane (its shadow, the target) stays in view. */
  lookAhead: 10,
  lookDrop: 4,
  /** While a bomb falls (and briefly after it lands) the camera rises and pans down to show it. */
  bombCamRise: 4,
  bombCamBlend: 0.5,
  bombCamLinger: 1.1,
  /** Follow stiffness (1/s). Higher = tighter, lower = floatier. */
  followStiffness: 5,
  /** Share of the plane's bank the camera leans into, and how fast it follows (1/s). */
  rollFollow: 0.2,
  rollStiffness: 4,
  baseFov: 62,
  /** Extra field of view at full speed and while boosting, to sell the sense of speed. */
  speedFov: 10,
  boostFov: 8,
} as const;

export const TRAILS = {
  /** Seconds a wingtip ribbon lingers. */
  life: 0.9,
  width: 0.16,
  opacity: 0.55,
  /** Wind streaks: how many, and how visible at cruise, at top speed and while boosting. */
  streakCount: 28,
  streakBase: 0.12,
  streakMax: 0.45,
} as const;

/** Flat colours (sRGB 0–1). */
export const PALETTE = {
  sky: [0.86, 0.85, 0.81],
  home: [0.23, 0.48, 0.93],
  target: [0.98, 0.56, 0.16],
  targetDone: [0.45, 0.78, 0.5],
  neutral: [0.62, 0.64, 0.68],
  launchPad: [0.86, 0.92, 1],
  runway: [0.36, 0.42, 0.52],
  bullseyeRed: [0.86, 0.15, 0.15],
  bullseyeWhite: [0.98, 0.97, 0.94],
  precisionInk: [0.2, 0.18, 0.55],
  done: [0.18, 0.66, 0.32],
  recon: [0.25, 0.55, 0.98],
  delivery: [0.2, 0.75, 0.45],
  ringNext: [1, 0.55, 0.1],
  ink: [0.12, 0.14, 0.32],
  paper: [0.97, 0.96, 0.92],
  paperBall: [0.95, 0.93, 0.86],
  blueprint: [0.85, 0.95, 1],
  cardboard: [0.74, 0.58, 0.38],
  cardboardDark: [0.6, 0.45, 0.28],
  tape: [0.93, 0.86, 0.62],
  pencil: [0.98, 0.76, 0.16],
  pencilWood: [0.93, 0.8, 0.6],
  graphite: [0.25, 0.25, 0.28],
  dummyPaper: [0.9, 0.86, 0.76],
  dummyAccent: [0.86, 0.22, 0.2],
  inkShot: [0.12, 0.2, 0.7],
  damageTrail: [0.22, 0.24, 0.32],
  /** Defenses: olive-drab card, a darker trim, and the scorched card of a wreck. */
  defense: [0.52, 0.55, 0.38],
  defenseDark: [0.33, 0.36, 0.25],
  defenseBarrel: [0.18, 0.19, 0.17],
  /** T1's own guns, in home blue. */
  friendlyDefense: [0.36, 0.5, 0.78],
  wreck: [0.26, 0.24, 0.22],
  enemyInk: [0.55, 0.08, 0.32],
  rocketPaper: [0.96, 0.95, 0.9],
  rocketNose: [0.85, 0.14, 0.12],
  rocketTrail: [0.92, 0.92, 0.9],
  radarDish: [0.86, 0.87, 0.84],
  rangeTurret: [0.95, 0.25, 0.2],
  rangeLauncher: [0.65, 0.25, 0.85],
  /** AI aircraft: enemy planes are folded from grey newsprint with red trim, friendly ones in home blue. */
  enemyPaper: [0.8, 0.79, 0.76],
  enemyAccent: [0.72, 0.1, 0.12],
  friendlyAccent: [0.23, 0.48, 0.93],
  /** Flags and platform trim per threat level (light, guarded, fortified). */
  threat1: [0.98, 0.78, 0.18],
  threat2: [0.98, 0.5, 0.12],
  threat3: [0.86, 0.15, 0.15],
} as const;

/**
 * Names for the desks the AI holds in multiplayer (v0.0.12, approved 2026-11-05), shown as
 * "{name}'s desk". Picked per session, skipping any name a player in that session uses.
 */
export const DESK_NAMES: readonly string[] = [
  'Billy', 'Tina', 'Big Greg', 'Sticky Sam', 'Pencil Pete', "Lil' Kevin", 'Captain Crayon', 'Gluestick Gary', 'Messy Maya', 'Sir Eraser',
  'Lunchbox Lou', 'Professor Pip', 'Sleepy Steve', 'Bossy Bea', 'Noodle Ned', 'Paperclip Pam', 'Wobbly Walt', 'Snack Jack', 'Fizzy Fran',
  'Doodle Dot', 'Nana Ruth', 'Tiny Tim', 'Margo', 'Doug',
];

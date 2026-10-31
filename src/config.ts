/**
 * Every tuning number lives here so playtesting can adjust them in one place.
 * All values are provisional. Distances are world units (shown as "m" in the HUD), times are
 * seconds, angles are radians unless the name says otherwise.
 */

const DEG = Math.PI / 180;

/** Whose side something is on: the player's (their plane, T1's guns, a friendly AI bomber) or the enemy's. */
export type Side = 'player' | 'enemy';

/** How targets, shots and kills refer to the player's own plane. */
export const PLAYER_ID = 'player';

export const ECONOMY = {
  startingPaper: 100,
  /** Home produces `incomeAmount` paper every `incomeInterval` seconds… */
  incomeAmount: 1,
  incomeInterval: 2,
  /** …while the player holds less than this. It is a safety net; missions are how you get rich. */
  incomeCap: 150,
  /** Enemy raids never take the balance below this, so the player can always fold a plane. */
  protectedPaper: 50,
} as const;

export const WORLD = {
  /** Territories per side; the grid is gridSize × gridSize. */
  gridSize: 3,
  /** Edge length of one square territory. */
  territorySize: 40,
  /** Empty space between neighbouring territories. */
  gap: 30,
  /** Platform thickness. Platform tops sit at y = 0. */
  thickness: 1.2,
  homeId: 'T1',
  /** Anything that sinks below this height has fallen into the void. */
  voidY: -30,
  /** Soft altitude limit for the plane. */
  ceilingY: 70,
  /** Horizontal distance from the world centre where the airspace ends. */
  boundaryRadius: 190,
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
  /** Seconds the ground crew takes to top up ink and range after a landing (R). */
  rearmTime: 1.5,
  /** Out of range, the nose is held at least this far down: the plane can only glide. */
  glideAngle: 5 * DEG,
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
}

export type BombKind = 'standard' | 'small';
export type AircraftId = 'dart' | 'falcon' | 'swift' | 'widewing';
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
  tagline: string;
  flight: FlightProfile;
  maxHealth: number;
  /** Metres it can fly before it can only glide. Rearming at home restores it. */
  range: number;
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
}

/**
 * The aircraft patterns the player can fold. Stats and costs are first balancing guesses. To add a
 * plane, add an entry here and a shape in aircraft/PlaneShapes.ts: the flight physics, garage,
 * ratings and suitability all work from this data.
 */
export const AIRCRAFT: Record<AircraftId, AircraftSpec> = {
  dart: {
    id: 'dart',
    name: 'Dart',
    role: 'recon',
    roleLabel: 'Recon',
    cost: 10,
    refitCost: 3,
    tagline: 'Cheap, quick and far-flying, but fragile. Carries one mini bomb.',
    flight: {
      minSpeed: 11, cruiseSpeed: 22, maxSpeed: 35,
      throttleAccel: 20, speedResponse: 3.2, pitchSpeedEffect: 6,
      maxTurnRate: 1.45, maxPitchRate: 1.25, aimGain: 3.2, rollResponse: 7, pitchResponse: 6.5, maxBank: 55 * DEG,
      boostSpeed: 16, boostResponse: 5.5, boostDuration: 1.4, boostCooldown: 3,
      collisionRadius: 0.6,
    },
    maxHealth: 45,
    range: 2600,
    gun: { barrels: 1, ammo: 40, interval: 0.18, damage: 5, speed: 62, range: 60 },
    gunLabel: 'Light ink gun',
    bombs: { capacity: 1, kind: 'small' },
    signature: 0.65,
    hitRadius: 0.9,
    accent: [0.08, 0.62, 0.56],
  },
  falcon: {
    id: 'falcon',
    name: 'Falcon',
    role: 'fighter',
    roleLabel: 'Fighter',
    cost: 25,
    refitCost: 6,
    tagline: 'Fast and agile with twin ink guns. Built to dogfight, not to bomb.',
    flight: {
      minSpeed: 10, cruiseSpeed: 21, maxSpeed: 33,
      throttleAccel: 16, speedResponse: 2.4, pitchSpeedEffect: 9,
      maxTurnRate: 1.75, maxPitchRate: 1.45, aimGain: 3.4, rollResponse: 8, pitchResponse: 7, maxBank: 62 * DEG,
      boostSpeed: 14, boostResponse: 5, boostDuration: 1.2, boostCooldown: 3.2,
      collisionRadius: 0.8,
    },
    maxHealth: 100,
    range: 1600,
    gun: { barrels: 2, ammo: 120, interval: 0.08, damage: 7, speed: 78, range: 85 },
    gunLabel: 'Twin ink guns',
    bombs: { capacity: 1, kind: 'standard' },
    signature: 0.9,
    hitRadius: 1.0,
    accent: [0.2, 0.45, 0.95],
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    role: 'multirole',
    roleLabel: 'Multipurpose',
    cost: 30,
    refitCost: 7,
    tagline: 'Balanced in the air and in a fight. Two bombs and twin guns.',
    flight: {
      minSpeed: 10, cruiseSpeed: 20, maxSpeed: 30,
      throttleAccel: 14, speedResponse: 2, pitchSpeedEffect: 8,
      maxTurnRate: 1.5, maxPitchRate: 1.2, aimGain: 3, rollResponse: 6, pitchResponse: 6, maxBank: 55 * DEG,
      boostSpeed: 13, boostResponse: 5, boostDuration: 1.2, boostCooldown: 3.5,
      collisionRadius: 0.8,
    },
    maxHealth: 110,
    range: 1900,
    gun: { barrels: 2, ammo: 80, interval: 0.12, damage: 6, speed: 70, range: 75 },
    gunLabel: 'Twin ink guns',
    bombs: { capacity: 2, kind: 'standard' },
    signature: 1.0,
    hitRadius: 1.05,
    accent: [0.95, 0.58, 0.1],
  },
  widewing: {
    id: 'widewing',
    name: 'Widewing',
    role: 'bomber',
    roleLabel: 'Bomber',
    cost: 40,
    refitCost: 10,
    tagline: 'Slow, heavy and tough. Carries four bombs and turns like a barge.',
    flight: {
      minSpeed: 9, cruiseSpeed: 17, maxSpeed: 26,
      throttleAccel: 9, speedResponse: 1.2, pitchSpeedEffect: 11,
      maxTurnRate: 1.05, maxPitchRate: 0.85, aimGain: 2.4, rollResponse: 3.2, pitchResponse: 3.5, maxBank: 45 * DEG,
      boostSpeed: 10, boostResponse: 3.5, boostDuration: 1, boostCooldown: 4.5,
      collisionRadius: 1,
    },
    maxHealth: 150,
    range: 1300,
    gun: { barrels: 1, ammo: 50, interval: 0.2, damage: 6, speed: 60, range: 65 },
    gunLabel: 'Nose ink gun',
    bombs: { capacity: 4, kind: 'standard' },
    signature: 1.25,
    hitRadius: 1.4,
    accent: [0.82, 0.2, 0.32],
  },
};

/** Garage order, cheapest first. */
export const AIRCRAFT_ORDER: readonly AircraftId[] = ['dart', 'falcon', 'swift', 'widewing'];

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
  range: [1200, 2700],
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
  map: { T2: 0, T4: 0, T5: 1, T7: 1, T3: 2, T6: 2, T8: 3, T9: 3 },
  levels: {
    0: { label: 'Unprotected', turrets: 0, launchers: 0, radar: false, supply: false },
    1: { label: 'Light', turrets: 1, launchers: 0, radar: false, supply: false },
    2: { label: 'Guarded', turrets: 2, launchers: 0, radar: true, supply: true },
    3: { label: 'Fortified', turrets: 2, launchers: 1, radar: true, supply: true },
  },
  /** The threat levels (lowest, highest) a mission of each difficulty sends the player into. */
  byDifficulty: { easy: [0, 1], medium: [1, 2], hard: [2, 3] },
  /** Extra reward for each defended territory a mission goes into, scaled by the type's exposure. */
  rewardBonus: { 0: 0, 1: 8, 2: 16, 3: 26 },
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
   * T1's own defenses, predefined until players can build their own: two ink turrets that shoot at
   * hostile aircraft (never at the player), and the paper store enemy bombers aim for. Positions are
   * (along the runway towards the world centre, to its right), from the middle of the platform.
   */
  home: {
    turrets: [[4, 12.5], [4, -12.5]] as ReadonlyArray<readonly [number, number]>,
    store: [-6, 12.5] as readonly [number, number],
    storeName: 'Paper store',
    storeRole: 'Your stores · raid target',
    storeHealth: 120,
    turretRole: 'Defends T1 · hostile aircraft',
  },
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
  hardness: { turret: 1, launcher: 1, radar: 0.8, supply: 0.7, barrier: 0.85 },
  /** Name and health labels show for installations this close. */
  labelRange: 110,
  /** The threat panel shows a defended territory once the plane is this close to its weapons' reach. */
  approachMargin: 30,
  /** A weapon's range ring shows once the plane is within this of its reach. */
  ringMargin: 40,
} as const;

export type Difficulty = 'easy' | 'medium' | 'hard';

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
  roleLabels: { scout: 'Scout', fighter: 'Fighter', bomber: 'Bomber' },
  skill: {
    easy: {
      label: 'Rookie', reaction: 1.0, trackingLag: 0.6, lead: 0.5, aimError: 6.5 * DEG, fireCone: 5 * DEG, burst: 0.35, pause: 1.5,
      throttle: 0.45, boost: false, evasive: 0, disengageHealth: 0, cleanBreak: false, positioning: 0, floor: 10, bombError: 10,
    },
    medium: {
      label: 'Regular', reaction: 0.6, trackingLag: 0.38, lead: 0.8, aimError: 4.5 * DEG, fireCone: 4 * DEG, burst: 0.45, pause: 1,
      throttle: 0.75, boost: true, evasive: 0.35, disengageHealth: 0.25, cleanBreak: false, positioning: 0.5, floor: 7, bombError: 6,
    },
    hard: {
      label: 'Veteran', reaction: 0.32, trackingLag: 0.22, lead: 0.95, aimError: 3.5 * DEG, fireCone: 3.5 * DEG, burst: 0.6, pause: 0.8,
      throttle: 1, boost: true, evasive: 0.7, disengageHealth: 0.35, cleanBreak: true, positioning: 1, floor: 4.5, bombError: 2.5,
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
  origins: ['T9', 'T8', 'T6', 'T3'],
  /** Paid for shooting the raider down (or helping to), and taken when its bomb hits. */
  reward: 60,
  penalty: 20,
  /** The first two raids come alone; after that, a raid has this chance of a fighter escort. */
  escortAfter: 2,
  escortChance: 0.3,
  /** The bomber's target: how close (beyond the store's own size) the blast must come. */
  hitRadius: 2.5,
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
    bombing: 30,
    precision: 45,
    recon: 25,
    delivery: 25,
    return: 40,
    'multi-bomb': 50,
    rings: 30,
    practice: 35,
    suppression: 40,
    'danger-recon': 30,
    fortified: 45,
    'multi-stage': 45,
    survival: 35,
    'low-attack': 45,
    dogfight: 45,
    'scout-intercept': 40,
    'bomber-intercept': 50,
    escort: 45,
    patrol: 40,
    combined: 50,
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
  },
  /** Mission types built around defenses need targets with at least this threat level. */
  minThreat: { suppression: 1, 'danger-recon': 1, survival: 1, 'low-attack': 1, fortified: 2, 'multi-stage': 2, combined: 1 },
  /** Extra reward for each enemy aircraft a mission sends up, by its pilot's skill. */
  airBonus: { easy: 10, medium: 18, hard: 28 },
  /** Bomber interception: where the raider sets out from. Harder raids start further off, and with an escort on hard. */
  raidOrigins: { easy: ['T3', 'T7'], medium: ['T6', 'T8'], hard: ['T9'] } as Record<Difficulty, readonly string[]>,
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
  distanceReward: 0.15,
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
    recon: { range: 2, maneuverability: 1 },
    delivery: { speed: 3, range: 1 },
    return: { durability: 2, payload: 1, range: 1 },
    'multi-bomb': { payload: 3, range: 1 },
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
    escort: { firepower: 3, maneuverability: 2, durability: 1, range: 1 },
    patrol: { firepower: 2, maneuverability: 2, range: 1, speed: 1 },
    combined: { payload: 1, firepower: 1, durability: 1, maneuverability: 1 },
  },
  /**
   * Types that need a bit of everything are rated by the plane's weakest weighted rating (plus
   * one) instead of the average, so a specialist with one poor stat doesn't come out on top.
   */
  balanced: ['multi-stage', 'combined'],
  recommended: 4,
  good: 2.75,
} as const;

export const CAMERA = {
  distance: 10,
  /** Extra follow distance at full speed, and while boosting: the view pulls back as you speed up. */
  speedDistance: 4,
  boostDistance: 2,
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
  sky: [0.74, 0.86, 0.96],
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

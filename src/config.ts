/**
 * Every tuning number lives here so playtesting can adjust them in one place.
 * All values are provisional. Distances are world units (shown as "m" in the HUD), times are
 * seconds, angles are radians unless the name says otherwise.
 */

const DEG = Math.PI / 180;

export const ECONOMY = {
  startingPaper: 100,
  /** Home produces `incomeAmount` paper every `incomeInterval` seconds… */
  incomeAmount: 1,
  incomeInterval: 2,
  /** …while the player holds less than this. It is a safety net; missions are how you get rich. */
  incomeCap: 150,
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

export type Difficulty = 'easy' | 'medium' | 'hard';

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
  },
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
  },
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
} as const;

/**
 * Every tuning number lives here so playtesting can adjust them in one place.
 * All values are provisional. Distances are world units (shown as "m" in the HUD), times are
 * seconds, angles are radians unless the name says otherwise.
 */

const DEG = Math.PI / 180;

export const ECONOMY = {
  startingPaper: 100,
  /** Folding a brand-new plane. */
  planeCost: 20,
  /** Re-creasing and re-arming a plane that landed safely back home. */
  refitCost: 5,
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

export const PLANE = {
  minSpeed: 10,
  cruiseSpeed: 20,
  maxSpeed: 32,
  /** Throttle setting change per second while holding W or S. */
  throttleAccel: 14,
  /** How quickly the actual speed settles on the throttle setting (1/s). */
  speedResponse: 2,
  /** Speed lost per second in a vertical climb (and gained in a dive), scaled by sin(pitch). */
  pitchSpeedEffect: 9,
  /** Fastest the plane can yaw, reached at full bank. */
  maxTurnRate: 1.5,
  /** Fastest the plane can pitch towards the aim direction. */
  maxPitchRate: 1.2,
  /** How eagerly the plane chases the aim direction (1/s). Higher = snappier. */
  aimGain: 3,
  /** How quickly the wings roll into a bank (1/s). The plane turns by banking, so this is the turn inertia. */
  rollResponse: 6,
  /** How quickly the pitch rate follows the aim (1/s). */
  pitchResponse: 6,
  /** Steepest climb or dive. */
  maxPitch: 60 * DEG,
  /** How far the mouse aim may lead the plane's nose before it is held back. */
  maxAimLead: 50 * DEG,
  /** Aim rotation per pixel of mouse movement. */
  mouseSensitivity: 0.0022,
  /** Aim rotation per second while holding A or D (assisted banking). */
  keyTurnRate: 1.2,
  /** Bank angle at full turn rate. */
  maxBank: 55 * DEG,
  /** With the mouse left alone this long, the aim eases back to level flight… */
  autoLevelDelay: 1.5,
  /** …at this rate (1/s). Turned off on the landing approach so a steady descent holds. */
  autoLevelRate: 0.7,
  /** Radius of the collision sphere around the plane. */
  collisionRadius: 0.8,
  /** Height of the plane's centre above the platform while parked. */
  parkedHeight: 0.35,
  /** Nose-up angle held during the automatic climb-out after launch. */
  launchPitch: 20 * DEG,
  /** Length of the climb-out. The home platform cannot crash the plane during it. */
  launchGrace: 1.2,
  /** Seconds to fold a new plane from a flat sheet, and to refit a recovered one. */
  buildTime: 2,
  refitTime: 0.9,
} as const;

export const BOOST = {
  /** Extra speed on top of the throttle setting while boosting. */
  speed: 14,
  /** How quickly the speed responds while boosting (1/s). */
  response: 5,
  /** Longest single burst. Releasing Shift ends it early. */
  duration: 1.2,
  /** Recharge time after each burst. */
  cooldown: 3.5,
} as const;

export const LANDING = {
  /** Touching down on the home platform faster, steeper or more banked than this is a crash. */
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
  radius: 0.6,
  gravity: 22,
  /** Extra downward speed added on release so the ball visibly drops away from the plane. */
  releaseKick: 2,
  /** How far below the plane's centre the bombs hang while carried. */
  hangOffset: 0.55,
  /** Minimum time between two drops. */
  dropCooldown: 0.8,
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
  },
  /** Extra paper per metre between the launch pad and the objective. */
  distanceReward: 0.15,
  /** Bullseye radius for ordinary bombing targets, and for the small precision spot. */
  bullseyeRadius: { easy: 6, medium: 5, hard: 4 },
  precisionRadius: { easy: 3, medium: 2.4, hard: 1.8 },
  /** Bombs carried beyond one per target. */
  spareBombs: { easy: 1, medium: 1, hard: 0 },
  /** Height of the bullseye above the platform top. */
  targetHeight: 0.3,
  /** Reconnaissance: time to spend inside the target's airspace, below the ceiling. */
  reconTime: { easy: 3, medium: 4.5, hard: 6 },
  reconCeiling: { easy: 30, medium: 22, hard: 15 },
  /** Timed delivery: time limit = flight time at cruise × slack + extra. */
  deliverySlack: { easy: 2.2, medium: 1.6, hard: 1.3 },
  deliveryExtraTime: 4,
  deliveryCeiling: 35,
  /** Flight challenge: number and size of the paper rings, and the time limit on hard. */
  ringCount: { easy: 4, medium: 5, hard: 6 },
  ringRadius: { easy: 5, medium: 4.2, hard: 3.5 },
  ringMinHeight: 8,
  ringMaxHeight: 28,
  ringSlackHard: 1.6,
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
  planeAccent: [0.2, 0.45, 0.95],
  blueprint: [0.85, 0.95, 1],
} as const;

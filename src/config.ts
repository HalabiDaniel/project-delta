/**
 * Every tuning number for v0.0.1 lives here so playtesting can adjust them in one place.
 * All values are provisional. Distances are world units (shown as "m" in the HUD), times are
 * seconds, angles are radians unless the name says otherwise.
 */

const DEG = Math.PI / 180;

export const ECONOMY = {
  startingPaper: 100,
  planeCost: 20,
  missionReward: 50,
} as const;

export const WORLD = {
  /** Territories per side; the grid is gridSize × gridSize. */
  gridSize: 3,
  /** Edge length of one square territory. */
  territorySize: 40,
  /** Empty space between neighbouring territories. */
  gap: 15,
  /** Platform thickness. Platform tops sit at y = 0. */
  thickness: 1.2,
  homeId: 'T1',
  targetId: 'T5',
  /** Radius of the bullseye in the centre of the target territory. Only this counts as a hit. */
  targetRadius: 5,
  /** Height of the bullseye above the platform top. */
  targetHeight: 0.3,
  /** Anything that sinks below this height has fallen into the void. */
  voidY: -30,
  /** Soft altitude limit for the plane. */
  ceilingY: 70,
} as const;

export const PLANE = {
  minSpeed: 10,
  cruiseSpeed: 18,
  maxSpeed: 30,
  /** Speed change per second while holding W or S. */
  throttleAccel: 14,
  /** Fastest the plane can yaw towards the aim direction. */
  maxTurnRate: 1.5,
  /** Fastest the plane can pitch towards the aim direction. */
  maxPitchRate: 1.2,
  /** How eagerly the plane chases the aim direction (1/s). Higher = snappier. */
  aimGain: 3,
  /** Steepest climb or dive. */
  maxPitch: 60 * DEG,
  /** How far the mouse aim may lead the plane's nose before it is held back. */
  maxAimLead: 50 * DEG,
  /** Aim rotation per pixel of mouse movement. */
  mouseSensitivity: 0.0022,
  /** Aim rotation per second while holding A or D (assisted banking). */
  keyTurnRate: 1.2,
  /** Visual bank angle at full turn rate. */
  maxBank: 55 * DEG,
  /** Radius of the collision sphere around the plane. */
  collisionRadius: 0.8,
  /** Height of the plane's centre above the platform while parked. */
  parkedHeight: 0.35,
  /** Nose-up angle held during the automatic climb-out after launch. */
  launchPitch: 20 * DEG,
  /** Length of the climb-out. The home platform cannot crash the plane during it. */
  launchGrace: 1.2,
  /** Seconds the folding animation takes. */
  foldTime: 0.6,
} as const;

export const BOMB = {
  radius: 0.6,
  gravity: 22,
  /** Extra downward speed added on release so the ball visibly drops away from the plane. */
  releaseKick: 2,
  /** How far below the plane's centre the bomb hangs while carried. */
  hangOffset: 0.55,
} as const;

export const CAMERA = {
  distance: 10,
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
  baseFov: 62,
  /** Extra field of view at full speed, to sell the sense of speed. */
  speedFov: 10,
} as const;

/** Flat colours (sRGB 0–1). */
export const PALETTE = {
  sky: [0.74, 0.86, 0.96],
  home: [0.23, 0.48, 0.93],
  target: [0.98, 0.56, 0.16],
  neutral: [0.62, 0.64, 0.68],
  launchPad: [0.86, 0.92, 1],
  bullseyeRed: [0.86, 0.15, 0.15],
  bullseyeWhite: [0.98, 0.97, 0.94],
  paper: [0.97, 0.96, 0.92],
  paperBall: [0.95, 0.93, 0.86],
  planeAccent: [0.2, 0.45, 0.95],
} as const;

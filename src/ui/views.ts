import type { RatingKey, SuitabilityLevel } from '../aircraft/Aircraft';
import type { BoostState } from '../aircraft/Boost';
import type { TouchdownCheck } from '../aircraft/Landing';
import type { RaidReport } from '../base/Raids';
import type { AircraftId, BuildingKind, SlotKind, TerritoryState, ThreatLevel, Tier } from '../config';
import type { Medal, MissionFailure, MissionStatus, MissionType } from '../missions/Mission';
import type { BoundaryState } from '../systems/Boundary';
import type { BuildKind, GamePhase } from '../systems/GameState';
import type { IncomeState } from '../systems/HomeIncome';
import type { AirView } from './AirHud';
import type { ScreenPoint } from './dom';
import type { GarageView } from './Garage';
import type { IconName } from './icons';
import type { MiniMapView } from './MiniMap';
import type { ThreatView } from './ThreatHud';

/** Everything the HUD shows, built fresh by the game every frame. The HUD never reads game state itself. */

/** A value shown as an icon and a number, with its name for the tooltip. */
export interface Stat {
  icon: IconName;
  value: string;
  label: string;
  /** What changes (an upgrade's gain): "+5". */
  delta?: string;
  tone?: 'good' | 'bad' | 'warn';
}

export interface TargetIndicator extends ScreenPoint {
  onScreen: boolean;
  /** Direction to the target in screen space (radians), for the edge arrow. */
  angle: number;
  label: string;
  /** Distance, shown as a number. */
  distance: number;
  tone: 'target' | 'home' | 'ring';
  icon: IconName;
  /** Close enough that the marker should fade out of the way. */
  near: boolean;
}

export interface TerritoryLabel extends ScreenPoint {
  id: string;
  role: 'home' | 'objective' | 'neutral';
  state: TerritoryState;
}

/** A name, role and health bar floating over a practice target, a damaged prop or a defense. */
export interface TargetLabelView extends ScreenPoint {
  id: string;
  name: string;
  role: string;
  health: number;
  mission: boolean;
  /** 0 → 1 as it gets further away, for fading. */
  far: number;
  icon: IconName | null;
  state: 'idle' | 'tracking' | 'locking' | 'firing' | null;
  side: 'player' | 'enemy' | null;
}

export interface ThreatSummary {
  level: ThreatLevel;
  label: string;
  /** "T8: 2 ink turrets + 1 rocket launcher · radar" (tooltip). */
  detail: string;
  /** Kinds of defenses (and air threats) as icons. */
  icons: IconName[];
}

export interface OperationStageView {
  label: string;
  status: 'locked' | 'open' | 'done';
  optional: string;
  met: boolean | null;
  skipped: boolean;
}

export interface OperationView {
  codename: string;
  territoryId: string;
  stage: number;
  stages: OperationStageView[];
  bonus: number;
  earned: number;
  remaining: number;
  active: boolean;
  confirming: boolean;
}

export interface MissionCardView {
  type: MissionType;
  codename: string;
  title: string;
  description: string;
  slotLabel: string;
  slot: 'safe' | 'balanced' | 'risky' | 'event';
  tier: Tier;
  tierLabel: string;
  stars: number;
  multiplier: number;
  reward: number;
  rewardNote: string;
  modifiers: Array<{ id: string; label: string; detail: string }>;
  recommended: boolean;
  expires: number | null;
  operation: OperationView | null;
  bombs: number;
  timeLimit: number | null;
  threat: ThreatSummary;
  fits: Array<{ id: AircraftId; name: string; level: SuitabilityLevel; selected: boolean }>;
}

export interface ObjectiveView {
  label: string;
  icon: IconName;
  done: boolean;
  open: boolean;
  progress: number | null;
  distance: number | null;
}

export interface TrackerView {
  title: string;
  codename: string;
  operation: string | null;
  modifiers: string[];
  threat: ThreatSummary;
  type: MissionType;
  difficultyLabel: string;
  stars: number;
  multiplier: number;
  reward: number;
  status: MissionStatus;
  failure: MissionFailure | null;
  timeLeft: number | null;
  objectives: ObjectiveView[];
  /** The advice for the current step: a tooltip, and a first-time tip. */
  hint: string;
}

export interface FlightView {
  speed: number;
  speedFrac: number;
  throttleFrac: number;
  altitude: number;
  boost: { state: BoostState; level: number };
  autopilot: boolean;
}

export interface AircraftStatusView {
  name: string;
  roleLabel: string;
  accent: string;
  health: number;
  maxHealth: number;
  rangeLeft: number;
  range: number;
  gun: { label: string; ammo: number; capacity: number; ready: boolean };
  bombs: { label: string; loaded: number; capacity: number; falling: number; cooldown: number; ready: boolean };
  airborne: boolean;
}

export interface GroundView {
  stopped: boolean;
  rearming: number | null;
  canRearm: boolean;
  status: MissionStatus | null;
  reward: number;
  timeLeft: number | null;
}

export interface LandingView {
  speed: number;
  sink: number;
  rollDeg: number;
  check: TouchdownCheck;
}

export interface ResultView {
  recovered: boolean;
  headline: string;
  aircraftName: string;
  missionTitle: string;
  missionLine: string;
  missionTone: 'good' | 'bad';
  planeLine: string;
  time: number;
  damageDealt: number;
  damageTaken: number;
  targetsDestroyed: number;
  bombsDropped: number;
  bombHits: number;
  shotsFired: number;
  shotsHit: number;
  defensesDestroyed: number;
  enemyShots: number;
  enemyHits: number;
  aircraftDestroyed: number;
  bombersIntercepted: number;
  objectivesProtected: number;
  paperLost: number;
  paperOverflow: number;
  survival: string;
  survived: boolean;
  health: number;
  paperSpent: number;
  paperEarned: number;
  medal: Medal | null;
  criteria: Record<Medal, string> | null;
  bonuses: Array<{ label: string; amount: number }>;
  records: string[];
  achievements: Array<{ title: string; detail: string }>;
  streak: number;
  operation: string | null;
}

export interface SessionView {
  missionsCompleted: number;
  missionsFailed: number;
  paperEarned: number;
  paperSpent: number;
  aircraftLost: number;
  enemiesDestroyed: number;
  best: string;
  achievements: string[];
  minutes: number;
}

export interface WelcomeView {
  restored: boolean;
  paper: number;
  session: SessionView | null;
  problems: number;
}

export type HintMode = 'auto' | 'on' | 'off';

export interface SettingsView {
  muted: boolean;
  hints: HintMode;
  uiScale: number;
}

export interface MenuView {
  session: SessionView;
  settings: SettingsView;
  saveNote: string;
  confirmingReset: boolean;
}

/** Paper, production and storage: the economy strip, top left. */
export interface EconomyView {
  paper: number;
  capacity: number;
  /** Paper per minute right now. */
  rate: number;
  state: IncomeState;
  /** 0 → 1 towards the next paper. */
  progress: number;
  protectedPaper: number;
  streak: number;
  /** Structures on T1 that need repairs. */
  repairs: number;
}

/** The desk's main action: fold, refit or roll out the chosen plane, then launch. */
export interface DeskActionView {
  cost: number;
  kind: BuildKind;
  name: string;
  canBuild: boolean;
  /** Why it can't (a tooltip, and a short tag). */
  note: string | null;
  tag: string | null;
  noteTone: 'bad' | 'info';
  progress: number;
  emergency: boolean;
}

// ---- Base management ----------------------------------------------------------------------------

export type StructureState = 'ok' | 'damaged' | 'destroyed';

/** A construction slot on T1, marked on screen in base mode. */
export interface SlotMarkerView extends ScreenPoint {
  id: string;
  onScreen: boolean;
  kind: SlotKind;
  /** What stands there; the paper store has a marker of its own. */
  building: BuildingKind | 'store' | null;
  level: number;
  status: StructureState | null;
  health: number;
  /** With a building chosen in the tray: can it go here? null when nothing is chosen. */
  fits: boolean | null;
  selected: boolean;
}

export interface TrayItemView {
  kind: BuildingKind;
  name: string;
  short: string;
  purpose: string;
  cost: number;
  /** Paper still needed (0 when affordable). */
  missing: number;
  /** A free slot takes it (and it isn't a second radar). */
  placeable: boolean;
  chosen: boolean;
  /** What one gives, as stats. */
  effects: Stat[];
}

export interface PriceView {
  cost: number;
  missing: number;
}

export type BaseInspectorView =
  | {
      type: 'empty';
      slot: string;
      slotKind: SlotKind;
      /** The building chosen to go here, if any, with what it would cost and do. */
      chosen: { kind: BuildingKind; name: string; price: PriceView; effects: Stat[]; fits: boolean } | null;
      /** What this slot takes. */
      takes: BuildingKind[];
    }
  | {
      type: 'building';
      slot: string;
      kind: BuildingKind | 'store';
      name: string;
      level: number;
      maxLevel: number;
      health: number;
      maxHealth: number;
      status: StructureState;
      stats: Stat[];
      upgrade: (PriceView & { next: Stat[] }) | null;
      repair: PriceView | null;
      refund: number | null;
      confirmingRemove: boolean;
    };

export interface BaseView {
  slots: SlotMarkerView[];
  selected: string | null;
  tray: TrayItemView[];
  inspector: BaseInspectorView | null;
  overview: {
    ready: number;
    total: number;
    radar: 'none' | 'on' | 'off';
    detection: number;
    integrity: number;
  };
  repairAll: PriceView & { count: number };
  /** The plane can take off (landed) or a sortie can start (desk). */
  canFly: boolean;
  lastRaid: RaidReport | null;
}

// ---- Raids ----------------------------------------------------------------------------------------

export interface RaidAlertView {
  state: 'inbound' | 'released';
  /** Compass direction it comes from, as seen from T1 on the map. */
  direction: string;
  eta: number;
  target: string;
  targetIcon: IconName;
  ready: number;
  total: number;
  escorted: boolean;
  distance: number | null;
  reward: number;
  mission: boolean;
  /** Suggested response: key and word. */
  response: { key: string; label: string } | null;
}

export interface HudView {
  phase: GamePhase;
  paused: boolean;
  /** Base management is open. */
  baseMode: boolean;
  economy: EconomyView;
  /** Key hints show (the first sorties, while H is held, or by setting). */
  hints: boolean;
  desk: DeskActionView;
  swaps: number;
  welcome: WelcomeView | null;
  menu: MenuView;
  garage: GarageView | null;
  cards: MissionCardView[] | null;
  selected: number;
  tracker: TrackerView | null;
  flight: FlightView | null;
  aircraft: AircraftStatusView | null;
  ground: GroundView | null;
  landing: LandingView | null;
  boundary: { state: BoundaryState; countdown: number };
  result: ResultView | null;
  pointerLocked: boolean;
  nose: ScreenPoint | null;
  aim: ScreenPoint | null;
  target: TargetIndicator | null;
  labels: TerritoryLabel[];
  targets: TargetLabelView[];
  minimap: MiniMapView;
  threat: ThreatView | null;
  air: AirView | null;
  raid: RaidAlertView | null;
  base: BaseView | null;
}

export interface HudActions {
  build(): void;
  launch(): void;
  select(index: number): void;
  selectAircraft(id: AircraftId): void;
  rearm(): void;
  takeOff(): void;
  endSortie(): void;
  continueToDesk(): void;
  resume(): void;
  swap(): void;
  abandonOperation(): void;
  openLogbook(): void;
  openMenu(): void;
  resetProgress(): void;
  dismissWelcome(): void;
  toggleSound(): void;
  setHints(mode: HintMode): void;
  setUiScale(scale: number): void;
  toggleBase(): void;
  base: {
    selectSlot(id: string): void;
    choose(kind: BuildingKind): void;
    build(): void;
    upgrade(): void;
    repair(): void;
    repairAll(): void;
    remove(): void;
  };
}

export type { RatingKey };

import type { SlotKind, TerritoryState } from '../config';
import type { MissionType } from '../missions/Mission';
import type { IconName } from './icons';

/**
 * Every short label the HUD uses, in one place, so wording stays consistent and short. New UI
 * picks from here instead of inventing its own phrasing: one to three words, no sentences.
 */
export const SAY = {
  launch: 'Launch',
  takeOff: 'Take off',
  rearm: 'Rearm',
  rearming: 'Rearming',
  armed: 'Full',
  endSortie: 'End sortie',
  continue: 'Continue',
  repair: 'Repair',
  repairAll: 'Repair all',
  upgrade: 'Upgrade',
  build: 'Build',
  remove: 'Remove',
  confirmRemove: 'Confirm',
  base: 'Base',
  done: 'Done',
  fly: 'Fly',
  swap: 'Swap',
  logbook: 'Logbook',
  menu: 'Menu',
  resume: 'Resume',
  reset: 'Reset',
  confirmReset: 'Confirm reset',
  details: 'Details',
  raidInbound: 'Raid inbound',
  raidRepelled: 'Raid repelled',
  baseHit: 'Base hit',
  offline: 'Offline',
  destroyed: 'Destroyed',
  damaged: 'Damaged',
  ready: 'Ready',
  free: 'Free',
  full: 'Full',
  storageFull: 'Storage full',
  maxLevel: 'Max',
  empty: 'Empty',
  gliding: 'Gliding',
  bombsAway: 'Bomb away',
  cancel: 'Cancel',
  keepFlying: 'Keep it',
  leave: 'Leave',
  abandon: 'Abandon',
  lowHealth: 'Low health',
  settings: 'Settings',
  close: 'Close',
  need: 'Need',
  all: 'All',
  earned: 'Earned',
  locked: 'Locked',
  paperIn: 'In',
  paperOut: 'Out',
  condition: 'Condition',
  instruments: 'Instruments',
  weapons: 'Weapons',
  objective: 'Objective',
  alerts: 'Alerts',
  resources: 'Resources',
  missions: 'Missions',
  aircraft: 'Aircraft',
  buildTray: 'Build tray',
  slot: 'Slot',
  report: 'Sortie report',
  defenseReport: 'Defense report',
  tutorial: 'Tutorial',
  paused: 'Paused',
  welcome: 'Welcome',
  ratings: 'Ratings',
  loadout: 'Loadout',
  filter: 'Filter',
  rocketLock: 'Rocket lock',
} as const;

/**
 * The confirm dialogs for destructive actions (docs/DESIGN_SYSTEM.md §2C): a question, one line on
 * what happens, and the two buttons. Shown by src/ui/confirm.ts.
 */
export const CONFIRM_TEXT = {
  remove: { title: 'Remove building?', body: 'It comes down for a partial refund of its paper.', confirm: 'Remove', cancel: 'Keep it' },
  endSortie: { title: 'End sortie?', body: 'The plane goes into the hangar and the report comes up.', confirm: 'End sortie', cancel: 'Stay' },
  endSortieActive: { title: 'End sortie?', body: 'The mission is still on: ending the sortie now abandons it.', confirm: 'End sortie', cancel: 'Stay' },
  leave: { title: 'Leave classroom?', body: 'You leave this classroom for good and your desk is freed.', confirm: 'Leave', cancel: 'Stay' },
  reset: { title: 'Reset all progress?', body: 'Everything saved in this browser is deleted and the game starts over.', confirm: 'Reset', cancel: 'Keep it' },
  abandon: { title: 'Abandon operation?', body: 'You keep what it has paid so far; the bonus is lost.', confirm: 'Abandon', cancel: 'Keep going' },
} as const;

/**
 * First-time tips that name controls. "{action}" becomes the binding's glyph for the device in use
 * (src/ui/Alerts.ts `withKeys`), so the words never name a key.
 */
export const TIP_TEXT = {
  base: 'Click a slot, pick a building, build. Damage stays until you repair.',
  unsuitable: (detail: string) => `${detail}. Switch plane with {prevAircraft} / {nextAircraft}, or pick another card.`,
  flight: (steer: string) => `${steer} steers. Hold {firePrimary} for ink, {fireSecondary} drops a bomb, {boost} boosts.`,
  desk: 'Pick a card, pick a plane, fold it ({fold}), launch ({launch}). {base} opens your base.',
  mpDesk: 'Pick a card, pick a plane ({prevAircraft} / {nextAircraft}), fold it ({fold}), launch ({launch}). {scoreboard} shows the scoreboard; {emote1} {emote2} {emote3} are emotes.',
} as const;

/**
 * The accessibility settings in the pause menu (src/ui/access.ts): a name, a tooltip and the
 * choices of each segmented control.
 */
export const ACCESS_TEXT = {
  section: 'Accessibility',
  theme: { label: 'Theme', tip: 'Daylight is notebook paper on a desk; Lights out is a chalkboard for late nights', daylight: 'Daylight', lightsOut: 'Lights out' },
  palette: { label: 'Colours', tip: 'Colour palette: the colour-blind palette is safe for protanopia, deuteranopia and tritanopia', standard: 'Standard', colourblind: 'Colour-blind' },
  text: { label: 'Text', tip: 'Text size, independent of the HUD size' },
  contrast: { label: 'Panels', tip: 'Solid, higher-contrast panels', normal: 'Normal', high: 'High contrast' },
  motion: { label: 'Motion', tip: 'Reduced motion: no fold-in, pop, slide or flash. Auto follows your system setting', auto: 'Auto', full: 'Full', reduced: 'Reduced' },
  captions: { label: 'Captions', tip: 'Sound captions: a caption and an arrow for important sounds. Auto shows them while the sound is off', auto: 'Auto', on: 'On', off: 'Off' },
  safeArea: { label: '16:9 HUD', tip: 'Ultrawide screens: keep the HUD in a 16:9 area in the middle', on: 'On', off: 'Off' },
} as const;

/** Sound captions (src/ui/Captions.ts): what each important sound means, in a few words. */
export const CAPTION_TEXT = {
  spotted: 'Spotted',
  lock: 'Rocket lock',
  launch: 'Rocket launch',
  hit: 'Hit',
  bandit: 'Bandit',
  raid: 'Raid incoming',
} as const;

/** Where a captioned sound came from, for screen readers (the arrow shows it). */
export const DIRECTION_TEXT = { ahead: 'ahead', right: 'to the right', behind: 'behind', left: 'to the left' } as const;

/** The mini-map's frame (the style guide's Minimap): the compass, zoom and the accessible name. */
export const MAP_TEXT = { label: 'Mini-map of the classroom', north: 'N', zoomIn: 'Zoom in', zoomOut: 'Zoom out' } as const;

/** Labels added with the developer's style guide (2026-11-06), in its voice: short, classroom words, sentence case. */
export const STYLE_TEXT = {
  gotIt: 'Got it',
  raidTitle: 'Raid on your desk!',
  bombsAway: 'Bombs away!',
  missionDone: 'Mission done',
  homeSafe: 'Home safe',
  crumpled: 'Crumpled',
  /** The mission card's risk line, naming the plane. */
  risk: (plane: string) => `Crash and you lose your ${plane}`,
  hull: 'Hull',
  range: 'Range',
  ink: 'Ink',
  bombs: 'Bombs',
  game: 'Game',
  quickNote: 'Changes save as you go.',
} as const;

/** Sound captions, as a group (the region's accessible name). */
export const CAPTIONS_LABEL = 'Sound captions';

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  bombing: 'Bombing',
  precision: 'Precision bombing',
  recon: 'Reconnaissance',
  delivery: 'Timed delivery',
  return: 'Strike & return',
  'multi-bomb': 'Multi-target',
  rings: 'Flight challenge',
  practice: 'Target practice',
  suppression: 'Suppression',
  'danger-recon': 'Dangerous recon',
  fortified: 'Fortified bombing',
  'multi-stage': 'Multi-stage strike',
  survival: 'Survival challenge',
  'low-attack': 'Low-altitude attack',
  dogfight: 'Dogfight',
  'scout-intercept': 'Scout interception',
  'bomber-intercept': 'Bomber interception',
  escort: 'Bomber escort',
  patrol: 'Airspace patrol',
  combined: 'Combined attack',
  shipment: 'High-value target',
  convoy: 'Convoy interception',
  'supply-run': 'Supply run escort',
};

/** One icon per mission type, for cards and the objective strip. */
export const MISSION_ICONS: Record<MissionType, IconName> = {
  bombing: 'bomb',
  precision: 'bomb',
  recon: 'recon',
  delivery: 'reach',
  return: 'land',
  'multi-bomb': 'bomb',
  rings: 'ring',
  practice: 'practice',
  suppression: 'turret',
  'danger-recon': 'recon',
  fortified: 'supply',
  'multi-stage': 'radar',
  survival: 'survive',
  'low-attack': 'bomb',
  dogfight: 'fighter',
  'scout-intercept': 'scout',
  'bomber-intercept': 'bomber',
  escort: 'escort',
  patrol: 'patrol',
  combined: 'fighter',
  shipment: 'supply',
  convoy: 'bomber',
  'supply-run': 'escort',
};

export const SLOT_KIND_ICONS: Record<SlotKind, IconName> = { defense: 'shield', radar: 'radar', economy: 'paper', utility: 'slot' };
export const SLOT_KIND_LABELS: Record<SlotKind, string> = { defense: 'Defense slot', radar: 'Radar slot', economy: 'Economy slot', utility: 'Utility slot' };

export const STATE_LABELS: Record<TerritoryState, string> = { peaceful: '', alert: 'On alert', 'under-attack': 'Under attack', disabled: 'Defenses down' };

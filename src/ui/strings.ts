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
} as const;

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

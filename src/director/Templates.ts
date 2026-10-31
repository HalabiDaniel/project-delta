import type { MissionType } from '../missions/Mission';

/** What kind of activity a mission is. The director varies these, so the cards don't all feel alike. */
export type Category = 'bombing' | 'recon' | 'flight' | 'dogfight' | 'interception' | 'escort' | 'assault';

export const CATEGORY_LABELS: Record<Category, string> = {
  bombing: 'Bombing',
  recon: 'Reconnaissance',
  flight: 'Flight & delivery',
  dogfight: 'Dogfighting',
  interception: 'Interception',
  escort: 'Escort',
  assault: 'Assault on defenses',
};

/**
 * Every mission type is a template: the generator fills in its parameters (target, threat level,
 * objectives, enemy aircraft, time limit, reward) from the world. `weight` is how often the
 * director reaches for it before variety and the player's situation have their say.
 */
export const TEMPLATES: Record<MissionType, { category: Category; weight: number }> = {
  bombing: { category: 'bombing', weight: 1 },
  precision: { category: 'bombing', weight: 0.8 },
  return: { category: 'bombing', weight: 0.8 },
  'multi-bomb': { category: 'bombing', weight: 0.7 },
  fortified: { category: 'bombing', weight: 0.8 },
  'low-attack': { category: 'bombing', weight: 0.7 },
  combined: { category: 'bombing', weight: 0.7 },
  recon: { category: 'recon', weight: 1 },
  'danger-recon': { category: 'recon', weight: 0.9 },
  delivery: { category: 'flight', weight: 0.8 },
  rings: { category: 'flight', weight: 0.8 },
  dogfight: { category: 'dogfight', weight: 1 },
  practice: { category: 'dogfight', weight: 0.8 },
  'scout-intercept': { category: 'interception', weight: 0.9 },
  'bomber-intercept': { category: 'interception', weight: 0.8 },
  patrol: { category: 'interception', weight: 0.8 },
  escort: { category: 'escort', weight: 0.9 },
  suppression: { category: 'assault', weight: 1 },
  'multi-stage': { category: 'assault', weight: 0.7 },
  survival: { category: 'assault', weight: 0.7 },
  shipment: { category: 'bombing', weight: 0 },
  convoy: { category: 'interception', weight: 0 },
  'supply-run': { category: 'escort', weight: 0 },
};

export function categoryOf(type: MissionType): Category {
  return TEMPLATES[type].category;
}

/**
 * Cheap, low-risk work for a player who has lost planes or run out of paper: reconnaissance of
 * an undefended territory, a basic flight challenge, a delivery, or one weak practice target.
 */
export const RECOVERY_TYPES: readonly MissionType[] = ['recon', 'rings', 'delivery', 'practice'];

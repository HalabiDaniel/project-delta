import type { RatingKey, SuitabilityLevel } from '../aircraft/Aircraft';
import type { AircraftId } from '../config';
import type { BuildKind } from '../systems/GameState';
import type { IconName } from './icons';
import type { Stat } from './views';

/** The garage's view (the Hangar drawer, src/ui/hud/DeskHud.ts, draws it since v0.0.16). */
export interface GarageCardView {
  id: AircraftId;
  name: string;
  roleLabel: string;
  accent: string;
  cost: number;
  buildCost: number;
  buildKind: BuildKind;
  hangar: 'ready' | 'recovered' | null;
  hangarHealth: number | null;
  suitability: SuitabilityLevel;
  selected: boolean;
  affordable: boolean;
}

export interface InspectorView {
  name: string;
  roleLabel: string;
  accent: string;
  tagline: string;
  ratings: Array<{ key: RatingKey; label: string; value: number }>;
  loadout: Stat[];
  /** The player's record with this design, for the tooltip. */
  record: string | null;
  suitability: { level: SuitabilityLevel; reason: string; missionTitle: string };
}

export interface GarageView {
  cards: GarageCardView[];
  inspector: InspectorView;
  locked: boolean;
}

/** Mission fit as an icon (and a shape: tick, warning triangle, cross), never colour alone. */
export const FIT_ICONS: Record<SuitabilityLevel, IconName> = { recommended: 'ok', good: 'ok', possible: 'warn', unsuitable: 'wrecked' };

import type { DeskState } from '../net/protocol';
import type { IconName } from '../ui/icons';
import type { Tone } from '../ui/components';

/**
 * Where another player is (plan v0.0.15 §5A, presence), worked out from what the server already
 * sends (PlayerState.connected / protect / shield, TerritoryState.state / safe):
 *
 *   online    – connected and playing.
 *   away      – dropped: the server keeps their plane and desk for the reconnect grace.
 *   offline   – gone: their desk is draining (a raid on it is being settled) or bare.
 *   protected – online, and nobody can raid their base now (new-player protection or the shield
 *               after a raid).
 *
 * Every state has a word, an icon and a tone, so it never shows by colour alone.
 */
export type Presence = 'online' | 'away' | 'offline' | 'protected';

export const PRESENCES: readonly Presence[] = ['online', 'away', 'offline', 'protected'];

export interface PresenceInput {
  /** Still in the session's player list. */
  present: boolean;
  connected: boolean;
  /** Seconds of new-player protection and of the raid shield left. */
  protect: number;
  shield: number;
  /** The desk's lifecycle state, when the player has one. */
  desk?: DeskState | null;
}

export function presenceOf(p: PresenceInput): Presence {
  if (!p.present) return 'offline';
  if (!p.connected) return p.desk === 'empty' || p.desk === 'open' ? 'offline' : 'away';
  if (p.protect > 0 || p.shield > 0) return 'protected';
  return 'online';
}

export const PRESENCE_LABELS: Readonly<Record<Presence, string>> = { online: 'Online', away: 'Away', offline: 'Offline', protected: 'Protected' };
export const PRESENCE_ICONS: Readonly<Record<Presence, IconName>> = { online: 'ok', away: 'clock', offline: 'offline', protected: 'shield' };
export const PRESENCE_TONES: Readonly<Record<Presence, Tone>> = { online: 'good', away: 'warn', offline: 'plain', protected: 'friend' };
export const PRESENCE_TIPS: Readonly<Record<Presence, string>> = {
  online: 'Connected and playing',
  away: 'Dropped: their plane and desk are kept for a minute',
  offline: 'Left the session',
  protected: 'Nobody can raid their base yet',
};

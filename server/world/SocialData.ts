/**
 * v0.0.19: what a player carries between sessions for the advanced multiplayer systems, besides
 * their base, planes and progress: their threat (how aggressive they have been lately, decaying),
 * the players whose emotes and markings they muted, and their reputation counts. Saved with their
 * progress (`progress.social`), checked field by field whenever it is read back.
 *
 * Rivalries between two players are not here: they are the pvp_records between them (raids, kills,
 * assists, defenses, cooperation), read back when the player joins (Rivalry.ts).
 */
export interface SocialData {
  /** Threat as it stood at `threatAt` (a clock time, ms); it decays from there (Situation.ts). */
  threat: number;
  threatAt: number;
  /** Clock times (ms) of recent kills on weaker players, for the "ace" bounty's streak. */
  weakKills: number[];
  /** Public ids of players whose emotes and ink markings this player doesn't want to see. */
  mutes: string[];
  /** Lifetime counts behind the reputation summary (raider, defender, ace, helper). */
  reputation: { raids: number; defends: number; kills: number; helps: number };
}

export const MAX_MUTES = 64;

export function emptySocial(): SocialData {
  return { threat: 0, threatAt: 0, weakKills: [], mutes: [], reputation: { raids: 0, defends: 0, kills: 0, helps: 0 } };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e7, Math.round(v)) : 0);

/** A saved SocialData, checked: anything broken is dropped rather than trusted. */
export function cleanSocial(raw: unknown): SocialData {
  const out = emptySocial();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.threat === 'number' && Number.isFinite(r.threat) && r.threat >= 0) out.threat = Math.min(1000, r.threat);
  if (typeof r.threatAt === 'number' && Number.isFinite(r.threatAt) && r.threatAt >= 0) out.threatAt = r.threatAt;
  if (Array.isArray(r.weakKills)) out.weakKills = r.weakKills.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0).slice(-32);
  if (Array.isArray(r.mutes)) out.mutes = [...new Set(r.mutes.filter((m): m is string => typeof m === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m)))].slice(0, MAX_MUTES);
  const rep = r.reputation && typeof r.reputation === 'object' ? (r.reputation as Record<string, unknown>) : {};
  out.reputation = { raids: count(rep.raids), defends: count(rep.defends), kills: count(rep.kills), helps: count(rep.helps) };
  return out;
}

import { SOCIAL, type MischiefKind } from '../../src/config';
import type { ReportReason } from '../../src/net/protocol';

/** An ink mark that fades: on a plane (by its pilot) or on a desk's banner (by territory). */
export interface InkMark {
  /** World time it is gone. */
  until: number;
  /** Who threw it (public id): players who muted them don't see it. */
  by: string;
}

/** A report waiting to be written to the store (the room knows the account ids). */
export interface PendingReport {
  reporter: string;
  reported: string;
  reason: ReportReason;
  context: Record<string, unknown>;
}

/**
 * Why a mischief card can't be offered:
 * pair    – you teased this player within SOCIAL.mischief.perPair.
 * target  – they have been teased SOCIAL.mischief.perTarget times lately (by anyone).
 */
export type MischiefRefusal = 'pair' | 'target';

/**
 * The playful side of a session (plan v0.0.19 §6): ink marks on planes and banners, the mischief
 * limits, and reports on their way to the store. Mutes live with the player (SocialData.mutes), so
 * they last for good. Nothing here can destroy or take anything: mischief only marks and teases.
 */
export class SocialBook {
  readonly planeInk = new Map<string, InkMark>();
  readonly bannerInk = new Map<string, InkMark>();
  private readonly mischiefs: Array<{ by: string; target: string; at: number }> = [];
  private readonly reportsBy = new Map<string, string[]>();
  private readonly pending: PendingReport[] = [];

  markPlane(pilot: string, by: string, now: number): void {
    this.planeInk.set(pilot, { until: now + SOCIAL.inkFade, by });
  }

  markBanner(territory: string, by: string, now: number): void {
    this.bannerInk.set(territory, { until: now + SOCIAL.bannerInk, by });
  }

  /** Seconds of ink left on a plane or banner, and who threw it (none: null). */
  static left(mark: InkMark | undefined, now: number): { seconds: number; by: string } | null {
    if (!mark || mark.until <= now) return null;
    return { seconds: Math.ceil(mark.until - now), by: mark.by };
  }

  /** Faded marks go. */
  fade(now: number): void {
    for (const [k, m] of this.planeInk) if (m.until <= now) this.planeInk.delete(k);
    for (const [k, m] of this.bannerInk) if (m.until <= now) this.bannerInk.delete(k);
  }

  mischiefRefusal(by: string, target: string, now: number): MischiefRefusal | null {
    const m = SOCIAL.mischief;
    if (this.mischiefs.some((x) => x.by === by && x.target === target && now - x.at < m.perPair)) return 'pair';
    if (this.mischiefs.filter((x) => x.target === target && now - x.at < m.targetWindow).length >= m.perTarget) return 'target';
    return null;
  }

  /** A mischief card was flown at `target` (launched: the limits count from here, done or not). */
  mischief(by: string, target: string, now: number): void {
    this.mischiefs.push({ by, target, at: now });
    while (this.mischiefs.length > 0 && now - this.mischiefs[0].at > Math.max(SOCIAL.mischief.perPair, SOCIAL.mischief.targetWindow)) this.mischiefs.shift();
  }

  /** Why `reporter` can't report `reported` now (once per player, SOCIAL.reportsPerSession in all), or null. */
  reportRefusal(reporter: string, reported: string): 'self' | 'again' | 'many' | null {
    if (reporter === reported) return 'self';
    const done = this.reportsBy.get(reporter) ?? [];
    if (done.filter((r) => r === reported).length >= SOCIAL.reportsPerTarget) return 'again';
    if (done.length >= SOCIAL.reportsPerSession) return 'many';
    return null;
  }

  report(r: PendingReport): boolean {
    if (this.reportRefusal(r.reporter, r.reported)) return false;
    this.reportsBy.set(r.reporter, [...(this.reportsBy.get(r.reporter) ?? []), r.reported]);
    this.pending.push(r);
    return true;
  }

  /** Players `id` reported this session. */
  reported(id: string): string[] {
    return [...new Set(this.reportsBy.get(id) ?? [])];
  }

  /** Reports since the last call, for the store. */
  takeReports(): PendingReport[] {
    return this.pending.splice(0);
  }
}

/** v0.0.19: the mischief kinds, round and round. */
export const MISCHIEF_ORDER: readonly MischiefKind[] = ['banner', 'flyby', 'stunt'];

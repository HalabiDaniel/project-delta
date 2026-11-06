import type { MissionFailure } from '../missions/Mission';
import { controlLabel } from './controlLabels';
import { T } from './strings';
import { paper } from './format';

/**
 * The words of the sortie report, shared by single-player and multiplayer: why a mission failed
 * and what to try next, where the paper came from and went, and the one thing to do now.
 */

export interface FailureText {
  /** The headline: "Out of bombs". */
  title: string;
  /** What happened, in a sentence. */
  why: string;
  /** What to try next time. */
  advice: string;
}

const FAILURES: Readonly<Record<MissionFailure, FailureText>> = T.failure;

export function failureText(failure: MissionFailure | null): FailureText {
  return FAILURES[failure ?? 'abandoned'];
}

/** One line of the paper breakdown on the report. */
export interface PaperLine {
  label: string;
  amount: number;
}

export interface PaperBreakdownInput {
  /** The mission's own reward, when it succeeded. */
  reward: number;
  missionTitle: string;
  bonuses: ReadonlyArray<{ label: string; amount: number }>;
  /** Everything the sortie earned (reward, bonuses and anything else, such as bounties). */
  earned: number;
  /** Paid for the plane (fold or refit) and anything else during the sortie. */
  spent: number;
  /** Taken by raids on the base while away. */
  lost: number;
  /** Earnings that didn't fit in storage. */
  overflow: number;
}

/** Where the paper came from and where it went: the report's ledger, positive first. */
export function paperBreakdown(p: PaperBreakdownInput): PaperLine[] {
  const lines: PaperLine[] = [];
  if (p.reward > 0) lines.push({ label: T.report.missionReward(p.missionTitle), amount: p.reward });
  let bonusTotal = 0;
  for (const b of p.bonuses) {
    if (b.amount === 0) continue;
    lines.push({ label: b.label, amount: b.amount });
    bonusTotal += b.amount;
  }
  const other = p.earned - p.reward - bonusTotal;
  if (other > 0) lines.push({ label: T.report.otherEarnings, amount: other });
  if (p.spent > 0) lines.push({ label: T.report.planeCost, amount: -p.spent });
  if (p.lost > 0) lines.push({ label: T.report.lostToRaids, amount: -p.lost });
  if (p.overflow > 0) lines.push({ label: T.report.lostStorageFull, amount: -p.overflow });
  return lines;
}

/** The report's suggestion for what to do next. */
export function nextStepText(o: { succeeded: boolean; recovered: boolean; aircraftName: string; refitCost: number; cost: number; repairs: number }): string {
  const parts: string[] = [];
  if (o.recovered) parts.push(T.report.inHangar(o.aircraftName, paper(o.refitCost)));
  else parts.push(T.report.quickRebuild(controlLabel('quickRebuild'), o.aircraftName, paper(o.cost)));
  if (o.repairs > 0) parts.push(T.report.repairs(o.repairs));
  return parts.join(' ');
}

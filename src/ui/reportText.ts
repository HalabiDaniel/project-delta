import type { MissionFailure } from '../missions/Mission';
import { controlLabel } from './controlLabels';

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

const FAILURES: Record<MissionFailure, FailureText> = {
  missed: {
    title: 'Out of bombs',
    why: 'Every bomb was dropped with a target still standing.',
    advice: 'A bomb keeps the plane\'s speed: release a little before you are over the target, low and level. Easy cards carry spares.',
  },
  'out-of-time': {
    title: 'Out of time',
    why: 'The clock ran out before the last objective was done.',
    advice: 'Pick a faster plane (the badges on the card say which fit), boost on the way out and fly straight to the marker.',
  },
  'aircraft-lost': {
    title: 'Plane lost',
    why: 'The plane went down before the job was done.',
    advice: 'Watch the threat ring: keep turning when something locks on, stay out of the turrets\' reach, and boost away from fighters.',
  },
  abandoned: {
    title: 'Landed before finishing',
    why: 'The sortie ended at home with objectives still open.',
    advice: 'Rearm and take off again instead of ending the sortie, or pick a card that suits the plane.',
  },
  'target-escaped': {
    title: 'It got away',
    why: 'The aircraft you had to stop left the map.',
    advice: 'Intercept early: fly towards where it is going, not where it is, and use the red lead circle to aim.',
  },
  'target-bombed': {
    title: 'The bomb was released',
    why: 'The bomber reached its target and released before you brought it down.',
    advice: 'Launch as soon as the raid alert comes up; a radar on your desk warns you earlier.',
  },
  'escort-lost': {
    title: 'Your bomber was lost',
    why: 'The bomber you were escorting was shot down.',
    advice: 'Stay close to it and go after the fighters that turn towards it first.',
  },
};

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
  if (p.reward > 0) lines.push({ label: `Mission reward · ${p.missionTitle}`, amount: p.reward });
  let bonusTotal = 0;
  for (const b of p.bonuses) {
    if (b.amount === 0) continue;
    lines.push({ label: b.label, amount: b.amount });
    bonusTotal += b.amount;
  }
  const other = p.earned - p.reward - bonusTotal;
  if (other > 0) lines.push({ label: 'Other earnings (bounties, deliveries)', amount: other });
  if (p.spent > 0) lines.push({ label: 'Plane: fold or refit', amount: -p.spent });
  if (p.lost > 0) lines.push({ label: 'Lost to raids', amount: -p.lost });
  if (p.overflow > 0) lines.push({ label: 'Lost: storage full', amount: -p.overflow });
  return lines;
}

/** The report's suggestion for what to do next. */
export function nextStepText(o: { succeeded: boolean; recovered: boolean; aircraftName: string; refitCost: number; cost: number; repairs: number }): string {
  const parts: string[] = [];
  if (o.recovered) parts.push(`${o.aircraftName} is in the hangar: a refit costs ${o.refitCost}.`);
  else parts.push(`Quick rebuild: ${controlLabel('quickRebuild')} at the desk folds a new ${o.aircraftName} for ${o.cost}.`);
  if (o.repairs > 0) parts.push(`${o.repairs} building${o.repairs === 1 ? '' : 's'} at home need${o.repairs === 1 ? 's' : ''} repairs.`);
  return parts.join(' ');
}

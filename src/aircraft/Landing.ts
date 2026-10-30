import { LANDING } from '../config';

export interface TouchdownState {
  /** Forward speed. */
  speed: number;
  /** Rate of descent (positive = going down). */
  sink: number;
  /** Bank angle. */
  roll: number;
}

export interface TouchdownCheck {
  speedOk: boolean;
  sinkOk: boolean;
  levelOk: boolean;
  /** All three: touching down now would be a safe landing. */
  ok: boolean;
}

/** Would touching the home platform in this state be a landing, or a crash? */
export function assessTouchdown(s: TouchdownState): TouchdownCheck {
  const speedOk = s.speed <= LANDING.maxSpeed;
  const sinkOk = s.sink <= LANDING.maxSink;
  const levelOk = Math.abs(s.roll) <= LANDING.maxRoll;
  return { speedOk, sinkOk, levelOk, ok: speedOk && sinkOk && levelOk };
}

/** Short reason for a failed touchdown, for the crash banner. */
export function hardLandingReason(check: TouchdownCheck): string {
  const problems: string[] = [];
  if (!check.speedOk) problems.push('too fast');
  if (!check.sinkOk) problems.push('descending too steeply');
  if (!check.levelOk) problems.push('wings not level');
  return problems.length ? `Touched down ${problems.join(', ')}.` : '';
}

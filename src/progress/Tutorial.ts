import { controlLabel, type ControlAction } from '../ui/controlLabels';

/**
 * The interactive tutorial: ten short steps from the first mission card to the base, shown in a
 * panel at the top of the screen on a player's first visit. It never blocks anything: each step
 * finishes when the player does the thing (or anything that comes after it), and it can be skipped.
 *
 * The same class runs in single-player and in multiplayer. Its state is a small versioned record
 * (`TutorialRecord`) kept in the single-player save and, in multiplayer, on the player's record on
 * the server, so finishing it once is enough on every computer.
 */

/** What the player did that the tutorial listens for. */
export type TutorialEvent =
  | 'card-selected'
  | 'plane-selected'
  | 'folded'
  | 'launched'
  | 'steered'
  | 'fired'
  | 'bomb-dropped'
  | 'landed'
  | 'rearmed'
  | 'sortie-ended'
  | 'base-opened';

export type TutorialStepId = 'card' | 'plane' | 'fold' | 'launch' | 'steer' | 'fire' | 'bomb' | 'land' | 'turnaround' | 'base';

interface StepSpec {
  id: TutorialStepId;
  title: string;
  /** The line under the title; controls are named through controlLabel. */
  text: () => string;
  keys: ControlAction[];
  /** The events that finish this step. Events of later steps finish it too. */
  done: TutorialEvent[];
  /** Only shown in the air (or on the ground for the landing steps); see `context`. */
  where: 'desk' | 'air' | 'landed' | 'any';
  /** Only its own events finish it, and only while it is the current step (opening the base early skips nothing). */
  strict?: boolean;
}

export const TUTORIAL_STEPS: readonly StepSpec[] = [
  { id: 'card', title: 'Pick a mission', text: () => `Each card is a job, with its reward and its defenses. Pick one with ${controlLabel('selectCard')} or a click.`, keys: ['selectCard'], done: ['card-selected'], where: 'desk' },
  { id: 'plane', title: 'Choose a plane', text: () => `The badges say which planes fit the card. Browse with ${controlLabel('prevPlane')} / ${controlLabel('nextPlane')}.`, keys: ['prevPlane', 'nextPlane'], done: ['plane-selected'], where: 'desk' },
  { id: 'fold', title: 'Fold it', text: () => `Folding costs paper; a plane you bring home only needs a cheap refit. Press ${controlLabel('fold')}.`, keys: ['fold'], done: ['folded'], where: 'desk' },
  { id: 'launch', title: 'Launch', text: () => `When the plane is on the pad, ${controlLabel('launch')} launches it.`, keys: ['launch'], done: ['launched'], where: 'desk' },
  { id: 'steer', title: 'Fly', text: () => `${controlLabel('steer')} steers: the ring shows where you aim. ${controlLabel('throttle')} sets the speed, ${controlLabel('boost')} boosts.`, keys: ['steer', 'throttle', 'boost'], done: ['steered'], where: 'air' },
  { id: 'fire', title: 'Fire ink', text: () => `Hold ${controlLabel('fire')} to fire the ink guns at the ringed targets.`, keys: ['fire'], done: ['fired'], where: 'air' },
  { id: 'bomb', title: 'Drop a bomb', text: () => `${controlLabel('bomb')} drops a bomb. It keeps your speed, so release before you are over the target.`, keys: ['bomb'], done: ['bomb-dropped'], where: 'air' },
  { id: 'land', title: 'Land at home', text: () => 'Fly back to your desk and touch down on the runway: slow, a gentle descent, wings level.', keys: [], done: ['landed'], where: 'air' },
  { id: 'turnaround', title: 'Rearm or end', text: () => `${controlLabel('rearm')} rearms for another run, ${controlLabel('endSortie')} ends the sortie and shows the report.`, keys: ['rearm', 'endSortie'], done: ['rearmed', 'sortie-ended'], where: 'landed' },
  { id: 'base', title: 'Build your base', text: () => `Paper also builds defenses, workshops and storage. ${controlLabel('base')} opens base management.`, keys: ['base'], done: ['base-opened'], where: 'desk', strict: true },
];

export const TUTORIAL_VERSION = 1;

/** The tutorial's saved state. */
export interface TutorialRecord {
  v: number;
  /** Index of the current step; equal to the step count when finished. */
  step: number;
  /** Skipped by the player rather than finished. */
  skipped: boolean;
}

/** Where the player is, so a step can say what to do from there. */
export interface TutorialContext {
  phase: 'desk' | 'building' | 'ready' | 'flying' | 'landed' | 'debrief' | 'crashed';
  /** The plane in the air carries bombs (otherwise the bomb step is passed over). */
  bombs: boolean;
  /** Base management is open. */
  baseOpen: boolean;
}

export interface TutorialView {
  step: number;
  total: number;
  id: TutorialStepId;
  title: string;
  text: string;
  keys: string[];
}

export class Tutorial {
  private step = 0;
  private skippedFlag = false;
  private listeners: Array<() => void> = [];

  constructor(record?: TutorialRecord | null) {
    if (record) this.restore(record);
  }

  /** A record for a player who has never seen the tutorial (null) or one from a save. */
  static fromSave(record: unknown, hasFlown: boolean): Tutorial {
    const parsed = parseTutorial(record);
    // Saves from before the tutorial: a player who has already flown doesn't need it.
    if (!parsed) return new Tutorial(hasFlown ? { v: TUTORIAL_VERSION, step: TUTORIAL_STEPS.length, skipped: false } : null);
    return new Tutorial(parsed);
  }

  get finished(): boolean {
    return this.step >= TUTORIAL_STEPS.length;
  }

  get skipped(): boolean {
    return this.skippedFlag;
  }

  get current(): TutorialStepId | null {
    return this.finished ? null : TUTORIAL_STEPS[this.step].id;
  }

  /** Called whenever the state changes (to save it). */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** The player did something: the step it belongs to, and every step before it, are done. */
  note(event: TutorialEvent): boolean {
    if (this.finished) return false;
    let last = -1;
    TUTORIAL_STEPS.forEach((s, i) => {
      if (s.done.includes(event) && (!s.strict || i === this.step)) last = i;
    });
    if (last < this.step) return false;
    this.step = last + 1;
    this.changed();
    return true;
  }

  /** Passes over steps that can't happen with the plane in use (no bombs on board). */
  update(ctx: TutorialContext): void {
    if (this.finished) return;
    if (this.current === 'bomb' && ctx.phase === 'flying' && !ctx.bombs) {
      this.step++;
      this.changed();
    }
  }

  skip(): void {
    if (this.finished) return;
    this.step = TUTORIAL_STEPS.length;
    this.skippedFlag = true;
    this.changed();
  }

  /** Starts again from the first step (from the menu, or after a progress reset). */
  restart(): void {
    this.step = 0;
    this.skippedFlag = false;
    this.changed();
  }

  restore(record: TutorialRecord): void {
    this.step = Math.max(0, Math.min(TUTORIAL_STEPS.length, Math.floor(record.step)));
    this.skippedFlag = record.skipped === true;
  }

  record(): TutorialRecord {
    return { v: TUTORIAL_VERSION, step: this.step, skipped: this.skippedFlag };
  }

  /**
   * What the panel shows now, or null when finished or when the step doesn't apply here (in the
   * air the desk steps wait; after a crash the flight steps say to fly again).
   */
  view(ctx: TutorialContext): TutorialView | null {
    if (this.finished || ctx.baseOpen) return null;
    const spec = TUTORIAL_STEPS[this.step];
    const base = { step: this.step + 1, total: TUTORIAL_STEPS.length, id: spec.id };
    const show = (title: string, text: string, keys: ControlAction[]) => ({ ...base, title, text, keys: keys.map(controlLabel) });
    const atDesk = ctx.phase === 'desk' || ctx.phase === 'building' || ctx.phase === 'ready';
    if (ctx.phase === 'debrief' || ctx.phase === 'crashed') return null;
    if (spec.where === 'air' && atDesk) {
      return show('Back in the air', `Fold a plane (${controlLabel('fold')}) and launch (${controlLabel('launch')}) to carry on: next, ${spec.title.toLowerCase()}.`, ['fold', 'launch']);
    }
    if (spec.where === 'landed' && ctx.phase !== 'landed') {
      if (atDesk) return show('Back in the air', `Fly a sortie and land at home to carry on: next, ${spec.title.toLowerCase()}.`, ['fold', 'launch']);
      return null;
    }
    if (spec.where === 'desk' && !atDesk) {
      // The desk steps were passed by flying anyway (note() catches up); the base step waits for home.
      if (spec.id === 'base' && ctx.phase === 'landed') return show(spec.title, spec.text(), spec.keys);
      return null;
    }
    return show(spec.title, spec.text(), spec.keys);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }
}

/** The tutorial event a game event stands for (single-player's GameState events), if any. */
export function tutorialEventFor(type: string): TutorialEvent | null {
  switch (type) {
    case 'mission-selected': return 'card-selected';
    case 'aircraft-selected': return 'plane-selected';
    case 'built': return 'folded';
    case 'launched': return 'launched';
    case 'fired': return 'fired';
    case 'bomb-dropped': return 'bomb-dropped';
    case 'landed': return 'landed';
    case 'rearm-started': return 'rearmed';
    case 'sortie-ended': return 'sortie-ended';
    default: return null;
  }
}

/** Seconds of flying with the controls in hand that finish the "fly" step. */
export const STEER_SECONDS = 3;

/** Reads a saved tutorial record; null if it is missing or not one. */
export function parseTutorial(raw: unknown): TutorialRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.v !== 'number' || r.v < 1 || typeof r.step !== 'number' || !Number.isFinite(r.step)) return null;
  // A record from a newer tutorial with more steps: keep the player where they were, capped.
  return { v: TUTORIAL_VERSION, step: Math.max(0, Math.min(TUTORIAL_STEPS.length, Math.floor(r.step))), skipped: r.skipped === true };
}

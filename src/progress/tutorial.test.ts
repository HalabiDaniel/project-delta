import { afterEach, describe, expect, it } from 'vitest';
import { setControlLabels } from '../ui/controlLabels';
import { parseTutorial, Tutorial, TUTORIAL_STEPS, tutorialEventFor, type TutorialContext } from './Tutorial';

const desk: TutorialContext = { phase: 'desk', bombs: false, baseOpen: false };
const air: TutorialContext = { phase: 'flying', bombs: true, baseOpen: false };

afterEach(() => setControlLabels(null));

describe('the tutorial', () => {
  it('walks through the ten steps in order, as the player does each thing', () => {
    const t = new Tutorial();
    expect(t.current).toBe('card');
    for (const e of ['card-selected', 'plane-selected', 'folded', 'launched', 'steered', 'fired', 'bomb-dropped', 'landed', 'sortie-ended', 'base-opened'] as const) {
      expect(t.note(e)).toBe(true);
    }
    expect(t.finished).toBe(true);
    expect(t.skipped).toBe(false);
    expect(t.view(desk)).toBeNull();
  });

  it('a later action finishes the earlier steps, but an earlier one changes nothing', () => {
    const t = new Tutorial();
    expect(t.note('launched')).toBe(true);
    expect(t.current).toBe('steer');
    expect(t.note('card-selected')).toBe(false);
    expect(t.current).toBe('steer');
  });

  it('opening the base early skips nothing; it only finishes the last step', () => {
    const t = new Tutorial();
    expect(t.note('base-opened')).toBe(false);
    expect(t.current).toBe('card');
    t.restore({ v: 1, step: TUTORIAL_STEPS.length - 1, skipped: false });
    expect(t.note('base-opened')).toBe(true);
    expect(t.finished).toBe(true);
  });

  it('passes over the bomb step when the plane carries no bombs', () => {
    const t = new Tutorial({ v: 1, step: 6, skipped: false });
    expect(t.current).toBe('bomb');
    t.update({ ...air, bombs: true });
    expect(t.current).toBe('bomb');
    t.update({ ...air, bombs: false });
    expect(t.current).toBe('land');
  });

  it('says to fly again when a flight step comes up at the desk (after a crash)', () => {
    const t = new Tutorial({ v: 1, step: 5, skipped: false });
    const v = t.view(desk)!;
    expect(v.title).toBe('Back in the air');
    expect(v.text).toMatch(/fire ink/);
    expect(t.view(air)!.title).toBe('Fire ink');
    expect(t.view({ ...air, phase: 'crashed' })).toBeNull();
    expect(t.view({ ...desk, baseOpen: true })).toBeNull();
  });

  it('names the controls of the device in use', () => {
    const t = new Tutorial({ v: 1, step: 2, skipped: false });
    expect(t.view(desk)!.keys).toEqual(['F']);
    setControlLabels({ fold: 'X' });
    expect(t.view(desk)!.keys).toEqual(['X']);
    expect(t.view(desk)!.text).toMatch(/Press X/);
  });

  it('can be skipped and restarted, and tells its listener each time', () => {
    const t = new Tutorial();
    let changes = 0;
    t.onChange(() => changes++);
    t.skip();
    expect(t.finished && t.skipped).toBe(true);
    t.restart();
    expect(t.current).toBe('card');
    expect(changes).toBe(2);
  });

  it('a save from before the tutorial counts it as done once the player has flown', () => {
    expect(Tutorial.fromSave(null, true).finished).toBe(true);
    expect(Tutorial.fromSave(null, false).current).toBe('card');
    expect(Tutorial.fromSave({ v: 1, step: 3, skipped: false }, true).current).toBe('launch');
  });

  it('reads saved records defensively', () => {
    expect(parseTutorial({ v: 1, step: 4, skipped: false })).toEqual({ v: 1, step: 4, skipped: false });
    expect(parseTutorial({ v: 2, step: 40 })).toEqual({ v: 1, step: TUTORIAL_STEPS.length, skipped: false });
    expect(parseTutorial({ v: 1, step: -3 })).toEqual({ v: 1, step: 0, skipped: false });
    expect(parseTutorial({})).toBeNull();
    expect(parseTutorial({ v: 1, step: 'x' })).toBeNull();
    expect(parseTutorial(null)).toBeNull();
  });

  it('maps the game\'s events to its own', () => {
    expect(tutorialEventFor('built')).toBe('folded');
    expect(tutorialEventFor('rearm-started')).toBe('rearmed');
    expect(tutorialEventFor('damaged')).toBeNull();
  });
});

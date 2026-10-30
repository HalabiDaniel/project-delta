import { describe, expect, it } from 'vitest';
import { BOOST, ECONOMY, LANDING } from '../config';
import { Boost } from '../aircraft/Boost';
import { assessTouchdown, hardLandingReason } from '../aircraft/Landing';
import { Boundary } from './Boundary';
import { HomeIncome } from './HomeIncome';
import { ResourceManager } from './ResourceManager';

describe('HomeIncome', () => {
  it('pays a small amount every interval', () => {
    const income = new HomeIncome();
    const r = new ResourceManager(0);
    expect(income.update(ECONOMY.incomeInterval * 0.9, r)).toBe(0);
    expect(income.update(ECONOMY.incomeInterval * 0.1, r)).toBe(ECONOMY.incomeAmount);
    income.update(ECONOMY.incomeInterval * 3, r);
    expect(r.paper).toBe(4 * ECONOMY.incomeAmount);
  });

  it('pauses at the cap', () => {
    const income = new HomeIncome(1, 1, 10);
    const r = new ResourceManager(9);
    income.update(5, r);
    expect(r.paper).toBe(10);
    expect(income.isProducing(r.paper)).toBe(false);
  });

  it('estimates the wait until the player can afford something', () => {
    const income = new HomeIncome(1, 2, 150);
    expect(income.timeToAfford(20, 20)).toBe(0);
    expect(income.timeToAfford(15, 20)).toBe(10);
    expect(income.timeToAfford(0, 500)).toBeNull();
  });
});

describe('Boost', () => {
  it('boosts while held, up to its duration, then cools down', () => {
    const b = new Boost();
    b.update(0.016, true);
    expect(b.state).toBe('active');
    b.update(BOOST.duration, true);
    expect(b.state).toBe('cooldown');
    expect(b.level).toBeCloseTo(0);
    b.update(BOOST.cooldown / 2, true);
    expect(b.level).toBeCloseTo(0.5);
    b.update(BOOST.cooldown / 2, false);
    expect(b.state).toBe('ready');
  });

  it('letting go ends the burst early, and the full cooldown still applies', () => {
    const b = new Boost();
    b.update(0.1, true);
    b.update(0.1, false);
    expect(b.state).toBe('cooldown');
    b.update(BOOST.cooldown - 0.1, true);
    expect(b.state).toBe('cooldown');
  });
});

describe('assessTouchdown', () => {
  it('accepts a slow, gentle, wings-level touchdown', () => {
    expect(assessTouchdown({ speed: LANDING.maxSpeed - 1, sink: 2, roll: 0.1 }).ok).toBe(true);
  });

  it('names what went wrong', () => {
    const check = assessTouchdown({ speed: LANDING.maxSpeed + 5, sink: LANDING.maxSink + 1, roll: 0 });
    expect(check).toMatchObject({ ok: false, speedOk: false, sinkOk: false, levelOk: true });
    expect(hardLandingReason(check)).toBe('Touched down too fast, descending too steeply.');
    expect(assessTouchdown({ speed: 12, sink: 1, roll: -LANDING.maxRoll - 0.1 }).levelOk).toBe(false);
  });
});

describe('Boundary', () => {
  it('warns past the radius and cancels when the player turns back', () => {
    const b = new Boundary(100, 5, 20);
    expect(b.update(0.1, 50, 50)).toBe('inside');
    expect(b.update(0.1, 90, 50)).toBe('warning');
    b.update(2, 90, 50);
    expect(b.countdown).toBeCloseTo(3);
    expect(b.update(0.1, 60, 50)).toBe('inside');
  });

  it('hands over to the autopilot when the countdown runs out, until well inside', () => {
    const b = new Boundary(100, 5, 20);
    b.update(0.1, 120, 0);
    expect(b.update(5, 120, 0)).toBe('autopilot');
    expect(b.update(0.1, 95, 0)).toBe('autopilot'); // inside, but not by the margin yet
    expect(b.update(0.1, 79, 0)).toBe('inside');
  });
});

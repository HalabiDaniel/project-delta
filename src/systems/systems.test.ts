import { describe, expect, it } from 'vitest';
import { ECONOMY, LANDING } from '../config';

const BOOST = { duration: 1.2, cooldown: 3.5 };
import { Boost } from '../aircraft/Boost';
import { assessTouchdown, hardLandingReason } from '../aircraft/Landing';
import { Boundary } from './Boundary';
import { HomeIncome } from './HomeIncome';
import { Ledger } from './Ledger';
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
    const b = new Boost(BOOST.duration, BOOST.cooldown);
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
    const b = new Boost(BOOST.duration, BOOST.cooldown);
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

describe('HomeIncome: storage', () => {
  it('slows to half rate as the store fills, and pauses when it is full', () => {
    const income = new HomeIncome(1, 3, 120, 60);
    expect(income.stateFor(10)).toBe('producing');
    expect(income.stateFor(60)).toBe('slowed');
    expect(income.stateFor(120)).toBe('full');
    expect(income.ratePerMinute(10)).toBe(20);
    expect(income.ratePerMinute(80)).toBe(10);
    expect(income.ratePerMinute(130)).toBe(0);
    const r = new ResourceManager(58);
    income.update(6, r); // two payouts at full rate: 58 → 60
    expect(r.paper).toBe(60);
    income.update(5.9, r); // half rate now: not quite one payout
    expect(r.paper).toBe(60);
    income.update(0.1, r);
    expect(r.paper).toBe(61);
    // Idle for an hour: never beyond the store's capacity.
    income.update(3600, r);
    expect(r.paper).toBe(120);
  });

  it('counts the slower rate when estimating a wait', () => {
    const income = new HomeIncome(1, 3, 120, 60);
    expect(income.timeToAfford(58, 62)).toBe(2 * 3 + 2 * 6);
  });
});

describe('Ledger', () => {
  it('logs every change with what it was for, and gathers home production into one line', () => {
    const r = new ResourceManager(100);
    const ledger = new Ledger(5, () => 7);
    ledger.watch(r);
    r.spend(25, 'Folded Falcon');
    r.earn(1, 'income');
    r.earn(1, 'income');
    r.earn(80, 'reward', 'Mission completed: Bomb T5');
    r.lose(20, 50);
    r.restore(300); // not a transaction
    expect(ledger.recent(4).map((e) => [e.label, e.delta])).toEqual([
      ['Raid on the paper store', -20],
      ['Mission completed: Bomb T5', 80],
      ['Home production', 2],
      ['Folded Falcon', -25],
    ]);
    expect(ledger.entries.find((e) => e.source === 'income')?.count).toBe(2);
    expect(ledger.totals).toEqual({ earned: 82, spent: 25, income: 2, bonuses: 0, raids: 20 });
  });

  it('keeps efficiency per design and per mission type', () => {
    const ledger = new Ledger();
    ledger.recordSortie({ aircraft: 'falcon', type: 'dogfight', spent: 25, earned: 90, success: true, lost: false });
    ledger.recordSortie({ aircraft: 'falcon', type: 'bombing', spent: 6, earned: 0, success: false, lost: true });
    expect(ledger.byAircraft.get('falcon')).toEqual({ sorties: 2, successes: 1, lost: 1, spent: 31, earned: 90 });
    expect(ledger.byType.get('dogfight')?.earned).toBe(90);
    expect(ledger.aircraftReturns()[0].ratio).toBeCloseTo(90 / 31);
  });

  it('keeps only the newest entries', () => {
    const r = new ResourceManager(100);
    const ledger = new Ledger(3);
    ledger.watch(r);
    for (let i = 0; i < 5; i++) r.spend(1, `Buy ${i}`);
    expect(ledger.entries.map((e) => e.label)).toEqual(['Buy 2', 'Buy 3', 'Buy 4']);
  });
});

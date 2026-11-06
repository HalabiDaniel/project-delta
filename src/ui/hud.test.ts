// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { AlertQueue, Alerts, alertLevel, MAX_ALERTS, type QueuedAlert } from './Alerts';
import { applyCombat, combatLevel } from './HUD';
import { resourceRows } from './EconomyStrip';
import type { EconomyView, HudView } from './views';
import type { ThreatView } from './ThreatHud';
import type { AirView } from './AirHud';

afterEach(() => {
  document.body.innerHTML = '';
});

// ---- Alerts: at most three, critical > warning > good / info, newest first within a level -------------

describe('alerts: priority and limit', () => {
  const item = (key: string, level: QueuedAlert['level'], at: number): QueuedAlert => ({ key, level, at, until: at + 1000, count: 1 });

  it('keeps at most three, ordered by level then newest first', () => {
    const q = new AlertQueue();
    q.push(item('a', 'info', 1));
    q.push(item('b', 'warning', 2));
    q.push(item('c', 'info', 3));
    expect(q.items.map((a) => a.key)).toEqual(['b', 'c', 'a']);
    // A fourth that matters as much as the weakest replaces the oldest of that level.
    expect(q.push(item('d', 'info', 4))!.map((a) => a.key)).toEqual(['a']);
    expect(q.items.map((a) => a.key)).toEqual(['b', 'd', 'c']);
    expect(q.items.length).toBe(MAX_ALERTS);
  });

  it('a critical warning always wins; a lesser alert does not push out more important ones', () => {
    const q = new AlertQueue();
    q.push(item('w1', 'warning', 1));
    q.push(item('w2', 'warning', 2));
    q.push(item('w3', 'warning', 3));
    expect(q.push(item('info', 'info', 4))).toBeNull();
    expect(q.items.map((a) => a.key)).toEqual(['w3', 'w2', 'w1']);
    q.push(item('lock', 'critical', 5));
    expect(q.items.map((a) => a.key)).toEqual(['lock', 'w3', 'w2']);
    // Three criticals: a warning can't get in, and the newest critical leads.
    q.push(item('raid', 'critical', 6));
    q.push(item('health', 'critical', 7));
    expect(q.push(item('w4', 'warning', 8))).toBeNull();
    expect(q.items.map((a) => a.key)).toEqual(['health', 'raid', 'lock']);
  });

  it('knows critical news by its flag or its icon (raid on home, rocket lock, low health)', () => {
    expect(alertLevel('paper', 'bad')).toBe('warning');
    expect(alertLevel('raid', 'bad')).toBe('critical');
    expect(alertLevel('lock', 'bad')).toBe('critical');
    expect(alertLevel('paper', 'bad', { critical: true })).toBe('critical');
    expect(alertLevel('raid', 'good')).toBe('info');
    expect(alertLevel('repair', 'warn')).toBe('warning');
  });

  it('renders the Alert component in queue order, counts repeats and lets them expire', () => {
    const clock = { t: 0 };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const alerts = new Alerts(host, () => clock.t);
    alerts.show('swap', 'Swapped', '2/3', 'info');
    clock.t = 10;
    alerts.show('paper', 'Need paper', '−10', 'bad');
    clock.t = 20;
    alerts.show('raid', 'Raid inbound', null, 'bad');
    clock.t = 30;
    alerts.show('swap', 'Swapped', '1/3', 'info');
    const els = [...host.querySelectorAll('.ui-alert:not(.leaving)')];
    expect(els.map((e) => e.getAttribute('data-level'))).toEqual(['critical', 'warning', 'info']);
    expect(els[0].getAttribute('role')).toBe('alert');
    expect(els[2].querySelector('.ui-alert-count')?.textContent).toBe('×2');
    expect(alerts.showing.map((a) => a.key)).toEqual(['bad|Raid inbound', 'bad|Need paper', 'info|Swapped']);
    clock.t = 10_000;
    alerts.update();
    expect(alerts.showing.length).toBe(0);
  });
});

// ---- Combat de-emphasis ----------------------------------------------------------------------------

describe('combat de-emphasis', () => {
  const threat = (t: Partial<ThreatView>): ThreatView => ({ panel: null, ring: [], lock: null, ...t });
  const view = (v: Partial<Pick<HudView, 'phase' | 'paused' | 'threat' | 'air'>>) => ({ phase: 'flying' as const, paused: false, threat: null, air: null, ...v });

  it('reads the fight from the threat and air views', () => {
    expect(combatLevel(view({}))).toBe(0);
    expect(combatLevel(view({ threat: threat({ ring: [{ id: 'r', angle: 0, icon: 'turret', state: 'tracking', distance: 100 }] }) }))).toBe(1);
    const air: AirView = { lead: null, markers: [{ attacking: true } as AirView['markers'][number]] };
    expect(combatLevel(view({ air }))).toBe(1);
    expect(combatLevel(view({ threat: threat({ lock: { state: 'locking', progress: 0.5, distance: 0, count: 0 } }) }))).toBe(2);
    expect(combatLevel(view({ threat: threat({ ring: [{ id: 'r', angle: 0, icon: 'turret', state: 'firing', distance: 100 }] }) }))).toBe(2);
    // Not in flight, or paused: never.
    expect(combatLevel(view({ phase: 'desk', threat: threat({ lock: { state: 'incoming', progress: 1, distance: 50, count: 1 } }) }))).toBe(0);
    expect(combatLevel(view({ paused: true, air }))).toBe(0);
  });

  it('puts the class on the HUD root and takes it off after the fight', () => {
    const root = document.createElement('div');
    applyCombat(root, 2);
    expect(root.classList.contains('combat')).toBe(true);
    expect(root.classList.contains('combat-hot')).toBe(true);
    applyCombat(root, 1);
    expect(root.classList.contains('combat-hot')).toBe(false);
    applyCombat(root, 0);
    expect(root.classList.contains('combat')).toBe(false);
  });
});

// ---- Resources: more without layout change ---------------------------------------------------------------

describe('economy strip resources', () => {
  it('lists paper first and any further resource as one more row of the same shape', () => {
    const v: EconomyView = { paper: 100, capacity: 300, rate: 3.5, state: 'producing', progress: 0, protectedPaper: 50, streak: 0, repairs: 0 };
    expect(resourceRows(v).map((r) => r.id)).toEqual(['paper']);
    const more = resourceRows({ ...v, resources: [{ id: 'ink', icon: 'ink', label: 'Ink', amount: 40, capacity: 100, rate: 1 }] });
    expect(more.map((r) => r.id)).toEqual(['paper', 'ink']);
    expect(Object.keys(more[1])).toEqual(expect.arrayContaining(['id', 'icon', 'label', 'amount', 'capacity']));
  });
});


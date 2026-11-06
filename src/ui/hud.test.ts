// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertQueue, Alerts, alertLevel, MAX_ALERTS, type QueuedAlert } from './Alerts';
import { applyCombat, combatLevel } from './HUD';
import { ConfirmDialog } from './components';
import { confirmOpen, confirmThen, guardActions, installConfirmDialog, requestConfirm, type ConfirmHost } from './confirm';
import { priceHtml } from './BaseHud';
import { resourceRows } from './EconomyStrip';
import { Logbook, type LogbookView } from './Logbook';
import { CONFIRM_TEXT } from './strings';
import { FocusManager, setFocusManager, type Rect } from '../input/FocusNav';
import { emptyProgress } from '../progress/Progress';
import { Ledger } from '../systems/Ledger';
import { emptyBaseStats } from '../base/Base';
import type { EconomyView, HudActions, HudView } from './views';
import type { ThreatView } from './ThreatHud';
import type { AirView } from './AirHud';

afterEach(() => {
  document.body.innerHTML = '';
  installConfirmDialog(null);
  setFocusManager(null);
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

// ---- Confirm dialogs on every destructive action ---------------------------------------------------------

function fakeHost(answer: boolean): ConfirmHost & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    isOpen: false,
    open: (o) => {
      asked.push(o.title);
      return Promise.resolve(answer);
    },
  };
}

function rawActions(): HudActions & { calls: string[] } {
  const calls: string[] = [];
  const f = (name: string) => () => void calls.push(name);
  return {
    calls,
    build: f('build'), launch: f('launch'), select: f('select'), selectAircraft: f('selectAircraft'), rearm: f('rearm'), takeOff: f('takeOff'),
    endSortie: f('endSortie'), continueToDesk: f('continue'), resume: f('resume'), swap: f('swap'), abandonOperation: f('abandon'),
    openLogbook: f('logbook'), openMenu: f('menu'), resetProgress: f('reset'), dismissWelcome: f('welcome'), toggleSound: f('sound'),
    setHints: f('hints'), setUiScale: f('scale'), setAccess: f('access'), setGraphicsPreset: f('gfx'), toggleBase: f('base'), skipTutorial: f('skip'),
    restartTutorial: f('restart'), quickRebuild: f('rebuild'), quickRepair: f('repair'), rearmAndGo: f('rearmgo'),
    base: { selectSlot: f('slot'), choose: f('choose'), build: f('b-build'), upgrade: f('upgrade'), repair: f('b-repair'), repairAll: f('repair-all'), remove: f('remove') },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('confirm dialogs for destructive actions', () => {
  it('End sortie, Reset and Abandon ask first and only act on confirm', async () => {
    const raw = rawActions();
    const no = fakeHost(false);
    installConfirmDialog(no);
    const guarded = guardActions(raw, { multiplayer: false, view: () => null });
    guarded.endSortie();
    guarded.resetProgress();
    guarded.abandonOperation();
    await flush();
    expect(no.asked).toEqual([CONFIRM_TEXT.endSortie.title, CONFIRM_TEXT.reset.title, CONFIRM_TEXT.abandon.title]);
    expect(raw.calls).toEqual([]);
    const yes = fakeHost(true);
    installConfirmDialog(yes);
    guarded.endSortie();
    guarded.resetProgress();
    guarded.abandonOperation();
    await flush();
    expect(raw.calls).toEqual(['endSortie', 'reset', 'abandon']);
    // Everything else passes straight through.
    guarded.launch();
    expect(raw.calls).toContain('launch');
  });

  it('asks Leave classroom in multiplayer, and says when ending the sortie abandons a mission', async () => {
    const raw = rawActions();
    const host = fakeHost(true);
    installConfirmDialog(host);
    const view = { ground: { status: 'active' } } as unknown as HudView;
    const guarded = guardActions(raw, { multiplayer: true, view: () => view });
    guarded.resetProgress();
    guarded.endSortie();
    await flush();
    expect(host.asked).toEqual([CONFIRM_TEXT.leave.title, CONFIRM_TEXT.endSortieActive.title]);
    expect(raw.calls).toEqual(['reset', 'endSortie']);
  });

  it('the real dialog: Enter confirms, Esc cancels, a held key does not confirm, one at a time', async () => {
    const dialog = new ConfirmDialog(document.body);
    installConfirmDialog(dialog);
    const run = vi.fn();
    const first = confirmThen('remove', run);
    expect(confirmOpen()).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(CONFIRM_TEXT.remove.title);
    expect(await requestConfirm('reset')).toBe(false); // another is up
    // The browser's own press of the newly focused Confirm (Enter's keypress, Space's keyup) is blocked.
    const press = new KeyboardEvent('keypress', { key: 'Enter', bubbles: true, cancelable: true });
    window.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(confirmOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
    expect(confirmOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await first).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    const second = confirmThen('endSortie', run);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await second).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(confirmOpen()).toBe(false);
  });

  it('Remove building asks through BaseMode, so the X shortcut asks too', async () => {
    const { BaseMode } = await import('../base/BaseMode');
    const host = fakeHost(false);
    installConfirmDialog(host);
    const base = { at: () => ({}), remove: vi.fn(() => true) } as unknown as ConstructorParameters<typeof BaseMode>[0];
    const mode = new BaseMode(base);
    mode.open = true;
    mode.selected = 'D1';
    expect(await mode.remove()).toBe(false);
    expect(host.asked).toEqual([CONFIRM_TEXT.remove.title]);
    expect((base as unknown as { remove: ReturnType<typeof vi.fn> }).remove).not.toHaveBeenCalled();
  });
});

// ---- Costs show what is missing --------------------------------------------------------------------------

describe('costs show what is missing', () => {
  it('a short price carries the shortfall as its own chip; an affordable one does not', () => {
    const host = document.createElement('div');
    host.innerHTML = priceHtml({ cost: 110, missing: 10 }) + priceHtml({ cost: 60, missing: 0 });
    const [short, ok] = [...host.querySelectorAll<HTMLElement>('.price')];
    expect(short.querySelector('b')?.textContent).toBe('110');
    expect(short.querySelector('.missing')?.textContent).toContain('−10');
    expect(short.querySelector('.missing')?.getAttribute('data-tip')).toContain('10');
    expect(short.getAttribute('aria-label')).toContain('10');
    expect(short.hasAttribute('data-short')).toBe(true);
    expect(ok.querySelector('.missing')).toBeNull();
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

// ---- Logbook tabs ------------------------------------------------------------------------------------

function logbookView(): LogbookView {
  const progress = emptyProgress();
  return {
    career: { missionsCompleted: 0, planesLost: 0, targetsDestroyed: 0, defensesDestroyed: 0, aircraftDestroyed: 0, favorite: null },
    base: { stats: emptyBaseStats(), production: 3, capacity: 300, protectedPaper: 50, buildings: [] },
    progress,
    session: { missionsCompleted: 0, missionsFailed: 0, paperEarned: 0, paperSpent: 0, aircraftLost: 0, enemiesDestroyed: 0, best: '—', achievements: [], minutes: 0 },
    ledger: new Ledger(),
    performance: { rating: 0.5, indicators: {} as LogbookView['performance']['indicators'], missions: 0 },
    skill: 0.5,
    band: 'Medium',
    recommended: 'Medium',
  };
}

const rect = (): Rect => ({ left: 0, top: 0, right: 40, bottom: 20 });

describe('logbook tabs', () => {
  it('is built from the Tabs component; the focus manager switches tabs (Q / E, LB / RB) and the panel follows', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const nav = new FocusManager(document, { rectOf: rect, hitTest: false });
    nav.setActive(true);
    setFocusManager(nav);
    const book = new Logbook(root, logbookView, () => book.toggle(false));
    book.toggle(true);
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.dataset.tab)).toEqual(['records', 'base', 'aircraft', 'paper', 'session']);
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    // Opening puts the highlight on the chosen tab.
    expect(nav.focused?.dataset.tab).toBe('records');
    expect(nav.switchTab(1)).toBe(true);
    expect(book.currentTab).toBe('base');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    const visible = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((p) => !p.hidden);
    expect(visible.map((p) => p.id)).toEqual([tabs[1].getAttribute('aria-controls')]);
    expect(visible[0].innerHTML).toContain('T1 now');
    nav.switchTab(-1);
    nav.switchTab(-1);
    expect(book.currentTab).toBe('session');
    book.toggle(false);
  });

  it('filters achievements and transactions', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const v = logbookView();
    v.ledger.record(20, 120, 'income', 'Home production');
    v.ledger.record(-15, 105, 'spend', 'Swift');
    const book = new Logbook(root, () => v, () => undefined);
    book.toggle(true);
    const press = (sel: string) => root.querySelector<HTMLElement>(sel)!.click();
    press('[data-filter="ach"][data-v="earned"]');
    expect(root.querySelectorAll('.achievements li.got').length).toBe(0);
    expect(root.querySelector('[data-filter="ach"][data-v="earned"]')?.getAttribute('aria-pressed')).toBe('true');
    press('[data-tab="paper"]');
    const rows = () => [...root.querySelectorAll('[role="tabpanel"]:not([hidden]) .lb-table')][0].querySelectorAll('tr').length;
    expect(rows()).toBe(2);
    press('[data-filter="paper"][data-v="out"]');
    expect(rows()).toBe(1);
    book.toggle(false);
  });

  it('closing returns the highlight to the control that opened it', () => {
    document.body.innerHTML = '<button id="opener">L</button>';
    const root = document.createElement('div');
    document.body.appendChild(root);
    const nav = new FocusManager(document, { rectOf: rect, hitTest: false });
    nav.setActive(true);
    setFocusManager(nav);
    const opener = document.getElementById('opener')!;
    nav.reset('desk');
    nav.focus(opener);
    const book = new Logbook(root, logbookView, () => undefined);
    book.toggle(true);
    expect(nav.focused?.dataset.tab).toBe('records');
    // The screen changes because the logbook opened: the opener is still what it returns to.
    nav.reset('desk|logbook');
    expect(nav.focused?.dataset.tab).toBe('records');
    book.toggle(false);
    nav.reset('desk');
    expect(nav.focused).toBe(opener);
  });
});

describe('focus: going back waits for the screen to draw its controls', () => {
  it('restores a control that shows again a frame after the screen change', () => {
    document.body.innerHTML = '<button id="card" data-m="card-0">Card</button><button id="fold" class="primary">Fold</button>';
    const nav = new FocusManager(document, { rectOf: (el) => (el.closest('[hidden]') ? { left: 0, top: 0, right: 0, bottom: 0 } : rect()), hitTest: false });
    nav.setActive(true);
    const card = document.getElementById('card')!;
    nav.reset('desk');
    nav.focus(card);
    nav.reset('base');
    card.hidden = true;
    nav.update();
    expect(nav.focused?.id).toBe('fold');
    // Back at the desk, before the HUD has shown the cards again: no jump to the main control.
    nav.reset('desk');
    nav.update();
    expect(nav.focused).toBeNull();
    card.hidden = false;
    nav.update();
    expect(nav.focused?.id).toBe('card');
  });
});

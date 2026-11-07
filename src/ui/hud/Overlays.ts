import { bind } from '../../input/bindings';
import { focusManager } from '../../input/FocusNav';
import { glyph } from '../components';
import { esc, toggle } from '../dom';
import { clock, count, fmt, minutes, paper, pct, signed } from '../format';
import { icon, type IconName } from '../icons';
import { coach, drawer, kbutton, kvRow, panel, resultCard, toast, type KitTone } from '../kit';
import { STYLE_TEXT, T } from '../strings';
import type { HudActions, HudView, ResultView, SessionView } from '../views';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { SettingsTab } from '../flow';
import type { TutorialStepId } from '../../progress/Tutorial';

const O = (): typeof T.overlay => T.overlay;
const MULTIPLAYER = typeof window !== 'undefined' && ['mp', 'invite'].some((k) => new URLSearchParams(window.location.search).has(k));

// ---- Toasts ----------------------------------------------------------------------------------------

/** One-line toasts, top centre under the alert slot, 2.5 seconds each, newest replaces oldest. */
export class Toasts {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toasts';
    this.el.setAttribute('aria-live', 'polite');
    host.appendChild(this.el);
  }

  show(iconName: IconName, text: string, tone: KitTone = 'plain', value?: string): void {
    this.el.innerHTML = toast({ icon: iconName, text, tone, value });
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const t = this.el.firstElementChild as HTMLElement | null;
      if (!t) return;
      t.dataset.leaving = '';
      window.setTimeout(() => t.remove(), 220);
    }, 2500);
  }
}

// ---- Result card ------------------------------------------------------------------------------------

/** The sortie's result: one centred 640px panel; everything else behind Details. */
export class ResultPanel {
  private readonly el: HTMLElement;
  private open = false;
  private key = '';
  private shown = false;

  constructor(host: HTMLElement, private readonly onContinue: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'result-layer';
    host.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === 'continue') this.onContinue();
      if (b.dataset.act === 'details') {
        this.open = !this.open;
        this.key = '';
      }
    });
  }

  render(r: ResultView | null, paused: boolean): void {
    const visible = r !== null && !paused;
    toggle(this.el, visible);
    if (visible !== this.shown) {
      this.shown = visible;
      if (visible) {
        this.open = false;
        this.key = '';
      }
    }
    if (!r || !visible) return;
    const key = JSON.stringify([r, this.open]);
    if (key === this.key) return;
    const first = this.key === '';
    this.key = key;
    const o = O();
    const net = r.paperEarned - r.paperSpent - r.paperLost;
    const done = r.missionTone === 'good';
    const status = done ? STYLE_TEXT.missionDone : r.recovered ? STYLE_TEXT.homeSafe : STYLE_TEXT.crumpled;
    const title = done ? (r.recovered ? o.homeAndDone : o.missionDone) : r.failure?.title ?? (r.recovered ? o.landedEarly : o.planeLost);
    const kills = r.aircraftDestroyed + r.defensesDestroyed + r.targetsDestroyed;
    const tipLine = shortTip(r.failure?.advice ?? r.next);
    this.el.innerHTML = resultCard({
      icon: done ? 'ok' : r.recovered ? 'home' : 'crumple',
      tone: done ? 'good' : r.recovered ? 'warn' : 'hostile',
      status,
      title,
      meta: T.common.dot([r.missionTitle, r.aircraftName, o.hull(pct(r.recovered ? r.health : 0))]),
      tiles: [
        ['paper', signed(net), o.paper],
        ['ink', count(r.shotsHit + r.bombHits), o.hits],
        ['kills', count(kills), o.kills],
        ['clock', clock(r.time), o.time],
      ],
      tip: tipLine ?? undefined,
      detailsOpen: this.open,
      detailsHtml: this.details(r, net),
      detailsLabel: T.say.details,
      continueLabel: T.say.continue,
      continueKey: bind('confirm'),
    });
    if (first) {
      focusManager()?.openPanel(this.el);
      this.el.dataset.enter = '';
      window.setTimeout(() => delete this.el.dataset.enter, 260);
    }
  }

  private details(r: ResultView, net: number): string {
    const o = O();
    const ratio = (a: number, b: number) => (b > 0 ? `${count(a)}/${count(b)} · ${pct(a / b)}` : '—');
    return [
      r.failure ? `<div class="rd-why"><p>${esc(r.failure.why)}</p><p class="rd-advice">${icon('tip', 'icon pw-icon')}<span>${esc(r.failure.advice)}</span></p></div>` : '',
      r.next ? `<p class="rd-next">${icon('plane', 'icon pw-icon')}<span>${esc(r.next)}</span></p>` : '',
      r.planeLine ? kvRow(o.plane, esc(r.planeLine)) : '',
      ...r.paper.map((l) => kvRow(l.label, `<b class="num ${l.amount > 0 ? 'good' : 'bad'}">${esc(signed(l.amount))}</b>`)),
      r.paper.length > 1 ? kvRow(T.report.net, `<b class="num">${esc(signed(net))}</b>`) : '',
      kvRow(T.report.damageDealt, esc(fmt(r.damageDealt))),
      kvRow(T.report.damageTaken, esc(fmt(r.damageTaken))),
      kvRow(T.report.bombsOnTarget, esc(ratio(r.bombHits, r.bombsDropped))),
      kvRow(T.report.inkHits, esc(ratio(r.shotsHit, r.shotsFired))),
      r.medal ? kvRow(o.medal, esc(T.report.medal[r.medal])) : '',
      ...r.records.map((x) => kvRow(o.record, esc(x))),
      ...r.achievements.map((a) => kvRow(o.achievement, esc(a.title))),
      ...r.bonuses.map((b) => kvRow(b.label, `+${esc(paper(b.amount))}`)),
    ].join('');
  }
}

/** The first sentence of a tip, when it fits in 70 characters (else none). */
export function shortTip(text: string | null | undefined): string | null {
  if (!text) return null;
  const first = text.split(/(?<=[.!?])\s/)[0].trim();
  return first.length <= 70 ? first : null;
}

// ---- Pause, session drawer, settings over the match --------------------------------------------------

export class PauseMenu {
  private readonly el: HTMLElement;
  private readonly drawerEl: HTMLElement;
  private readonly settingsEl: HTMLElement;
  private readonly settings: SettingsScreen;
  private settingsOpen = false;
  private sessionOpen = false;
  private shown = false;
  private key = '';
  private drawerKey = '';

  constructor(host: HTMLElement, drawerHost: HTMLElement, private readonly actions: HudActions) {
    this.el = document.createElement('div');
    this.el.className = 'pause-layer';
    host.appendChild(this.el);
    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'session-drawer';
    drawerHost.appendChild(this.drawerEl);
    this.settingsEl = document.createElement('div');
    this.settingsEl.className = 'hud-settings front';
    this.settingsEl.innerHTML = '<div class="front-stage"><div class="front-sheet pw-panel screen-sheet" data-margin></div></div>';
    document.body.appendChild(this.settingsEl);
    this.settingsEl.hidden = true;
    this.settings = new SettingsScreen(this.settingsEl.querySelector<HTMLElement>('.screen-sheet')!, {
      setHints: actions.setHints,
      setUiScale: actions.setUiScale,
      setAccess: actions.setAccess,
      setGraphicsPreset: actions.setGraphicsPreset,
      toggleSound: actions.toggleSound,
      setVolume: (v) => actions.setVolume?.(v),
      restartTutorial: () => {
        actions.restartTutorial();
        this.closeSettings();
        actions.resume();
      },
      resetProgress: actions.resetProgress,
      signIn: () => {},
      signOut: () => {},
      back: () => this.closeSettings(),
    });
    for (const n of [this.el, this.drawerEl]) {
      n.addEventListener('mousedown', (e) => e.preventDefault());
      n.addEventListener('click', (e) => this.click(e));
    }
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.max(0.6, Math.min(2.4, Math.min(w / 1440, h / 900)));
    this.settingsEl.style.setProperty('--fs', String(s));
    this.settingsEl.style.setProperty('--stage-w', `${w / s}px`);
    this.settingsEl.style.setProperty('--stage-h', `${h / s}px`);
  }

  get isSettingsOpen(): boolean {
    return this.settingsOpen;
  }

  get isSessionOpen(): boolean {
    return this.sessionOpen;
  }

  openSettings(tab: SettingsTab): void {
    this.settings.open(tab, document.documentElement.dataset.device === 'gamepad' ? 'gamepad' : 'keyboard');
    this.settingsOpen = true;
    this.settingsEl.hidden = false;
    focusManager()?.openPanel(this.settingsEl);
  }

  /** Back out of Settings to Pause. True when it was open. */
  closeSettings(): boolean {
    if (!this.settingsOpen) return false;
    this.settingsOpen = false;
    this.settingsEl.hidden = true;
    focusManager()?.closePanel(this.settingsEl);
    this.key = '';
    return true;
  }

  /** L: this session's stats in a right drawer. */
  toggleSession(open = !this.sessionOpen): void {
    this.sessionOpen = open;
    this.drawerKey = '';
  }

  render(v: HudView): void {
    const paused = v.paused;
    if (!paused && this.settingsOpen) this.closeSettings();
    toggle(this.el, paused && !this.settingsOpen);
    if (paused !== this.shown) {
      this.shown = paused;
      if (paused) focusManager()?.openPanel(this.el);
      else focusManager()?.closePanel(this.el);
    }
    if (this.settingsOpen) {
      this.settings.render(v.menu.settings, {
        volume: v.menu.settings.volume ?? 1,
        saveNote: v.menu.saveNote,
        account: v.menu.account ?? null,
        multiplayer: MULTIPLAYER,
        device: document.documentElement.dataset.device === 'gamepad' ? 'gamepad' : 'keyboard',
      });
    }
    if (paused && !this.settingsOpen) this.renderPause(v);
    const atDesk = v.phase !== 'flying' && v.result === null;
    const drawerShown = this.sessionOpen && atDesk && !paused;
    toggle(this.drawerEl, drawerShown);
    if (!atDesk) this.sessionOpen = false;
    if (drawerShown) this.renderSession(v.menu.session);
  }

  private renderPause(v: HudView): void {
    const o = O();
    const desk = v.phase !== 'flying';
    const s = v.menu.session;
    const key = JSON.stringify([desk, s]);
    if (key === this.key) return;
    this.key = key;
    const leave = MULTIPLAYER
      ? kbutton({ label: o.leaveMatch, icon: 'logOut', size: 'm', block: true, attrs: { 'data-act': 'leave' } })
      : kbutton({ label: o.quitToMenu, icon: 'logOut', size: 'm', block: true, attrs: { 'data-act': 'quit' } });
    this.el.innerHTML = panel({
      className: 'pause-panel', label: desk ? T.say.menu : o.paused, tag: 'section',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
      bodyHtml: `<h2 class="pause-title" id="pause-title">${esc(desk ? T.say.menu : o.paused)}</h2>
        <div class="pause-actions">
          ${kbutton({ label: o.resume, icon: 'play', variant: 'primary', size: 'm', block: true, key: bind('back', 'pause'), attrs: { 'data-act': 'resume', 'data-nav-default': '' } })}
          ${kbutton({ label: o.settings, icon: 'sliders', size: 'm', block: true, attrs: { 'data-act': 'settings' } })}
          ${kbutton({ label: o.controls, icon: 'gamepad', size: 'm', block: true, attrs: { 'data-act': 'controls' } })}
          ${leave}
        </div>
        <div class="pause-stats" role="group" aria-label="${esc(o.session)}">
          ${this.stat('ok', count(s.missionsCompleted), T.menus.missionsCompleted(s.missionsFailed))}
          ${this.stat('paper', `+${fmt(s.paperEarned)}`, T.menus.paperEarned)}
          ${this.stat('kills', count(s.enemiesDestroyed), T.menus.enemiesDestroyed)}
          ${this.stat('crumple', count(s.aircraftLost), T.menus.aircraftLost)}
          ${this.stat('clock', minutes(s.minutes), T.menus.time)}
        </div>`,
    });
  }

  private stat(i: IconName, value: string, label: string): string {
    return `<span class="pause-stat" role="img" aria-label="${esc(T.common.labelValue(label, value))}" data-tip="${esc(label)}">${icon(i, 'icon pw-icon')}<b class="num">${esc(value)}</b></span>`;
  }

  private renderSession(s: SessionView): void {
    const key = JSON.stringify(s);
    if (key === this.drawerKey) return;
    this.drawerKey = key;
    const o = O();
    this.drawerEl.innerHTML = drawer({
      id: 'session-drawer-panel',
      title: o.session,
      icon: 'book',
      bodyHtml: [
        kvRow(T.menus.missionsCompleted(s.missionsFailed), `<b class="num">${esc(count(s.missionsCompleted))}</b>`),
        kvRow(T.menus.paperEarned, `<b class="num good">+${esc(fmt(s.paperEarned))}</b>`),
        kvRow(T.menus.paperSpent, `<b class="num">−${esc(fmt(s.paperSpent))}</b>`),
        kvRow(T.menus.enemiesDestroyed, `<b class="num">${esc(count(s.enemiesDestroyed))}</b>`),
        kvRow(T.menus.aircraftLost, `<b class="num">${esc(count(s.aircraftLost))}</b>`),
        kvRow(T.menus.time, `<b class="num">${esc(minutes(s.minutes))}</b>`),
        s.best !== '—' ? kvRow(T.menus.bestPerformance, esc(s.best)) : '',
        s.achievements.length ? kvRow(o.newAchievements, esc(s.achievements.join(' · '))) : '',
      ].join(''),
      footHtml: MULTIPLAYER ? undefined : kbutton({ label: o.allAchievements, icon: 'award', size: 'm', attrs: { 'data-act': 'achievements' } }),
      closeName: T.say.close,
      closeKey: bind('logbook'),
    });
  }

  private click(e: Event): void {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    const a = this.actions;
    switch (b.dataset.act) {
      case 'resume':
        return a.resume();
      case 'settings':
        return this.openSettings('game');
      case 'controls':
        return this.openSettings('controls');
      case 'leave':
        return a.resetProgress();
      case 'quit':
        return a.quitToMenu?.();
      case 'close':
        this.toggleSession(false);
        return;
      case 'achievements':
        this.toggleSession(false);
        return a.openAchievements?.();
    }
  }
}

// ---- Coach marks ---------------------------------------------------------------------------------

/** Where each tutorial step points: the element it explains, and which side the note sits on. */
const ANCHORS: Record<TutorialStepId, { target: string; side: 'above' | 'right' | 'left' | 'below' }> = {
  card: { target: '.pw-dock-btn[data-dock="missions"], .m-card.tracked', side: 'above' },
  plane: { target: '.pw-dock-btn[data-dock="hangar"]', side: 'above' },
  fold: { target: '.desk-dock .dock-main', side: 'above' },
  launch: { target: '.desk-dock .dock-main', side: 'above' },
  steer: { target: '.plane-card', side: 'above' },
  fire: { target: '.action-tile[data-f="t-ink"]', side: 'above' },
  bomb: { target: '.action-tile[data-f="t-bomb"]', side: 'above' },
  land: { target: '.mm-frame, .minimap', side: 'left' },
  turnaround: { target: '.ground-dock', side: 'above' },
  base: { target: '.pw-dock-btn[data-dock="build"]', side: 'above' },
};

/**
 * The tutorial as coach marks: one small note in Kalam at a time, anchored by an arrow to what it
 * explains, which gets a 3px focus ring; "3 / 10", one sentence, the key, Skip tutorial. In flight
 * it never covers the centre of the screen (it is placed beside an edge widget, clamped to the edge).
 */
export class CoachMarks {
  private readonly el: HTMLElement;
  private key = '';
  private target: Element | null = null;

  constructor(private readonly root: HTMLElement, onSkip: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'coach-layer';
    root.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-act="skip-tutorial"]')) {
        e.stopPropagation();
        onSkip();
      }
    });
  }

  render(v: HudView): void {
    const t = v.tutorial;
    const hidden = !t || v.paused || v.result !== null;
    const anchor = t ? ANCHORS[t.id] : null;
    const target = !hidden && anchor ? [...this.root.querySelectorAll(anchor.target)].find((e) => (e as HTMLElement).offsetParent !== null) ?? null : null;
    if (target !== this.target) {
      this.target?.classList.remove('pw-coach-target');
      target?.classList.add('pw-coach-target');
      this.target = target;
    }
    toggle(this.el, !hidden && target !== null);
    if (hidden || !t || !anchor || !target) return;
    const key = JSON.stringify([t.step, t.id, t.text, t.keys]);
    if (key !== this.key) {
      this.key = key;
      const keys = t.keys.map((k) => glyph({ key: k }, { literal: true })).join('');
      const arrow = anchor.side === 'above' ? 'down' : anchor.side === 'below' ? 'up' : anchor.side === 'left' ? 'right' : 'left';
      this.el.innerHTML = coach({ step: `${count(t.step)} / ${count(t.total)}`, text: t.text, keysHtml: keys, skipLabel: T.tutorial.skip, arrow, name: T.say.tutorial });
    }
    this.place(target.getBoundingClientRect(), anchor.side);
  }

  private place(r: DOMRect, side: 'above' | 'right' | 'left' | 'below'): void {
    const note = this.el.firstElementChild as HTMLElement | null;
    if (!note) return;
    const w = note.offsetWidth;
    const h = note.offsetHeight;
    const gap = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = 0;
    let y = 0;
    if (side === 'above') {
      x = r.left + r.width / 2 - 28;
      y = r.top - h - gap;
    } else if (side === 'below') {
      x = r.left + r.width / 2 - 28;
      y = r.bottom + gap;
    } else if (side === 'left') {
      x = r.left - w - gap;
      y = r.top + r.height / 2 - 24;
    } else {
      x = r.right + gap;
      y = r.top + r.height / 2 - 24;
    }
    const cx = Math.max(16, Math.min(vw - w - 16, x));
    const cy = Math.max(16, Math.min(vh - h - 16, y));
    note.style.setProperty('--arrow-at', side === 'above' || side === 'below' ? `${Math.max(12, Math.min(w - 26, r.left + r.width / 2 - cx - 7))}px` : `${Math.max(12, Math.min(h - 26, r.top + r.height / 2 - cy - 7))}px`);
    this.el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  }
}


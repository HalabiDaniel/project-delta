import { AIRCRAFT, AIRCRAFT_ORDER } from '../config';
import { bind } from '../input/bindings';
import type { PerformanceBreakdown } from '../director/Performance';
import { CATEGORY_LABELS, type Category } from '../director/Templates';
import { ACHIEVEMENTS, BEST_LABELS, clock, type ProgressData } from '../progress/Progress';
import type { Ledger } from '../systems/Ledger';
import type { BaseStats } from '../base/Base';
import { bar, bindTabs, button, panelId, tabPanel, tabs } from './components';
import { bindButton, esc } from './dom';
import { icon, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
import { MISSION_TYPE_LABELS, SAY, T } from './strings';
import { count, date, km, minutesLong, num, paper as paperAmount, pct, timeOfDay, times } from './format';
import type { SessionView } from './views';

const L = T.logbook;
/** A loss or a gain in the ledger, in full: "−120", "+40", "0". */
const minus = (n: number): string => (n > 0 ? `−${paperAmount(n)}` : count(0));
const plus = (n: number): string => (n > 0 ? `+${paperAmount(n)}` : count(0));

export interface LogbookView {
  /** Career numbers in this browser (the HUD no longer shows them). */
  career: { missionsCompleted: number; planesLost: number; targetsDestroyed: number; defensesDestroyed: number; aircraftDestroyed: number; favorite: string | null };
  /** T1 as a base: what stands there and what it has been through. */
  base: {
    stats: BaseStats;
    production: number;
    capacity: number;
    protectedPaper: number;
    buildings: Array<{ name: string; icon: IconName; level: number; status: 'ok' | 'damaged' | 'destroyed'; kills: number; bombers: number; damage: number }>;
  };
  progress: ProgressData;
  session: SessionView;
  ledger: Ledger;
  performance: PerformanceBreakdown;
  skill: number;
  band: string;
  recommended: string;
}

export type LogbookTab = 'records' | 'base' | 'aircraft' | 'paper' | 'session';
type Tab = LogbookTab;
const TABS: Array<[Tab, string, IconName]> = [['records', T.logbook.tabs.records, 'medal'], ['base', T.logbook.tabs.base, 'base'], ['aircraft', T.logbook.tabs.aircraft, 'plane'], ['paper', T.logbook.tabs.paper, 'paper'], ['session', T.logbook.tabs.session, 'clock']];
const TABS_ID = 'logbook-tabs';

/** Filters: which achievements, which transactions. */
export type AchievementFilter = 'all' | 'earned' | 'locked';
export type PaperFilter = 'all' | 'in' | 'out';
interface Filters {
  ach: AchievementFilter;
  paper: PaperFilter;
}

/** A segmented filter: buttons with aria-pressed, the chosen one also underlined. */
function filterHtml(group: keyof Filters, chosen: string, items: Array<[string, string]>): string {
  return `<div class="lb-filter" role="group" aria-label="${esc(SAY.filter)}">${icon('more', 'icon', SAY.filter)}${items
    .map(([v, label]) => `<button type="button" class="lb-filter-btn" data-filter="${group}" data-v="${v}" aria-pressed="${v === chosen}">${esc(label)}</button>`)
    .join('')}</div>`;
}

/**
 * The logbook (L): personal bests, medals and achievements, each design's record, the paper log
 * with where paper came from and went, and this session so far. Everything here is saved locally.
 * Tabs switch with Q / E (LB / RB on a controller) or the highlight; the achievements and the
 * paper log can be filtered.
 */
export class Logbook {
  private readonly el: HTMLElement;
  private readonly panels: Record<Tab, HTMLElement>;
  private tab: Tab = 'records';
  private readonly filters: Filters = { ach: 'all', paper: 'all' };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(root: HTMLElement, private readonly view: () => LogbookView, close: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'logbook';
    this.el.hidden = true;
    this.el.innerHTML = `
      <section class="logbook-card ui-card" role="dialog" aria-labelledby="logbook-title" data-fold="none">
        <div class="logbook-head"><h2 id="logbook-title">${esc(SAY.logbook)}</h2>${this.tabsHtml()}${button({ label: SAY.close, icon: 'close', key: bind('back'), attrs: { 'data-close': '', 'data-act': 'close-logbook' } })}</div>
        ${TABS.map(([id]) => tabPanel({ tabsId: TABS_ID, tab: id, bodyHtml: '', selected: id === this.tab, className: 'logbook-body' })).join('')}
      </section>`;
    this.panels = Object.fromEntries(TABS.map(([id]) => [id, this.el.querySelector<HTMLElement>(`#${panelId(TABS_ID, id)}`)!])) as Record<Tab, HTMLElement>;
    bindTabs(this.el, (_list, tab) => {
      this.tab = tab as Tab;
      this.markDefault();
      this.render();
    });
    this.el.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest('button')) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const f = (e.target as Element).closest<HTMLElement>('[data-filter]');
      if (!f) return;
      if (f.dataset.filter === 'ach') this.filters.ach = f.dataset.v as AchievementFilter;
      else this.filters.paper = f.dataset.v as PaperFilter;
      this.render();
    });
    bindButton(this.el.querySelector<HTMLElement>('[data-close]')!, close);
    this.el.addEventListener('click', (e) => e.target === this.el && close());
    root.appendChild(this.el);
    this.markDefault();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** The tab showing (tests). */
  get currentTab(): Tab {
    return this.tab;
  }

  toggle(open = !this.open): void {
    const was = this.open;
    this.el.hidden = !open;
    if (this.timer) clearInterval(this.timer);
    this.timer = open ? setInterval(() => this.render(), 600) : null;
    if (open) this.render();
    // Opening puts the highlight on the chosen tab; closing returns it to what opened the logbook.
    if (open && !was) focusManager()?.openPanel(this.el);
    if (!open && was) focusManager()?.closePanel(this.el);
  }

  private tabsHtml(): string {
    return tabs({
      id: TABS_ID, label: SAY.logbook,
      tabs: TABS.map(([id, label, i]) => ({ id, label, icon: i, selected: id === this.tab })),
      prev: { key: bind('prevAircraft').key, pad: 'lb' }, next: { key: bind('nextAircraft').key, pad: 'rb' },
    });
  }

  /** The chosen tab is where the highlight starts. */
  private markDefault(): void {
    for (const t of this.el.querySelectorAll<HTMLElement>('[role="tab"]')) t.toggleAttribute('data-nav-default', t.dataset.tab === this.tab);
  }

  private render(): void {
    const v = this.view();
    const html = this.tab === 'records' ? records(v, this.filters.ach) : this.tab === 'base' ? base(v) : this.tab === 'aircraft' ? aircraft(v) : this.tab === 'paper' ? paper(v, this.filters.paper) : session(v);
    const body = this.panels[this.tab];
    if (body.dataset.html !== html) {
      body.dataset.html = html;
      body.innerHTML = html;
    }
  }
}

function records(v: LogbookView, filter: AchievementFilter = 'all'): string {
  const b = v.progress.bests;
  const row = (label: string, value: string) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const bests = [
    row(BEST_LABELS.fastestBombing, b.fastestBombing ? `${clock(b.fastestBombing.time)} <small>${esc(b.fastestBombing.title)}</small>` : '—'),
    row(BEST_LABELS.bestBombAccuracy, b.bestBombAccuracy ? `${esc(T.logbook.accuracyOf(pct(b.bestBombAccuracy.accuracy), b.bestBombAccuracy.bombs))} <small>${esc(b.bestBombAccuracy.title)}</small>` : '—'),
    row(BEST_LABELS.longestFlight, b.longestFlight ? `${km(b.longestFlight.distance, 2)} <small>${esc(AIRCRAFT[b.longestFlight.aircraft].name)}</small>` : '—'),
    row(BEST_LABELS.mostKills, b.mostKills ? `${count(b.mostKills.count)} <small>${esc(b.mostKills.title)}</small>` : '—'),
    row(BEST_LABELS.cleanRun, count(b.cleanRun)),
    row(L.longestStreak, count(v.progress.streak.best)),
    row(L.medals, (['gold', 'silver', 'bronze'] as const).map((m) => `<span class="medal-n" data-medal="${m}" role="img" aria-label="${esc(L.medalCount(L.medal[m], v.progress.medals[m]))}">${icon('medal')}<b class="num">${count(v.progress.medals[m])}</b></span>`).join('')),
    row(L.safeLandings, count(v.progress.landings)),
    row(L.suitsYou, `${esc(v.recommended)} <small>${esc(L.suitsYouNote)}</small>`),
    row(L.missionsCompleted, count(v.career.missionsCompleted)),
    row(L.planesLost, count(v.career.planesLost)),
    row(L.targetsDestroyed, count(v.career.targetsDestroyed)),
    row(L.defensesDestroyed, count(v.career.defensesDestroyed)),
    row(L.aircraftShotDown, count(v.career.aircraftDestroyed)),
    row(L.favouritePlane, esc(v.career.favorite ?? '—')),
  ].join('');
  const unlocked = ACHIEVEMENTS.filter((a) => v.progress.achievements[a.id] !== undefined).length;
  const achievements = ACHIEVEMENTS.filter((a) => {
    const got = v.progress.achievements[a.id] !== undefined;
    return filter === 'all' || (filter === 'earned') === got;
  }).map((a) => {
    const at = v.progress.achievements[a.id];
    return `<li class="${at !== undefined ? 'got' : ''}"><b>${icon(at !== undefined ? 'medal' : 'lock', 'icon', at !== undefined ? SAY.earned : SAY.locked)} ${esc(a.title)}</b><span>${esc(a.detail)}</span>${at !== undefined ? `<small>${date(at)}</small>` : ''}</li>`;
  }).join('');
  return `<div class="lb-cols"><section><h3>${esc(L.personalBests)}</h3><dl class="ledger">${bests}</dl></section>
    <section><div class="lb-section-head"><h3>${esc(L.achievements)} <small>${count(unlocked)}/${count(ACHIEVEMENTS.length)}</small></h3>${filterHtml('ach', filter, [['all', SAY.all], ['earned', SAY.earned], ['locked', SAY.locked]])}</div>${bar({ value: unlocked / Math.max(1, ACHIEVEMENTS.length), label: L.achievementsCount(unlocked, ACHIEVEMENTS.length), kind: 'progress', segments: 0, className: 'lb-progress' })}<ul class="achievements">${achievements || '<li class="muted">—</li>'}</ul></section></div>`;
}

function base(v: LogbookView): string {
  const b = v.base;
  const s = b.stats;
  const row = (label: string, value: string) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const status = { ok: L.statusOk, damaged: L.statusDamaged, destroyed: L.statusDestroyed };
  const buildings = b.buildings.length
    ? b.buildings.map((x) => `<tr><th>${icon(x.icon)} ${esc(x.name)}</th><td>${'★'.repeat(x.level)}</td><td class="${x.status === 'ok' ? 'good' : 'bad'}">${esc(status[x.status])}</td><td>${count(x.kills)}</td><td>${count(x.bombers)}</td><td>${count(x.damage)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="muted">${esc(L.nothingBuilt)}</td></tr>`;
  return `<div class="lb-cols"><section><h3>${esc(L.t1Now)}</h3><dl class="ledger">
      ${row(L.paperPerMinute, num(b.production, 1))}
      ${row(L.capacity, paperAmount(b.capacity))}
      ${row(L.protectedFromRaids, paperAmount(b.protectedPaper))}
    </dl>
    <h3>${esc(L.buildings)}</h3><table class="lb-table"><thead><tr><th></th><th>${esc(L.level)}</th><th>${esc(L.state)}</th><th>${esc(L.shotDown)}</th><th>${esc(L.bombers)}</th><th>${esc(L.damage)}</th></tr></thead><tbody>${buildings}</tbody></table></section>
    <section><h3>${esc(L.raidsAndBuilding)}</h3><dl class="ledger">
      ${row(L.raidsOnT1, count(s.raids))}
      ${row(L.raidsRepelled, count(s.repelled))}
      ${row(L.bombersByDefenses, count(s.bombersDowned))}
      ${row(L.aircraftByDefenses, count(s.aircraftDowned))}
      ${row(L.paperLostToAttacks, minus(s.paperLost))}
      ${row(L.paperOnConstruction, minus(s.construction))}
      ${row(L.paperOnRepairs, minus(s.repairCosts))}
      ${row(L.paperByWorkshops, `+${paperAmount(s.workshopPaper)}`)}
      ${row(L.structuresRepaired, count(s.repairs))}
      ${row(L.refunds, plus(s.refunds))}
    </dl></section></div>`;
}

function aircraft(v: LogbookView): string {
  const rows = AIRCRAFT_ORDER.map((id) => {
    const m = v.progress.mastery[id];
    const spec = AIRCRAFT[id];
    if (!m || m.flights === 0) return `<tr><th>${esc(spec.name)}</th><td colspan="7" class="muted">${esc(L.notFlown)}</td></tr>`;
    const share = (a: number, b: number) => (b > 0 ? pct(a / b) : '—');
    const best = (Object.entries(m.byCategory) as Array<[Category, number]>).sort((a, b) => b[1] - a[1])[0];
    return `<tr><th>${esc(spec.name)}</th><td>${count(m.flights)}</td><td>${count(m.missions)}</td><td>${count(m.lost)}</td><td>${share(m.shotsHit, m.shotsFired)}</td><td>${share(m.bombHits, m.bombsDropped)}</td><td>${count(m.kills)}</td>
      <td>${best ? esc(L.mostDone(best[1], CATEGORY_LABELS[best[0]])) : '—'}</td></tr>`;
  }).join('');
  return `<p class="muted">${esc(L.designsNote)}</p>
    <table class="lb-table"><thead><tr><th></th><th>${esc(L.flights)}</th><th>${esc(L.missionsDone)}</th><th>${esc(L.lost)}</th><th>${esc(L.inkAccuracy)}</th><th>${esc(L.bombAccuracy)}</th><th>${esc(L.shotDown)}</th><th>${esc(L.mostDoneHead)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function paper(v: LogbookView, filter: PaperFilter = 'all'): string {
  const l = v.ledger;
  const log = l.recent(30).filter((e) => filter === 'all' || (filter === 'in') === e.delta > 0).map((e) => `<tr><td>${timeOfDay(e.at)}</td><td>${esc(e.source === 'income' ? L.homeProduction(e.count) : e.label)}</td><td class="${e.delta > 0 ? 'good' : 'bad'}">${e.delta > 0 ? '+' : '−'}${paperAmount(Math.abs(e.delta))}</td><td>${paperAmount(e.balance)}</td></tr>`).join('');
  const t = l.totals;
  const eff = (rows: Array<[string, { sorties: number; successes: number; lost: number; spent: number; earned: number }]>) =>
    rows.map(([name, e]) => `<tr><th>${esc(name)}</th><td>${count(e.sorties)}</td><td>${count(e.successes)}</td><td>${count(e.lost)}</td><td>−${paperAmount(e.spent)}</td><td>+${paperAmount(e.earned)}</td><td>${e.spent > 0 ? times(e.earned / e.spent) : '—'}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">${esc(L.noSorties)}</td></tr>`;
  const head = `<thead><tr><th></th>${[L.sorties, L.done, L.lost, L.spent, L.earned, L.return].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  return `<div class="lb-cols"><section><div class="lb-section-head"><h3>${esc(L.recentTransactions)}</h3>${filterHtml('paper', filter, [['all', SAY.all], ['in', SAY.paperIn], ['out', SAY.paperOut]])}</div><table class="lb-table">${log || `<tr><td class="muted">${esc(L.nothingYet)}</td></tr>`}</table></section>
    <section><h3>${esc(L.totals)}</h3><dl class="ledger"><div><dt>${esc(L.earnedAll)}</dt><dd>+${paperAmount(t.earned)}</dd></div><div><dt>${esc(L.ofWhichHome)}</dt><dd>+${paperAmount(t.income)}</dd></div><div><dt>${esc(L.ofWhichBonuses)}</dt><dd>+${paperAmount(t.bonuses)}</dd></div><div><dt>${esc(L.spentOnPlanes)}</dt><dd>−${paperAmount(t.spent)}</dd></div><div><dt>${esc(L.lostToRaids)}</dt><dd>−${paperAmount(t.raids)}</dd></div></dl>
    <h3>${esc(L.byAircraft)}</h3><table class="lb-table">${head}<tbody>${eff(AIRCRAFT_ORDER.filter((id) => l.byAircraft.has(id)).map((id) => [AIRCRAFT[id].name, l.byAircraft.get(id)!]))}</tbody></table>
    <h3>${esc(L.byMissionType)}</h3><table class="lb-table">${head}<tbody>${eff([...l.byType].map(([type, e]) => [MISSION_TYPE_LABELS[type], e]))}</tbody></table></section></div>`;
}

function session(v: LogbookView): string {
  const s = v.session;
  return `<dl class="ledger session wide">
    <div><dt>${esc(L.missionsCompleted)}</dt><dd>${count(s.missionsCompleted)}${s.missionsFailed ? ` ${esc(L.failedCount(s.missionsFailed))}` : ''}</dd></div>
    <div><dt>${esc(L.paperEarned)}</dt><dd>+${paperAmount(s.paperEarned)}</dd></div>
    <div><dt>${esc(L.paperSpent)}</dt><dd>−${paperAmount(s.paperSpent)}</dd></div>
    <div><dt>${esc(L.aircraftLost)}</dt><dd>${count(s.aircraftLost)}</dd></div>
    <div><dt>${esc(L.enemiesDestroyed)}</dt><dd>${count(s.enemiesDestroyed)}</dd></div>
    <div><dt>${esc(L.bestPerformance)}</dt><dd>${esc(s.best)}</dd></div>
    <div><dt>${esc(L.timePlayed)}</dt><dd>${minutesLong(s.minutes)}</dd></div>
  </dl>${s.achievements.length ? `<p class="session-ach">${icon('medal')} ${s.achievements.map(esc).join(' · ')}</p>` : ''}`;
}

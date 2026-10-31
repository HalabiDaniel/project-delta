import { AIRCRAFT, AIRCRAFT_ORDER } from '../config';
import type { PerformanceBreakdown } from '../director/Performance';
import { CATEGORY_LABELS, type Category } from '../director/Templates';
import { ACHIEVEMENTS, BEST_LABELS, clock, type ProgressData } from '../progress/Progress';
import type { Ledger } from '../systems/Ledger';
import type { BaseStats } from '../base/Base';
import { bindButton, esc } from './dom';
import { icon, type IconName } from './icons';
import { MISSION_TYPE_LABELS } from './strings';
import type { SessionView } from './views';

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

type Tab = 'records' | 'base' | 'aircraft' | 'paper' | 'session';
const TABS: Array<[Tab, string]> = [['records', 'Records'], ['base', 'Base'], ['aircraft', 'Aircraft'], ['paper', 'Paper'], ['session', 'Session']];

/**
 * The logbook (L): personal bests, medals and achievements, each design's record, the paper log
 * with where paper came from and went, and this session so far. Everything here is saved locally.
 */
export class Logbook {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private tab: Tab = 'records';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(root: HTMLElement, private readonly view: () => LogbookView, close: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'logbook';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="logbook-card">
        <div class="logbook-head"><h2>Logbook</h2><div class="tabs">${TABS.map(([id, label]) => `<button class="tab" data-tab="${id}">${label}</button>`).join('')}</div><button class="btn ghost" data-close>Close <kbd>Esc</kbd></button></div>
        <div class="logbook-body"></div>
      </div>`;
    this.body = this.el.querySelector('.logbook-body')!;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tab]')) {
      bindButton(b, () => {
        this.tab = b.dataset.tab as Tab;
        this.render();
      });
    }
    bindButton(this.el.querySelector('[data-close]')!, close);
    this.el.addEventListener('click', (e) => e.target === this.el && close());
    root.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open;
    if (this.timer) clearInterval(this.timer);
    this.timer = open ? setInterval(() => this.render(), 600) : null;
    if (open) this.render();
  }

  private render(): void {
    const v = this.view();
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.tab);
    const html = this.tab === 'records' ? records(v) : this.tab === 'base' ? base(v) : this.tab === 'aircraft' ? aircraft(v) : this.tab === 'paper' ? paper(v) : session(v);
    if (this.body.dataset.html !== html) {
      this.body.dataset.html = html;
      this.body.innerHTML = html;
    }
  }
}

function records(v: LogbookView): string {
  const b = v.progress.bests;
  const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const bests = [
    row(BEST_LABELS.fastestBombing, b.fastestBombing ? `${clock(b.fastestBombing.time)} <small>${esc(b.fastestBombing.title)}</small>` : '—'),
    row(BEST_LABELS.bestBombAccuracy, b.bestBombAccuracy ? `${Math.round(b.bestBombAccuracy.accuracy * 100)}% of ${b.bestBombAccuracy.bombs} <small>${esc(b.bestBombAccuracy.title)}</small>` : '—'),
    row(BEST_LABELS.longestFlight, b.longestFlight ? `${(b.longestFlight.distance / 1000).toFixed(2)} km <small>${AIRCRAFT[b.longestFlight.aircraft].name}</small>` : '—'),
    row(BEST_LABELS.mostKills, b.mostKills ? `${b.mostKills.count} <small>${esc(b.mostKills.title)}</small>` : '—'),
    row(BEST_LABELS.cleanRun, String(b.cleanRun)),
    row('Longest mission streak', String(v.progress.streak.best)),
    row('Medals', `🥇 ${v.progress.medals.gold} · 🥈 ${v.progress.medals.silver} · 🥉 ${v.progress.medals.bronze}`),
    row('Safe landings', String(v.progress.landings)),
    row('Difficulty that suits you now', `${v.recommended} <small>(the director's guess: harder cards are always there if you want them)</small>`),
    row('Missions completed', String(v.career.missionsCompleted)),
    row('Planes lost', String(v.career.planesLost)),
    row('Targets destroyed', String(v.career.targetsDestroyed)),
    row('Defenses destroyed', String(v.career.defensesDestroyed)),
    row('Aircraft shot down', String(v.career.aircraftDestroyed)),
    row('Favourite plane', v.career.favorite ?? '—'),
  ].join('');
  const unlocked = ACHIEVEMENTS.filter((a) => v.progress.achievements[a.id] !== undefined).length;
  const achievements = ACHIEVEMENTS.map((a) => {
    const at = v.progress.achievements[a.id];
    return `<li class="${at !== undefined ? 'got' : ''}"><b>${at !== undefined ? '🏆' : '🔒'} ${esc(a.title)}</b><span>${esc(a.detail)}</span>${at !== undefined ? `<small>${new Date(at).toLocaleDateString()}</small>` : ''}</li>`;
  }).join('');
  return `<div class="lb-cols"><section><h3>Personal bests</h3><dl class="ledger">${bests}</dl></section>
    <section><h3>Achievements <small>${unlocked}/${ACHIEVEMENTS.length}</small></h3><ul class="achievements">${achievements}</ul></section></div>`;
}

function base(v: LogbookView): string {
  const b = v.base;
  const s = b.stats;
  const row = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const status = { ok: '✓', damaged: 'Damaged', destroyed: 'Wrecked' };
  const buildings = b.buildings.length
    ? b.buildings.map((x) => `<tr><th>${icon(x.icon)} ${esc(x.name)}</th><td>${'★'.repeat(x.level)}</td><td class="${x.status === 'ok' ? 'good' : 'bad'}">${status[x.status]}</td><td>${x.kills}</td><td>${x.bombers}</td><td>${x.damage}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">Nothing built yet</td></tr>';
  return `<div class="lb-cols"><section><h3>T1 now</h3><dl class="ledger">
      ${row('Paper per minute', String(Math.round(b.production * 10) / 10))}
      ${row('Capacity', String(b.capacity))}
      ${row('Protected from raids', String(b.protectedPaper))}
    </dl>
    <h3>Buildings</h3><table class="lb-table"><thead><tr><th></th><th>Level</th><th>State</th><th>Shot down</th><th>Bombers</th><th>Damage</th></tr></thead><tbody>${buildings}</tbody></table></section>
    <section><h3>Raids and building</h3><dl class="ledger">
      ${row('Raids on T1', String(s.raids))}
      ${row('Raids repelled', String(s.repelled))}
      ${row('Bombers destroyed by defenses', String(s.bombersDowned))}
      ${row('Aircraft destroyed by defenses', String(s.aircraftDowned))}
      ${row('Paper lost to attacks', s.paperLost > 0 ? `−${s.paperLost}` : '0')}
      ${row('Paper spent on construction', s.construction > 0 ? `−${s.construction}` : '0')}
      ${row('Paper spent on repairs', s.repairCosts > 0 ? `−${s.repairCosts}` : '0')}
      ${row('Paper made by workshops', `+${Math.round(s.workshopPaper)}`)}
      ${row('Structures repaired', String(s.repairs))}
      ${row('Refunds for removed buildings', s.refunds > 0 ? `+${s.refunds}` : '0')}
    </dl></section></div>`;
}

function aircraft(v: LogbookView): string {
  const rows = AIRCRAFT_ORDER.map((id) => {
    const m = v.progress.mastery[id];
    const spec = AIRCRAFT[id];
    if (!m || m.flights === 0) return `<tr><th>${spec.name}</th><td colspan="7" class="muted">Not flown yet</td></tr>`;
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
    const best = (Object.entries(m.byCategory) as Array<[Category, number]>).sort((a, b) => b[1] - a[1])[0];
    return `<tr><th>${spec.name}</th><td>${m.flights}</td><td>${m.missions}</td><td>${m.lost}</td><td>${pct(m.shotsHit, m.shotsFired)}</td><td>${pct(m.bombHits, m.bombsDropped)}</td><td>${m.kills}</td>
      <td>${best ? `${best[1]} ${CATEGORY_LABELS[best[0]].toLowerCase()}` : '—'}</td></tr>`;
  }).join('');
  return `<p class="muted">Each design's record. Statistics only: nothing unlocks, every plane stays as it is.</p>
    <table class="lb-table"><thead><tr><th></th><th>Flights</th><th>Missions done</th><th>Lost</th><th>Ink accuracy</th><th>Bomb accuracy</th><th>Shot down</th><th>Most done</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function paper(v: LogbookView): string {
  const l = v.ledger;
  const log = l.recent(30).map((e) => `<tr><td>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(e.source === 'income' ? `Home production (${e.count} payouts)` : e.label)}</td><td class="${e.delta > 0 ? 'good' : 'bad'}">${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)}</td><td>${e.balance}</td></tr>`).join('');
  const t = l.totals;
  const eff = (rows: Array<[string, { sorties: number; successes: number; lost: number; spent: number; earned: number }]>) =>
    rows.map(([name, e]) => `<tr><th>${esc(name)}</th><td>${e.sorties}</td><td>${e.successes}</td><td>${e.lost}</td><td>−${e.spent}</td><td>+${e.earned}</td><td>${e.spent > 0 ? `${(e.earned / e.spent).toFixed(1)}×` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No sorties yet</td></tr>';
  const head = '<thead><tr><th></th><th>Sorties</th><th>Done</th><th>Lost</th><th>Spent</th><th>Earned</th><th>Return</th></tr></thead>';
  return `<div class="lb-cols"><section><h3>Recent transactions</h3><table class="lb-table">${log || '<tr><td class="muted">Nothing yet</td></tr>'}</table></section>
    <section><h3>Totals</h3><dl class="ledger"><div><dt>Earned (all sources)</dt><dd>+${t.earned}</dd></div><div><dt>Of which home production</dt><dd>+${t.income}</dd></div><div><dt>Of which bonuses</dt><dd>+${t.bonuses}</dd></div><div><dt>Spent on planes</dt><dd>−${t.spent}</dd></div><div><dt>Lost to raids</dt><dd>−${t.raids}</dd></div></dl>
    <h3>By aircraft</h3><table class="lb-table">${head}<tbody>${eff(AIRCRAFT_ORDER.filter((id) => l.byAircraft.has(id)).map((id) => [AIRCRAFT[id].name, l.byAircraft.get(id)!]))}</tbody></table>
    <h3>By mission type</h3><table class="lb-table">${head}<tbody>${eff([...l.byType].map(([type, e]) => [MISSION_TYPE_LABELS[type], e]))}</tbody></table></section></div>`;
}

function session(v: LogbookView): string {
  const s = v.session;
  return `<dl class="ledger session wide">
    <div><dt>Missions completed</dt><dd>${s.missionsCompleted}${s.missionsFailed ? ` (${s.missionsFailed} failed)` : ''}</dd></div>
    <div><dt>Paper earned</dt><dd>+${s.paperEarned}</dd></div>
    <div><dt>Paper spent</dt><dd>−${s.paperSpent}</dd></div>
    <div><dt>Aircraft lost</dt><dd>${s.aircraftLost}</dd></div>
    <div><dt>Enemies destroyed</dt><dd>${s.enemiesDestroyed}</dd></div>
    <div><dt>Best performance</dt><dd>${esc(s.best)}</dd></div>
    <div><dt>Time played</dt><dd>${s.minutes} min</dd></div>
  </dl>${s.achievements.length ? `<p class="session-ach">🏆 ${s.achievements.map(esc).join(' · ')}</p>` : ''}`;
}

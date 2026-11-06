import { button, card, chip, stat, type Tone } from './components';
import { bind } from '../input/bindings';
import { attr, bindButton, esc, text, toggle } from './dom';
import { clock, fmt, pct, signed } from './format';
import { icon, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
import { SAY } from './strings';
import type { ResultView } from './views';

/**
 * The sortie report: the result and medal up top, four big numbers (net paper, kills, damage,
 * time), records and achievements as chips, and the full breakdown behind Details. Continue
 * (Enter / A) has the highlight when it opens.
 */
export class ReportCard {
  private readonly el: HTMLElement;
  private readonly q: Record<string, HTMLElement> = {};
  private open = false;
  private key = '';
  private shown = false;

  constructor(host: HTMLElement, onContinue: () => void) {
    host.insertAdjacentHTML('beforeend', card({
      className: 'report', label: SAY.report, elevation: 'floating',
      bodyHtml: /* html */ `
      <div class="rp-head"><span class="rp-icon" data-r="icon"></span><b class="rp-title" data-r="title"></b><span class="medal" data-r="medal"></span></div>
      <div class="rp-mission" data-r="mission"></div>
      <div class="rp-why" data-r="why"></div>
      <div class="rp-big" data-r="big"></div>
      <ul class="rp-paper" data-r="paper"></ul>
      <div class="rp-next" data-r="next"></div>
      <div class="rp-chips" data-r="chips"></div>
      <div class="rp-foot">${button({ label: SAY.details, icon: 'more', size: 'small', className: 'rp-toggle', attrs: { 'data-r': 'toggle', 'aria-expanded': 'false', 'aria-controls': 'rp-details' } })}
        ${button({ label: SAY.continue, variant: 'primary', key: bind('confirm'), attrs: { 'data-r': 'continue', 'data-nav-default': '' } })}</div>
      <dl class="rp-details" id="rp-details" data-r="details"></dl>`,
    }));
    this.el = host.lastElementChild as HTMLElement;
    for (const n of this.el.querySelectorAll<HTMLElement>('[data-r]')) this.q[n.dataset.r!] = n;
    bindButton(this.q.continue, onContinue);
    bindButton(this.q.toggle, () => {
      this.open = !this.open;
      this.key = '';
    });
  }

  render(r: ResultView | null, paused: boolean): void {
    const visible = r !== null && !paused;
    toggle(this.el, visible);
    if (visible !== this.shown) {
      this.shown = visible;
      if (visible) focusManager()?.openPanel(this.el);
      else focusManager()?.closePanel(this.el);
    }
    if (!r) {
      this.open = false;
      return;
    }
    const net = r.paperEarned - r.paperSpent - r.paperLost;
    const key = JSON.stringify([r, this.open]);
    if (key === this.key) return;
    this.key = key;
    attr(this.el, 'data-tone', r.missionTone === 'good' ? 'good' : 'hostile');
    this.q.icon.innerHTML = icon(r.recovered ? 'home' : 'crumple');
    const failed = r.missionLine.replace(/^Failed: /, '');
    text(this.q.title, r.missionTone === 'good' ? 'Mission complete' : failed.charAt(0).toUpperCase() + failed.slice(1));
    attr(this.q.title, 'data-tip', `${r.headline} · ${r.survival}`);
    const medalName = r.medal ? `${r.medal.charAt(0).toUpperCase()}${r.medal.slice(1)}` : '';
    const next = r.medal === 'bronze' ? 'silver' : r.medal === 'silver' ? 'gold' : null;
    const medalTip = r.criteria ? (next ? `Next, ${next}: ${r.criteria[next]}` : r.criteria.gold) : '';
    this.q.medal.innerHTML = r.medal ? `${icon('medal')}<b>${medalName}</b>` : '';
    attr(this.q.medal, 'data-medal', r.medal ?? 'none');
    attr(this.q.medal, 'data-tip', medalTip);
    attr(this.q.medal, 'aria-label', medalName);
    toggle(this.q.medal, r.medal !== null);
    this.q.mission.innerHTML = `${esc(r.missionTitle)} · ${icon('plane')}<b>${esc(r.aircraftName)}</b> ${icon(r.recovered ? 'health' : 'wrecked')}<b class="num">${r.recovered ? pct(r.health) : '0%'}</b>`;
    attr(this.q.mission, 'data-tip', r.planeLine);

    // Why it failed, and what to try: in plain words, not only a headline.
    toggle(this.q.why, r.failure !== null);
    this.q.why.innerHTML = r.failure ? `<span>${esc(r.failure.why)}</span><span class="rp-advice">${icon('tip')}${esc(r.failure.advice)}</span>` : '';
    // Where the paper came from and went.
    this.q.paper.innerHTML = r.paper
      .map((l) => `<li data-tone="${l.amount > 0 ? 'good' : 'bad'}"><span>${esc(l.label)}</span><b class="num">${signed(l.amount)}</b></li>`)
      .join('') + (r.paper.length > 1 ? `<li class="rp-total"><span>Net</span><b class="num">${signed(net)}</b></li>` : '');
    toggle(this.q.paper, r.paper.length > 0);
    text(this.q.next, r.next);
    toggle(this.q.next, r.next.length > 0);

    // The four big numbers.
    const big = (iconName: IconName, value: string, label: string, tone?: Tone) => `<div class="rp-tile">${stat({ icon: iconName, value, label, tone })}</div>`;
    const kills = r.aircraftDestroyed + r.defensesDestroyed + r.targetsDestroyed;
    this.q.big.innerHTML = [
      big('paper', signed(net), 'Net paper', net > 0 ? 'good' : net < 0 ? 'hostile' : undefined),
      big('kills', String(kills), `Destroyed: ${r.aircraftDestroyed} aircraft, ${r.defensesDestroyed} defenses, ${r.targetsDestroyed} targets`),
      big('damage', fmt(r.damageDealt), 'Damage dealt'),
      big('clock', clock(r.time), 'Time'),
    ].join('');

    const chips = [
      ...r.bonuses.map((b) => chip({ label: '', icon: 'level', value: `+${b.amount}`, tone: 'good', tip: b.label })),
      ...(r.operation ? [chip({ label: r.operation.split(':')[0], icon: 'radar', tip: r.operation })] : []),
      ...(r.streak >= 2 ? [chip({ label: '', icon: 'streak', value: String(r.streak), tone: 'streak', tip: 'Missions in a row' })] : []),
      ...r.records.map((x) => chip({ label: x, icon: 'reach', tone: 'good', tip: `New best: ${x}` })),
      ...r.achievements.map((a) => chip({ label: a.title, icon: 'medal', tone: 'gold', tip: a.detail })),
      ...(r.paperOverflow > 0 ? [chip({ label: '', icon: 'capacity', value: `−${r.paperOverflow}`, tone: 'warn', tip: 'Storage was full: build or upgrade storage boxes' })] : []),
    ].join('');
    this.q.chips.innerHTML = chips;
    toggle(this.q.chips, chips.length > 0);

    this.q.toggle.classList.toggle('open', this.open);
    attr(this.q.toggle, 'aria-expanded', String(this.open));
    toggle(this.q.details, this.open);
    if (this.open) {
      const row = (iconName: IconName, label: string, value: string, tone = '') => `<div><dt>${icon(iconName)}${esc(label)}</dt><dd class="num" data-tone="${tone}">${value}</dd></div>`;
      const ratio = (a: number, b: number) => (b > 0 ? `${a}/${b} · ${pct(a / b)}` : '—');
      this.q.details.innerHTML = [
        row('health', 'Aircraft', esc(r.survival), r.survived ? 'good' : 'bad'),
        row('damage', 'Damage dealt', fmt(r.damageDealt)),
        row('health', 'Damage taken', fmt(r.damageTaken)),
        row('turret', 'Defenses destroyed', String(r.defensesDestroyed)),
        row('kills', 'Aircraft shot down', String(r.aircraftDestroyed)),
        row('bomber', 'Bombers intercepted', String(r.bombersIntercepted)),
        row('shield', 'Objectives protected', String(r.objectivesProtected)),
        row('recon', 'Enemy fire dodged', r.enemyShots > 0 ? ratio(r.enemyShots - r.enemyHits, r.enemyShots) : '—'),
        row('bomb', 'Bombs on target', ratio(r.bombHits, r.bombsDropped)),
        row('ink', 'Ink hits', ratio(r.shotsHit, r.shotsFired)),
        row('paper', 'Paper spent', r.paperSpent > 0 ? `−${r.paperSpent}` : '0', r.paperSpent > 0 ? 'bad' : ''),
        row('paper', 'Paper earned', r.paperEarned > 0 ? `+${r.paperEarned}` : '0', r.paperEarned > 0 ? 'good' : ''),
        ...(r.paperLost > 0 ? [row('raid', 'Lost to raids', `−${r.paperLost}`, 'bad')] : []),
      ].join('');
    }
  }
}


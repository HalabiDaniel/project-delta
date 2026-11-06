import { button, card, chip, stat, type Tone } from './components';
import { bind } from '../input/bindings';
import { attr, bindButton, esc, text, toggle } from './dom';
import { clock, count, fmt, paper, pct, signed } from './format';
import { icon, type IconName } from './icons';
import { focusManager } from '../input/FocusNav';
import { SAY, STYLE_TEXT, T } from './strings';
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
      <div class="rp-head"><span class="rp-icon" data-r="icon"></span><span class="rp-kicker" data-r="kicker"></span><b class="rp-title" data-r="title"></b><span class="medal" data-r="medal"></span></div>
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
    // The style guide's ResultDialog: home safe or crumpled above a big title.
    text(this.q.kicker, r.recovered ? STYLE_TEXT.homeSafe : STYLE_TEXT.crumpled);
    attr(this.q.kicker, 'data-tone', r.recovered ? 'good' : 'bad');
    // The failure's own headline ("Out of bombs"), never cut out of the English mission line.
    text(this.q.title, r.missionTone === 'good' || !r.failure ? STYLE_TEXT.missionDone : r.failure.title);
    attr(this.q.title, 'data-tip', T.common.dot([r.headline, r.survival]));
    const medalName = r.medal ? T.report.medal[r.medal] : '';
    const next = r.medal === 'bronze' ? 'silver' : r.medal === 'silver' ? 'gold' : null;
    const medalTip = r.criteria ? (next ? T.report.nextMedal(T.report.medalId[next], r.criteria[next]) : r.criteria.gold) : '';
    this.q.medal.innerHTML = r.medal ? `${icon('medal')}<b>${esc(medalName)}</b>` : '';
    attr(this.q.medal, 'data-medal', r.medal ?? 'none');
    attr(this.q.medal, 'data-tip', medalTip);
    attr(this.q.medal, 'aria-label', medalName);
    toggle(this.q.medal, r.medal !== null);
    this.q.mission.innerHTML = `${esc(r.missionTitle)} · ${icon('plane')}<b>${esc(r.aircraftName)}</b> ${icon(r.recovered ? 'health' : 'wrecked')}<b class="num">${pct(r.recovered ? r.health : 0)}</b>`;
    attr(this.q.mission, 'data-tip', r.planeLine);

    // Why it failed, and what to try: in plain words, not only a headline.
    toggle(this.q.why, r.failure !== null);
    this.q.why.innerHTML = r.failure ? `<span>${esc(r.failure.why)}</span><span class="rp-advice">${icon('tip')}${esc(r.failure.advice)}</span>` : '';
    // Where the paper came from and went.
    this.q.paper.innerHTML = r.paper
      .map((l) => `<li data-tone="${l.amount > 0 ? 'good' : 'bad'}"><span>${esc(l.label)}</span><b class="num">${signed(l.amount)}</b></li>`)
      .join('') + (r.paper.length > 1 ? `<li class="rp-total"><span>${esc(T.report.net)}</span><b class="num">${signed(net)}</b></li>` : '');
    toggle(this.q.paper, r.paper.length > 0);
    text(this.q.next, r.next);
    toggle(this.q.next, r.next.length > 0);

    // The four big numbers.
    const big = (iconName: IconName, value: string, label: string, tone?: Tone) => `<div class="rp-tile">${stat({ icon: iconName, value, label, tone })}</div>`;
    const kills = r.aircraftDestroyed + r.defensesDestroyed + r.targetsDestroyed;
    this.q.big.innerHTML = [
      big('paper', signed(net), T.report.netPaper, net > 0 ? 'good' : net < 0 ? 'hostile' : undefined),
      big('kills', count(kills), T.report.destroyed(r.aircraftDestroyed, r.defensesDestroyed, r.targetsDestroyed)),
      big('damage', fmt(r.damageDealt), T.report.damageDealt),
      big('clock', clock(r.time), T.report.time),
    ].join('');

    const chips = [
      ...r.bonuses.map((b) => chip({ label: '', icon: 'level', value: `+${paper(b.amount)}`, tone: 'good', tip: b.label })),
      ...(r.operation ? [chip({ label: r.operation.split(':')[0], icon: 'radar', tip: r.operation })] : []),
      ...(r.streak >= 2 ? [chip({ label: '', icon: 'streak', value: count(r.streak), tone: 'streak', tip: T.report.streak })] : []),
      ...r.records.map((x) => chip({ label: x, icon: 'reach', tone: 'good', tip: T.report.newBest(x) })),
      ...r.achievements.map((a) => chip({ label: a.title, icon: 'medal', tone: 'gold', tip: a.detail })),
      ...(r.paperOverflow > 0 ? [chip({ label: '', icon: 'capacity', value: `−${paper(r.paperOverflow)}`, tone: 'warn', tip: T.report.overflow })] : []),
    ].join('');
    this.q.chips.innerHTML = chips;
    toggle(this.q.chips, chips.length > 0);

    this.q.toggle.classList.toggle('open', this.open);
    attr(this.q.toggle, 'aria-expanded', String(this.open));
    toggle(this.q.details, this.open);
    if (this.open) {
      const row = (iconName: IconName, label: string, value: string, tone = '') => `<div><dt>${icon(iconName)}${esc(label)}</dt><dd class="num" data-tone="${tone}">${value}</dd></div>`;
      const ratio = (a: number, b: number) => (b > 0 ? `${count(a)}/${count(b)} · ${pct(a / b)}` : '—');
      this.q.details.innerHTML = [
        row('health', T.report.aircraft, esc(r.survival), r.survived ? 'good' : 'bad'),
        row('damage', T.report.damageDealt, fmt(r.damageDealt)),
        row('health', T.report.damageTaken, fmt(r.damageTaken)),
        row('turret', T.report.defensesDestroyed, count(r.defensesDestroyed)),
        row('kills', T.report.aircraftShotDown, count(r.aircraftDestroyed)),
        row('bomber', T.report.bombersIntercepted, count(r.bombersIntercepted)),
        row('shield', T.report.objectivesProtected, count(r.objectivesProtected)),
        row('recon', T.report.fireDodged, r.enemyShots > 0 ? ratio(r.enemyShots - r.enemyHits, r.enemyShots) : '—'),
        row('bomb', T.report.bombsOnTarget, ratio(r.bombHits, r.bombsDropped)),
        row('ink', T.report.inkHits, ratio(r.shotsHit, r.shotsFired)),
        row('paper', T.report.paperSpent, r.paperSpent > 0 ? `−${paper(r.paperSpent)}` : count(0), r.paperSpent > 0 ? 'bad' : ''),
        row('paper', T.report.paperEarned, r.paperEarned > 0 ? `+${paper(r.paperEarned)}` : count(0), r.paperEarned > 0 ? 'good' : ''),
        ...(r.paperLost > 0 ? [row('raid', T.report.lostToRaids, `−${paper(r.paperLost)}`, 'bad')] : []),
      ].join('');
    }
  }
}


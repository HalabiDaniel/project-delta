import { attr, bindButton, esc, text, toggle } from './dom';
import { clock, fmt, pct, signed } from './format';
import { icon, type IconName } from './icons';
import { SAY } from './strings';
import type { ResultView } from './views';

const MEDAL_ICON = { gold: 'medal', silver: 'medal', bronze: 'medal' } as const;

/**
 * The sortie report: the result and medal up top, four big numbers (net paper, kills, damage,
 * time), and the full breakdown behind Details. Records and achievements as chips.
 */
export class ReportCard {
  private readonly el: HTMLElement;
  private readonly q: Record<string, HTMLElement> = {};
  private open = false;
  private key = '';

  constructor(host: HTMLElement, onContinue: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'report card';
    this.el.innerHTML = /* html */ `
      <div class="rp-head"><span class="rp-icon" data-r="icon"></span><b class="rp-title" data-r="title"></b><span class="medal" data-r="medal"></span></div>
      <div class="rp-mission" data-r="mission"></div>
      <div class="rp-why" data-r="why"></div>
      <div class="rp-big" data-r="big"></div>
      <ul class="rp-paper" data-r="paper"></ul>
      <div class="rp-next" data-r="next"></div>
      <ul class="rp-chips" data-r="chips"></ul>
      <button class="link-btn" data-r="toggle">${icon('more')}<span>${SAY.details}</span></button>
      <dl class="rp-details" data-r="details"></dl>
      <button class="btn primary" data-r="continue"><span>${SAY.continue}</span><kbd>Enter</kbd></button>`;
    host.appendChild(this.el);
    for (const n of this.el.querySelectorAll<HTMLElement>('[data-r]')) this.q[n.dataset.r!] = n;
    bindButton(this.q.continue, onContinue);
    bindButton(this.q.toggle, () => {
      this.open = !this.open;
      this.key = '';
    });
  }

  render(r: ResultView | null, paused: boolean): void {
    toggle(this.el, r !== null && !paused);
    if (!r) {
      this.open = false;
      return;
    }
    const net = r.paperEarned - r.paperSpent - r.paperLost;
    const key = JSON.stringify([r, this.open]);
    if (key === this.key) return;
    this.key = key;
    attr(this.el, 'data-tone', r.missionTone);
    this.q.icon.innerHTML = icon(r.recovered ? 'home' : 'crumple');
    const failed = r.missionLine.replace(/^Failed: /, '');
    text(this.q.title, r.missionTone === 'good' ? 'Mission complete' : failed.charAt(0).toUpperCase() + failed.slice(1));
    this.q.title.title = `${r.headline} · ${r.survival}`;
    this.q.medal.innerHTML = r.medal ? `${icon(MEDAL_ICON[r.medal])}<b>${r.medal.charAt(0).toUpperCase()}${r.medal.slice(1)}</b>` : '';
    attr(this.q.medal, 'data-medal', r.medal ?? 'none');
    const next = r.medal === 'bronze' ? 'silver' : r.medal === 'silver' ? 'gold' : null;
    this.q.medal.title = r.criteria ? (next ? `Next, ${next}: ${r.criteria[next]}` : r.criteria.gold) : '';
    toggle(this.q.medal, r.medal !== null);
    this.q.mission.innerHTML = `${esc(r.missionTitle)} · ${icon('plane')}<b>${esc(r.aircraftName)}</b> ${icon(r.recovered ? 'health' : 'wrecked')}<b>${r.recovered ? pct(r.health) : '0%'}</b>`;
    this.q.mission.title = r.planeLine;

    // Why it failed, and what to try: in plain words, not only a headline.
    toggle(this.q.why, r.failure !== null);
    this.q.why.innerHTML = r.failure ? `<span>${esc(r.failure.why)}</span><span class="rp-advice">${icon('tip')}${esc(r.failure.advice)}</span>` : '';
    // Where the paper came from and went.
    this.q.paper.innerHTML = r.paper
      .map((l) => `<li data-tone="${l.amount > 0 ? 'good' : 'bad'}"><span>${esc(l.label)}</span><b>${signed(l.amount)}</b></li>`)
      .join('') + (r.paper.length > 1 ? `<li class="rp-total"><span>Net</span><b>${signed(net)}</b></li>` : '');
    toggle(this.q.paper, r.paper.length > 0);
    text(this.q.next, r.next);
    toggle(this.q.next, r.next.length > 0);

    const big = (iconName: IconName, value: string, label: string, tone = '') => `<div class="rp-tile" title="${esc(label)}" data-tone="${tone}">${icon(iconName)}<b>${value}</b></div>`;
    const kills = r.aircraftDestroyed + r.defensesDestroyed + r.targetsDestroyed;
    this.q.big.innerHTML = [
      big('paper', signed(net), 'Net paper', net > 0 ? 'good' : net < 0 ? 'bad' : ''),
      big('kills', String(kills), `Destroyed: ${r.aircraftDestroyed} aircraft, ${r.defensesDestroyed} defenses, ${r.targetsDestroyed} targets`),
      big('damage', fmt(r.damageDealt), 'Damage dealt'),
      big('clock', clock(r.time), 'Time'),
    ].join('');

    const chips = [
      ...r.bonuses.map((b) => `<li data-tone="good" title="${esc(b.label)}">${icon('level')}<b>+${b.amount}</b></li>`),
      ...(r.operation ? [`<li title="${esc(r.operation)}">${icon('radar')}<span>${esc(r.operation.split(':')[0])}</span></li>`] : []),
      ...(r.streak >= 2 ? [`<li title="Missions in a row">${icon('streak')}<b>${r.streak}</b></li>`] : []),
      ...r.records.map((x) => `<li data-tone="good" title="New best: ${esc(x)}">${icon('reach')}<span>${esc(x)}</span></li>`),
      ...r.achievements.map((a) => `<li data-tone="gold" title="${esc(a.detail)}">${icon('medal')}<span>${esc(a.title)}</span></li>`),
      ...(r.paperOverflow > 0 ? [`<li data-tone="warn" title="Storage was full: build or upgrade storage boxes">${icon('capacity')}<b>−${r.paperOverflow}</b></li>`] : []),
    ].join('');
    this.q.chips.innerHTML = chips;
    toggle(this.q.chips, chips.length > 0);

    this.q.toggle.classList.toggle('open', this.open);
    toggle(this.q.details, this.open);
    if (this.open) {
      const row = (iconName: IconName, label: string, value: string, tone = '') => `<div><dt>${icon(iconName)}${esc(label)}</dt><dd data-tone="${tone}">${value}</dd></div>`;
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

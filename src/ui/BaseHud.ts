import type { BuildingKind } from '../config';
import type { RaidReport } from '../base/Raids';
import { attrs, card, chip, glyph, iconButton, stat, tooltipAttrs, type Tone } from './components';
import { attr, esc, toggle } from './dom';
import { count, metres, paper, pct } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { SAY, STYLE_TEXT, T } from './strings';
import type { PriceView, RaidAlertView } from './views';

/**
 * The raid alert (the top-centre alert slot) and the defense report, plus the building icons and
 * the price chip shared with the build tray. Base management itself is src/ui/hud/DeskHud.ts.
 */
export const BUILDING_ICONS: Record<BuildingKind | 'store', IconName> = {
  turret: 'turret', launcher: 'launcher', radar: 'radar', workshop: 'workshop', storage: 'storage', inkwell: 'inkwell', store: 'store',
};

const tip = (t: string): string => attrs(tooltipAttrs(t));

/**
 * A price as the paper icon and the cost, and, when the player can't afford it, what is MISSING
 * as a red chip ("−10", tooltip "Need 10 more paper"): what to earn, not just the total.
 */
export function priceHtml(p: PriceView): string {
  const name = p.missing > 0 ? T.base.priceShort(paper(p.cost), ICON_NAMES.paper, SAY.need, paper(p.missing)) : T.base.price(paper(p.cost), ICON_NAMES.paper);
  const missing = p.missing > 0
    ? chip({ label: '', value: `−${paper(p.missing)}`, tone: 'hostile', className: 'missing', tip: T.base.needMore(SAY.need, paper(p.missing), ICON_NAMES.paper), attrs: { 'data-missing': p.missing } })
    : '';
  return `<span class="price" role="img" aria-label="${esc(name)}"${p.missing > 0 ? ' data-short' : ''}>${icon('paper')}<b class="num">${paper(p.cost)}</b>${missing}</span>`;
}

/**
 * Raids on T1: the early-warning alert while one is inbound (where from, how long, what it is
 * after, how many guns are ready, what to do about it), and the defense report once it is over.
 */
export class RaidHud {
  private readonly alert: HTMLElement;
  private readonly report: HTMLElement;
  private alertKey = '';
  private reportUntil = 0;

  constructor(host: HTMLElement) {
    host.insertAdjacentHTML('beforeend', `<div class="raid-alert ui-raid" role="alert" aria-label="${esc(SAY.raidInbound)}" data-critical data-tone="hostile"></div>`);
    this.alert = host.lastElementChild as HTMLElement;
    host.insertAdjacentHTML('beforeend', card({ className: 'raid-report', label: SAY.defenseReport, elevation: 'floating', bodyHtml: '' }));
    this.report = host.lastElementChild as HTMLElement;
    this.report.hidden = true;
    this.report.addEventListener('click', () => this.hideReport());
  }

  render(r: RaidAlertView | null, paused: boolean): void {
    toggle(this.alert, r !== null && !paused);
    if (this.reportUntil && performance.now() > this.reportUntil) this.hideReport();
    if (!r) return;
    const key = JSON.stringify([r.state, r.direction, Math.ceil(r.eta), r.target, r.ready, r.total, r.escorted, r.distance !== null ? Math.round(r.distance / 10) : null, r.response?.key]);
    if (key === this.alertKey) return;
    this.alertKey = key;
    attr(this.alert, 'data-state', r.state);
    const escort = r.escorted ? `<span role="img" aria-label="${esc(ICON_NAMES.escort)}" ${tip(T.base.escorted)}>${icon('escort')}</span>` : '';
    // The style guide's RaidAlert: the badge, a title and a line of facts, the time to target large on the right.
    this.alert.innerHTML = `<span class="ui-raid-badge">${icon('bomber', 'icon ui-icon')}</span>
      <div class="ui-raid-text"><p class="ui-raid-title ra-title">${esc(r.state === 'released' ? STYLE_TEXT.bombsAway : STYLE_TEXT.raidTitle)}</p>
      <div class="ra-row">
        <span class="ra-dir" ${tip(T.base.comingFrom)}>${icon('heading')}<b class="num">${r.direction}</b></span>${escort}
        <span ${tip(T.base.target(r.target))}>${icon(r.targetIcon)}<b>${esc(r.target.split(' ').slice(-1)[0])}</b></span>
        <span ${tip(T.base.weaponsReady)} data-tone="${r.total === 0 ? 'warn' : r.ready < r.total ? 'bad' : 'good'}">${icon('shield')}<b class="num">${count(r.ready)}/${count(r.total)}</b></span>
        ${r.distance !== null ? `<span ${tip(T.base.distanceFromYou)}>${icon('distance')}<b class="num">${metres(r.distance)}</b></span>` : ''}
        <span ${tip(r.mission ? T.base.missionReward : T.base.defenseReward)}>${icon('paper')}<b class="num">+${paper(r.reward)}</b></span>
        ${r.response ? `<span class="ra-do">${glyph({ key: r.response.key })}${esc(r.response.label)}</span>` : ''}</div></div>
      ${r.state === 'inbound' ? `<span class="ui-raid-eta ra-eta num" ${tip(T.base.timeToTarget)}>${T.units.seconds(count(Math.max(0, Math.ceil(r.eta))))}</span>` : ''}`;
  }

  /** The defense report: one card, a few numbers, gone after a while, on click or with its close button. */
  showReport(r: RaidReport): void {
    const row = (iconName: IconName, value: string, label: string, tone?: Tone) => stat({ icon: iconName, value, label, tone });
    attr(this.report, 'data-tone', r.repelled ? 'good' : 'hostile');
    const share = r.defenseDamage + r.playerDamage;
    (this.report.querySelector('.ui-card-body') as HTMLElement).innerHTML = `
      <div class="rr-head">${icon(r.repelled ? 'shield' : 'raid')}<b>${esc(r.repelled ? SAY.raidRepelled : SAY.baseHit)}</b><span class="rr-where num">${esc(T.base.home)}</span>${iconButton({ icon: 'close', name: SAY.close, className: 'rr-close' })}</div>
      <div class="stats">
        ${row('bomber', count(r.aircraftDestroyed), T.base.raidersShotDown(r.byDefenses, r.byPlayer), r.aircraftDestroyed > 0 ? 'good' : undefined)}
        ${row('paper', r.paperLost > 0 ? `−${paper(r.paperLost)}` : count(0), T.base.paperLost, r.paperLost > 0 ? 'hostile' : 'good')}
        ${r.prevented > 0 ? row('shield', `+${paper(r.prevented)}`, T.base.paperSaved, 'good') : ''}
        ${r.destroyed.length + r.damaged.length > 0 ? row('warn', count(r.destroyed.length + r.damaged.length), T.base.hit([...r.destroyed, ...r.damaged]), 'hostile') : ''}
        ${r.repairCost > 0 ? row('repair', paper(r.repairCost), T.base.repairCost, 'warn') : ''}
        ${share > 0 ? row('turret', pct(r.defenseDamage / share), T.base.defenseShare(pct(r.playerDamage / share))) : ''}
      </div>
      <div class="rr-line">${esc(r.highlight)}</div>`;
    this.report.hidden = false;
    this.report.classList.remove('show');
    void this.report.offsetWidth;
    this.report.classList.add('show');
    this.reportUntil = performance.now() + 9000;
  }

  private hideReport(): void {
    this.report.hidden = true;
    this.reportUntil = 0;
  }
}


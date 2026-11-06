import { SUITABILITY_LABELS } from '../aircraft/Aircraft';
import { bind } from '../input/bindings';
import { DIRECTOR } from '../config';
import { attrs, bar, button, card, chip, glyph, pips, tooltipAttrs, type Tone } from './components';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { clock, count, fmt, metres, paper } from './format';
import { icon, ICON_NAMES, type IconName } from './icons';
import { MISSION_ICONS, MISSION_TYPE_LABELS, SAY, STYLE_TEXT, T } from './strings';
import type { HudView, MissionCardView, ThreatSummary, TrackerView } from './views';

const MODIFIER_ICONS: Record<string, IconName> = {
  wingman: 'fighter',
  escorted: 'escort',
  'extra-target': 'bomb',
  return: 'land',
  'tight-clock': 'clock',
  'high-value': 'medal',
  alert: 'warn',
};

/** The card's risk slot as a chip tone: safe green, balanced blue, high risk red, event amber. */
export const SLOT_TONES: Record<MissionCardView['slot'], Tone> = { safe: 'good', balanced: 'friend', risky: 'hostile', event: 'warn' };

const tip = (t: string): string => attrs(tooltipAttrs(t));

/** Threat as pips (count and colour) with the defenses as icons; the full list is the tooltip. */
function threatHtml(t: ThreatSummary): string {
  const icons = t.icons.slice(0, 5).map((n) => icon(n, 'icon', ICON_NAMES[n])).join('');
  return `<span class="threat" data-level="${t.level}" ${tip(T.common.labelValue(t.label, t.detail))}>${pips({ filled: t.level, total: 3, label: t.label, tone: 'threat' })}${icons}</span>`;
}

/** One mission card: reward and risk at a glance (type, title, reward, slot, stars, threat, kit, which planes fit). */
export function missionCardHtml(c: MissionCardView, i: number): string {
  const stars = pips({ filled: c.stars, total: Math.max(3, c.stars), label: T.mission.tier(c.tierLabel, c.multiplier), tone: 'gold', className: 'mc-stars', attrs: { 'data-tip': T.mission.tier(c.tierLabel, c.multiplier) } });
  const mods = c.modifiers.map((m) => `<span class="mod" role="img" aria-label="${esc(m.label)}" ${tip(T.common.labelValue(m.label, m.detail))}>${icon(MODIFIER_ICONS[m.id] ?? 'info')}</span>`).join('');
  const kit = [
    c.bombs > 0 ? `<span class="kit" ${tip(ICON_NAMES.bombload)}>${icon('bombload')}<b class="num">${count(c.bombs)}</b></span>` : '',
    c.timeLimit ? `<span class="kit" ${tip(T.mission.timeLimit)}>${icon('clock')}<b class="num">${clock(c.timeLimit, true)}</b></span>` : '',
    `<span class="kit card-expires" ${tip(T.mission.eventEnds)}>${icon('warn')}<b class="num"></b></span>`,
  ].join('');
  const fits = c.fits
    .map((f) => `<span class="fit" data-id="${f.id}" data-level="${f.level}" ${tip(T.common.labelValue(f.name, SUITABILITY_LABELS[f.level]))}>${esc(shortName(f.id, f.name))}</span>`)
    .join('');
  const op = c.operation;
  const opHtml = op
    ? `<div class="op" ${tip(T.mission.operation(op.codename, paper(op.bonus), paper(op.remaining)))}>${op.stages
        .map((st, k) => `<i data-status="${st.status}" class="${k === op.stage ? 'this' : ''}" ${tip(T.mission.stage(st.label, st.optional))}></i>`)
        .join('')}<b class="num">+${paper(op.bonus)}</b>${op.active ? button({ label: SAY.abandon, icon: 'close', size: 'small', variant: 'secondary', className: 'op-abandon', tip: T.mission.abandonTip, attrs: { 'data-act': 'abandon' } }) : ''}</div>`
    : '';
  const title = c.codename ? T.mission.codename(c.codename, c.description) : c.description;
  return `<div class="mcard" role="button" data-nav data-m="card-${i}" data-slot="${c.slot}" data-tier="${c.tier}" aria-label="${esc(T.common.dot([c.title, c.slotLabel, `+${fmt(c.reward)}`]))}" ${tip(title)}>
    <div class="mc-top">${glyph({ key: String(i + 1) }, { className: 'hint-key' })}<span class="mc-type" role="img" aria-label="${esc(MISSION_TYPE_LABELS[c.type])}" ${tip(MISSION_TYPE_LABELS[c.type])}>${icon(MISSION_ICONS[c.type])}</span>
      <b class="mc-title">${esc(c.title)}</b>
      <b class="mc-reward" ${tip(c.rewardNote || T.mission.reward)}>${icon('trophy')}<span class="num">+${fmt(c.reward)}</span>${icon('paper')}</b></div>
    <div class="mc-mid">${chip({ label: c.slotLabel, tone: SLOT_TONES[c.slot], className: 'mc-slot' })}${stars}${c.recommended ? `<span class="mc-yours" role="img" aria-label="${esc(T.mission.directorsPick)}" ${tip(T.mission.directorsPick)}>${icon('level')}</span>` : ''}${mods}</div>
    <div class="mc-bottom">${threatHtml(c.threat)}${kit}<span class="fits">${fits}</span></div>
    <div class="mc-risk" hidden>${icon('plane')}<span data-risk></span></div>
    ${opHtml}</div>`;
}

/**
 * At the desk: the mission cards, one line each for what matters (type, title, reward, risk, kit,
 * which planes fit), the rest in tooltips; notebook pages with the red margin line and the risk
 * naming the plane. In the air: the objective card under the paper counter, with the current step,
 * its distance and progress, the clock, and every step as a line.
 */
export class MissionPanel {
  private readonly cards: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private cardsKey = '';
  private objectivesKey = '';

  constructor(
    cardHost: HTMLElement,
    stripHost: HTMLElement,
    private readonly actions: { select: (i: number) => void; swap: () => void; abandon: () => void },
  ) {
    this.cards = document.createElement('div');
    this.cards.className = 'mission-cards';
    this.cards.innerHTML = `<div class="cards" role="group" aria-label="${SAY.missions}" data-m="cards"></div>${button({
      label: SAY.swap, icon: 'swap', size: 'small', tip: T.mission.swapTip, tipKey: bind('swap'), className: 'swap-btn', attrs: { 'data-m': 'swap' },
    })}`;
    cardHost.appendChild(this.cards);
    const swap = this.cards.querySelector<HTMLElement>('[data-m="swap"]')!;
    swap.querySelector('.ui-label')!.insertAdjacentHTML('afterend', `<b class="num" data-m="swaps"></b>${glyph(bind('swap'), { className: 'hint-key' })}`);
    stripHost.insertAdjacentHTML('beforeend', card({
      className: 'objective', label: SAY.objective, fold: true,
      bodyHtml: /* html */ `
      <div class="obj-head">
        <span class="obj-type" data-m="type"></span>
        <b class="obj-now" data-m="now"></b>
        <span class="obj-dist num" data-m="dist"></span>
        <span class="obj-timer" data-m="timer">${icon('clock')}<b class="num" data-m="time"></b></span>
        ${chip({ label: '', className: 'obj-status', attrs: { 'data-m': 'status' } })}
        <b class="obj-reward" data-m="reward" ${tip(T.mission.reward)}>${icon('trophy')}<span class="num" data-m="reward-n"></span>${icon('paper')}</b>
      </div>
      ${bar({ value: 0, label: SAY.objective, kind: 'progress', size: 'thin', className: 'obj-bar', attrs: { 'data-m': 'bar' } })}
      <ol class="obj-steps" data-m="steps"></ol>`,
    }));
    this.strip = stripHost.lastElementChild as HTMLElement;
    for (const root of [this.cards, this.strip]) for (const n of root.querySelectorAll<HTMLElement>('[data-m]')) this.el[n.dataset.m!] = n;
    bindButton(this.el.swap, actions.swap);
    const wrap = this.el.cards;
    wrap.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.addEventListener('click', (e) => {
      const t = e.target as Element;
      const cardEl = t.closest<HTMLElement>('.mcard');
      if (!cardEl) return;
      e.stopPropagation();
      if (t.closest('[data-act="abandon"]')) return this.actions.abandon();
      this.actions.select(Number(cardEl.dataset.m!.slice(5)));
    });
  }

  render(v: HudView): void {
    this.renderCards(v);
    this.renderStrip(v.paused ? null : v.tracker);
  }

  private renderCards(v: HudView): void {
    const show = v.cards !== null && !v.paused && !v.baseMode;
    toggle(this.cards, show);
    if (!show || !v.cards) return;
    const key = v.cards
      .map((c) => [c.title, c.tier, c.reward, c.slotLabel, c.recommended, c.modifiers.map((m) => m.id).join('+'), c.fits.map((f) => f.level).join(','), c.threat.level,
        c.operation ? `${c.operation.stage}:${c.operation.active}:${c.operation.stages.map((x) => x.status).join('')}` : ''].join('|'))
      .join('/');
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      this.el.cards.innerHTML = v.cards.map(missionCardHtml).join('');
    }
    [...this.el.cards.children].forEach((cardEl, i) => {
      const c = v.cards![i];
      if (!c) return;
      cardEl.classList.toggle('selected', i === v.selected);
      attr(cardEl as HTMLElement, 'aria-pressed', String(i === v.selected));
      for (const f of cardEl.querySelectorAll<HTMLElement>('.fit')) f.classList.toggle('mine', !!c.fits.find((x) => x.id === f.dataset.id)?.selected);
      // The risk names the plane you would lose (the style guide's MissionCard), on the chosen card.
      const plane = i === v.selected ? c.fits.find((x) => x.selected)?.name ?? '' : '';
      const risk = cardEl.querySelector<HTMLElement>('.mc-risk');
      if (risk) {
        toggle(risk, plane !== '');
        text(risk.querySelector<HTMLElement>('[data-risk]')!, plane ? STYLE_TEXT.risk(plane) : '');
      }
      const exp = cardEl.querySelector<HTMLElement>('.card-expires');
      if (exp) {
        toggle(exp, c.expires !== null);
        text(exp.querySelector('b') as HTMLElement, c.expires !== null ? clock(c.expires) : '');
      }
    });
    const chosen = v.cards[v.selected];
    const swappable = !!chosen && chosen.slot !== 'event' && !chosen.operation?.active;
    toggle(this.el.swap, v.phase === 'desk' || v.phase === 'building' || v.phase === 'ready');
    (this.el.swap as HTMLButtonElement).disabled = !swappable || v.swaps <= 0;
    text(this.el.swaps, `${v.swaps}/${DIRECTOR.swaps.max}`);
  }

  private renderStrip(t: TrackerView | null): void {
    toggle(this.strip, t !== null);
    if (!t) return;
    const current = t.objectives.find((o) => o.open) ?? t.objectives.find((o) => !o.done) ?? t.objectives[t.objectives.length - 1];
    const typeEl = this.el.type;
    if (typeEl.dataset.type !== t.type) {
      typeEl.dataset.type = t.type;
      typeEl.innerHTML = icon(MISSION_ICONS[t.type], 'icon', MISSION_TYPE_LABELS[t.type]);
      typeEl.dataset.tip = T.common.dot([MISSION_TYPE_LABELS[t.type], T.mission.tier(t.difficultyLabel, t.multiplier)]);
    }
    const done = t.status === 'succeeded';
    text(this.el.now, done ? T.mission.complete : t.status === 'failed' ? T.mission.failed : (current?.label ?? t.title));
    attr(this.el.now, 'data-tip', t.hint ? T.common.dot([t.title, t.hint]) : t.title);
    const dist = current && current.open && current.distance !== null ? metres(current.distance) : '';
    text(this.el.dist, dist);
    toggle(this.el.dist, dist !== '');
    toggle(this.el.timer, t.timeLeft !== null && t.status === 'active');
    if (t.timeLeft !== null) {
      text(this.el.time, clock(t.timeLeft));
      this.el.timer.classList.toggle('urgent', t.timeLeft < 10);
    }
    const status = t.status === 'succeeded' ? `+${fmt(t.reward)}` : '';
    toggle(this.el.status, status !== '');
    text(this.el.status.querySelector<HTMLElement>('.ui-label')!, status);
    attr(this.el.status, 'data-tone', t.status === 'succeeded' ? 'good' : t.status === 'failed' ? 'hostile' : 'plain');
    toggle(this.el.reward, t.status === 'active' || t.status === 'available');
    text(this.el['reward-n'], `+${fmt(t.reward)}`);
    attr(this.strip, 'data-status', t.status);
    attr(this.strip, 'data-state', t.status === 'succeeded' ? 'default' : t.status === 'failed' ? 'critical' : 'default');
    const progress = current?.progress ?? null;
    toggle(this.el.bar, progress !== null && !current?.done && t.status === 'active');
    width(this.el.bar.firstElementChild as HTMLElement, progress ?? 0);

    // The other steps, as a row of small icons with a tick when done.
    const steps = this.el.steps;
    const key = t.objectives.map((o) => `${o.icon}:${o.label}`).join('|');
    if (key !== this.objectivesKey) {
      this.objectivesKey = key;
      // Each step as a line: its icon and its words (a tick when done), as on the style guide's flight HUD.
      steps.innerHTML = t.objectives.length > 1 ? t.objectives.map((o) => `<li ${tip(o.label)}><span class="obj-step-icon">${icon(o.icon, 'icon')}${icon('ok', 'icon obj-tick')}</span><span class="obj-step-label">${esc(o.label)}</span></li>`).join('') : '';
    }
    t.objectives.forEach((o, i) => {
      const li = steps.children[i] as HTMLElement | undefined;
      if (!li) return;
      li.classList.toggle('done', o.done);
      li.classList.toggle('now', o === current && !o.done);
    });
  }
}

/** One letter per design, two where names share a first letter (Swift / Specter, Lancer / Lightning); by id, not by name. */
function shortName(id: string, name: string): string {
  return T.mission.fitLetter[id] ?? name.charAt(0);
}

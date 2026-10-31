import { SUITABILITY_LABELS } from '../aircraft/Aircraft';
import { DIRECTOR } from '../config';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { clock, fmt, metres } from './format';
import { icon, type IconName } from './icons';
import { MISSION_ICONS, MISSION_TYPE_LABELS, SAY } from './strings';
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

/** "●●○" threat pips with the defenses as icons; the full list is the tooltip. */
function threatHtml(t: ThreatSummary): string {
  const pips = [1, 2, 3].map((n) => `<i class="${n <= t.level ? 'on' : ''}"></i>`).join('');
  const icons = t.icons.slice(0, 5).map((n) => icon(n)).join('');
  return `<span class="threat" data-level="${t.level}" title="${esc(`${t.label}: ${t.detail}`)}"><span class="pips">${pips}</span>${icons}</span>`;
}

/**
 * At the desk: the mission cards, one line each for what matters (type, title, reward, risk, kit,
 * which planes fit), the rest in tooltips. In the air: the objective strip at the top centre, with
 * the current step, its distance and progress, and the clock.
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
    this.cards.innerHTML = `<div class="cards" data-m="cards"></div><button class="btn small ghost swap-btn" data-m="swap" title="Swap the chosen card (X)">${icon('swap')}<span>${SAY.swap}</span><b data-m="swaps"></b><kbd class="hint-key">X</kbd></button>`;
    cardHost.appendChild(this.cards);
    this.strip = document.createElement('div');
    this.strip.className = 'objective card';
    this.strip.innerHTML = /* html */ `
      <div class="obj-head">
        <span class="obj-type" data-m="type"></span>
        <b class="obj-now" data-m="now"></b>
        <span class="obj-dist" data-m="dist"></span>
        <span class="obj-timer" data-m="timer">${icon('clock')}<b data-m="time"></b></span>
        <span class="pill" data-m="status"></span>
        <b class="obj-reward" data-m="reward" title="Reward">${icon('paper')}<span data-m="reward-n"></span></b>
      </div>
      <div class="bar thin obj-bar" data-m="bar"><i data-m="bar-fill"></i></div>
      <ol class="obj-steps" data-m="steps"></ol>`;
    stripHost.appendChild(this.strip);
    for (const root of [this.cards, this.strip]) for (const n of root.querySelectorAll<HTMLElement>('[data-m]')) this.el[n.dataset.m!] = n;
    bindButton(this.el.swap, actions.swap);
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
        c.operation ? `${c.operation.stage}:${c.operation.active}:${c.operation.confirming}:${c.operation.stages.map((x) => x.status).join('')}` : ''].join('|'))
      .join('/');
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      const wrap = this.el.cards;
      wrap.innerHTML = '';
      v.cards.forEach((c, i) => wrap.appendChild(this.card(c, i)));
    }
    [...this.el.cards.children].forEach((card, i) => {
      const c = v.cards![i];
      card.classList.toggle('selected', i === v.selected);
      for (const chip of card.querySelectorAll<HTMLElement>('.fit')) chip.classList.toggle('mine', !!c.fits.find((f) => f.id === chip.dataset.id)?.selected);
      const exp = card.querySelector<HTMLElement>('.card-expires');
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

  private card(c: MissionCardView, i: number): HTMLElement {
    const card = document.createElement('div');
    card.className = 'mcard';
    card.setAttribute('role', 'button');
    card.dataset.slot = c.slot;
    card.dataset.tier = c.tier;
    const stars = [1, 2, 3, 4].slice(0, Math.max(3, c.stars)).map((n) => `<i class="${n <= c.stars ? 'on' : ''}"></i>`).join('');
    const mods = c.modifiers.map((m) => `<span class="mod" title="${esc(`${m.label}: ${m.detail}`)}">${icon(MODIFIER_ICONS[m.id] ?? 'info')}</span>`).join('');
    const kit = [
      c.bombs > 0 ? `<span class="kit" title="Bombs">${icon('bombload')}<b>${c.bombs}</b></span>` : '',
      c.timeLimit ? `<span class="kit" title="Time limit">${icon('clock')}<b>${clock(c.timeLimit, true)}</b></span>` : '',
      `<span class="kit card-expires" title="Event ends in">${icon('warn')}<b></b></span>`,
    ].join('');
    const fits = c.fits
      .map((f) => `<span class="fit" data-id="${f.id}" data-level="${f.level}" title="${esc(`${f.name}: ${SUITABILITY_LABELS[f.level]}`)}">${esc(f.name.charAt(0))}</span>`)
      .join('');
    const op = c.operation;
    const opHtml = op
      ? `<div class="op" title="${esc(`${op.codename} · bonus +${op.bonus} · ${op.remaining} still to earn`)}"><span class="op-dots">${op.stages
          .map((st, k) => `<i data-status="${st.status}" class="${k === op.stage ? 'this' : ''}" title="${esc(`${st.label} · optional: ${st.optional}`)}"></i>`)
          .join('')}</span><b>+${op.bonus}</b>${op.active ? `<button class="btn tiny ghost op-abandon${op.confirming ? ' confirm' : ''}" title="Abandon the operation">${icon('close')}${op.confirming ? '<span>Confirm</span>' : ''}</button>` : ''}</div>`
      : '';
    card.innerHTML = `
      <div class="mc-top"><kbd class="hint-key">${i + 1}</kbd><span class="mc-type" title="${esc(MISSION_TYPE_LABELS[c.type])}">${icon(MISSION_ICONS[c.type])}</span>
        <b class="mc-title" title="${esc(`${c.codename ? `${c.codename}: ` : ''}${c.description}`)}">${esc(c.title)}</b>
        <b class="mc-reward" title="${esc(c.rewardNote || 'Reward')}">+${fmt(c.reward)}</b></div>
      <div class="mc-mid"><span class="tag" data-slot="${c.slot}">${esc(c.slotLabel)}</span><span class="stars" title="${esc(`${c.tierLabel} ×${c.multiplier}`)}">${stars}</span>${c.recommended ? `<span class="mc-yours" title="The director's pick for your level">${icon('level')}</span>` : ''}${mods}</div>
      <div class="mc-bottom">${threatHtml(c.threat)}${kit}<span class="fits">${fits}</span></div>
      ${opHtml}`;
    bindButton(card, () => this.actions.select(i));
    const abandon = card.querySelector<HTMLElement>('.op-abandon');
    if (abandon) bindButton(abandon, () => this.actions.abandon());
    return card;
  }

  private renderStrip(t: TrackerView | null): void {
    toggle(this.strip, t !== null);
    if (!t) return;
    const current = t.objectives.find((o) => o.open) ?? t.objectives.find((o) => !o.done) ?? t.objectives[t.objectives.length - 1];
    const typeEl = this.el.type;
    if (typeEl.dataset.type !== t.type) {
      typeEl.dataset.type = t.type;
      typeEl.innerHTML = icon(MISSION_ICONS[t.type]);
      typeEl.title = `${MISSION_TYPE_LABELS[t.type]} · ${t.difficultyLabel} ×${t.multiplier}`;
    }
    const done = t.status === 'succeeded';
    text(this.el.now, done ? 'Complete' : t.status === 'failed' ? 'Failed' : (current?.label ?? t.title));
    this.el.now.title = `${t.title}${t.hint ? ` · ${t.hint}` : ''}`;
    const dist = current && current.open && current.distance !== null ? metres(current.distance) : '';
    text(this.el.dist, dist);
    toggle(this.el.dist, dist !== '');
    toggle(this.el.timer, t.timeLeft !== null && t.status === 'active');
    if (t.timeLeft !== null) {
      text(this.el.time, clock(t.timeLeft));
      this.el.timer.classList.toggle('urgent', t.timeLeft < 10);
    }
    const [status, tone] = t.status === 'succeeded' ? [`+${fmt(t.reward)}`, 'good'] : t.status === 'failed' ? ['', 'bad'] : ['', ''];
    toggle(this.el.status, status !== '');
    text(this.el.status, status);
    attr(this.el.status, 'data-tone', tone);
    toggle(this.el.reward, t.status === 'active' || t.status === 'available');
    text(this.el['reward-n'], `+${fmt(t.reward)}`);
    attr(this.strip, 'data-status', t.status);
    const progress = current?.progress ?? null;
    toggle(this.el.bar, progress !== null && !current?.done && t.status === 'active');
    width(this.el['bar-fill'], progress ?? 0);

    // The other steps, as a row of small icons with a tick when done.
    const steps = this.el.steps;
    const key = t.objectives.map((o) => `${o.icon}:${o.label}`).join('|');
    if (key !== this.objectivesKey) {
      this.objectivesKey = key;
      steps.innerHTML = t.objectives.length > 1 ? t.objectives.map((o) => `<li title="${esc(o.label)}">${icon(o.icon)}</li>`).join('') : '';
    }
    t.objectives.forEach((o, i) => {
      const li = steps.children[i] as HTMLElement | undefined;
      if (!li) return;
      li.classList.toggle('done', o.done);
      li.classList.toggle('now', o === current && !o.done);
    });
  }
}

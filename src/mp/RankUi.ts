import { bar, button } from '../ui/components';
import { esc } from '../ui/dom';
import { count } from '../ui/format';
import { T } from '../ui/strings';
import type { PromotionDTO, RankDTO } from '../net/protocol';
import { insigniaHtml } from '../ranks/insignia';
import { RANKS, rankDef, stepAt, unlockedCards, unlockedEffects, unlockedTitles, type EffectId, type RankStep } from '../ranks/Ranks';

const R = T.ranks;

/** Whose rank effects this player wants to see (a viewer-only setting: other screens are unchanged). */
export type EffectsShown = 'everyone' | 'mine' | 'none';

const SHOWN_KEY = 'paperwars.rankEffects';

export function loadEffectsShown(): EffectsShown {
  try {
    const v = localStorage.getItem(SHOWN_KEY);
    return v === 'mine' || v === 'none' ? v : 'everyone';
  } catch {
    return 'everyone';
  }
}

function saveEffectsShown(v: EffectsShown): void {
  try {
    localStorage.setItem(SHOWN_KEY, v);
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
}

/** What a profile card shows. Nothing from outside the game (no real name, no location) ever does. */
export interface ProfileView {
  name: string;
  step: RankStep;
  title: string | null;
  /** The card's paper: a rank id (or "honor-roll-N"); the rank's own when null. */
  card: string | null;
  /** Shown on the player's own card only. */
  progress?: { into: number; needed: number; next: RankStep } | null;
  merit?: number;
  stats: Array<{ label: string; value: number }>;
  /** "Flying since" (a month), when known. */
  since?: string | null;
}

/** The card's look: the paper of the chosen (or current) rank, by tier. */
function cardStyle(v: ProfileView): { card: string; tier: number; metal: string } {
  const id = v.card ?? v.step.rank;
  const def = rankDef(id.startsWith('honor-roll') ? '' : id);
  return { card: id, tier: def?.tier ?? 16, metal: def?.metal ?? 'gold' };
}

/** One profile card (used everywhere a card appears: own profile, the killer's card, results). */
export function profileCardHtml(v: ProfileView, className = ''): string {
  const style = cardStyle(v);
  const progress = v.progress
    ? `<div class="rank-progress">${bar({ value: v.progress.needed > 0 ? v.progress.into / v.progress.needed : 1, label: R.merit, kind: 'progress', size: 'thin', valueText: R.toNext(count(v.progress.into), count(v.progress.needed), v.progress.next.label) })}<span class="rank-progress-text num">${esc(v.step.stars > 0 || v.step.index >= 47 ? R.top : R.toNext(count(v.progress.into), count(v.progress.needed), v.progress.next.label))}</span></div>`
    : '';
  const stats = v.stats.length > 0 ? `<dl class="rank-stats">${v.stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd class="num">${count(s.value)}</dd></div>`).join('')}</dl>` : '';
  return `<article class="rank-card ${esc(className)}" data-card="${esc(style.card)}" data-tier="${style.tier}" data-metal="${esc(style.metal)}" aria-label="${esc(`${v.name}, ${v.step.label}`)}">
    <div class="rank-card-badge">${insigniaHtml(v.step, 'rank-card-insignia')}</div>
    <div class="rank-card-body">
      <h3 class="rank-card-name">${esc(v.name)}</h3>
      <p class="rank-card-rank">${esc(v.step.label)}</p>
      ${v.title ? `<p class="rank-card-title">“${esc(v.title)}”</p>` : ''}
      ${v.merit !== undefined ? `<p class="rank-card-merit num">${esc(R.meritOf(count(v.merit)))}</p>` : ''}
      ${progress}
      ${stats}
      ${v.since ? `<p class="rank-card-since">${esc(R.flyingSince)} ${esc(v.since)}</p>` : ''}
    </div>
  </article>`;
}

/** The ceremony's markup: the old insignia stamped over by the new, and what the new rank unlocks. */
export function ceremonyHtml(from: RankStep, to: RankStep): string {
  const before = new Set<string>([...unlockedTitles(from), ...unlockedEffects(from)]);
  const fresh = [
    ...unlockedTitles(to).filter((t) => !before.has(t)).map((t) => `“${t}”`),
    ...unlockedEffects(to).filter((e) => !before.has(e)).map((e) => R.effect[e] ?? e),
  ];
  return `<div class="rank-ceremony-stage">
      <div class="rank-ceremony-old">${insigniaHtml(from, 'rank-ceremony-insignia')}</div>
      <div class="rank-ceremony-new">${insigniaHtml(to, 'rank-ceremony-insignia')}</div>
      <span class="rank-stamp" aria-hidden="true">${esc(R.stamp)}</span>
    </div>
    <p class="rank-ceremony-line">${esc(R.nowRank(to.label))}</p>
    ${fresh.length > 0 ? `<ul class="rank-unlocks">${fresh.map((f) => `<li><span class="rank-new">${esc(R.unlocked)}</span> ${esc(f)}</li>`).join('')}</ul>` : ''}`;
}

/**
 * v0.0.17: the rank screens of a multiplayer session: the player's own profile (rank, progress,
 * equipping titles, cards and effects), another player's card shown briefly (who shot you down),
 * and the promotion ceremony, which never interrupts a fight: a promotion in flight is a small note,
 * and the ceremony waits until the player is back at their desk. Several promotions at once (the
 * backfill, a big mission) run as one quick ceremony from the first to the last.
 */
export class RankUi {
  private own: RankDTO | null = null;
  private pending: { from: number; to: number } | null = null;
  private ceremonyLeft = 0;
  private flash: { html: string; left: number } | null = null;
  readonly root: HTMLElement;
  private readonly badge: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly peek: HTMLElement;
  private readonly ceremony: HTMLElement;
  shown: EffectsShown = loadEffectsShown();
  private stats: () => ProfileView['stats'] = () => [];
  private name: () => string = () => '';

  constructor(
    host: HTMLElement,
    private readonly send: (prefs: { title: string | null; card: string | null; off: string[] }) => void,
    private readonly onShownChange: (v: EffectsShown) => void = () => undefined,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'rank-ui';
    this.root.innerHTML = `<button type="button" class="rank-badge" hidden></button><section class="rank-panel" role="dialog" aria-modal="true" aria-label="${esc(R.profile)}" hidden></section><div class="rank-peek" hidden></div><div class="rank-ceremony" role="status" hidden></div>`;
    host.appendChild(this.root);
    this.badge = this.root.querySelector('.rank-badge')!;
    this.panel = this.root.querySelector('.rank-panel')!;
    this.peek = this.root.querySelector('.rank-peek')!;
    this.ceremony = this.root.querySelector('.rank-ceremony')!;
    this.badge.addEventListener('mousedown', (e) => e.preventDefault());
    this.badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
    this.panel.addEventListener('change', (e) => this.onPanelChange(e));
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    this.ceremony.addEventListener('click', () => this.endCeremony());
  }

  /** Where the profile's name and statistics come from (the game knows them). */
  setSources(name: () => string, stats: () => ProfileView['stats']): void {
    this.name = name;
    this.stats = stats;
  }

  get step(): RankStep | null {
    return this.own ? stepAt(this.own.index) : null;
  }

  get prefs(): RankDTO | null {
    return this.own;
  }

  get open(): boolean {
    return !this.panel.hidden || !this.ceremony.hidden;
  }

  /** Our rank from the server (on joining, and whenever it or what we equipped changes). */
  setOwn(dto: RankDTO): void {
    this.own = dto;
    const step = stepAt(dto.index);
    this.badge.hidden = false;
    this.badge.innerHTML = `${insigniaHtml(step, 'rank-badge-insignia')}<span class="rank-badge-label">${esc(step.label)}</span>`;
    this.badge.title = `${R.yourRank}: ${step.label} (P)`;
    this.badge.setAttribute('aria-label', `${R.profile}: ${step.label}`);
    if (!this.panel.hidden) this.renderPanel();
  }

  /** We were promoted. The ceremony waits for the desk (`atDesk`); several run as one. */
  promoted(dto: PromotionDTO): void {
    this.pending = this.pending ? { from: this.pending.from, to: Math.max(this.pending.to, dto.to) } : { from: dto.from, to: dto.to };
  }

  /** Shows another player's card for a few seconds (the player who shot us down). */
  showCard(view: ProfileView, seconds = 4): void {
    this.flash = { html: `<p class="rank-peek-head">${esc(R.shotBy)}</p>${profileCardHtml(view, 'rank-card-small')}`, left: seconds };
    this.peek.innerHTML = this.flash.html;
    this.peek.hidden = false;
  }

  /** Per frame: the ceremony starts once we're back at the desk, and lasts under five seconds. */
  update(dt: number, atDesk: boolean): void {
    // The badge is for the desk: in flight the HUD needs the corner.
    this.badge.classList.toggle('rank-badge-away', !atDesk);
    if (this.flash) {
      this.flash.left -= dt;
      if (this.flash.left <= 0) {
        this.flash = null;
        this.peek.hidden = true;
      }
    }
    if (this.pending && atDesk && this.ceremony.hidden) this.startCeremony();
    if (!this.ceremony.hidden) {
      this.ceremonyLeft -= dt;
      if (this.ceremonyLeft <= 0) this.endCeremony();
    }
  }

  /** A promotion is waiting for the desk (the flight HUD shows the small note). */
  get waiting(): boolean {
    return this.pending !== null;
  }

  private startCeremony(): void {
    const p = this.pending!;
    this.pending = null;
    const from = stepAt(p.from);
    const to = stepAt(p.to);
    this.ceremony.dataset.tier = from.tier !== to.tier ? 'new-rank' : 'new-level';
    this.ceremony.innerHTML = `${ceremonyHtml(from, to)}${button({ label: R.skip, variant: 'primary', size: 'small', className: 'rank-ceremony-skip' })}`;
    this.ceremony.hidden = false;
    this.ceremonyLeft = from.tier !== to.tier ? 4.6 : 3;
  }

  private endCeremony(): void {
    this.ceremony.hidden = true;
    this.ceremony.innerHTML = '';
  }

  toggle(): void {
    if (this.panel.hidden) this.openPanel();
    else this.close();
  }

  openPanel(): void {
    if (!this.own) return;
    this.renderPanel();
    this.panel.hidden = false;
    this.panel.querySelector<HTMLElement>('select, button')?.focus();
  }

  /** Closes the profile (and skips a ceremony that is playing). */
  close(): void {
    this.panel.hidden = true;
    if (!this.ceremony.hidden) this.endCeremony();
  }

  private renderPanel(): void {
    const own = this.own;
    if (!own) return;
    const step = stepAt(own.index);
    const progress = { into: own.into, needed: own.needed, next: stepAt(own.index + 1) };
    const card = profileCardHtml({ name: this.name(), step, title: own.title, card: own.card, progress, merit: own.merit, stats: this.stats() });
    const titles = unlockedTitles(step);
    const cards = unlockedCards(step);
    const effects = unlockedEffects(step);
    const option = (value: string, label: string, chosen: boolean) => `<option value="${esc(value)}"${chosen ? ' selected' : ''}>${esc(label)}</option>`;
    const cardName = (id: string) => RANKS.find((r) => r.id === id)?.name ?? id.replace('honor-roll-', `${T.ranks.profile} ★`);
    this.panel.innerHTML = `<header class="rank-panel-head"><h2>${esc(R.profile)}</h2>${button({ label: R.close, size: 'small', className: 'rank-close' })}</header>
      ${card}
      <div class="rank-equip">
        <label>${esc(R.title)} <select data-pref="title">${option('', R.noTitle, own.title === null)}${titles.map((t) => option(t, t, own.title === t)).join('')}</select></label>
        <label>${esc(R.card)} <select data-pref="card">${cards.map((c) => option(c, cardName(c), (own.card ?? step.rank) === c)).join('')}</select></label>
        ${effects.length > 0 ? `<fieldset><legend>${esc(R.effects)}</legend>${effects.map((e) => `<label class="rank-effect"><input type="checkbox" data-effect="${esc(e)}"${own.off.includes(e) ? '' : ' checked'}> ${esc(R.effect[e] ?? e)}</label>`).join('')}<p class="rank-hint">${esc(R.effectsHint)}</p></fieldset>` : ''}
        <label>${esc(R.showEffects)} <select data-shown>${option('everyone', R.showEveryone, this.shown === 'everyone')}${option('mine', R.showMine, this.shown === 'mine')}${option('none', R.showNone, this.shown === 'none')}</select></label>
      </div>`;
    // The choices as properties too (some browsers keep a select's earlier choice over `selected`).
    const set = (sel: string, value: string) => {
      const el = this.panel.querySelector<HTMLSelectElement>(sel);
      if (el) el.value = value;
    };
    set('[data-pref="title"]', own.title ?? '');
    set('[data-pref="card"]', own.card ?? step.rank);
    set('[data-shown]', this.shown);
  }

  private onPanelClick(e: Event): void {
    const t = e.target as HTMLElement;
    if (t.closest('.rank-close')) this.close();
    e.stopPropagation();
  }

  private onPanelChange(e: Event): void {
    const own = this.own;
    if (!own) return;
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.matches('[data-shown]')) {
      this.shown = (t.value as EffectsShown) ?? 'everyone';
      saveEffectsShown(this.shown);
      this.onShownChange(this.shown);
      return;
    }
    const title = (this.panel.querySelector<HTMLSelectElement>('[data-pref="title"]')?.value ?? '') || null;
    const card = this.panel.querySelector<HTMLSelectElement>('[data-pref="card"]')?.value ?? null;
    const off = [...this.panel.querySelectorAll<HTMLInputElement>('[data-effect]')].filter((i) => !i.checked).map((i) => i.dataset.effect as EffectId);
    this.send({ title, card, off });
  }

  dispose(): void {
    this.root.remove();
  }
}

import { bar, chip, glyph, iconButton } from './components';
import { bind } from '../input/bindings';
import type { GlyphSpec } from '../input/glyphs';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { count, fmt, num, signed } from './format';
import { icon } from './icons';
import { SAY, T } from './strings';
import type { EconomyView, ResourceView } from './views';

/** One resource row in the strip (paper today; ink and rubber balls join in v0.0.20). */
export interface ResourceRow extends ResourceView {
  /** Paper also carries its production state and the protected reserve. */
  state?: EconomyView['state'];
  protectedAmount?: number;
}

/**
 * The resources the strip shows, in order: paper first, then whatever else the view lists. A new
 * resource is one more row of the same shape, so the layout does not change (plan v0.0.15 §3D).
 */
export function resourceRows(v: EconomyView): ResourceRow[] {
  return [
    { id: 'paper', icon: 'paper', label: T.economy.paper, amount: v.paper, capacity: v.capacity, rate: v.rate, state: v.state, protectedAmount: v.protectedPaper },
    ...(v.resources ?? []),
  ];
}

/**
 * One resource as the style guide's PaperCounter (a pencil pill for paper, a paper pill for the
 * others) with its production chip and a storage chip (how full, and the protected reserve).
 */
function rowHtml(r: ResourceRow, primary: boolean): string {
  return /* html */ `<li class="econ-res" data-res="${esc(r.id)}"${primary ? ' data-primary' : ''}>
    <span class="econ-amount ui-counter" role="group" aria-label="${esc(r.label)}" data-tip="${esc(r.label)}"><span class="ui-counter-icon">${icon(r.icon, 'icon ui-icon econ-icon')}</span><b class="num ui-counter-value" data-e="value"></b><small class="num" data-e="cap"></small>${primary ? '<span class="delta num" data-e="delta"></span>' : ''}</span>
    ${chip({ label: '', icon: 'rate', value: '', tip: T.common.labelValue(r.label, SAY.paperIn), className: 'econ-rate hud-chip', attrs: { 'data-e': 'rate-chip' } })}
    <span class="econ-store hud-chip">
      ${icon('capacity')}${bar({ value: 0, label: T.economy.storage(r.label), kind: 'capacity', size: 'thin', attrs: { 'data-e': 'fill' } })}
      ${r.protectedAmount !== undefined ? `<span class="econ-safe" data-tip="${esc(T.economy.protected)}">${icon('lock')}<b class="num" data-e="safe"></b></span>` : ''}
    </span>
  </li>`;
}

/**
 * Top left, a top bar: each resource as a counter pill (capacity small beside it once the store
 * fills), its rate per minute as a chip, a storage chip (a thin bar for how full the store is and
 * the protected reserve); the streak; changes pop next to the number and fade. After them, icon
 * buttons for the base, the logbook and the menu.
 */
export class EconomyStrip {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly card: HTMLElement;
  private readonly list: HTMLElement;
  private rowsKey = '';

  constructor(host: HTMLElement, actions: { base: () => void; logbook: () => void; menu: () => void }) {
    // The top bar (the style guide's DeskHud): the counter and its chips, then the base, logbook and menu buttons.
    host.insertAdjacentHTML('beforeend', `<div class="topbar"></div>`);
    const bar_ = host.lastElementChild as HTMLElement;
    bar_.insertAdjacentHTML('beforeend', `<section class="econ" role="group" aria-label="${esc(SAY.resources)}"><ul class="econ-list" role="list" data-e="list"></ul>${chip({ label: '', icon: 'streak', value: '', tip: T.economy.streak, tone: 'streak', className: 'econ-streak hud-chip', attrs: { 'data-e': 'streak-chip' } })}</section>`);
    this.card = bar_.lastElementChild as HTMLElement;
    host = bar_;
    const hint = (spec: GlyphSpec) => glyph(spec, { className: 'ui-corner hint-key' });
    const menuKey = bind('back', 'pause');
    host.insertAdjacentHTML('beforeend', /* html */ `<div class="icon-btns">
      ${iconButton({ icon: 'base', name: SAY.base, tipKey: bind('base'), badge: '0', attrs: { 'data-e': 'base-btn' } })}
      ${iconButton({ icon: 'book', name: SAY.logbook, tipKey: bind('logbook'), attrs: { 'data-e': 'book-btn' } })}
      ${iconButton({ icon: 'menu', name: SAY.menu, tipKey: menuKey, attrs: { 'data-e': 'menu-btn' } })}
    </div>`);
    const buttons = host.lastElementChild as HTMLElement;
    for (const root of [this.card, buttons]) for (const node of root.querySelectorAll<HTMLElement>('[data-e]')) this.el[node.dataset.e!] = node;
    this.el['base-btn'].insertAdjacentHTML('beforeend', hint(bind('base')));
    this.el['book-btn'].insertAdjacentHTML('beforeend', hint(bind('logbook')));
    this.el['menu-btn'].insertAdjacentHTML('beforeend', hint(menuKey));
    this.el.repairs = this.el['base-btn'].querySelector<HTMLElement>('.ui-badge')!;
    this.el.repairs.dataset.tip = T.economy.needRepairs;
    this.el.buttons = buttons;
    this.list = this.el.list;
    bindButton(this.el['base-btn'], actions.base);
    bindButton(this.el['book-btn'], actions.logbook);
    bindButton(this.el['menu-btn'], actions.menu);
  }

  render(v: EconomyView, opts: { buttons: boolean; base: boolean; baseAvailable: boolean; full: boolean; repairs: number }): void {
    const rows = resourceRows(v);
    const key = rows.map((r) => `${r.id}:${r.icon}:${r.label}`).join('|');
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.list.innerHTML = rows.map((r, i) => rowHtml(r, i === 0)).join('');
    }
    rows.forEach((r, i) => {
      const row = this.list.children[i] as HTMLElement;
      const q = (name: string) => row.querySelector<HTMLElement>(`[data-e="${name}"]`);
      text(q('value')!, fmt(r.amount));
      const cap = q('cap')!;
      const showCap = r.capacity !== null && (opts.full || r.amount >= r.capacity * 0.8);
      toggle(cap, showCap);
      if (r.capacity !== null) text(cap, `/${fmt(r.capacity)}`);
      const rateChip = q('rate-chip')!;
      const rate = r.rate ?? 0;
      text(rateChip.querySelector<HTMLElement>('b')!, rate > 0 ? `+${num(rate, 1)}` : count(0));
      attr(rateChip, 'data-state', r.state === 'full' ? 'warning' : 'default');
      attr(rateChip, 'data-tone', r.state === 'boosted' ? 'friend' : 'plain');
      attr(rateChip, 'data-tip', r.state === 'full' ? T.economy.full : r.state === 'boosted' ? T.economy.boosted : T.economy.perMinute(r.label));
      const fillBar = q('fill')!;
      const fill = r.capacity ? r.amount / r.capacity : 0;
      width(fillBar.firstElementChild as HTMLElement, fill);
      attr(fillBar, 'data-level', fill >= 1 ? 'critical' : fill >= 0.9 ? 'worn' : 'ok');
      const safe = q('safe');
      if (safe && r.protectedAmount !== undefined) text(safe, fmt(r.protectedAmount));
    });
    toggle(this.el['streak-chip'], v.streak >= 2);
    text(this.el['streak-chip'].querySelector<HTMLElement>('b')!, String(v.streak));
    this.card.classList.toggle('full', opts.full);
    toggle(this.el.buttons, opts.buttons);
    this.el['base-btn'].classList.toggle('on', opts.base);
    attr(this.el['base-btn'], 'aria-pressed', String(opts.base));
    (this.el['base-btn'] as HTMLButtonElement).disabled = !opts.baseAvailable && !opts.base;
    toggle(this.el.repairs, opts.repairs > 0 && !opts.base);
    text(this.el.repairs, String(opts.repairs));
  }

  /** Floats "+50" / "−20" next to the paper and fades. */
  delta(delta: number): void {
    const el = this.list.querySelector<HTMLElement>('[data-e="delta"]');
    if (!el) return;
    el.textContent = signed(delta);
    el.dataset.tone = delta > 0 ? 'good' : 'bad';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
}


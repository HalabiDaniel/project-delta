import { bar, card, chip, glyph, iconButton } from './components';
import { attr, bindButton, esc, text, toggle, width } from './dom';
import { fmt, signed } from './format';
import { icon } from './icons';
import { SAY } from './strings';
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
    { id: 'paper', icon: 'paper', label: 'Paper', amount: v.paper, capacity: v.capacity, rate: v.rate, state: v.state, protectedAmount: v.protectedPaper },
    ...(v.resources ?? []),
  ];
}

function rowHtml(r: ResourceRow, primary: boolean): string {
  return /* html */ `<li class="econ-res" data-res="${esc(r.id)}"${primary ? ' data-primary' : ''}>
    <div class="econ-row">
      <span class="econ-amount" role="group" aria-label="${esc(r.label)}" data-tip="${esc(r.label)}">${icon(r.icon, 'icon econ-icon')}<b class="num" data-e="value"></b><small class="num" data-e="cap"></small></span>
      ${primary ? '<span class="delta num" data-e="delta"></span>' : ''}
      ${chip({ label: '', icon: 'rate', value: '', tip: `${r.label}: ${SAY.paperIn}`, className: 'econ-rate', attrs: { 'data-e': 'rate-chip' } })}
    </div>
    <div class="econ-store">
      ${bar({ value: 0, label: `${r.label}: storage`, kind: 'capacity', size: 'thin', attrs: { 'data-e': 'fill' } })}
      ${r.protectedAmount !== undefined ? `<span class="econ-safe" data-tip="Protected from raids">${icon('lock')}<b class="num" data-e="safe"></b></span>` : ''}
    </div>
  </li>`;
}

/**
 * Top left: each resource as an icon and a number (capacity small beside it once the store fills),
 * its rate per minute, a thin bar for how full the store is and the protected reserve; the
 * streak; changes pop next to the number and fade. Below it, icon buttons for the base, the
 * logbook and the menu.
 */
export class EconomyStrip {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly card: HTMLElement;
  private readonly list: HTMLElement;
  private rowsKey = '';

  constructor(host: HTMLElement, actions: { base: () => void; logbook: () => void; menu: () => void }) {
    host.insertAdjacentHTML('beforeend', card({
      className: 'econ', label: SAY.resources,
      bodyHtml: `<ul class="econ-list ui-list" role="list" data-e="list"></ul>${chip({ label: '', icon: 'streak', value: '', tip: 'Missions in a row', tone: 'streak', className: 'econ-streak', attrs: { 'data-e': 'streak-chip' } })}`,
    }));
    this.card = host.lastElementChild as HTMLElement;
    const hint = (key: string, pad?: 'menu') => glyph({ key, pad }, { className: 'ui-corner hint-key' });
    host.insertAdjacentHTML('beforeend', /* html */ `<div class="icon-btns">
      ${iconButton({ icon: 'base', name: SAY.base, tip: 'Base (B)', badge: '0', attrs: { 'data-e': 'base-btn' } })}
      ${iconButton({ icon: 'book', name: SAY.logbook, tip: 'Logbook (L)', attrs: { 'data-e': 'book-btn' } })}
      ${iconButton({ icon: 'menu', name: SAY.menu, tip: 'Menu (Esc)', attrs: { 'data-e': 'menu-btn' } })}
    </div>`);
    const buttons = host.lastElementChild as HTMLElement;
    for (const root of [this.card, buttons]) for (const node of root.querySelectorAll<HTMLElement>('[data-e]')) this.el[node.dataset.e!] = node;
    this.el['base-btn'].insertAdjacentHTML('beforeend', hint('B'));
    this.el['book-btn'].insertAdjacentHTML('beforeend', hint('L'));
    this.el['menu-btn'].insertAdjacentHTML('beforeend', hint('Esc', 'menu'));
    this.el.repairs = this.el['base-btn'].querySelector<HTMLElement>('.ui-badge')!;
    this.el.repairs.dataset.tip = 'Need repairs';
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
      text(rateChip.querySelector<HTMLElement>('b')!, rate > 0 ? `+${Math.round(rate * 10) / 10}` : '0');
      attr(rateChip, 'data-state', r.state === 'full' ? 'warning' : 'default');
      attr(rateChip, 'data-tone', r.state === 'boosted' ? 'friend' : 'plain');
      attr(rateChip, 'data-tip', r.state === 'full' ? 'Storage full: production stopped' : r.state === 'boosted' ? 'Paper per minute (low reserves: faster)' : `${r.label} per minute`);
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


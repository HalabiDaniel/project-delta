import { attr, bindButton, text, toggle, width } from './dom';
import { fmt, signed } from './format';
import { icon } from './icons';
import type { EconomyView } from './views';

/**
 * Top left: paper as an icon and a number (with the capacity small beside it), paper per minute,
 * a thin bar for how full the store is, the protected reserve, and the streak. Changes pop up
 * next to the number and fade. Below it, icon buttons for the base, the logbook and the menu.
 */
export class EconomyStrip {
  private readonly el: Record<string, HTMLElement> = {};

  constructor(host: HTMLElement, actions: { base: () => void; logbook: () => void; menu: () => void }) {
    const card = document.createElement('div');
    card.className = 'econ card';
    card.innerHTML = /* html */ `
      <div class="econ-row">
        <span class="econ-paper" title="Paper">${icon('paper', 'icon econ-icon')}<b data-e="paper"></b><small data-e="cap"></small></span>
        <span class="delta" data-e="delta"></span>
        <span class="chip econ-rate" data-e="rate-chip" title="Paper per minute">${icon('rate')}<b data-e="rate"></b></span>
        <span class="chip econ-streak" data-e="streak-chip" title="Missions in a row">${icon('streak')}<b data-e="streak"></b></span>
      </div>
      <div class="econ-store" title="Storage">
        <span class="bar thin"><i data-e="fill"></i></span>
        <span class="econ-safe" title="Protected from raids">${icon('lock')}<b data-e="safe"></b></span>
      </div>`;
    host.appendChild(card);
    const buttons = document.createElement('div');
    buttons.className = 'icon-btns';
    buttons.innerHTML = /* html */ `
      <button class="icon-btn" data-e="base-btn" title="Base (B)">${icon('base')}<span class="badge" data-e="repairs" title="Need repairs"></span><kbd class="hint-key">B</kbd></button>
      <button class="icon-btn" data-e="book-btn" title="Logbook (L)">${icon('book')}<kbd class="hint-key">L</kbd></button>
      <button class="icon-btn" data-e="menu-btn" title="Menu (Esc)">${icon('menu')}<kbd class="hint-key" data-pad="menu">Esc</kbd></button>`;
    host.appendChild(buttons);
    for (const root of [card, buttons]) {
      for (const node of root.querySelectorAll<HTMLElement>('[data-e]')) this.el[node.dataset.e!] = node;
    }
    this.el.card = card;
    this.el.buttons = buttons;
    bindButton(this.el['base-btn'], actions.base);
    bindButton(this.el['book-btn'], actions.logbook);
    bindButton(this.el['menu-btn'], actions.menu);
  }

  render(v: EconomyView, opts: { buttons: boolean; base: boolean; baseAvailable: boolean; full: boolean; repairs: number }): void {
    text(this.el.paper, fmt(v.paper));
    text(this.el.cap, `/${fmt(v.capacity)}`);
    toggle(this.el.cap, opts.full || v.paper >= v.capacity * 0.8);
    text(this.el.rate, v.rate > 0 ? `+${Math.round(v.rate * 10) / 10}` : '0');
    attr(this.el['rate-chip'], 'data-state', v.state);
    this.el['rate-chip'].title = v.state === 'full' ? 'Storage full: production stopped' : v.state === 'boosted' ? 'Paper per minute (low reserves: faster)' : 'Paper per minute';
    const fill = v.capacity > 0 ? v.paper / v.capacity : 0;
    width(this.el.fill, fill);
    attr(this.el.fill, 'data-level', fill >= 1 ? 'full' : fill >= 0.9 ? 'high' : 'ok');
    text(this.el.safe, fmt(v.protectedPaper));
    toggle(this.el['streak-chip'], v.streak >= 2);
    text(this.el.streak, String(v.streak));
    this.el.card.classList.toggle('full', opts.full);
    toggle(this.el.buttons, opts.buttons);
    this.el['base-btn'].classList.toggle('on', opts.base);
    (this.el['base-btn'] as HTMLButtonElement).disabled = !opts.baseAvailable && !opts.base;
    toggle(this.el.repairs, opts.repairs > 0 && !opts.base);
    text(this.el.repairs, String(opts.repairs));
  }

  /** Floats "+50" / "−20" next to the paper and fades. */
  delta(delta: number): void {
    const el = this.el.delta;
    el.textContent = signed(delta);
    el.dataset.tone = delta > 0 ? 'good' : 'bad';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
}

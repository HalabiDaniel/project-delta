import { button, card, chip, glyph } from './components';
import { esc, toggle } from './dom';
import { pct } from './format';
import { icon } from './icons';
import { priceHtml } from './BaseHud';
import { SAY } from './strings';
import type { DashboardView } from './views';

export interface DashboardActions {
  quickRebuild(): void;
  quickRepair(): void;
  toggleBase(): void;
}

const FIT_LABEL: Record<string, string> = { recommended: 'recommended', good: 'good fit', possible: 'possible', unsuitable: "can't do it" };
const FIT_TONE = { recommended: 'good', good: 'good', possible: 'plain', unsuitable: 'hostile' } as const;

/**
 * The home dashboard, under the economy strip at the desk: the base's condition, the hangar, the
 * chosen mission and plane, and the next steps, with the quick actions (rebuild the lost plane,
 * repair everything, open the base). Costs show what is missing. One panel instead of hunting
 * through four.
 */
export class Dashboard {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly row: HTMLElement;
  private key = '';

  constructor(host: HTMLElement, actions: DashboardActions) {
    host.insertAdjacentHTML('beforeend', card({ className: 'dashboard', label: 'Home desk', bodyHtml: '<div class="db-body"></div><div class="db-actions"></div>' }));
    this.el = host.lastElementChild as HTMLElement;
    this.el.hidden = true;
    this.body = this.el.querySelector<HTMLElement>('.db-body')!;
    this.row = this.el.querySelector<HTMLElement>('.db-actions')!;
    this.row.addEventListener('mousedown', (e) => e.preventDefault());
    this.row.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-nav]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      if (b.dataset.nav === 'dash-rebuild') actions.quickRebuild();
      else if (b.dataset.nav === 'dash-repair') actions.quickRepair();
      else if (b.dataset.nav === 'dash-base') actions.toggleBase();
    });
  }

  render(v: DashboardView | null): void {
    toggle(this.el, v !== null);
    if (!v) return;
    const key = JSON.stringify(v);
    if (key === this.key) return;
    this.key = key;
    const b = v.base;
    const radar = b.radar === 'none' ? 'no radar' : b.radar === 'on' ? 'radar on' : 'radar down';
    const hangar = v.hangar.length
      ? v.hangar.map((h) => chip({ label: h.name, icon: 'plane', value: pct(h.health), tip: h.condition === 'ready' ? 'Ready to roll out, free' : 'Needs a refit' })).join('')
      : '<span class="db-muted">empty</span>';
    const mission = v.mission
      ? `<div class="db-row">${icon('ok')}<span><b>${esc(v.mission.title)}</b> · +${v.mission.reward} · ${esc(v.mission.plane)} ${chip({ label: FIT_LABEL[v.mission.fit] ?? v.mission.fit, tone: FIT_TONE[v.mission.fit], className: 'db-fit', attrs: { 'data-fit': v.mission.fit } })}</span></div>`
      : '';
    const next = v.next.map((n) => `<li data-tone="${n.tone}"><span>${esc(n.text)}</span>${n.key ? glyph({ key: n.key }) : ''}</li>`).join('');
    this.body.innerHTML =
      `<div class="db-title">${icon('home')}<b>Home desk</b><span class="db-muted">${v.rate}/min · ${v.paper}/${v.capacity} · ${v.protectedPaper} safe</span></div>` +
      `<div class="db-row" data-tone="${b.repairs > 0 ? 'warn' : ''}">${icon('shield')}<span>Defenses <b class="num">${b.ready}/${b.total}</b> · ${radar} · condition <b class="num">${pct(b.integrity)}</b>${b.repairs > 0 ? ` · ${b.repairs} to repair` : ''}</span></div>` +
      `<div class="db-row db-hangar">${icon('base')}<span>Hangar</span>${hangar}</div>` +
      mission +
      (next ? `<ul class="db-next">${next}</ul>` : '');
    const buttons: string[] = [];
    if (v.rebuild) {
      const r = v.rebuild;
      buttons.push(button({
        label: `Rebuild ${r.name}`, icon: 'build', size: 'small', variant: 'primary', disabled: !r.canAfford,
        key: r.key ? { key: r.key } : undefined,
        tip: r.canAfford ? 'Choose the plane you lost and fold it again' : 'Not enough paper yet',
        attrs: { 'data-nav': 'dash-rebuild' },
      }).replace('</button>', `${priceHtml({ cost: r.cost, missing: r.canAfford ? 0 : Math.max(0, r.cost - v.paper) })}</button>`));
    }
    if (b.repairs > 0) {
      buttons.push(button({
        label: SAY.repairAll, icon: 'repair', size: 'small', disabled: !b.canRepair,
        tip: b.canRepair ? 'Repair everything on the home desk' : 'Not enough paper to repair everything',
        attrs: { 'data-nav': 'dash-repair' },
      }).replace('</button>', `${priceHtml({ cost: b.repairCost, missing: b.canRepair ? 0 : Math.max(0, b.repairCost - v.paper) })}</button>`));
    }
    buttons.push(button({ label: SAY.base, icon: 'base', size: 'small', attrs: { 'data-nav': 'dash-base' } }));
    this.row.innerHTML = buttons.join('');
  }
}


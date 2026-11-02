import { bindButton, esc, toggle } from './dom';
import { pct } from './format';
import { icon } from './icons';
import type { DashboardView } from './views';

export interface DashboardActions {
  quickRebuild(): void;
  quickRepair(): void;
  toggleBase(): void;
}

const FIT_LABEL: Record<string, string> = { recommended: 'recommended', good: 'good fit', possible: 'possible', unsuitable: "can't do it" };

/**
 * The home dashboard, under the economy strip at the desk: the base's condition, the hangar, the
 * chosen mission and plane, and the next steps, with the quick actions (rebuild the lost plane,
 * repair everything, open the base). One panel instead of hunting through four.
 */
export class Dashboard {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly rebuild: HTMLButtonElement;
  private readonly repair: HTMLButtonElement;
  private key = '';

  constructor(host: HTMLElement, actions: DashboardActions) {
    this.el = document.createElement('div');
    this.el.className = 'dashboard card';
    this.el.hidden = true;
    this.body = document.createElement('div');
    this.body.className = 'db-body';
    const row = document.createElement('div');
    row.className = 'db-actions';
    const button = (nav: string, cls: string) => {
      const b = document.createElement('button');
      b.className = `btn small ${cls}`;
      b.dataset.nav = nav;
      row.appendChild(b);
      return b;
    };
    this.rebuild = button('dash-rebuild', 'primary');
    this.repair = button('dash-repair', '');
    const base = button('dash-base', 'ghost');
    base.innerHTML = `${icon('base')}<span>Base</span>`;
    bindButton(this.rebuild, actions.quickRebuild);
    bindButton(this.repair, actions.quickRepair);
    bindButton(base, actions.toggleBase);
    this.el.append(this.body, row);
    host.appendChild(this.el);
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
      ? v.hangar
          .map((h) => `<span class="chip" title="${esc(h.condition === 'ready' ? 'Ready to roll out, free' : 'Needs a refit')}">${icon('plane')}${esc(h.name)} <b>${pct(h.health)}</b></span>`)
          .join('')
      : '<span class="db-muted">empty</span>';
    const mission = v.mission
      ? `<div class="db-row">${icon('ok')}<span><b>${esc(v.mission.title)}</b> · +${v.mission.reward} · ${esc(v.mission.plane)} <span class="db-fit" data-fit="${v.mission.fit}">${esc(FIT_LABEL[v.mission.fit] ?? v.mission.fit)}</span></span></div>`
      : '';
    const next = v.next.map((n) => `<li data-tone="${n.tone}"><span>${esc(n.text)}</span>${n.key ? `<kbd>${esc(n.key)}</kbd>` : ''}</li>`).join('');
    this.body.innerHTML =
      `<div class="db-title">${icon('home')}<b>Home desk</b><span class="db-muted">${v.rate}/min · ${v.paper}/${v.capacity} · ${v.protectedPaper} safe</span></div>` +
      `<div class="db-row" data-tone="${b.repairs > 0 ? 'warn' : ''}">${icon('shield')}<span>Defenses <b>${b.ready}/${b.total}</b> · ${radar} · condition <b>${pct(b.integrity)}</b>${b.repairs > 0 ? ` · ${b.repairs} to repair` : ''}</span></div>` +
      `<div class="db-row db-hangar">${icon('base')}<span>Hangar</span>${hangar}</div>` +
      mission +
      (next ? `<ul class="db-next">${next}</ul>` : '');
    toggle(this.rebuild, v.rebuild !== null);
    if (v.rebuild) {
      this.rebuild.disabled = !v.rebuild.canAfford;
      this.rebuild.innerHTML = `${icon('build')}<span>Rebuild ${esc(v.rebuild.name)}</span><span class="cost">${icon('paper')}${v.rebuild.cost}</span>${v.rebuild.key ? `<kbd>${esc(v.rebuild.key)}</kbd>` : ''}`;
      this.rebuild.title = v.rebuild.canAfford ? 'Choose the plane you lost and fold it again' : 'Not enough paper yet';
    }
    toggle(this.repair, b.repairs > 0);
    this.repair.disabled = !b.canRepair;
    this.repair.innerHTML = `${icon('repair')}<span>Repair all</span><span class="cost">${icon('paper')}${b.repairCost}</span>`;
    this.repair.title = b.canRepair ? 'Repair everything on the home desk' : 'Not enough paper to repair everything';
  }
}

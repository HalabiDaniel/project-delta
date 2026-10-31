import { SUITABILITY_LABELS, type RatingKey, type SuitabilityLevel } from '../aircraft/Aircraft';
import type { AircraftId } from '../config';
import type { BuildKind } from '../systems/GameState';
import { attr, bindButton, esc, text, toggle } from './dom';
import { icon, type IconName } from './icons';
import type { Stat } from './views';

export interface GarageCardView {
  id: AircraftId;
  name: string;
  roleLabel: string;
  accent: string;
  cost: number;
  buildCost: number;
  buildKind: BuildKind;
  hangar: 'ready' | 'recovered' | null;
  hangarHealth: number | null;
  suitability: SuitabilityLevel;
  selected: boolean;
  affordable: boolean;
}

export interface InspectorView {
  name: string;
  roleLabel: string;
  accent: string;
  tagline: string;
  ratings: Array<{ key: RatingKey; label: string; value: number }>;
  loadout: Stat[];
  /** The player's record with this design, for the tooltip. */
  record: string | null;
  suitability: { level: SuitabilityLevel; reason: string; missionTitle: string };
}

export interface GarageView {
  cards: GarageCardView[];
  inspector: InspectorView;
  locked: boolean;
}

const RATING_ICONS: Record<RatingKey, IconName> = {
  speed: 'speed', maneuverability: 'heading', durability: 'health', range: 'range', payload: 'bombload', firepower: 'ink', stealth: 'recon',
};

export const FIT_ICONS: Record<SuitabilityLevel, IconName> = { recommended: 'ok', good: 'ok', possible: 'warn', unsuitable: 'wrecked' };

/**
 * The garage at home: a card per design (price, hangar, fit for the chosen mission as an icon)
 * and an inspector for the chosen one: ratings as icons and pips, loadout as numbers. The 3D
 * preview above the launch pad shows the same plane.
 */
export class Garage {
  private cardsKey = '';

  constructor(
    private readonly cards: HTMLElement,
    private readonly inspector: HTMLElement,
    private readonly onSelect: (id: AircraftId) => void,
  ) {
    inspector.innerHTML = /* html */ `
      <div class="insp-head"><span class="swatch" data-i="swatch"></span><b data-i="name"></b><span class="tag" data-i="role"></span><span class="fit-badge" data-i="fit"></span></div>
      <dl class="ratings" data-i="ratings"></dl>
      <div class="stats" data-i="loadout"></div>
      <div class="insp-keys hint-keys"><kbd>Q</kbd><kbd>E</kbd>${icon('swap')}</div>`;
  }

  render(v: GarageView | null): void {
    toggle(this.cards, v !== null);
    toggle(this.inspector, v !== null);
    if (!v) return;
    this.renderCards(v);
    this.renderInspector(v.inspector);
  }

  private renderCards(v: GarageView): void {
    const key = v.cards.map((c) => `${c.id}|${c.buildKind}|${c.buildCost}|${c.hangar}|${c.suitability}|${c.affordable}|${Math.round((c.hangarHealth ?? 1) * 20)}`).join('/');
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      this.cards.innerHTML = '';
      for (const c of v.cards) {
        const card = document.createElement('button');
        card.className = 'plane-card';
        card.dataset.id = c.id;
        card.style.setProperty('--accent', c.accent);
        card.title = `${c.name} · ${c.roleLabel} · ${SUITABILITY_LABELS[c.suitability]}${c.hangar === 'ready' ? ' · in the hangar' : c.hangar === 'recovered' ? ` · recovered, refit ${c.buildCost} instead of ${c.cost}` : ''}`;
        const price =
          c.buildKind === 'rollout' ? `${icon('home')}<b>0</b>`
          : c.buildKind === 'refit' ? `${icon('repair')}<b>${c.buildCost}</b>`
          : `${icon('paper')}<b>${c.cost}</b>`;
        const health = c.hangar === 'recovered' && c.hangarHealth !== null ? `<span class="pc-health"><i style="width:${Math.round(c.hangarHealth * 100)}%"></i></span>` : '';
        card.innerHTML = `
          <span class="pc-name">${esc(c.name)}</span>
          <span class="fit-badge small" data-level="${c.suitability}">${icon(FIT_ICONS[c.suitability])}</span>
          <span class="pc-price${c.affordable ? '' : ' short'}">${price}</span>
          ${health}`;
        bindButton(card, () => this.onSelect(c.id));
        this.cards.appendChild(card);
      }
    }
    for (const el of this.cards.children as HTMLCollectionOf<HTMLElement>) {
      const c = v.cards.find((x) => x.id === el.dataset.id);
      el.classList.toggle('selected', !!c?.selected);
      (el as HTMLButtonElement).disabled = v.locked && !c?.selected;
    }
  }

  private renderInspector(i: InspectorView): void {
    const q = (name: string) => this.inspector.querySelector<HTMLElement>(`[data-i="${name}"]`)!;
    q('swatch').style.background = i.accent;
    text(q('name'), i.name);
    q('name').title = i.tagline;
    text(q('role'), i.roleLabel);
    const fit = q('fit');
    attr(fit, 'data-level', i.suitability.level);
    const fitKey = i.suitability.level;
    if (fit.dataset.key !== fitKey) {
      fit.dataset.key = fitKey;
      fit.innerHTML = icon(FIT_ICONS[i.suitability.level]);
    }
    fit.title = `${SUITABILITY_LABELS[i.suitability.level]} for ${i.suitability.missionTitle}: ${i.suitability.reason}`;
    const ratings = q('ratings');
    if (ratings.children.length !== i.ratings.length) {
      ratings.innerHTML = i.ratings.map((r) => `<div title="${esc(r.label)}"><dt>${icon(RATING_ICONS[r.key])}</dt><dd><span class="pips5"><i></i><i></i><i></i><i></i><i></i></span></dd></div>`).join('');
    }
    i.ratings.forEach((r, k) => {
      const row = ratings.children[k] as HTMLElement;
      row.title = `${r.label} ${r.value}/5`;
      [...row.querySelectorAll('i')].forEach((pip, n) => pip.classList.toggle('on', n < r.value));
    });
    const loadout = q('loadout');
    const html = i.loadout.map((s) => `<span class="stat" title="${esc(s.label)}">${icon(s.icon)}<b>${esc(s.value)}</b></span>`).join('');
    if (loadout.dataset.html !== html) {
      loadout.dataset.html = html;
      loadout.innerHTML = html;
    }
    loadout.title = i.record ?? '';
  }
}

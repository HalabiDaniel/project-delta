import { SUITABILITY_LABELS, type RatingKey, type SuitabilityLevel } from '../aircraft/Aircraft';
import type { AircraftId } from '../config';
import type { BuildKind } from '../systems/GameState';
import { attr, bindButton, esc, text, toggle } from './dom';

export interface GarageCardView {
  id: AircraftId;
  name: string;
  roleLabel: string;
  accent: string;
  cost: number;
  /** What pressing F would cost for this design right now, and what it would do. */
  buildCost: number;
  buildKind: BuildKind;
  /** A plane of this design waiting at home: stowed and ready, or recovered and needing a refit. */
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
  loadout: string[];
  suitability: { level: SuitabilityLevel; reason: string; missionTitle: string };
}

export interface GarageView {
  cards: GarageCardView[];
  inspector: InspectorView;
  /** Folding is under way: the choice can't change. */
  locked: boolean;
}

/**
 * The garage at home: a card per design (cost, hangar, how well it suits the chosen mission) and an
 * inspector for the chosen one with its ratings and loadout. The 3D preview above the launch pad
 * shows the same plane.
 */
export class Garage {
  private cardsKey = '';

  constructor(
    private readonly cards: HTMLElement,
    private readonly inspector: HTMLElement,
    private readonly onSelect: (id: AircraftId) => void,
  ) {
    inspector.innerHTML = /* html */ `
      <div class="insp-head"><span class="swatch" data-i="swatch"></span><b data-i="name"></b><span class="role-chip" data-i="role"></span></div>
      <p class="insp-tagline" data-i="tagline"></p>
      <dl class="ratings" data-i="ratings"></dl>
      <ul class="loadout" data-i="loadout"></ul>
      <div class="fit" data-i="fit"><span class="fit-badge" data-i="fit-badge"></span><span class="fit-text" data-i="fit-text"></span></div>
      <p class="insp-hint">Drag the model to turn it · <kbd>Q</kbd><kbd>E</kbd> switch plane</p>`;
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
        const price =
          c.buildKind === 'rollout' ? 'In hangar · <b>free</b>'
          : c.buildKind === 'refit' ? `Refit <b>${c.buildCost}</b> <s>${c.cost}</s>`
          : `<b>${c.cost}</b> paper`;
        const health = c.hangar === 'recovered' && c.hangarHealth !== null ? `<span class="pc-health"><i style="width:${Math.round(c.hangarHealth * 100)}%"></i></span>` : '';
        card.innerHTML = `
          <span class="pc-name">${esc(c.name)}</span>
          <span class="fit-badge small" data-level="${c.suitability}">${SUITABILITY_LABELS[c.suitability]}</span>
          <span class="pc-role">${esc(c.roleLabel)}</span>
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
    text(q('role'), i.roleLabel);
    text(q('tagline'), i.tagline);
    const ratings = q('ratings');
    if (ratings.children.length !== i.ratings.length) {
      ratings.innerHTML = i.ratings.map(() => '<div><dt></dt><dd><span class="pips"><i></i><i></i><i></i><i></i><i></i></span></dd></div>').join('');
    }
    i.ratings.forEach((r, k) => {
      const row = ratings.children[k] as HTMLElement;
      text(row.querySelector('dt') as HTMLElement, r.label);
      [...row.querySelectorAll('i')].forEach((pip, n) => pip.classList.toggle('on', n < r.value));
    });
    const loadout = q('loadout');
    const html = i.loadout.map((line) => `<li>${esc(line)}</li>`).join('');
    if (loadout.innerHTML !== html) loadout.innerHTML = html;
    const badge = q('fit-badge');
    attr(badge, 'data-level', i.suitability.level);
    text(badge, SUITABILITY_LABELS[i.suitability.level]);
    text(q('fit-text'), `for ${i.suitability.missionTitle}: ${i.suitability.reason}`);
  }
}

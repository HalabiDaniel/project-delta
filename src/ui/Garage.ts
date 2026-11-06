import { SUITABILITY_LABELS, type RatingKey, type SuitabilityLevel } from '../aircraft/Aircraft';
import type { AircraftId } from '../config';
import type { BuildKind } from '../systems/GameState';
import { attrs, bar, glyph, pips, stat, tooltipAttrs } from './components';
import { attr, esc, text, toggle } from './dom';
import { icon, ICON_NAMES, type IconName } from './icons';
import { SAY } from './strings';
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

/** Mission fit as an icon (and a shape: tick, warning triangle, cross), never colour alone. */
export const FIT_ICONS: Record<SuitabilityLevel, IconName> = { recommended: 'ok', good: 'ok', possible: 'warn', unsuitable: 'wrecked' };

function fitBadge(level: SuitabilityLevel, tipText: string, small = false): string {
  return `<span class="fit-badge${small ? ' small' : ''}" data-level="${level}" role="img" aria-label="${esc(SUITABILITY_LABELS[level])}" ${attrs(tooltipAttrs(tipText))}>${icon(FIT_ICONS[level])}</span>`;
}

/**
 * A plane card: name, mission fit icon, price as icon and number, hangar health. The Raptor is the
 * reference. `.pc-extra` (and `[data-i="tricks"]` in the inspector) is the empty, hidden extension
 * point for v0.0.16's trick cards: chips or pips from the design system go there without a layout
 * change (the card is a grid whose extra row spans both columns).
 */
export function planeCardHtml(c: GarageCardView): string {
  const price =
    c.buildKind === 'rollout' ? `${icon('home')}<b class="num">0</b>`
    : c.buildKind === 'refit' ? `${icon('repair')}<b class="num">${c.buildCost}</b>`
    : `${icon('paper')}<b class="num">${c.cost}</b>`;
  const tipText = `${c.name} · ${c.roleLabel} · ${SUITABILITY_LABELS[c.suitability]}${c.hangar === 'ready' ? ' · in the hangar' : c.hangar === 'recovered' ? ` · recovered, refit ${c.buildCost} instead of ${c.cost}` : ''}`;
  const health = c.hangar === 'recovered' && c.hangarHealth !== null ? bar({ value: c.hangarHealth, label: ICON_NAMES.health, size: 'mini', className: 'pc-health' }) : '';
  return `<button type="button" class="plane-card" data-id="${c.id}" style="--accent:${esc(c.accent)}" aria-label="${esc(tipText)}" ${attrs(tooltipAttrs(tipText))}>
    <span class="pc-name">${esc(c.name)}</span>${fitBadge(c.suitability, SUITABILITY_LABELS[c.suitability], true)}
    <span class="pc-price${c.affordable ? '' : ' short'}">${price}</span>${health}<span class="pc-extra" data-slot="tricks" hidden></span></button>`;
}

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
    cards.setAttribute('role', 'group');
    cards.setAttribute('aria-label', SAY.aircraft);
    inspector.setAttribute('role', 'group');
    inspector.innerHTML = /* html */ `<div class="ui-card-body">
      <div class="insp-head"><span class="swatch" data-i="swatch"></span><b data-i="name"></b><span class="ui-chip" data-i="role"></span><span data-i="fit"></span></div>
      <dl class="ratings" data-i="ratings" aria-label="${SAY.ratings}"></dl>
      <div class="stats" data-i="loadout" role="group" aria-label="${SAY.loadout}"></div>
      <div class="insp-tricks" data-i="tricks" hidden></div>
      <div class="insp-keys hint-keys">${glyph({ key: 'Q' })}${glyph({ key: 'E' })}${icon('swap')}</div></div>`;
    cards.addEventListener('mousedown', (e) => e.preventDefault());
    cards.addEventListener('click', (e) => {
      const card = (e.target as Element).closest<HTMLButtonElement>('.plane-card');
      if (!card || card.disabled) return;
      e.stopPropagation();
      this.onSelect(card.dataset.id as AircraftId);
    });
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
      this.cards.innerHTML = v.cards.map(planeCardHtml).join('');
    }
    for (const el of this.cards.children as HTMLCollectionOf<HTMLButtonElement>) {
      const c = v.cards.find((x) => x.id === el.dataset.id);
      el.classList.toggle('selected', !!c?.selected);
      attr(el, 'aria-pressed', String(!!c?.selected));
      el.disabled = v.locked && !c?.selected;
    }
  }

  private renderInspector(i: InspectorView): void {
    const q = (name: string) => this.inspector.querySelector<HTMLElement>(`[data-i="${name}"]`)!;
    const swatch = q('swatch');
    if (swatch.dataset.c !== i.accent) {
      swatch.dataset.c = i.accent;
      swatch.style.background = i.accent;
    }
    text(q('name'), i.name);
    attr(q('name'), 'data-tip', i.tagline);
    attr(this.inspector, 'aria-label', i.name);
    text(q('role'), i.roleLabel);
    const fitTip = `${SUITABILITY_LABELS[i.suitability.level]} for ${i.suitability.missionTitle}: ${i.suitability.reason}`;
    const fitHtml = fitBadge(i.suitability.level, fitTip);
    const fit = q('fit');
    if (fit.dataset.html !== fitHtml) {
      fit.dataset.html = fitHtml;
      fit.innerHTML = fitHtml;
    }
    const ratings = q('ratings');
    const rHtml = i.ratings.map((r) => `<div ${attrs(tooltipAttrs(`${r.label} ${r.value}/5`))}><dt>${icon(RATING_ICONS[r.key], 'icon', r.label)}</dt><dd>${pips({ filled: r.value, total: 5, label: `${r.label} ${r.value}/5`, tone: 'friend' })}</dd></div>`).join('');
    if (ratings.dataset.html !== rHtml) {
      ratings.dataset.html = rHtml;
      ratings.innerHTML = rHtml;
    }
    const loadout = q('loadout');
    const html = i.loadout.map((s) => stat({ icon: s.icon, value: s.value, label: s.label, tone: s.tone === 'bad' ? 'hostile' : s.tone === 'warn' ? 'warn' : s.tone === 'good' ? 'good' : undefined })).join('');
    if (loadout.dataset.html !== html) {
      loadout.dataset.html = html;
      loadout.innerHTML = html;
    }
    attr(loadout, 'data-tip', i.record ?? '');
  }
}

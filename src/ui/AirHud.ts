import type { Side } from '../config';
import { attr, place, text, toggle, width, type ScreenPoint } from './dom';
import { icon, type IconName } from './icons';

/** A marker on an AI aircraft: brackets and a tag on screen, or a chevron at the screen edge when it is off screen. */
export interface AircraftMarkerView extends ScreenPoint {
  id: string;
  onScreen: boolean;
  /** Screen-space direction towards it (radians), for the edge chevron. */
  angle: number;
  side: Side;
  icon: IconName;
  /** "Enemy Falcon", "Your Widewing". */
  name: string;
  /** "Fighter · Veteran", "Attacking you!", "Bombing run"… */
  detail: string;
  distance: number;
  /** 0–1. */
  health: number;
  /** The health bar shows while it is being aimed at or was just hit. */
  showHealth: boolean;
  /** 0 close → 1 far, for fading: distant aircraft are less prominent. */
  far: number;
  /** One the mission wants shot down (or protected). */
  mission: boolean;
  /** It is shooting at the player. */
  attacking: boolean;
  /** Crowded by a more important marker: brackets only, no tag. */
  compact: boolean;
}

export interface RaidAlertView {
  state: 'inbound' | 'released';
  title: string;
  subtitle: string;
  /** Seconds until the bomber reaches the store. */
  eta: number;
  target: string;
  objective: string;
  rewardLabel: string;
  reward: string;
  /** Distance from the player's plane, in flight. */
  distance: number | null;
}

export interface AirView {
  markers: AircraftMarkerView[];
  /** Where to aim to hit the enemy aircraft nearest the nose. */
  lead: ScreenPoint | null;
  raid: RaidAlertView | null;
}

const RAID = /* html */ `
  <div class="ra-head"><span class="ra-icon">${icon('bomber')}</span><span class="ra-title" data-ra-title></span><span class="ra-eta" data-ra-eta></span></div>
  <div class="ra-sub" data-ra-sub></div>
  <dl class="ra-facts">
    <div><dt>Target</dt><dd data-ra-target></dd></div>
    <div><dt>Objective</dt><dd data-ra-objective></dd></div>
    <div><dt data-ra-reward-label></dt><dd data-ra-reward></dd></div>
  </dl>
`;

/**
 * Combat in the air, on screen: a marker on every AI aircraft nearby (brackets, name and role,
 * distance, a health bar while it is being aimed at or hit, fading with distance), a subtle chevron
 * at the screen edge for those off screen, a lead sight showing where to shoot at the enemy nearest
 * the nose, and the incoming-bomber alert.
 */
export class AirHud {
  private readonly layer: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly raid: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly markers = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, raidHost: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'air-markers';
    root.appendChild(this.layer);
    this.lead = document.createElement('div');
    this.lead.className = 'lead-mark';
    root.appendChild(this.lead);
    this.raid = document.createElement('div');
    this.raid.className = 'raid-alert';
    this.raid.innerHTML = RAID;
    raidHost.appendChild(this.raid);
    for (const node of this.raid.querySelectorAll<HTMLElement>('*')) {
      for (const name of node.getAttributeNames()) if (name.startsWith('data-')) this.el[name.slice(5)] = node;
    }
  }

  render(v: AirView | null): void {
    this.renderMarkers(v?.markers ?? []);
    place(this.lead, v?.lead ?? null);
    const r = v?.raid ?? null;
    toggle(this.raid, r !== null);
    if (!r) return;
    attr(this.raid, 'data-state', r.state);
    text(this.el['ra-title'], r.title);
    text(this.el['ra-eta'], r.state === 'inbound' ? `ETA ${Math.max(0, Math.ceil(r.eta))} s` : 'BOMB AWAY');
    text(this.el['ra-sub'], r.distance !== null ? `${r.subtitle} · ${Math.round(r.distance)} m from you` : r.subtitle);
    text(this.el['ra-target'], r.target);
    text(this.el['ra-objective'], r.objective);
    text(this.el['ra-reward-label'], r.rewardLabel);
    text(this.el['ra-reward'], r.reward);
  }

  private renderMarkers(markers: readonly AircraftMarkerView[]): void {
    const seen = new Set<string>();
    for (const m of markers) {
      let el = this.markers.get(m.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'air-marker';
        el.innerHTML = `
          <div class="am-box"></div>
          <div class="am-tag"><span class="am-icon"></span><b class="am-name"></b><span class="am-dist"></span></div>
          <div class="am-detail"></div>
          <span class="am-health"><i></i></span>
          <div class="am-edge"><span class="am-chev"></span><span class="am-edge-icon"></span><span class="am-edge-dist"></span></div>`;
        this.layer.appendChild(el);
        this.markers.set(m.id, el);
      }
      const iconEl = el.querySelector('.am-icon') as HTMLElement;
      if (iconEl.dataset.icon !== m.icon) {
        iconEl.dataset.icon = m.icon;
        iconEl.innerHTML = icon(m.icon);
        (el.querySelector('.am-edge-icon') as HTMLElement).innerHTML = icon(m.icon);
      }
      attr(el, 'data-side', m.side);
      el.classList.toggle('offscreen', !m.onScreen);
      el.classList.toggle('mission', m.mission);
      el.classList.toggle('attacking', m.attacking);
      el.classList.toggle('compact', m.compact);
      el.style.transform = `translate(${m.x}px, ${m.y}px)`;
      el.style.opacity = String(1 - 0.5 * m.far);
      text(el.querySelector('.am-name') as HTMLElement, m.name);
      text(el.querySelector('.am-dist') as HTMLElement, `${Math.round(m.distance)} m`);
      text(el.querySelector('.am-detail') as HTMLElement, m.detail);
      text(el.querySelector('.am-edge-dist') as HTMLElement, `${Math.round(m.distance)} m`);
      (el.querySelector('.am-edge') as HTMLElement).style.transform = `rotate(${m.angle}rad)`;
      (el.querySelector('.am-edge-icon') as HTMLElement).style.transform = `rotate(${-m.angle}rad)`;
      (el.querySelector('.am-edge-dist') as HTMLElement).style.transform = `rotate(${-m.angle}rad)`;
      const health = el.querySelector('.am-health') as HTMLElement;
      toggle(health, m.showHealth && m.onScreen);
      const bar = health.firstElementChild as HTMLElement;
      width(bar, m.health);
      attr(bar, 'data-level', m.health > 0.6 ? 'ok' : m.health > 0.3 ? 'worn' : 'critical');
      toggle(el, true);
      seen.add(m.id);
    }
    for (const [id, el] of this.markers) {
      if (seen.has(id)) continue;
      el.remove();
      this.markers.delete(id);
    }
  }
}

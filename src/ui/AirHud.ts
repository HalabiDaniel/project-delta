import type { Side } from '../config';
import { attr, place, text, toggle, width, type ScreenPoint } from './dom';
import { icon, type IconName } from './icons';

const STATUS_ICONS: Record<NonNullable<AircraftMarkerView['status']>, IconName> = { attacking: 'kills', bombing: 'bomb', running: 'escape', leaving: 'heading' };

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
  /** "Fighter · Veteran", "Attacking you!", "Bombing run"… (the tooltip). */
  detail: string;
  /** What it is doing, as an icon: attacking, bombing, running, leaving. */
  status: 'attacking' | 'bombing' | 'running' | 'leaving' | null;
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

export interface AirView {
  markers: AircraftMarkerView[];
  /** Where to aim to hit the enemy aircraft nearest the nose. */
  lead: ScreenPoint | null;
}

/**
 * Combat in the air, on screen: a marker on every AI aircraft nearby (brackets, name and role,
 * distance, a health bar while it is being aimed at or hit, fading with distance), a subtle chevron
 * at the screen edge for those off screen, and a lead sight showing where to shoot at the enemy
 * nearest the nose. What a plane is doing shows as an icon (attacking, bombing, running).
 */
export class AirHud {
  private readonly layer: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly markers = new Map<string, HTMLElement>();

  constructor(root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'air-markers';
    root.appendChild(this.layer);
    this.lead = document.createElement('div');
    this.lead.className = 'lead-mark';
    root.appendChild(this.lead);
  }

  render(v: AirView | null): void {
    this.renderMarkers(v?.markers ?? []);
    place(this.lead, v?.lead ?? null);
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
          <div class="am-tag"><span class="am-icon"></span><span class="am-status"></span><span class="am-dist"></span></div>
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
      const status = el.querySelector('.am-status') as HTMLElement;
      if (status.dataset.status !== (m.status ?? '')) {
        status.dataset.status = m.status ?? '';
        status.innerHTML = m.status ? icon(STATUS_ICONS[m.status]) : '';
      }
      el.title = `${m.name} · ${m.detail}`;
      text(el.querySelector('.am-dist') as HTMLElement, `${Math.round(m.distance)} m`);
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

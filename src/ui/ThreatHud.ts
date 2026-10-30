import type { ThreatLevel } from '../config';
import type { InstallationKind } from '../defenses/Layout';
import { attr, text, toggle, width } from './dom';
import { icon, type IconName } from './icons';

export interface ThreatPanelView {
  territoryId: string;
  level: ThreatLevel;
  label: string;
  /**
   * clear       – nothing there has noticed the plane.
   * spotted     – its radar or a weapon knows where the plane is.
   * engaged     – something is shooting or locking on.
   * neutralised – every weapon there is destroyed.
   */
  status: 'clear' | 'spotted' | 'engaged' | 'neutralised';
  installations: Array<{ id: string; kind: InstallationKind; alive: boolean; engaged: boolean }>;
}

export interface ThreatRingItem {
  id: string;
  /** Bearing from the plane relative to the view: 0 straight ahead, positive to the right (radians). */
  angle: number;
  icon: IconName;
  state: 'tracking' | 'locking' | 'firing' | 'incoming';
  distance: number;
}

export interface LockView {
  /** locking – a launcher is locking on. incoming – a rocket is in the air. */
  state: 'locking' | 'incoming';
  progress: number;
  /** Distance to the nearest incoming rocket. */
  distance: number;
  count: number;
}

export interface ThreatView {
  panel: ThreatPanelView | null;
  ring: ThreatRingItem[];
  lock: LockView | null;
}

/** Radius of the ring of threat markers around the middle of the screen. */
const RING_RADIUS = 190;

const STATUS: Record<ThreatPanelView['status'], string> = {
  clear: 'Not spotted',
  spotted: 'Spotted!',
  engaged: 'Under fire!',
  neutralised: 'Defenses down',
};

const TEMPLATE = /* html */ `
  <div class="threat-panel" data-threat-panel>
    <span class="tp-id" data-tp-id></span><span class="tp-level" data-tp-level></span>
    <span class="tp-icons" data-tp-icons></span><span class="tp-status" data-tp-status></span>
  </div>
  <div class="lock-warning" data-lock>
    <div class="lw-title" data-lw-title></div>
    <div class="lw-bar"><i data-lw-bar></i></div>
    <div class="lw-sub" data-lw-sub></div>
  </div>
  <div class="threat-note" data-threat-note></div>
  <div class="threat-ring" data-threat-ring></div>
`;

/**
 * The warnings in flight: which defended territory the plane is approaching and whether it has
 * been spotted, where every defense following it is (a ring of markers around the middle of the
 * screen: ahead is up), the rocket lock and launch warning, and a red arc towards whatever just hit
 * the plane.
 */
export class ThreatHud {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly items = new Map<string, HTMLElement>();
  private iconsKey = '';
  private noteTimer = 0;

  constructor(root: HTMLElement) {
    const holder = document.createElement('div');
    holder.className = 'threat-hud';
    holder.innerHTML = TEMPLATE;
    root.appendChild(holder);
    for (const node of holder.querySelectorAll<HTMLElement>('*')) {
      for (const name of node.getAttributeNames()) if (name.startsWith('data-')) this.el[name.slice(5)] = node;
    }
  }

  render(v: ThreatView | null): void {
    const panel = v?.panel ?? null;
    toggle(this.el['threat-panel'], panel !== null);
    if (panel) {
      attr(this.el['threat-panel'], 'data-level', String(panel.level));
      attr(this.el['threat-panel'], 'data-status', panel.status);
      text(this.el['tp-id'], panel.territoryId);
      text(this.el['tp-level'], panel.label);
      text(this.el['tp-status'], STATUS[panel.status]);
      const key = panel.installations.map((i) => `${i.id}:${i.alive}:${i.engaged}`).join('|');
      if (key !== this.iconsKey) {
        this.iconsKey = key;
        this.el['tp-icons'].innerHTML = panel.installations
          .map((i) => `<span class="tp-icon" data-alive="${i.alive}" data-engaged="${i.engaged}" title="${i.kind}">${icon(i.kind)}</span>`)
          .join('');
      }
    }

    const lock = v?.lock ?? null;
    toggle(this.el.lock, lock !== null);
    if (lock) {
      attr(this.el.lock, 'data-state', lock.state);
      if (lock.state === 'locking') {
        text(this.el['lw-title'], 'ROCKET LOCK');
        text(this.el['lw-sub'], 'Break its line: turn hard, get low, or get out of range');
      } else {
        text(this.el['lw-title'], `ROCKET INCOMING${lock.count > 1 ? ` ×${lock.count}` : ''} · ${Math.round(lock.distance)} m`);
        text(this.el['lw-sub'], 'Turn hard across its path, outrun it, or shoot it down');
      }
      width(this.el['lw-bar'], lock.state === 'locking' ? lock.progress : 1);
    }

    const seen = new Set<string>();
    for (const item of v?.ring ?? []) {
      let el = this.items.get(item.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'threat-item';
        el.innerHTML = `<div class="tr-pos"><span class="tr-chev"></span><span class="tr-icon">${icon(item.icon)}</span><span class="tr-dist"></span></div>`;
        this.el['threat-ring'].appendChild(el);
        this.items.set(item.id, el);
      }
      attr(el, 'data-state', item.state);
      el.style.transform = `rotate(${item.angle}rad)`;
      const pos = el.firstElementChild as HTMLElement;
      pos.style.transform = `translateY(${-RING_RADIUS}px)`;
      (pos.querySelector('.tr-icon') as HTMLElement).style.transform = `rotate(${-item.angle}rad)`;
      const dist = pos.querySelector('.tr-dist') as HTMLElement;
      dist.style.transform = `rotate(${-item.angle}rad)`;
      text(dist, `${Math.round(item.distance)} m`);
      seen.add(item.id);
    }
    for (const [id, el] of this.items) {
      if (seen.has(id)) continue;
      el.remove();
      this.items.delete(id);
    }

    if (this.noteTimer && performance.now() > this.noteTimer) {
      this.el['threat-note'].classList.remove('show');
      this.noteTimer = 0;
    }
  }

  /** A red arc on the ring, towards what just hit the plane (bearing as for the ring items). */
  damageDirection(angle: number, strength: number): void {
    const el = document.createElement('div');
    el.className = 'hit-arc';
    el.style.transform = `rotate(${angle}rad)`;
    el.style.setProperty('--strength', String(Math.min(1, 0.45 + strength / 40)));
    this.el['threat-ring'].appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  /** A short line under the lock warning ("Lock broken"). */
  note(message: string, tone: 'good' | 'bad' | 'info'): void {
    const el = this.el['threat-note'];
    el.textContent = message;
    el.dataset.tone = tone;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.noteTimer = performance.now() + 1400;
  }
}

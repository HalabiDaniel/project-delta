import { attr, place, text, toggle, width, type ScreenPoint } from './dom';
import { level, metres } from './format';
import { bar } from './components';
import { icon, ICON_NAMES } from './icons';
import { STATE_LABELS, T } from './strings';
import type { HudView, TargetLabelView, TerritoryLabel } from './views';

const STATE_ICONS = { alert: 'warn', 'under-attack': 'raid', disabled: 'offline' } as const;

/**
 * Everything drawn over the 3D view at a point in the world: the reticles, the objective marker
 * (or an arrow at the screen edge), territory tags, tags over targets and defenses with their
 * health, hit markers, comic words and damage numbers.
 */
/** Neutral desks further than this (metres, on the ground) get no label. */
const LABEL_RANGE = 170;

export class WorldLabels {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly labelEls = new Map<string, HTMLElement>();
  private readonly targetEls = new Map<string, HTMLElement>();
  private hitTimer = 0;

  constructor(layer: HTMLElement) {
    layer.insertAdjacentHTML(
      'beforeend',
      /* html */ `
      <div class="labels" data-w="labels"></div>
      <div class="target-labels" data-w="target-labels"></div>
      <div class="target-indicator" role="img" data-w="target"><span class="ti-arrow" data-w="ti-arrow"></span><span class="ti-diamond"></span><span class="ti-icon" data-w="ti-icon"></span><b class="ti-label" data-w="ti-dist"></b></div>
      <div class="reticle nose" data-w="nose"><span class="hit-x"></span></div>
      <div class="reticle aim" data-w="aim"></div>
      <div class="pops" data-w="pops"></div>`,
    );
    for (const n of layer.querySelectorAll<HTMLElement>('[data-w]')) this.el[n.dataset.w!] = n;
  }

  render(v: HudView): void {
    const flying = v.phase === 'flying' && !v.paused;
    place(this.el.nose, flying ? v.nose : null);
    place(this.el.aim, flying && !v.flight?.autopilot ? v.aim : null);
    if (this.hitTimer && performance.now() > this.hitTimer) {
      this.el.nose.classList.remove('hit', 'kill');
      this.hitTimer = 0;
    }
    this.renderTarget(v);
    this.renderLabels(v.paused || v.baseMode ? [] : v.labels);
    this.renderTargetLabels(v.paused ? [] : v.targets);
  }

  /** The nose reticle flashes an X when a round lands; bigger when it finishes the target. */
  hitMarker(kill: boolean): void {
    const nose = this.el.nose;
    nose.classList.remove('hit', 'kill');
    void nose.offsetWidth;
    nose.classList.add(kill ? 'kill' : 'hit');
    this.hitTimer = performance.now() + (kill ? 420 : 160);
  }

  pop(word: string, tone: 'good' | 'bad' | 'info', at: ScreenPoint): void {
    this.float(word, 'pop-word', tone, at);
  }

  damageNumber(amount: number, at: ScreenPoint, kill = false): void {
    const jitter = { x: at.x + (Math.random() - 0.5) * 24, y: at.y - Math.random() * 10 };
    this.float(`${amount}`, kill ? 'damage-number kill' : 'damage-number', 'info', jitter);
  }

  private float(word: string, className: string, tone: string, at: ScreenPoint): void {
    const el = document.createElement('div');
    el.className = className;
    el.dataset.tone = tone;
    el.textContent = word;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    this.el.pops.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  private renderTarget(v: HudView): void {
    const el = this.el.target;
    const t = v.target;
    if (!t || v.paused || v.baseMode || v.phase === 'debrief' || v.phase === 'crashed') {
      toggle(el, false);
      return;
    }
    toggle(el, true);
    el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    el.classList.toggle('offscreen', !t.onScreen);
    el.classList.toggle('near', t.onScreen && t.near);
    attr(el, 'data-tone', t.tone);
    attr(el, 'aria-label', t.label);
    this.el['ti-arrow'].style.transform = `rotate(${t.angle}rad)`;
    text(this.el['ti-dist'], t.tone === 'home' ? T.flight.homeMarker(metres(t.distance)) : T.flight.targetMarker(metres(t.distance)));
    const iconEl = this.el['ti-icon'];
    if (iconEl.dataset.icon !== t.icon) {
      iconEl.dataset.icon = t.icon;
      iconEl.innerHTML = icon(t.icon);
    }
  }

  private renderLabels(all: TerritoryLabel[]): void {
    const seen = new Set<string>();
    // Desk labels only for the target, home and desks in range (v0.0.16); overlapping ones stack.
    const labels = all
      .filter((l) => l.role !== 'neutral' || l.distance === undefined || l.distance <= LABEL_RANGE)
      .sort((a, b) => a.y - b.y);
    const placed: Array<{ x: number; y: number }> = [];
    for (const label of labels) {
      let y = label.y;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((p) => Math.abs(p.x - label.x) < 56 && Math.abs(p.y - y) < 24);
        if (!hit) break;
        y = hit.y + 26;
      }
      placed.push({ x: label.x, y });
      let el = this.labelEls.get(label.id);
      if (!el) {
        el = document.createElement('div');
        this.el.labels.appendChild(el);
        this.labelEls.set(label.id, el);
      }
      const key = `${label.id}:${label.role}:${label.state}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        const state = label.state !== 'peaceful' ? icon(STATE_ICONS[label.state], 'icon', STATE_LABELS[label.state]) : '';
        // Role is shape as well as colour: a house for home, a diamond for the objective.
        el.innerHTML = `${label.role === 'home' ? icon('home') : label.role === 'objective' ? '<i class="tl-diamond"></i>' : ''}<b>${label.id}</b>${state}`;
        el.className = `territory-label ${label.role} state-${label.state}`;
      }
      el.style.transform = `translate(${label.x}px, ${y}px)`;
      toggle(el, true);
      seen.add(label.id);
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) toggle(el, false);
  }

  private renderTargetLabels(targets: TargetLabelView[]): void {
    const seen = new Set<string>();
    for (const t of targets) {
      let el = this.targetEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'target-label';
        el.setAttribute('role', 'img');
        el.innerHTML = `<span class="tl-icon"></span>${bar({ value: 1, label: ICON_NAMES.health, size: 'mini', className: 'tl-health' })}`;
        this.el['target-labels'].appendChild(el);
        this.targetEls.set(t.id, el);
      }
      const iconEl = el.querySelector('.tl-icon') as HTMLElement;
      const iconKey = t.icon ?? 'practice';
      if (iconEl.dataset.icon !== iconKey) {
        iconEl.dataset.icon = iconKey;
        iconEl.innerHTML = icon(iconKey);
      }
      attr(el, 'aria-label', `${t.name} · ${t.role}`);
      el.classList.toggle('mission', t.mission);
      attr(el, 'data-state', t.state ?? 'none');
      attr(el, 'data-side', t.side ?? 'none');
      const meter = el.querySelector('.tl-health') as HTMLElement;
      width(meter.firstElementChild as HTMLElement, t.health);
      attr(meter, 'data-level', level(t.health));
      el.style.transform = `translate(${t.x}px, ${t.y}px)`;
      el.style.opacity = String(1 - 0.55 * t.far);
      toggle(el, true);
      seen.add(t.id);
    }
    for (const [id, el] of this.targetEls) if (!seen.has(id)) toggle(el, false);
  }
}

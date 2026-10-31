import { attr, place, text, toggle, width, type ScreenPoint } from './dom';
import { level, metres } from './format';
import { icon } from './icons';
import { STATE_LABELS } from './strings';
import type { HudView, TargetLabelView, TerritoryLabel } from './views';

const STATE_ICONS = { alert: 'warn', 'under-attack': 'raid', disabled: 'offline' } as const;

/**
 * Everything drawn over the 3D view at a point in the world: the reticles, the objective marker
 * (or an arrow at the screen edge), territory tags, tags over targets and defenses with their
 * health, hit markers, comic words and damage numbers.
 */
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
      <div class="target-indicator" data-w="target"><span class="ti-arrow" data-w="ti-arrow"></span><span class="ti-diamond"></span><span class="ti-icon" data-w="ti-icon"></span><b class="ti-dist" data-w="ti-dist"></b></div>
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
    el.title = t.label;
    this.el['ti-arrow'].style.transform = `rotate(${t.angle}rad)`;
    text(this.el['ti-dist'], metres(t.distance));
    const iconEl = this.el['ti-icon'];
    if (iconEl.dataset.icon !== t.icon) {
      iconEl.dataset.icon = t.icon;
      iconEl.innerHTML = icon(t.icon);
    }
  }

  private renderLabels(labels: TerritoryLabel[]): void {
    const seen = new Set<string>();
    for (const label of labels) {
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
        el.innerHTML = `${label.role === 'home' ? icon('home') : ''}<b>${label.id}</b>${state}`;
        el.className = `territory-label ${label.role} state-${label.state}`;
      }
      el.style.transform = `translate(${label.x}px, ${label.y}px)`;
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
        el.innerHTML = `<span class="tl-icon"></span><span class="tl-health"><i></i></span>`;
        this.el['target-labels'].appendChild(el);
        this.targetEls.set(t.id, el);
      }
      const iconEl = el.querySelector('.tl-icon') as HTMLElement;
      const iconKey = t.icon ?? 'practice';
      if (iconEl.dataset.icon !== iconKey) {
        iconEl.dataset.icon = iconKey;
        iconEl.innerHTML = icon(iconKey);
      }
      el.title = `${t.name} · ${t.role}`;
      el.classList.toggle('mission', t.mission);
      attr(el, 'data-state', t.state ?? 'none');
      attr(el, 'data-side', t.side ?? 'none');
      const bar = el.querySelector('.tl-health i') as HTMLElement;
      width(bar, t.health);
      attr(bar, 'data-level', level(t.health));
      el.style.transform = `translate(${t.x}px, ${t.y}px)`;
      el.style.opacity = String(1 - 0.55 * t.far);
      toggle(el, true);
      seen.add(t.id);
    }
    for (const [id, el] of this.targetEls) if (!seen.has(id)) toggle(el, false);
  }
}

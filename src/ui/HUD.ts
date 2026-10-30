import type { MissionFailure, MissionStatus } from '../missions/BombingMission';
import type { GamePhase, GameStats } from '../systems/GameState';
import './hud.css';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TargetIndicator extends ScreenPoint {
  onScreen: boolean;
  /** Direction to the target in screen space (radians), for the edge arrow. */
  angle: number;
  distance: number;
}

export interface TerritoryLabel extends ScreenPoint {
  id: string;
  role: 'home' | 'neutral';
}

export interface HudView {
  paper: number;
  planeCost: number;
  stats: GameStats;
  phase: GamePhase;
  paused: boolean;
  canFold: boolean;
  mission: { title: string; targetId: string; reward: number; status: MissionStatus; failure: MissionFailure | null };
  flight: { speed: number; speedFrac: number; altitude: number; bomb: 'loaded' | 'falling' | 'used' } | null;
  pointerLocked: boolean;
  returnQueued: boolean;
  nose: ScreenPoint | null;
  aim: ScreenPoint | null;
  target: TargetIndicator | null;
  labels: TerritoryLabel[];
}

export interface HudActions {
  fold(): void;
  resetPaper(): void;
  returnHome(): void;
  resume(): void;
}

export type BannerTone = 'good' | 'bad' | 'info';

const CONTROLS: Array<[string, string]> = [
  ['Mouse', 'Steer the aircraft'],
  ['W / S', 'Speed up / slow down'],
  ['A / D', 'Assisted banking'],
  ['Space', 'Launch from your territory'],
  ['Left click', 'Drop the bomb'],
  ['R', 'Return to T1, or restart after a crash'],
  ['F', 'Fold a plane (at home)'],
  ['Esc', 'Pause / show controls'],
];

const TEMPLATE = /* html */ `
  <div class="labels" data-labels></div>
  <div class="target-indicator" data-target>
    <span class="ti-arrow"></span><span class="ti-diamond"></span><span class="ti-label" data-target-label></span>
  </div>
  <div class="reticle nose" data-nose></div>
  <div class="reticle aim" data-aim></div>

  <section class="panel resources">
    <div class="brand">paperwars<span>.io</span> <small>v0.0.1</small></div>
    <div class="paper"><svg class="paper-icon" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1h11l5 5v15H1z" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 1v5h5" fill="#e5e7eb" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><b data-paper></b><span>paper</span><span class="delta" data-delta></span></div>
    <dl class="stats">
      <div><dt>Planes folded</dt><dd data-built></dd></div>
      <div><dt>Successes</dt><dd data-successes></dd></div>
      <div><dt>Failures</dt><dd data-failures></dd></div>
    </dl>
  </section>

  <section class="panel mission">
    <div class="eyebrow">Mission</div>
    <div class="mission-title" data-mission-title></div>
    <div class="mission-meta" data-mission-meta></div>
    <div class="pill" data-mission-status></div>
    <p class="mission-hint" data-mission-hint></p>
  </section>

  <div class="banner" data-banner><div class="banner-title"></div><div class="banner-sub"></div></div>

  <section class="dock">
    <div class="dock-row" data-dock="desk">
      <button class="btn primary" data-fold>Fold Plane <span class="cost" data-fold-cost></span><kbd>F</kbd></button>
      <button class="btn ghost" data-reset>Reset paper to 100 <small>(dev)</small></button>
    </div>
    <p class="dock-note" data-fold-note></p>
    <div class="dock-row ready" data-dock="ready"><kbd class="big">Space</kbd><span>Launch from T1</span></div>
    <div class="dock-row flight" data-dock="flying">
      <div class="gauge"><span class="gauge-label">Speed</span><div class="bar"><i data-speed-bar></i></div><span class="gauge-value" data-speed></span></div>
      <div class="gauge"><span class="gauge-label">Alt</span><span class="gauge-value" data-alt></span></div>
      <div class="bomb-state" data-bomb></div>
    </div>
    <div class="dock-row" data-dock="crashed">
      <button class="btn primary" data-return>Return to T1 <kbd>R</kbd></button>
    </div>
  </section>

  <div class="keys" data-keys>
    <span><kbd>W</kbd><kbd>S</kbd></span><span>speed</span>
    <span><kbd>A</kbd><kbd>D</kbd></span><span>bank</span>
    <span><kbd>R</kbd></span><span>return home</span>
    <span><kbd>Esc</kbd></span><span>pause</span>
  </div>
  <div class="hint" data-lock-hint>Mouse not captured. Press <kbd>Esc</kbd>, then click to capture it.</div>

  <div class="overlay" data-overlay>
    <div class="overlay-card">
      <h2 data-overlay-title></h2>
      <table class="controls">
        ${CONTROLS.map(([key, action]) => `<tr><th><kbd>${key}</kbd></th><td>${action}</td></tr>`).join('')}
      </table>
      <button class="btn primary" data-resume>Resume</button>
      <p class="overlay-note">Click anywhere or press Esc to continue.</p>
    </div>
  </div>
`;

/** DOM overlay for paper, the mission card, flight readouts, markers, banners and the pause menu. */
export class HUD {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly docks: HTMLElement[];
  private readonly labelEls = new Map<string, HTMLElement>();
  private bannerTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    actions: HudActions,
  ) {
    root.classList.add('hud');
    root.innerHTML = TEMPLATE;
    for (const node of root.querySelectorAll<HTMLElement>('*')) {
      for (const attr of node.getAttributeNames()) {
        if (attr.startsWith('data-') && attr !== 'data-dock') this.el[attr.slice(5)] = node;
      }
    }
    this.docks = [...root.querySelectorAll<HTMLElement>('[data-dock]')];

    const bind = (key: string, action: () => void) => {
      const button = this.el[key];
      // Buttons never take focus, so Space can't re-trigger them after a click.
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
    };
    bind('fold', actions.fold);
    bind('reset', actions.resetPaper);
    bind('return', actions.returnHome);
    bind('resume', actions.resume);
    this.el.overlay.addEventListener('click', () => actions.resume());
  }

  render(v: HudView): void {
    const flying = v.phase === 'flying' && !v.paused;

    text(this.el.paper, String(v.paper));
    text(this.el.built, String(v.stats.planesBuilt));
    text(this.el.successes, String(v.stats.successes));
    text(this.el.failures, String(v.stats.failures));

    text(this.el['mission-title'], v.mission.title);
    text(this.el['mission-meta'], `Reward +${v.mission.reward} paper · Plane costs ${v.planeCost}`);
    const [statusText, tone] = missionStatusLabel(v.mission.status, v.mission.reward);
    text(this.el['mission-status'], statusText);
    attr(this.el['mission-status'], 'data-tone', tone);
    text(this.el['mission-hint'], missionHint(v));

    for (const dock of this.docks) toggle(dock, dock.dataset.dock === v.phase);
    toggle(this.el.keys, v.phase === 'flying');
    text(this.el['fold-cost'], `−${v.planeCost} paper`);
    (this.el.fold as HTMLButtonElement).disabled = !v.canFold;
    text(this.el['fold-note'], v.phase === 'desk' && !v.canFold ? 'Not enough paper. Use “Reset paper” to keep testing.' : '');
    toggle(this.el['fold-note'], v.phase === 'desk' && !v.canFold);

    if (v.flight) {
      text(this.el.speed, String(Math.round(v.flight.speed)));
      this.el['speed-bar'].style.width = `${Math.round(v.flight.speedFrac * 100)}%`;
      text(this.el.alt, `${Math.round(v.flight.altitude)} m`);
      const bomb = v.flight.bomb;
      this.el.bomb.innerHTML =
        bomb === 'loaded' ? 'Bomb loaded · <b>Left-click</b> to drop'
        : bomb === 'falling' ? (v.returnQueued ? 'Bomb falling… returning after impact' : 'Bomb falling…')
        : 'Bomb used';
      attr(this.el.bomb, 'data-state', bomb);
    }

    toggle(this.el['lock-hint'], flying && !v.pointerLocked);
    toggle(this.el.overlay, v.paused);
    text(this.el['overlay-title'], v.phase === 'flying' ? 'Paused' : 'Controls');
    this.root.classList.toggle('in-flight', flying);

    place(this.el.nose, flying ? v.nose : null);
    place(this.el.aim, flying ? v.aim : null);
    this.renderTarget(v);
    this.renderLabels(v.labels);

    if (this.bannerTimer && performance.now() > this.bannerTimer) {
      this.el.banner.classList.remove('show');
      this.bannerTimer = 0;
    }
  }

  banner(title: string, subtitle: string, tone: BannerTone, seconds = 3): void {
    const banner = this.el.banner;
    banner.querySelector('.banner-title')!.textContent = title;
    banner.querySelector('.banner-sub')!.textContent = subtitle;
    banner.dataset.tone = tone;
    banner.classList.remove('show');
    void banner.offsetWidth; // restart the entrance animation
    banner.classList.add('show');
    this.bannerTimer = performance.now() + seconds * 1000;
  }

  /** Floats "+50" / "−20" next to the paper counter. */
  paperDelta(delta: number): void {
    const el = this.el.delta;
    el.textContent = delta > 0 ? `+${delta}` : `−${-delta}`;
    el.dataset.tone = delta > 0 ? 'good' : 'bad';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  private renderTarget(v: HudView): void {
    const el = this.el.target;
    const t = v.target;
    if (!t || v.paused) {
      toggle(el, false);
      return;
    }
    toggle(el, true);
    el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    el.classList.toggle('offscreen', !t.onScreen);
    el.classList.toggle('done', v.mission.status === 'succeeded');
    // Right over the bullseye the marker only gets in the way of watching the drop.
    el.classList.toggle('near', t.onScreen && t.distance < 15);
    (el.querySelector('.ti-arrow') as HTMLElement).style.transform = `rotate(${t.angle}rad)`;
    text(this.el['target-label'], `${v.mission.targetId} · ${Math.round(t.distance)} m`);
  }

  private renderLabels(labels: TerritoryLabel[]): void {
    const seen = new Set<string>();
    for (const label of labels) {
      let el = this.labelEls.get(label.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `territory-label ${label.role}`;
        el.textContent = label.role === 'home' ? `${label.id} · Home` : label.id;
        this.el.labels.appendChild(el);
        this.labelEls.set(label.id, el);
      }
      el.style.transform = `translate(${label.x}px, ${label.y}px)`;
      toggle(el, true);
      seen.add(label.id);
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) toggle(el, false);
  }
}

function missionStatusLabel(status: MissionStatus, reward: number): [string, string] {
  switch (status) {
    case 'available': return ['Available', 'neutral'];
    case 'active': return ['In progress', 'info'];
    case 'succeeded': return [`Success · +${reward} paper`, 'good'];
    case 'failed': return ['Failed', 'bad'];
  }
}

function missionHint(v: HudView): string {
  const target = v.mission.targetId;
  switch (v.mission.status) {
    case 'available':
      return v.phase === 'ready' ? 'Plane ready. Press Space to launch.' : `Fold a plane, fly to ${target} and hit the bullseye.`;
    case 'active':
      return v.flight?.bomb === 'falling' ? 'Bombs away…' : `Fly to ${target} and drop your bomb on the bullseye.`;
    case 'succeeded':
      return 'Target hit! Press R to return to T1, or keep flying.';
    case 'failed':
      return v.mission.failure === 'missed' ? 'The bomb missed the bullseye. Press R to return to T1.'
        : v.mission.failure === 'aircraft-lost' ? 'Plane lost. No reward this time.'
        : 'Returned without success.';
  }
}

function text(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function attr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function toggle(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}

function place(el: HTMLElement, point: ScreenPoint | null): void {
  toggle(el, point !== null);
  if (point) el.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

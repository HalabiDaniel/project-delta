import type { BoostState } from '../aircraft/Boost';
import type { TouchdownCheck } from '../aircraft/Landing';
import { LANDING, type Difficulty } from '../config';
import type { MissionFailure, MissionStatus, MissionType } from '../missions/Mission';
import type { BoundaryState } from '../systems/Boundary';
import type { GamePhase, GameStats } from '../systems/GameState';
import { MiniMap, type MiniMapView } from './MiniMap';
import './hud.css';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface TargetIndicator extends ScreenPoint {
  onScreen: boolean;
  /** Direction to the target in screen space (radians), for the edge arrow. */
  angle: number;
  label: string;
  tone: 'target' | 'home' | 'ring';
  /** Close enough that the marker should fade out of the way. */
  near: boolean;
}

export interface TerritoryLabel extends ScreenPoint {
  id: string;
  role: 'home' | 'objective' | 'neutral';
}

export interface MissionCardView {
  type: MissionType;
  title: string;
  description: string;
  difficulty: Difficulty;
  difficultyLabel: string;
  stars: number;
  multiplier: number;
  reward: number;
  bombs: number;
  timeLimit: number | null;
}

export interface ObjectiveView {
  label: string;
  done: boolean;
  open: boolean;
  /** 0–1 for objectives that fill up (reconnaissance, ring count), else null. */
  progress: number | null;
  distance: number | null;
}

export interface TrackerView {
  title: string;
  type: MissionType;
  difficultyLabel: string;
  multiplier: number;
  reward: number;
  status: MissionStatus;
  failure: MissionFailure | null;
  timeLeft: number | null;
  objectives: ObjectiveView[];
  hint: string;
}

export interface FlightView {
  speed: number;
  /** Speed and throttle setting as fractions of the gauge (0 = min speed, 1 = top boosted speed). */
  speedFrac: number;
  throttleFrac: number;
  altitude: number;
  boost: { state: BoostState; level: number };
  bombs: { loaded: number; capacity: number; falling: number; cooldown: number; ready: boolean };
  autopilot: boolean;
}

export interface LandingView {
  speed: number;
  sink: number;
  rollDeg: number;
  check: TouchdownCheck;
}

export interface ResultView {
  recovered: boolean;
  headline: string;
  missionTitle: string;
  missionLine: string;
  missionTone: 'good' | 'bad';
  planeLine: string;
}

export interface HudView {
  paper: number;
  stats: GameStats;
  phase: GamePhase;
  paused: boolean;
  income: { producing: boolean; amount: number; interval: number; progress: number; cap: number };
  build: { cost: number; refit: boolean; canBuild: boolean; note: string | null; noteTone: 'bad' | 'info'; progress: number; refitting: boolean };
  /** Mission cards while choosing (desk → ready); null once launched. */
  cards: MissionCardView[] | null;
  selected: number;
  tracker: TrackerView | null;
  flight: FlightView | null;
  landing: LandingView | null;
  boundary: { state: BoundaryState; countdown: number };
  result: ResultView | null;
  pointerLocked: boolean;
  nose: ScreenPoint | null;
  aim: ScreenPoint | null;
  target: TargetIndicator | null;
  labels: TerritoryLabel[];
  minimap: MiniMapView;
}

export interface HudActions {
  build(): void;
  select(index: number): void;
  continueToDesk(): void;
  resume(): void;
}

export type BannerTone = 'good' | 'bad' | 'info';

export const MISSION_TYPE_LABELS: Record<MissionType, string> = {
  bombing: 'Bombing',
  precision: 'Precision bombing',
  recon: 'Reconnaissance',
  delivery: 'Timed delivery',
  return: 'Strike & return',
  'multi-bomb': 'Multi-target',
  rings: 'Flight challenge',
};

const CONTROLS: Array<[string, string]> = [
  ['Mouse', 'Steer the aircraft'],
  ['W / S', 'Speed up / slow down'],
  ['A / D', 'Assisted banking'],
  ['Shift', 'Boost (short burst, then recharge)'],
  ['Left click', 'Drop a bomb'],
  ['1 / 2 / 3', 'Choose a mission (at home)'],
  ['F', 'Fold a plane, or refit a recovered one'],
  ['Space', 'Launch from your territory'],
  ['R', 'Continue after landing or a crash'],
  ['Esc', 'Pause / show controls'],
];

const TEMPLATE = /* html */ `
  <div class="labels" data-labels></div>
  <div class="target-indicator" data-target>
    <span class="ti-arrow"></span><span class="ti-diamond"></span><span class="ti-label" data-target-label></span>
  </div>
  <div class="reticle nose" data-nose></div>
  <div class="reticle aim" data-aim></div>
  <div class="pops" data-pops></div>

  <section class="panel resources">
    <div class="brand">paperwars<span>.io</span> <small>v0.0.2</small></div>
    <div class="paper"><svg class="paper-icon" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1h11l5 5v15H1z" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 1v5h5" fill="#e5e7eb" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><b data-paper></b><span>paper</span><span class="delta" data-delta></span></div>
    <div class="income"><span class="income-bar"><i data-income-bar></i></span><span data-income-text></span></div>
    <dl class="stats">
      <div><dt>Planes folded</dt><dd data-built></dd></div>
      <div><dt>Planes recovered</dt><dd data-recovered></dd></div>
      <div><dt>Successes</dt><dd data-successes></dd></div>
      <div><dt>Failures</dt><dd data-failures></dd></div>
    </dl>
  </section>

  <section class="panel mission">
    <div data-cards-wrap>
      <div class="eyebrow">Choose a mission <span class="eyebrow-keys"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></span></div>
      <div class="cards" data-cards></div>
    </div>
    <div data-tracker>
      <div class="tracker-head"><span class="eyebrow" data-tr-type></span><span class="pill" data-tr-status></span></div>
      <div class="mission-title" data-tr-title></div>
      <div class="mission-meta" data-tr-meta></div>
      <div class="timer" data-tr-timer></div>
      <ul class="objectives" data-tr-objectives></ul>
      <p class="mission-hint" data-tr-hint></p>
    </div>
  </section>

  <div class="banner" data-banner><div class="banner-title"></div><div class="banner-sub"></div></div>
  <div class="boundary-warning" data-boundary><div class="bw-title" data-bw-title></div><div class="bw-sub" data-bw-sub></div></div>

  <section class="dock">
    <div class="landing-guide" data-landing>
      <span class="eyebrow">Landing at T1</span>
      <span class="check" data-lg-speed></span><span class="check" data-lg-sink></span><span class="check" data-lg-level></span>
    </div>
    <div class="dock-row" data-dock="desk">
      <button class="btn primary" data-build><span data-build-label></span><span class="cost" data-build-cost></span><kbd>F</kbd></button>
    </div>
    <p class="dock-note" data-build-note></p>
    <div class="dock-row building" data-dock="building"><span data-building-label></span><div class="bar wide"><i data-building-bar></i></div></div>
    <div class="dock-row ready" data-dock="ready"><kbd class="big">Space</kbd><span>Launch from T1</span></div>
    <div class="dock-row flight" data-dock="flying">
      <div class="gauge"><span class="gauge-label">Speed</span><div class="bar speed"><i data-speed-bar></i><b class="throttle-mark" data-throttle-mark></b></div><span class="gauge-value" data-speed></span></div>
      <div class="gauge"><span class="gauge-label">Alt</span><span class="gauge-value" data-alt></span></div>
      <div class="gauge boost" data-boost><span class="gauge-label">Boost</span><div class="bar"><i data-boost-bar></i></div><kbd>Shift</kbd></div>
      <div class="gauge bombs" data-bombs><span class="gauge-label">Bombs</span><span class="bomb-icons" data-bomb-icons></span><span class="bomb-text" data-bomb-text></span></div>
    </div>
    <div class="dock-row result" data-dock="result">
      <div class="result-card" data-result>
        <div class="eyebrow">Sortie report</div>
        <div class="result-title" data-res-title></div>
        <dl class="ledger">
          <div><dt data-res-mission-title></dt><dd data-res-mission></dd></div>
          <div><dt>Plane</dt><dd data-res-plane></dd></div>
        </dl>
        <button class="btn primary" data-continue>Continue <kbd>R</kbd></button>
      </div>
    </div>
  </section>

  <canvas class="minimap" data-minimap></canvas>

  <div class="keys" data-keys>
    <span><kbd>W</kbd><kbd>S</kbd></span><span>speed</span>
    <span><kbd>A</kbd><kbd>D</kbd></span><span>bank</span>
    <span><kbd>Shift</kbd></span><span>boost</span>
    <span><kbd>Click</kbd></span><span>drop bomb</span>
    <span><kbd>Esc</kbd></span><span>pause</span>
  </div>
  <div class="hint" data-lock-hint>Mouse not captured. Press <kbd>Esc</kbd>, then click to capture it.</div>

  <div class="overlay" data-overlay>
    <div class="overlay-card">
      <h2 data-overlay-title></h2>
      <table class="controls">
        ${CONTROLS.map(([key, action]) => `<tr><th><kbd>${key}</kbd></th><td>${action}</td></tr>`).join('')}
      </table>
      <p class="overlay-rules">No recall in v0.0.2: <b>land on T1</b> to bring your plane home. Come in slow (under ${LANDING.maxSpeed}), descend gently (under ${LANDING.maxSink} m/s) with the wings level.</p>
      <button class="btn primary" data-resume>Resume</button>
      <p class="overlay-note">Click anywhere or press Esc to continue.</p>
    </div>
  </div>
`;

/** DOM overlay: paper, mission cards and tracker, flight readouts, markers, banners, minimap, menus. */
export class HUD {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly docks: HTMLElement[];
  private readonly labelEls = new Map<string, HTMLElement>();
  private readonly minimap: MiniMap;
  private bannerTimer = 0;
  private cardsKey = '';
  private objectivesKey = '';
  private lastRender = performance.now();

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: HudActions,
  ) {
    root.classList.add('hud');
    root.innerHTML = TEMPLATE;
    for (const node of root.querySelectorAll<HTMLElement>('*')) {
      for (const attr of node.getAttributeNames()) {
        if (attr.startsWith('data-') && attr !== 'data-dock') this.el[attr.slice(5)] = node;
      }
    }
    this.docks = [...root.querySelectorAll<HTMLElement>('[data-dock]')];
    this.minimap = new MiniMap(this.el.minimap as HTMLCanvasElement);

    this.bindButton(this.el.build, actions.build);
    this.bindButton(this.el.continue, actions.continueToDesk);
    this.bindButton(this.el.resume, actions.resume);
    this.el.overlay.addEventListener('click', () => actions.resume());
  }

  render(v: HudView): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    const flying = v.phase === 'flying' && !v.paused;

    text(this.el.paper, String(v.paper));
    text(this.el.built, String(v.stats.planesBuilt));
    text(this.el.recovered, String(v.stats.planesRecovered));
    text(this.el.successes, String(v.stats.successes));
    text(this.el.failures, String(v.stats.failures));
    this.el['income-bar'].style.width = `${Math.round((v.income.producing ? v.income.progress : 0) * 100)}%`;
    text(
      this.el['income-text'],
      v.income.producing ? `T1 makes +${v.income.amount} every ${v.income.interval} s` : `Income paused at ${v.income.cap}+ paper`,
    );

    this.renderCards(v);
    this.renderTracker(v.tracker);
    this.renderDock(v);
    this.renderBoundary(v);

    toggle(this.el.keys, flying);
    toggle(this.el['lock-hint'], flying && !v.pointerLocked);
    toggle(this.el.overlay, v.paused);
    text(this.el['overlay-title'], v.phase === 'flying' ? 'Paused' : 'Controls');
    this.root.classList.toggle('in-flight', flying);

    place(this.el.nose, flying ? v.nose : null);
    place(this.el.aim, flying && !v.flight?.autopilot ? v.aim : null);
    this.renderTarget(v);
    this.renderLabels(v.labels);
    this.minimap.render(v.minimap, dt);

    if (this.bannerTimer && now > this.bannerTimer) {
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

  /** A comic-book word ("BOOM!") that pops up at a point on screen and fades. */
  pop(word: string, tone: 'good' | 'bad' | 'info', at: ScreenPoint): void {
    const el = document.createElement('div');
    el.className = 'pop-word';
    el.dataset.tone = tone;
    el.textContent = word;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    this.el.pops.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  private bindButton(button: HTMLElement, action: () => void): void {
    // Buttons never take focus, so Space can't re-trigger them after a click.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      action();
    });
  }

  private renderCards(v: HudView): void {
    toggle(this.el['cards-wrap'], v.cards !== null);
    if (!v.cards) return;
    const key = v.cards.map((c) => `${c.title}|${c.difficulty}|${c.reward}`).join('/');
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      const wrap = this.el.cards;
      wrap.innerHTML = '';
      v.cards.forEach((c, i) => {
        const card = document.createElement('button');
        card.className = 'card';
        card.dataset.difficulty = c.difficulty;
        const stars = '★'.repeat(c.stars) + '☆'.repeat(3 - c.stars);
        const facts = [c.bombs > 0 ? `${c.bombs} bomb${c.bombs === 1 ? '' : 's'}` : 'No bombs', c.timeLimit ? `${c.timeLimit} s limit` : 'No time limit'];
        card.innerHTML = `
          <div class="card-top"><kbd>${i + 1}</kbd><span class="card-type">${MISSION_TYPE_LABELS[c.type]}</span><span class="card-diff" title="${c.difficultyLabel}">${stars} <b>×${c.multiplier}</b></span></div>
          <div class="card-title"></div>
          <div class="card-desc"></div>
          <div class="card-foot"><span>${facts.join(' · ')}</span><b class="card-reward">+${c.reward}</b></div>`;
        card.querySelector('.card-title')!.textContent = c.title;
        card.querySelector('.card-desc')!.textContent = c.description;
        this.bindButton(card, () => this.actions.select(i));
        wrap.appendChild(card);
      });
    }
    [...this.el.cards.children].forEach((card, i) => card.classList.toggle('selected', i === v.selected));
  }

  private renderTracker(t: TrackerView | null): void {
    toggle(this.el.tracker, t !== null);
    if (!t) return;
    text(this.el['tr-type'], `${MISSION_TYPE_LABELS[t.type]} · ${t.difficultyLabel} ×${t.multiplier}`);
    text(this.el['tr-title'], t.title);
    text(this.el['tr-meta'], `Reward +${t.reward} paper`);
    const [statusText, tone] = statusLabel(t.status, t.reward);
    text(this.el['tr-status'], statusText);
    attr(this.el['tr-status'], 'data-tone', tone);

    const timer = this.el['tr-timer'];
    toggle(timer, t.timeLeft !== null && t.status === 'active');
    if (t.timeLeft !== null) {
      text(timer, `${Math.ceil(t.timeLeft)} s left`);
      timer.classList.toggle('urgent', t.timeLeft < 5);
    }

    const list = this.el['tr-objectives'];
    const key = t.objectives.map((o) => o.label).join('|');
    if (key !== this.objectivesKey) {
      this.objectivesKey = key;
      list.innerHTML = t.objectives
        .map(() => '<li><span class="obj-box"></span><span class="obj-label"></span><span class="obj-dist"></span><span class="obj-progress"><i></i></span></li>')
        .join('');
    }
    t.objectives.forEach((o, i) => {
      const li = list.children[i] as HTMLElement;
      li.classList.toggle('done', o.done);
      li.classList.toggle('open', o.open);
      text(li.querySelector('.obj-label') as HTMLElement, o.label);
      text(li.querySelector('.obj-dist') as HTMLElement, o.distance !== null && o.open ? `${Math.round(o.distance)} m` : '');
      const bar = li.querySelector('.obj-progress') as HTMLElement;
      toggle(bar, o.progress !== null && !o.done);
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round((o.progress ?? 0) * 100)}%`;
    });
    text(this.el['tr-hint'], t.hint);
  }

  private renderDock(v: HudView): void {
    const dockKey = v.phase === 'landed' || v.phase === 'crashed' ? (v.result ? 'result' : '') : v.phase;
    for (const dock of this.docks) toggle(dock, dock.dataset.dock === dockKey);

    const b = v.build;
    text(this.el['build-label'], b.refit ? 'Refit Falcon' : 'Fold Falcon');
    text(this.el['build-cost'], `−${b.cost} paper`);
    (this.el.build as HTMLButtonElement).disabled = !b.canBuild;
    const note = this.el['build-note'];
    toggle(note, v.phase === 'desk' && b.note !== null);
    text(note, b.note ?? '');
    attr(note, 'data-tone', b.noteTone);
    text(this.el['building-label'], b.refitting ? 'Refitting your Falcon…' : 'Folding a new Falcon…');
    this.el['building-bar'].style.width = `${Math.round(b.progress * 100)}%`;

    const f = v.flight;
    if (f) {
      text(this.el.speed, String(Math.round(f.speed)));
      this.el['speed-bar'].style.width = `${Math.round(f.speedFrac * 100)}%`;
      this.el['throttle-mark'].style.left = `${Math.round(f.throttleFrac * 100)}%`;
      text(this.el.alt, `${Math.round(f.altitude)} m`);
      attr(this.el.boost, 'data-state', f.boost.state);
      this.el['boost-bar'].style.width = `${Math.round(f.boost.level * 100)}%`;

      const bombs = f.bombs;
      const icons = this.el['bomb-icons'];
      const iconKey = `${bombs.capacity}:${bombs.loaded}`;
      if (icons.dataset.key !== iconKey) {
        icons.dataset.key = iconKey;
        icons.innerHTML = Array.from({ length: bombs.capacity }, (_, i) => `<i class="${i < bombs.loaded ? 'full' : ''}"></i>`).join('');
      }
      const state =
        bombs.capacity === 0 ? 'none'
        : bombs.ready ? 'ready'
        : bombs.loaded > 0 ? 'reloading'
        : bombs.falling > 0 ? 'falling'
        : 'empty';
      attr(this.el.bombs, 'data-state', state);
      this.el.bombs.style.setProperty('--cooldown', String(bombs.cooldown));
      text(
        this.el['bomb-text'],
        state === 'none' ? 'None on this mission'
        : state === 'ready' ? 'Ready · Left-click'
        : state === 'reloading' ? 'Reloading…'
        : state === 'falling' ? 'Bombs away…'
        : 'Empty',
      );
    }

    const l = v.landing;
    toggle(this.el.landing, l !== null && !v.paused);
    if (l) {
      check(this.el['lg-speed'], l.check.speedOk, `Speed ${Math.round(l.speed)} / ${LANDING.maxSpeed}`);
      check(this.el['lg-sink'], l.check.sinkOk, `Descent ${Math.max(0, l.sink).toFixed(1)} / ${LANDING.maxSink} m/s`);
      check(this.el['lg-level'], l.check.levelOk, `Bank ${Math.round(Math.abs(l.rollDeg))}°`);
      this.el.landing.classList.toggle('ok', l.check.ok);
    }

    const r = v.result;
    if (r) {
      text(this.el['res-title'], r.headline);
      attr(this.el['res-title'], 'data-tone', r.recovered ? 'good' : 'bad');
      text(this.el['res-mission-title'], r.missionTitle);
      text(this.el['res-mission'], r.missionLine);
      attr(this.el['res-mission'], 'data-tone', r.missionTone);
      text(this.el['res-plane'], r.planeLine);
      attr(this.el['res-plane'], 'data-tone', r.recovered ? 'good' : 'bad');
    }
  }

  private renderBoundary(v: HudView): void {
    const b = v.boundary;
    const show = v.phase === 'flying' && b.state !== 'inside' && !v.paused;
    toggle(this.el.boundary, show);
    if (!show) return;
    attr(this.el.boundary, 'data-state', b.state);
    if (b.state === 'warning') {
      text(this.el['bw-title'], `Leaving the airspace! ${Math.ceil(b.countdown)}`);
      text(this.el['bw-sub'], 'Turn back now, or the autopilot will fly you home.');
    } else {
      text(this.el['bw-title'], 'Autopilot engaged');
      text(this.el['bw-sub'], 'Returning to the airspace. You get control back shortly.');
    }
  }

  private renderTarget(v: HudView): void {
    const el = this.el.target;
    const t = v.target;
    if (!t || v.paused || v.phase === 'landed' || v.phase === 'crashed') {
      toggle(el, false);
      return;
    }
    toggle(el, true);
    el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    el.classList.toggle('offscreen', !t.onScreen);
    el.classList.toggle('near', t.onScreen && t.near);
    attr(el, 'data-tone', t.tone);
    (el.querySelector('.ti-arrow') as HTMLElement).style.transform = `rotate(${t.angle}rad)`;
    text(this.el['target-label'], t.label);
  }

  private renderLabels(labels: TerritoryLabel[]): void {
    const seen = new Set<string>();
    for (const label of labels) {
      let el = this.labelEls.get(label.id);
      if (!el) {
        el = document.createElement('div');
        el.textContent = label.role === 'home' ? `${label.id} · Home` : label.id;
        this.el.labels.appendChild(el);
        this.labelEls.set(label.id, el);
      }
      const className = `territory-label ${label.role}`;
      if (el.className !== className) el.className = className;
      el.style.transform = `translate(${label.x}px, ${label.y}px)`;
      toggle(el, true);
      seen.add(label.id);
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) toggle(el, false);
  }
}

function statusLabel(status: MissionStatus, reward: number): [string, string] {
  switch (status) {
    case 'available': return ['Ready', 'neutral'];
    case 'active': return ['In progress', 'info'];
    case 'succeeded': return [`Success · +${reward}`, 'good'];
    case 'failed': return ['Failed', 'bad'];
  }
}

function check(el: HTMLElement, ok: boolean, label: string): void {
  text(el, `${ok ? '✓' : '✗'} ${label}`);
  el.classList.toggle('ok', ok);
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

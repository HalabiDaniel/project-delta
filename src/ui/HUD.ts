import { SUITABILITY_LABELS, type SuitabilityLevel } from '../aircraft/Aircraft';
import type { BoostState } from '../aircraft/Boost';
import type { TouchdownCheck } from '../aircraft/Landing';
import { LANDING, type AircraftId, type Difficulty } from '../config';
import type { MissionFailure, MissionStatus, MissionType } from '../missions/Mission';
import type { BoundaryState } from '../systems/Boundary';
import type { BuildKind, GamePhase } from '../systems/GameState';
import { attr, bindButton, esc, place, text, toggle, width, type ScreenPoint } from './dom';
import { Garage, type GarageView } from './Garage';
import { MiniMap, type MiniMapView } from './MiniMap';
import './hud.css';

export type { ScreenPoint } from './dom';

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

/** A name, role and health bar floating over a practice target or a damaged prop. */
export interface TargetLabelView extends ScreenPoint {
  id: string;
  name: string;
  role: string;
  health: number;
  /** One the current mission wants shot down. */
  mission: boolean;
  /** 0 → 1 as it gets further away, for fading. */
  far: number;
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
  /** How well each design suits this mission, for the chips along the bottom. */
  fits: Array<{ id: AircraftId; name: string; level: SuitabilityLevel; selected: boolean }>;
}

export interface ObjectiveView {
  label: string;
  done: boolean;
  open: boolean;
  /** 0–1 for objectives that fill up (reconnaissance, ring count, targets shot down), else null. */
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
  autopilot: boolean;
}

/** The plane's condition and weapons, in flight and on the ground. */
export interface AircraftStatusView {
  name: string;
  roleLabel: string;
  accent: string;
  health: number;
  maxHealth: number;
  rangeLeft: number;
  range: number;
  gun: { label: string; ammo: number; capacity: number; ready: boolean };
  bombs: { label: string; loaded: number; capacity: number; falling: number; cooldown: number; ready: boolean };
  /** Keys only work in the air. */
  airborne: boolean;
}

export interface GroundView {
  /** The plane has rolled to a stop: the ground crew can work. */
  stopped: boolean;
  /** 0 → 1 while rearming, else null. */
  rearming: number | null;
  canRearm: boolean;
  missionLine: string;
  missionTone: 'good' | 'bad' | 'info';
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
  aircraftName: string;
  missionTitle: string;
  missionLine: string;
  missionTone: 'good' | 'bad';
  planeLine: string;
  /** Seconds the mission ran. */
  time: number;
  damageDealt: number;
  damageTaken: number;
  targetsDestroyed: number;
  bombsDropped: number;
  bombHits: number;
  shotsFired: number;
  shotsHit: number;
  paperSpent: number;
  paperEarned: number;
}

export interface CareerView {
  missionsCompleted: number;
  planesLost: number;
  targetsDestroyed: number;
  favorite: string | null;
}

export interface HudView {
  paper: number;
  career: CareerView;
  phase: GamePhase;
  paused: boolean;
  income: { producing: boolean; amount: number; interval: number; progress: number; cap: number };
  build: { cost: number; kind: BuildKind; name: string; canBuild: boolean; note: string | null; noteTone: 'bad' | 'info'; progress: number };
  garage: GarageView | null;
  /** Mission cards while choosing (desk → ready); null once launched. */
  cards: MissionCardView[] | null;
  selected: number;
  tracker: TrackerView | null;
  flight: FlightView | null;
  aircraft: AircraftStatusView | null;
  ground: GroundView | null;
  landing: LandingView | null;
  boundary: { state: BoundaryState; countdown: number };
  result: ResultView | null;
  pointerLocked: boolean;
  nose: ScreenPoint | null;
  aim: ScreenPoint | null;
  target: TargetIndicator | null;
  labels: TerritoryLabel[];
  targets: TargetLabelView[];
  minimap: MiniMapView;
}

export interface HudActions {
  build(): void;
  select(index: number): void;
  selectAircraft(id: AircraftId): void;
  rearm(): void;
  takeOff(): void;
  endSortie(): void;
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
  practice: 'Target practice',
};

const BUILD_VERB: Record<BuildKind, string> = { fold: 'Fold', refit: 'Refit', rollout: 'Roll out' };

const CONTROLS: Array<[string, string]> = [
  ['Mouse', 'Steer the aircraft'],
  ['W / S', 'Speed up / slow down'],
  ['A / D', 'Assisted banking'],
  ['Shift', 'Boost (short burst, then recharge)'],
  ['Left click', 'Fire ink guns (hold)'],
  ['Right click', 'Drop a bomb'],
  ['1 / 2 / 3', 'Choose a mission (at home)'],
  ['Q / E', 'Choose a plane (at home)'],
  ['F', 'Fold, refit or roll out the plane'],
  ['Space', 'Launch, or take off again after landing'],
  ['R', 'Rearm ink and range (landed at home)'],
  ['Enter', 'End the sortie / continue'],
  ['Esc', 'Pause / show controls'],
];

const TEMPLATE = /* html */ `
  <div class="labels" data-labels></div>
  <div class="target-labels" data-target-labels></div>
  <div class="target-indicator" data-target>
    <span class="ti-arrow"></span><span class="ti-diamond"></span><span class="ti-label" data-target-label></span>
  </div>
  <div class="reticle nose" data-nose><span class="hit-x" data-hitmark></span></div>
  <div class="reticle aim" data-aim></div>
  <div class="pops" data-pops></div>
  <div class="damage-flash" data-damage-flash></div>

  <section class="panel resources">
    <div class="brand">paperwars<span>.io</span> <small>v0.0.3</small></div>
    <div class="paper"><svg class="paper-icon" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1h11l5 5v15H1z" fill="#fff" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 1v5h5" fill="#e5e7eb" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><b data-paper></b><span>paper</span><span class="delta" data-delta></span></div>
    <div class="income"><span class="income-bar"><i data-income-bar></i></span><span data-income-text></span></div>
    <div class="stats-title">Career <small>(this browser)</small></div>
    <dl class="stats">
      <div><dt>Missions completed</dt><dd data-missions></dd></div>
      <div><dt>Planes lost</dt><dd data-lost></dd></div>
      <div><dt>Targets destroyed</dt><dd data-destroyed></dd></div>
      <div><dt>Favourite plane</dt><dd data-favorite></dd></div>
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

  <section class="panel inspector" data-inspector></section>

  <section class="panel status" data-status>
    <div class="st-head"><span class="swatch" data-st-swatch></span><b data-st-name></b><span class="role-chip" data-st-role></span></div>
    <div class="st-row"><span class="gauge-label">Health</span><div class="bar health"><i data-st-health></i></div><span class="st-value" data-st-health-text></span></div>
    <div class="st-row"><span class="gauge-label">Range</span><div class="bar range"><i data-st-range></i></div><span class="st-value" data-st-range-text></span></div>
    <div class="st-row weapon" data-st-gun><kbd>LMB</kbd><span class="st-weapon" data-st-gun-label></span><div class="bar ammo"><i data-st-ammo></i></div><span class="st-value" data-st-ammo-text></span></div>
    <div class="st-row weapon bombs" data-bombs><kbd>RMB</kbd><span class="st-weapon" data-st-bomb-label></span><span class="bomb-icons" data-bomb-icons></span><span class="bomb-text" data-bomb-text></span></div>
    <div class="st-keys" data-st-keys><span><kbd>W</kbd><kbd>S</kbd> speed</span><span><kbd>A</kbd><kbd>D</kbd> bank</span><span><kbd>Shift</kbd> boost</span><span><kbd>R</kbd> rearm at home</span><span><kbd>Esc</kbd> pause</span></div>
  </section>

  <div class="banner" data-banner><div class="banner-title"></div><div class="banner-sub"></div></div>
  <div class="boundary-warning" data-boundary><div class="bw-title" data-bw-title></div><div class="bw-sub" data-bw-sub></div></div>

  <section class="dock">
    <div class="landing-guide" data-landing>
      <span class="eyebrow">Landing at T1</span>
      <span class="check" data-lg-speed></span><span class="check" data-lg-sink></span><span class="check" data-lg-level></span>
    </div>
    <div class="garage-row" data-garage-cards></div>
    <div class="dock-row" data-dock="desk">
      <button class="btn primary" data-build><span data-build-label></span><span class="cost" data-build-cost></span><kbd>F</kbd></button>
    </div>
    <p class="dock-note" data-build-note></p>
    <div class="dock-row building" data-dock="building"><span data-building-label></span><div class="bar wide"><i data-building-bar></i></div></div>
    <div class="dock-row ready" data-dock="ready"><kbd class="big">Space</kbd><span data-ready-label>Launch from T1</span></div>
    <div class="dock-row flight" data-dock="flying">
      <div class="gauge"><span class="gauge-label">Speed</span><div class="bar speed"><i data-speed-bar></i><b class="throttle-mark" data-throttle-mark></b></div><span class="gauge-value" data-speed></span></div>
      <div class="gauge"><span class="gauge-label">Alt</span><span class="gauge-value" data-alt></span></div>
      <div class="gauge boost" data-boost><span class="gauge-label">Boost</span><div class="bar"><i data-boost-bar></i></div><kbd>Shift</kbd></div>
    </div>
    <div class="dock-row ground" data-dock="landed">
      <div class="ground-card">
        <div class="eyebrow">Landed at T1 · ground crew</div>
        <div class="ground-mission" data-gr-mission></div>
        <div class="ground-actions">
          <button class="btn ghost" data-rearm><kbd>R</kbd><span data-rearm-label>Rearm</span><span class="bar mini"><i data-rearm-bar></i></span></button>
          <button class="btn primary" data-takeoff><kbd>Space</kbd>Take off</button>
          <button class="btn ghost" data-end><kbd>Enter</kbd>End sortie</button>
        </div>
        <div class="ground-note">Rearming tops up ink and range for free. Bombs come with the mission.</div>
      </div>
    </div>
    <div class="dock-row result" data-dock="result">
      <div class="result-card" data-result>
        <div class="eyebrow">Sortie report</div>
        <div class="result-title" data-res-title></div>
        <dl class="ledger">
          <div><dt>Aircraft</dt><dd data-res-plane></dd></div>
          <div><dt data-res-mission-title></dt><dd data-res-mission></dd></div>
          <div><dt>Time taken</dt><dd data-res-time></dd></div>
          <div><dt>Damage dealt</dt><dd data-res-dealt></dd></div>
          <div><dt>Bombing accuracy</dt><dd data-res-bombs></dd></div>
          <div><dt>Ink accuracy</dt><dd data-res-shots></dd></div>
        </dl>
        <dl class="ledger money">
          <div><dt>Paper spent</dt><dd data-res-spent></dd></div>
          <div><dt>Paper earned</dt><dd data-res-earned></dd></div>
          <div class="net"><dt>Net change</dt><dd data-res-net></dd></div>
        </dl>
        <button class="btn primary" data-continue>Continue <kbd>Enter</kbd></button>
      </div>
    </div>
  </section>

  <canvas class="minimap" data-minimap></canvas>

  <div class="hint" data-lock-hint>Mouse not captured. Press <kbd>Esc</kbd>, then click to capture it.</div>

  <div class="overlay" data-overlay>
    <div class="overlay-card">
      <h2 data-overlay-title></h2>
      <table class="controls">
        ${CONTROLS.map(([key, action]) => `<tr><th><kbd>${key}</kbd></th><td>${action}</td></tr>`).join('')}
      </table>
      <p class="overlay-rules">Land on <b>T1</b> to rearm or bring your plane home: come in slow (under ${LANDING.maxSpeed}), descend gently (under ${LANDING.maxSink} m/s) with the wings level. Fast or steep touchdowns cost health.</p>
      <button class="btn primary" data-resume>Resume</button>
      <p class="overlay-note">Click anywhere or press Esc to continue.</p>
    </div>
  </div>
`;

/** DOM overlay: paper, garage, mission cards and tracker, flight readouts, markers, banners, minimap, menus. */
export class HUD {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly docks: HTMLElement[];
  private readonly labelEls = new Map<string, HTMLElement>();
  private readonly targetEls = new Map<string, HTMLElement>();
  private readonly minimap: MiniMap;
  private readonly garage: Garage;
  private bannerTimer = 0;
  private hitTimer = 0;
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
      for (const name of node.getAttributeNames()) {
        if (name.startsWith('data-') && name !== 'data-dock') this.el[name.slice(5)] = node;
      }
    }
    this.docks = [...root.querySelectorAll<HTMLElement>('[data-dock]')];
    this.minimap = new MiniMap(this.el.minimap as HTMLCanvasElement);
    this.garage = new Garage(this.el['garage-cards'], this.el.inspector, actions.selectAircraft);

    bindButton(this.el.build, actions.build);
    bindButton(this.el.continue, actions.continueToDesk);
    bindButton(this.el.resume, actions.resume);
    bindButton(this.el.rearm, actions.rearm);
    bindButton(this.el.takeoff, actions.takeOff);
    bindButton(this.el.end, actions.endSortie);
    this.el.overlay.addEventListener('click', () => actions.resume());
  }

  render(v: HudView): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    const flying = v.phase === 'flying' && !v.paused;

    text(this.el.paper, String(v.paper));
    text(this.el.missions, String(v.career.missionsCompleted));
    text(this.el.lost, String(v.career.planesLost));
    text(this.el.destroyed, String(v.career.targetsDestroyed));
    text(this.el.favorite, v.career.favorite ?? '—');
    width(this.el['income-bar'], v.income.producing ? v.income.progress : 0);
    text(
      this.el['income-text'],
      v.income.producing ? `T1 makes +${v.income.amount} every ${v.income.interval} s` : `Income paused at ${v.income.cap}+ paper`,
    );

    this.renderCards(v);
    this.renderTracker(v.tracker);
    this.garage.render(v.paused ? null : v.garage);
    this.renderDock(v);
    this.renderStatus(v);
    this.renderBoundary(v);

    toggle(this.el['lock-hint'], flying && !v.pointerLocked);
    toggle(this.el.overlay, v.paused);
    text(this.el['overlay-title'], v.phase === 'flying' ? 'Paused' : 'Controls');
    this.root.classList.toggle('in-flight', flying);

    place(this.el.nose, flying ? v.nose : null);
    place(this.el.aim, flying && !v.flight?.autopilot ? v.aim : null);
    if (this.hitTimer && now > this.hitTimer) {
      this.el.nose.classList.remove('hit', 'kill');
      this.hitTimer = 0;
    }
    this.renderTarget(v);
    this.renderLabels(v.labels);
    this.renderTargetLabels(v.paused ? [] : v.targets);
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
    this.floatText(word, `pop-word`, tone, at);
  }

  /** A small damage number that jumps off a target and fades. */
  damageNumber(amount: number, at: ScreenPoint, kill = false): void {
    const jitter = { x: at.x + (Math.random() - 0.5) * 24, y: at.y - Math.random() * 10 };
    this.floatText(`${amount}`, kill ? 'damage-number kill' : 'damage-number', 'info', jitter);
  }

  /** The nose reticle flashes an X when a round lands; bigger when it finishes the target. */
  hitMarker(kill: boolean): void {
    const nose = this.el.nose;
    nose.classList.remove('hit', 'kill');
    void nose.offsetWidth;
    nose.classList.add(kill ? 'kill' : 'hit');
    this.hitTimer = performance.now() + (kill ? 420 : 160);
  }

  /** The screen edges flash red when the plane is hurt, more for bigger hits. */
  damageFlash(amount: number): void {
    const el = this.el['damage-flash'];
    el.style.setProperty('--strength', String(Math.min(1, 0.35 + amount / 60)));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  private floatText(word: string, className: string, tone: string, at: ScreenPoint): void {
    const el = document.createElement('div');
    el.className = className;
    el.dataset.tone = tone;
    el.textContent = word;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    this.el.pops.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  private renderCards(v: HudView): void {
    toggle(this.el['cards-wrap'], v.cards !== null);
    if (!v.cards) return;
    const key = v.cards.map((c) => `${c.title}|${c.difficulty}|${c.reward}|${c.fits.map((f) => f.level).join(',')}`).join('/');
    if (key !== this.cardsKey) {
      this.cardsKey = key;
      const wrap = this.el.cards;
      wrap.innerHTML = '';
      v.cards.forEach((c, i) => {
        const card = document.createElement('button');
        card.className = 'card';
        card.dataset.difficulty = c.difficulty;
        const stars = '★'.repeat(c.stars) + '☆'.repeat(3 - c.stars);
        const facts = [c.bombs > 0 ? `Up to ${c.bombs} bomb${c.bombs === 1 ? '' : 's'}` : 'No bombs', c.timeLimit ? `${c.timeLimit} s limit` : 'No time limit'];
        const fits = c.fits
          .map((f) => `<span class="fit-chip" data-id="${f.id}" data-level="${f.level}" title="${esc(f.name)}: ${SUITABILITY_LABELS[f.level]}">${esc(f.name)}</span>`)
          .join('');
        card.innerHTML = `
          <div class="card-top"><kbd>${i + 1}</kbd><span class="card-type">${MISSION_TYPE_LABELS[c.type]}</span><span class="card-diff" title="${c.difficultyLabel}">${stars} <b>×${c.multiplier}</b></span></div>
          <div class="card-title">${esc(c.title)}</div>
          <div class="card-desc">${esc(c.description)}</div>
          <div class="card-foot"><span>${facts.join(' · ')}</span><b class="card-reward">+${c.reward}</b></div>
          <div class="card-fits">${fits}</div>`;
        bindButton(card, () => this.actions.select(i));
        wrap.appendChild(card);
      });
    }
    [...this.el.cards.children].forEach((card, i) => {
      card.classList.toggle('selected', i === v.selected);
      for (const chip of card.querySelectorAll<HTMLElement>('.fit-chip')) {
        chip.classList.toggle('mine', !!v.cards![i].fits.find((f) => f.id === chip.dataset.id)?.selected);
      }
    });
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
    const key = t.objectives.map((o) => o.label.replace(/\(\d+\/\d+\)/, '')).join('|');
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
      width(bar.firstElementChild as HTMLElement, o.progress ?? 0);
    });
    text(this.el['tr-hint'], t.hint);
  }

  private renderDock(v: HudView): void {
    const over = v.phase === 'debrief' || v.phase === 'crashed';
    const dockKey = over ? (v.result ? 'result' : '') : v.phase === 'landed' ? (v.ground?.stopped ? 'landed' : '') : v.phase;
    for (const dock of this.docks) toggle(dock, dock.dataset.dock === dockKey && !v.paused);

    const b = v.build;
    text(this.el['build-label'], `${BUILD_VERB[b.kind]} ${b.name}`);
    text(this.el['build-cost'], b.cost > 0 ? `−${b.cost} paper` : 'free');
    (this.el.build as HTMLButtonElement).disabled = !b.canBuild;
    const note = this.el['build-note'];
    toggle(note, (v.phase === 'desk' || v.phase === 'ready') && b.note !== null && !v.paused);
    text(note, b.note ?? '');
    attr(note, 'data-tone', b.noteTone);
    text(this.el['building-label'], b.kind === 'refit' ? `Refitting your ${b.name}…` : b.kind === 'rollout' ? `Rolling out your ${b.name}…` : `Folding a new ${b.name}…`);
    width(this.el['building-bar'], b.progress);
    text(this.el['ready-label'], `Launch the ${b.name} from T1`);

    const f = v.flight;
    if (f) {
      text(this.el.speed, String(Math.round(f.speed)));
      width(this.el['speed-bar'], f.speedFrac);
      this.el['throttle-mark'].style.left = `${Math.round(f.throttleFrac * 100)}%`;
      text(this.el.alt, `${Math.round(f.altitude)} m`);
      attr(this.el.boost, 'data-state', f.boost.state);
      width(this.el['boost-bar'], f.boost.level);
    }

    const l = v.landing;
    toggle(this.el.landing, l !== null && !v.paused);
    if (l) {
      check(this.el['lg-speed'], l.check.speedOk, `Speed ${Math.round(l.speed)} / ${LANDING.maxSpeed}`);
      check(this.el['lg-sink'], l.check.sinkOk, `Descent ${Math.max(0, l.sink).toFixed(1)} / ${LANDING.maxSink} m/s`);
      check(this.el['lg-level'], l.check.levelOk, `Bank ${Math.round(Math.abs(l.rollDeg))}°`);
      this.el.landing.classList.toggle('ok', l.check.ok);
    }

    const g = v.ground;
    if (g) {
      text(this.el['gr-mission'], g.missionLine);
      attr(this.el['gr-mission'], 'data-tone', g.missionTone);
      (this.el.rearm as HTMLButtonElement).disabled = !g.canRearm;
      (this.el.takeoff as HTMLButtonElement).disabled = g.rearming !== null;
      text(this.el['rearm-label'], g.rearming !== null ? 'Rearming…' : g.canRearm ? 'Rearm' : 'Fully armed');
      toggle(this.el['rearm-bar'].parentElement!, g.rearming !== null);
      width(this.el['rearm-bar'], g.rearming ?? 0);
    }

    const r = v.result;
    if (r) {
      text(this.el['res-title'], r.headline);
      attr(this.el['res-title'], 'data-tone', r.recovered ? 'good' : 'bad');
      text(this.el['res-plane'], `${r.aircraftName} · ${r.planeLine}`);
      attr(this.el['res-plane'], 'data-tone', r.recovered ? 'good' : 'bad');
      text(this.el['res-mission-title'], r.missionTitle);
      text(this.el['res-mission'], r.missionLine);
      attr(this.el['res-mission'], 'data-tone', r.missionTone);
      text(this.el['res-time'], clock(r.time));
      text(
        this.el['res-dealt'],
        r.damageDealt > 0 || r.targetsDestroyed > 0
          ? `${r.damageDealt}${r.targetsDestroyed ? ` · ${r.targetsDestroyed} destroyed` : ''}`
          : '0',
      );
      text(this.el['res-bombs'], r.bombsDropped > 0 ? `${r.bombHits}/${r.bombsDropped} · ${Math.round((r.bombHits / r.bombsDropped) * 100)}%` : '—');
      text(this.el['res-shots'], r.shotsFired > 0 ? `${r.shotsHit}/${r.shotsFired} · ${Math.round((r.shotsHit / r.shotsFired) * 100)}%` : '—');
      text(this.el['res-spent'], r.paperSpent > 0 ? `−${r.paperSpent}` : '0');
      text(this.el['res-earned'], r.paperEarned > 0 ? `+${r.paperEarned}` : '0');
      const net = r.paperEarned - r.paperSpent;
      text(this.el['res-net'], net > 0 ? `+${net}` : net < 0 ? `−${-net}` : '0');
      attr(this.el['res-net'], 'data-tone', net > 0 ? 'good' : net < 0 ? 'bad' : '');
    }
  }

  private renderStatus(v: HudView): void {
    const a = v.aircraft;
    toggle(this.el.status, a !== null && !v.paused);
    if (!a) return;
    this.el['st-swatch'].style.background = a.accent;
    text(this.el['st-name'], a.name);
    text(this.el['st-role'], a.roleLabel);
    const hp = a.health / a.maxHealth;
    width(this.el['st-health'], hp);
    attr(this.el['st-health'], 'data-level', hp > 0.6 ? 'ok' : hp > 0.3 ? 'worn' : 'critical');
    text(this.el['st-health-text'], `${Math.ceil(a.health)}/${a.maxHealth}`);
    const range = a.rangeLeft / a.range;
    width(this.el['st-range'], range);
    attr(this.el['st-range'], 'data-level', range > 0.25 ? 'ok' : range > 0 ? 'worn' : 'critical');
    text(this.el['st-range-text'], range > 0 ? `${(a.rangeLeft / 1000).toFixed(1)} km` : 'Gliding');

    text(this.el['st-gun-label'], a.gun.label);
    width(this.el['st-ammo'], a.gun.ammo / a.gun.capacity);
    text(this.el['st-ammo-text'], a.gun.ammo > 0 ? `${a.gun.ammo}` : 'Empty');
    attr(this.el['st-gun'], 'data-state', a.gun.ammo === 0 ? 'empty' : a.gun.ammo / a.gun.capacity < 0.2 ? 'low' : 'ok');

    const bombs = a.bombs;
    text(this.el['st-bomb-label'], bombs.label);
    const icons = this.el['bomb-icons'];
    const iconKey = `${bombs.capacity}:${bombs.loaded}`;
    if (icons.dataset.key !== iconKey) {
      icons.dataset.key = iconKey;
      icons.innerHTML = Array.from({ length: bombs.capacity }, (_, i) => `<i class="${i < bombs.loaded ? 'full' : ''}"></i>`).join('');
    }
    const state =
      bombs.capacity === 0 ? 'none'
      : !a.airborne ? (bombs.loaded > 0 ? 'loaded' : 'empty')
      : bombs.ready ? 'ready'
      : bombs.loaded > 0 ? 'reloading'
      : bombs.falling > 0 ? 'falling'
      : 'empty';
    attr(this.el.bombs, 'data-state', state);
    text(
      this.el['bomb-text'],
      state === 'none' ? 'None on this mission'
      : state === 'ready' ? 'Ready'
      : state === 'loaded' ? 'Loaded'
      : state === 'reloading' ? 'Reloading…'
      : state === 'falling' ? 'Bombs away…'
      : 'Empty',
    );
    toggle(this.el['st-keys'], a.airborne);
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
    if (!t || v.paused || v.phase === 'debrief' || v.phase === 'crashed') {
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

  private renderTargetLabels(targets: TargetLabelView[]): void {
    const seen = new Set<string>();
    for (const t of targets) {
      let el = this.targetEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'target-label';
        el.innerHTML = '<b class="tl-name"></b><span class="tl-role"></span><span class="tl-health"><i></i></span>';
        this.el['target-labels'].appendChild(el);
        this.targetEls.set(t.id, el);
      }
      text(el.querySelector('.tl-name') as HTMLElement, t.name);
      text(el.querySelector('.tl-role') as HTMLElement, t.mission ? 'Mission target' : t.role);
      el.classList.toggle('mission', t.mission);
      const bar = el.querySelector('.tl-health i') as HTMLElement;
      width(bar, t.health);
      attr(bar, 'data-level', t.health > 0.6 ? 'ok' : t.health > 0.3 ? 'worn' : 'critical');
      el.style.transform = `translate(${t.x}px, ${t.y}px)`;
      el.style.opacity = String(1 - 0.55 * t.far);
      toggle(el, true);
      seen.add(t.id);
    }
    for (const [id, el] of this.targetEls) if (!seen.has(id)) toggle(el, false);
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

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

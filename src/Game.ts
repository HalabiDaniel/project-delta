import * as pc from 'playcanvas';
import { BOMB, BOOST, CAMERA, ECONOMY, LANDING, MISSIONS, PLANE, WORLD } from './config';
import { Bombs, type BombImpact, type ZoneRef } from './aircraft/Bomb';
import { ChaseCamera } from './aircraft/ChaseCamera';
import { FlightTrails } from './aircraft/FlightTrails';
import { HangarPreview } from './aircraft/HangarPreview';
import { assessTouchdown, hardLandingReason } from './aircraft/Landing';
import { clamp, PlaneController, yawFromDirection } from './aircraft/PlaneController';
import type { Mission, Objective } from './missions/Mission';
import { generateOffers } from './missions/MissionGenerator';
import { Boundary } from './systems/Boundary';
import { GameState, type CrashCause } from './systems/GameState';
import { Input } from './systems/Input';
import { ResourceManager } from './systems/ResourceManager';
import {
  HUD,
  type HudView,
  type ObjectiveView,
  type ResultView,
  type ScreenPoint,
  type TargetIndicator,
  type TerritoryLabel,
  type TrackerView,
} from './ui/HUD';
import type { MiniMapView } from './ui/MiniMap';
import { Effects } from './world/Effects';
import { MissionMarkers } from './world/MissionMarkers';
import { buildWorld, type World } from './world/WorldGenerator';

/** Ignore an Esc key press this soon after the browser released pointer lock (it was the same press). */
const ESC_AFTER_UNLOCK_MS = 300;
/** Distance at which the nose and aim reticles are projected. */
const RETICLE_RANGE = 60;
/** The autopilot cruises home at this height. */
const AUTOPILOT_ALTITUDE = 22;
const KEY_TO_CARD: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

/**
 * Wires the rules (GameState, missions, paper) to the 3D scene, input and HUD, and runs the frame
 * loop. The rules never touch rendering; this class translates between the two.
 */
export class Game {
  readonly boundary = new Boundary();
  paused = false;

  private lastAutoPause = -Infinity;
  private lastRecallHint = -Infinity;
  private crashCause: CrashCause | null = null;
  /** The landing rollout has finished and the sortie report is up. */
  private rolledToStop = false;
  private readonly crashPoint = new pc.Vec3();
  /** Where the last bomb landed, and how much longer the camera keeps it in view. */
  private readonly impactPoint = new pc.Vec3();
  private impactCamTime = 0;
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private readonly v3 = new pc.Vec3();
  private readonly rel = new pc.Vec3();
  private readonly screen = new pc.Vec3();

  private constructor(
    readonly app: pc.AppBase,
    readonly world: World,
    readonly resources: ResourceManager,
    readonly state: GameState,
    readonly plane: PlaneController,
    readonly bombs: Bombs,
    readonly camera: ChaseCamera,
    readonly effects: Effects,
    readonly markers: MissionMarkers,
    readonly trails: FlightTrails,
    readonly preview: HangarPreview,
    readonly input: Input,
    readonly hud: HUD,
  ) {}

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<Game> {
    const device = await pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGL2],
      antialias: true,
    });
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

    const options = new pc.AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
    options.resourceHandlers = [];
    const app = new pc.AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());

    const world = buildWorld(app);
    const resources = new ResourceManager();
    const missionContext = { territories: world.territories, homeId: world.home.id, launch: world.launchPosition };
    const state = new GameState(resources, () => generateOffers(missionContext, Math.random));

    let game: Game | undefined;
    const hud = new HUD(hudRoot, {
      build: () => game?.build(),
      select: (index) => game?.select(index),
      continueToDesk: () => game?.continueToDesk(),
      resume: () => game?.resume(),
    });
    game = new Game(
      app,
      world,
      resources,
      state,
      new PlaneController(app),
      new Bombs(app),
      new ChaseCamera(app),
      new Effects(app),
      new MissionMarkers(app, world),
      new FlightTrails(app),
      new HangarPreview(app),
      new Input(canvas),
      hud,
    );
    game.bindEvents();
    game.camera.updateDesk(0, world.launchPosition, world.launchYaw, true);
    app.on('update', (dt: number) => game!.tick(dt));
    app.start();
    return game;
  }

  // ---- Player actions -------------------------------------------------------------------------

  select(index: number): void {
    if (!this.paused) this.state.select(index);
  }

  /** Fold a new plane, or refit the recovered one, on the launch pad. */
  build(): void {
    if (this.paused || !this.state.build()) return;
    if (!this.state.refitting) this.parkPlane(0);
  }

  launch(): void {
    if (this.paused || !this.state.launch()) return;
    this.plane.launch();
    this.boundary.reset();
    this.input.consumeMouse(); // ignore mouse travel from before take-off
    this.input.requestPointerLock();
  }

  dropBomb(): void {
    if (this.paused || !this.state.dropBomb()) return;
    // The ball released is the one that disappears from the rack: slot `bombsLoaded` after the drop.
    this.bombs.release(this.plane.getBombPosition(this.v1, this.state.bombsLoaded), this.plane.getVelocity(this.v2));
  }

  /** After landing (once the plane has stopped) or a crash: back to the desk for the next sortie. */
  continueToDesk(): void {
    if (this.paused) return;
    if (this.state.phase === 'landed' && !this.rolledToStop) return;
    if (!this.state.continueToDesk()) return;
    this.impactCamTime = 0;
    this.crashCause = null;
    this.rolledToStop = false;
    this.bombs.clear();
    this.trails.clear();
    this.boundary.reset();
    if (this.state.hangarPlane) this.parkPlane(1);
    else this.plane.hide();
    this.input.exitPointerLock();
    this.camera.updateDesk(0, this.world.launchPosition, this.world.launchYaw, true);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.input.exitPointerLock();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.input.consumeMouse();
    if (this.state.phase === 'flying') this.input.requestPointerLock();
  }

  // ---- Frame loop -----------------------------------------------------------------------------

  private tick(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    const mouse = this.input.consumeMouse();
    if (!this.paused) this.simulate(dt, mouse);
    this.hud.render(this.view());
  }

  private simulate(dt: number, mouse: { dx: number; dy: number }): void {
    const { world, plane, camera, state } = this;
    state.tick(dt);
    switch (state.phase) {
      case 'desk':
      case 'building':
      case 'ready':
        if (state.phase === 'building') plane.setFold(foldPose(state.buildProgress, state.refitting));
        camera.updateDesk(dt, world.launchPosition, world.launchYaw);
        break;
      case 'flying':
        this.fly(dt, mouse);
        break;
      case 'landed':
        if (plane.rollout(dt, world.home) && !this.rolledToStop) {
          this.rolledToStop = true;
          this.input.exitPointerLock(); // free the cursor for the Continue button
        }
        camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        break;
      case 'crashed':
        camera.updateWatch(dt, this.crashPoint);
        break;
    }

    // The bombs are loaded at take-off; on the pad they would only sit in the way of the fold.
    plane.setBombs(state.phase === 'flying' ? state.bombsLoaded : 0);
    const choosing = state.phase === 'desk' || state.phase === 'building' || state.phase === 'ready';
    const shown = choosing ? state.selectedMission : state.mission;
    if (this.markers.shown !== shown) this.markers.show(shown);

    for (const impact of this.bombs.update(dt, this.openZones(), world.territories)) this.onBombImpact(impact);
    this.markers.update(dt);
    this.trails.update(dt, plane);
    this.preview.update(dt, world.launchPosition, state.phase === 'desk' && !state.hangarPlane);
    this.effects.update(dt);
  }

  private fly(dt: number, mouse: { dx: number; dy: number }): void {
    const { plane, world, input, state } = this;
    const before = this.boundary.state;
    const boundary = this.boundary.update(dt, plane.position.x, plane.position.z);
    // The warning panel covers the countdown and the autopilot; only the hand-back needs a banner.
    if (before === 'autopilot' && boundary === 'inside') this.hud.banner('You have control', 'Back inside the airspace.', 'info', 1.8);
    const p = plane.position;
    const autopilot =
      boundary === 'autopilot'
        ? { yaw: yawFromDirection(world.home.x - p.x, world.home.z - p.z), pitch: clamp((AUTOPILOT_ALTITUDE - p.y) * 0.04, -0.35, 0.35) }
        : null;
    const outcome = plane.fly(
      dt,
      {
        mouseDX: mouse.dx,
        mouseDY: mouse.dy,
        throttle: input.axis('KeyS', 'KeyW'),
        bank: input.axis('KeyD', 'KeyA'),
        boost: input.isHeld('ShiftLeft') || input.isHeld('ShiftRight'),
        autoLevel: !this.onApproach(),
        autopilot,
      },
      world.territories,
    );
    switch (outcome) {
      case 'flying':
        state.updateFlight(plane.prevPosition, plane.position, dt);
        if (state.phase === 'flying') this.camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        break;
      case 'touchdown':
        this.effects.burst(plane.position, 'dust');
        this.rolledToStop = false;
        state.land(world.home.id);
        this.camera.updateFollow(dt, plane, world.territories, null);
        break;
      case 'hard-landing':
        this.loseAircraft('hard-landing');
        break;
      case 'crashed-void':
        this.loseAircraft('void');
        break;
      case 'crashed-impact':
        this.loseAircraft('impact');
        break;
    }
  }

  /** Low and close to home after the climb-out: show the landing checklist and stop auto-levelling. */
  private onApproach(): boolean {
    const { plane, world } = this;
    if (this.state.phase !== 'flying' || plane.airborneFor < PLANE.launchGrace + 1.5) return false;
    const distance = Math.hypot(plane.position.x - world.home.x, plane.position.z - world.home.z);
    return distance < LANDING.guideRange && plane.position.y < LANDING.guideAltitude;
  }

  /** Bombing targets the bombs can still score on. */
  private openZones(): ZoneRef[] {
    const mission = this.state.mission;
    if (!mission?.isActive) return [];
    const zones: ZoneRef[] = [];
    mission.objectives.forEach((o, i) => {
      if (o.kind === 'bomb' && mission.isOpen(i)) zones.push({ objective: i, territoryId: o.territoryId, zone: o.zone });
    });
    return zones;
  }

  private onBombImpact(impact: BombImpact): void {
    const point = this.impactPoint.set(impact.x, impact.y, impact.z);
    if (impact.kind !== 'void') {
      const hit = impact.kind === 'target';
      this.effects.bombImpact(point, hit);
      const at = this.projectOnScreen(this.v3.copy(point));
      if (at) this.hud.pop(hit ? 'BOOM!' : 'SPLAT!', hit ? 'good' : 'bad', at);
    }
    this.impactCamTime = impact.kind === 'void' ? 0 : CAMERA.bombCamLinger;
    this.state.resolveBomb(impact.kind === 'target' ? impact.objective : null);
  }

  /** The newest falling bomb, or for a moment after it lands, the impact point. */
  private bombCamFocus(dt: number): pc.Vec3 | null {
    const falling = this.bombs.newest();
    if (falling) return falling;
    if (this.impactCamTime <= 0) return null;
    this.impactCamTime -= dt;
    return this.impactPoint;
  }

  private loseAircraft(cause: CrashCause): void {
    this.crashPoint.copy(this.plane.position);
    this.crashCause = cause;
    if (cause !== 'void') this.effects.burst(this.plane.position, 'crash');
    this.plane.crash();
    this.state.crash(cause);
    this.input.exitPointerLock(); // free the cursor for the Continue button
  }

  private parkPlane(fold: number): void {
    const pad = this.v1.copy(this.world.launchPosition);
    pad.y = PLANE.parkedHeight;
    this.plane.park(pad, this.world.launchYaw, this.world.home.id, fold);
  }

  // ---- Wiring ---------------------------------------------------------------------------------

  private bindEvents(): void {
    const { input, hud, state } = this;

    input.onKeyDown((code) => {
      if (code === 'Escape') {
        if (performance.now() - this.lastAutoPause < ESC_AFTER_UNLOCK_MS) return;
        if (this.paused) this.resume();
        else this.pause();
        return;
      }
      if (this.paused) return;
      if (code in KEY_TO_CARD) this.select(KEY_TO_CARD[code]);
      else if (code === 'KeyF') this.build();
      else if (code === 'Space') this.launch();
      else if (code === 'KeyR' || code === 'Enter') {
        if (state.phase === 'flying') this.recallHint();
        else this.continueToDesk();
      }
    });
    input.onCanvasClick(() => {
      if (state.phase === 'flying') this.dropBomb();
    });
    input.onPointerLockChange((locked) => {
      // Losing the lock mid-flight (Esc, alt-tab) pauses rather than leaving the plane unattended.
      if (!locked && state.phase === 'flying' && !this.paused) {
        this.pause();
        this.lastAutoPause = performance.now();
      }
    });
    window.addEventListener('blur', () => {
      if (state.phase === 'flying') this.pause();
    });

    this.resources.onChange((_paper, delta, source) => {
      if (source !== 'income') hud.paperDelta(delta);
    });
    state.onEvent((event) => {
      switch (event.type) {
        case 'build-refused':
          hud.banner('Not enough paper', `You need ${event.cost}. Your home territory keeps producing paper.`, 'bad', 2.5);
          break;
        case 'ready':
          this.effects.burst(this.plane.position, 'fold');
          break;
        case 'launched':
          hud.banner('Mission active', this.state.mission!.title, 'info', 1.8);
          break;
        case 'bomb-missed':
          if (event.remaining > 0 || this.state.bombsFalling > 0) {
            hud.banner('Missed!', `${event.remaining} bomb${event.remaining === 1 ? '' : 's'} left. Line up and try again.`, 'bad', 2);
          }
          break;
        case 'objective-complete':
          this.onObjectiveComplete(event.objective, event.index);
          break;
        case 'mission-succeeded':
          if (this.state.phase === 'landed') break; // the touchdown banner reports it
          hud.banner(
            'Mission complete!',
            this.state.phase === 'flying' ? `+${event.reward} paper · Land on T1 to recover your plane` : `+${event.reward} paper`,
            'good',
            3.5,
          );
          break;
        case 'mission-failed':
          if (event.reason === 'missed') hud.banner('Out of bombs!', 'Every target needs a hit. Mission failed.', 'bad', 3);
          else if (event.reason === 'out-of-time') hud.banner('Out of time!', 'Mission failed. Land on T1 to recover the plane.', 'bad', 3);
          break;
        case 'crashed':
          if (event.cause === 'hard-landing') {
            hud.banner('Hard landing!', hardLandingReason(this.plane.lastTouchdown ?? assessTouchdown(this.plane.touchdownState())), 'bad', 4);
          } else if (event.cause === 'void') {
            hud.banner('Plane lost in the void', 'No reward for an unfinished mission. Press R to continue.', 'bad', 4);
          } else {
            const hit = this.plane.lastImpactId;
            hud.banner(
              'Plane crashed!',
              hit === this.world.home.id
                ? `Hit the edge of ${hit}. Come in over the top of the platform to land.`
                : `Flew into ${hit}. Planes can only land on your home, ${this.world.home.id}.`,
              'bad',
              4,
            );
          }
          break;
        case 'landed': {
          const mission = this.state.mission;
          if (mission?.status === 'succeeded' && mission.objectives.some((o) => o.kind === 'land')) {
            hud.banner('Mission complete!', `+${mission.reward} paper · Plane recovered`, 'good', 3.5);
          } else {
            hud.banner('Touchdown!', `Plane recovered. A refit costs ${ECONOMY.refitCost} instead of ${ECONOMY.planeCost}.`, 'good', 3);
          }
          break;
        }
        case 'paper-reset':
          hud.banner('Paper reset', `${this.resources.paper} paper restored`, 'info', 1.6);
          break;
      }
    });
  }

  private onObjectiveComplete(objective: Objective, index: number): void {
    const mission = this.state.mission!;
    if (objective.kind === 'ring') {
      const g = objective.gate;
      this.effects.burst(this.v1.set(g.x, g.y, g.z), 'ring');
      const at = this.projectOnScreen(this.v1);
      const total = mission.objectives.length;
      if (at) this.hud.pop(`${objective.number}/${total}`, 'info', at);
      return;
    }
    if (mission.allDone) return; // the success banner says it all
    if (objective.kind === 'bomb') {
      const left = mission.objectives.filter((o, i) => o.kind === 'bomb' && !mission.isDone(i)).length;
      this.hud.banner('Target hit!', left > 0 ? `${left} more to go.` : this.objectiveLabel(mission, mission.openObjectives()[0] ?? index), 'good', 2.5);
    } else if (objective.kind === 'recon') {
      this.hud.banner('Reconnaissance complete', '', 'good', 2);
    } else if (objective.kind === 'reach') {
      this.hud.banner('Delivered!', '', 'good', 2);
    }
  }

  private recallHint(): void {
    if (performance.now() - this.lastRecallHint < 3000) return;
    this.lastRecallHint = performance.now();
    this.hud.banner('No recall', 'Land on T1 to bring your plane home: slow down and descend gently.', 'info', 2.5);
  }

  // ---- HUD view -------------------------------------------------------------------------------

  private view(): HudView {
    const { plane, world, state, resources } = this;
    const flying = state.phase === 'flying';
    const choosing = state.phase === 'desk' || state.phase === 'building' || state.phase === 'ready';
    const mission = choosing ? state.selectedMission : state.mission;

    let nose: ScreenPoint | null = null;
    let aim: ScreenPoint | null = null;
    if (flying) {
      nose = this.projectOnScreen(plane.getForward(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
      aim = this.projectOnScreen(plane.getAimDirection(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
    }

    const from = flying || state.phase === 'landed' || state.phase === 'crashed' ? plane.position : world.launchPosition;
    const goal = this.currentGoal(mission, from);
    let target: TargetIndicator | null = null;
    if (goal) {
      const distance = goal.ring
        ? this.v2.copy(goal.point).sub(from).length()
        : Math.hypot(goal.point.x - from.x, goal.point.z - from.z);
      target = { ...this.indicator(goal.point), label: `${goal.label} · ${Math.round(distance)} m`, tone: goal.tone, near: !goal.ring && distance < 15 };
    }

    const labels: TerritoryLabel[] = [];
    const eye = this.camera.entity.getPosition();
    const objectiveTerritories = this.objectiveTerritories(mission);
    for (const t of world.territories) {
      // In flight, a label on the platform right below is just clutter; the goal has its own marker.
      if (flying && Math.hypot(t.x - eye.x, t.z - eye.z) < t.size * 0.75) continue;
      if (goal?.territoryId === t.id && target?.onScreen) continue;
      const p = this.projectOnScreen(this.v3.set(t.x, 0.3, t.z));
      if (p) labels.push({ id: t.id, role: t.isHome ? 'home' : objectiveTerritories.get(t.id) === false ? 'objective' : 'neutral', x: p.x, y: p.y });
    }

    const buildCost = state.buildCost;
    let buildNote: string | null = null;
    let noteTone: 'bad' | 'info' = 'info';
    if (state.phase === 'desk') {
      if (!resources.canAfford(buildCost)) {
        const wait = state.income.timeToAfford(resources.paper, buildCost);
        noteTone = 'bad';
        buildNote =
          `Need ${buildCost} paper to ${state.hangarPlane ? 'refit' : 'fold'}, you have ${resources.paper}.` +
          (wait !== null ? ` Your home makes paper: ready in about ${Math.ceil(wait)} s.` : ' Fly a mission to earn more.');
      } else if (state.hangarPlane) {
        buildNote = `Your recovered plane is in the hangar: a refit costs ${state.refitCost} instead of ${state.planeCost}.`;
      }
    }

    const landing = this.onApproach()
      ? (() => {
          const s = plane.touchdownState();
          return { speed: s.speed, sink: s.sink, rollDeg: (s.roll * 180) / Math.PI, check: assessTouchdown(s) };
        })()
      : null;

    return {
      paper: resources.paper,
      stats: state.stats,
      phase: state.phase,
      paused: this.paused,
      income: {
        producing: state.income.isProducing(resources.paper),
        amount: state.income.amount,
        interval: state.income.interval,
        progress: state.income.progress,
        cap: state.income.cap,
      },
      build: {
        cost: buildCost,
        refit: state.hangarPlane,
        canBuild: state.canBuild(),
        note: buildNote,
        noteTone,
        progress: state.buildProgress,
        refitting: state.refitting,
      },
      cards: choosing
        ? state.offers.map((m) => {
            const d = MISSIONS.difficulty[m.spec.difficulty];
            return {
              type: m.spec.type,
              title: m.title,
              description: m.spec.description,
              difficulty: m.spec.difficulty,
              difficultyLabel: d.label,
              stars: d.stars,
              multiplier: d.multiplier,
              reward: m.reward,
              bombs: m.spec.bombs,
              timeLimit: m.spec.timeLimit,
            };
          })
        : null,
      selected: state.selected,
      tracker: !choosing && mission ? this.tracker(mission, from) : null,
      flight: flying
        ? {
            speed: plane.speed,
            speedFrac: (plane.speed - PLANE.minSpeed) / (PLANE.maxSpeed + BOOST.speed - PLANE.minSpeed),
            throttleFrac: (plane.throttleSpeed - PLANE.minSpeed) / (PLANE.maxSpeed + BOOST.speed - PLANE.minSpeed),
            altitude: plane.position.y,
            boost: { state: plane.boost.state, level: plane.boost.level },
            bombs: {
              loaded: state.bombsLoaded,
              capacity: state.mission?.spec.bombs ?? 0,
              falling: state.bombsFalling,
              cooldown: state.bombCooldown / BOMB.dropCooldown,
              ready: state.canDropBomb(),
            },
            autopilot: this.boundary.state === 'autopilot',
          }
        : null,
      landing,
      boundary: { state: this.boundary.state, countdown: this.boundary.countdown },
      result: this.result(),
      pointerLocked: this.input.pointerLocked,
      nose,
      aim,
      target,
      labels,
      minimap: this.minimapView(mission, goal?.point ?? null),
    };
  }

  /** What the target marker points at: the nearest open objective, or home once the mission is over. */
  private currentGoal(
    mission: Mission | null,
    from: pc.Vec3,
  ): { point: pc.Vec3; label: string; tone: TargetIndicator['tone']; ring: boolean; territoryId: string | null } | null {
    const { state, world } = this;
    if (state.phase === 'landed' || state.phase === 'crashed' || !mission) return null;
    const point = new pc.Vec3();
    if (state.phase === 'flying' && !mission.isActive) {
      point.set(world.home.x, 0.5, world.home.z);
      return { point, label: `${world.home.id} · Land`, tone: 'home', ring: false, territoryId: world.home.id };
    }
    let best: { point: pc.Vec3; label: string; tone: TargetIndicator['tone']; ring: boolean; territoryId: string | null } | null = null;
    let bestDistance = Infinity;
    for (const i of mission.openObjectives()) {
      const o = mission.objectives[i];
      const p = objectivePoint(o, world, new pc.Vec3());
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= bestDistance) continue;
      bestDistance = d;
      switch (o.kind) {
        case 'bomb':
          best = { point: p, label: o.precision ? `${o.territoryId} spot` : o.territoryId, tone: 'target', ring: false, territoryId: o.territoryId };
          break;
        case 'recon':
        case 'reach':
          best = { point: p, label: o.territoryId, tone: 'target', ring: false, territoryId: o.territoryId };
          break;
        case 'ring':
          best = { point: p, label: `Ring ${o.number}/${mission.objectives.length}`, tone: 'ring', ring: true, territoryId: null };
          break;
        case 'land':
          best = { point: p, label: `${world.home.id} · Land`, tone: 'home', ring: false, territoryId: world.home.id };
          break;
      }
    }
    return best;
  }

  /** Territories with objectives on them → whether they are all done. */
  private objectiveTerritories(mission: Mission | null): Map<string, boolean> {
    const result = new Map<string, boolean>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind !== 'bomb' && o.kind !== 'recon' && o.kind !== 'reach') return;
      result.set(o.territoryId, (result.get(o.territoryId) ?? true) && mission.isDone(i));
    });
    return result;
  }

  private objectiveLabel(mission: Mission, index: number): string {
    const o = mission.objectives[index];
    if (!o) return '';
    switch (o.kind) {
      case 'bomb': return o.precision ? `Hit the ink spot on ${o.territoryId}` : `Hit the bullseye on ${o.territoryId}`;
      case 'recon': return `Scout ${o.territoryId} below ${o.airspace.ceiling} m`;
      case 'reach': return `Reach ${o.territoryId}'s airspace`;
      case 'ring': return `Ring ${o.number} of ${mission.objectives.length}`;
      case 'land': return `Land on ${o.territoryId}`;
    }
  }

  private tracker(mission: Mission, from: pc.Vec3): TrackerView {
    const { world, state } = this;
    const objectives: ObjectiveView[] = [];
    const rings = mission.objectives.filter((o) => o.kind === 'ring');
    if (rings.length > 0) {
      // A ring course is one line: how many rings so far, and how far to the next.
      const done = mission.progress.filter((p) => p >= 1).length;
      const next = mission.openObjectives()[0];
      const gate = next !== undefined ? mission.objectives[next] : null;
      objectives.push({
        label: `Fly through the rings (${done}/${rings.length})`,
        done: mission.allDone,
        open: !mission.allDone,
        progress: done / rings.length,
        distance: gate?.kind === 'ring' ? Math.hypot(gate.gate.x - from.x, gate.gate.y - from.y, gate.gate.z - from.z) : null,
      });
    } else {
      mission.objectives.forEach((o, i) => {
        const p = objectivePoint(o, world, this.v3);
        objectives.push({
          label: this.objectiveLabel(mission, i),
          done: mission.isDone(i),
          open: mission.isOpen(i) && mission.isActive,
          progress: o.kind === 'recon' ? mission.progress[i] : null,
          distance: Math.hypot(p.x - from.x, p.z - from.z),
        });
      });
    }
    const d = MISSIONS.difficulty[mission.spec.difficulty];
    return {
      title: mission.title,
      type: mission.spec.type,
      difficultyLabel: d.label,
      multiplier: d.multiplier,
      reward: mission.reward,
      status: mission.status,
      failure: mission.failure,
      timeLeft: mission.timeLeft,
      objectives,
      hint: this.trackerHint(mission, state.phase),
    };
  }

  private trackerHint(mission: Mission, phase: string): string {
    if (phase === 'landed' || phase === 'crashed') return '';
    if (mission.status === 'succeeded') return `Now land on T1 to recover your plane: the next refit costs ${ECONOMY.refitCost} instead of ${ECONOMY.planeCost}.`;
    if (mission.status === 'failed') {
      const why = mission.failure === 'out-of-time' ? 'The clock ran out.' : 'Every bomb is gone.';
      return `${why} Land on T1 to recover the plane anyway.`;
    }
    const next = mission.objectives[mission.openObjectives()[0]];
    switch (next?.kind) {
      case 'bomb': return 'Line up on the target and left-click. The ball keeps your speed, so release before you are over it.';
      case 'recon': return `Stay low over ${next.territoryId}: time only counts inside the blue zone, below ${next.airspace.ceiling} m.`;
      case 'reach': return `Get into ${next.territoryId}'s airspace before the clock runs out. Shift boosts.`;
      case 'ring': return 'Fly through the orange ring. The next one lights up when you pass.';
      case 'land': return 'Slow down (S), line up with T1 and descend gently.';
      default: return '';
    }
  }

  private result(): ResultView | null {
    const { state } = this;
    const mission = state.mission;
    if (!mission) return null;
    const recovered = state.phase === 'landed';
    if (!(recovered && this.rolledToStop) && state.phase !== 'crashed') return null;
    const failure: Record<string, string> = {
      missed: 'Failed: out of bombs',
      'out-of-time': 'Failed: out of time',
      'aircraft-lost': 'Failed: plane lost',
      abandoned: 'Failed: landed before finishing',
    };
    const succeeded = mission.status === 'succeeded';
    return {
      recovered,
      headline: recovered ? 'Plane recovered' : this.crashCause === 'hard-landing' ? 'Hard landing' : 'Plane lost',
      missionTitle: mission.title,
      missionLine: succeeded ? `Complete · +${mission.reward} paper` : failure[mission.failure ?? 'abandoned'],
      missionTone: succeeded ? 'good' : 'bad',
      planeLine: recovered ? `In the hangar · refit for ${state.refitCost}` : `Destroyed · next one costs ${state.planeCost}`,
    };
  }

  private minimapView(mission: Mission | null, objective: pc.Vec3 | null): MiniMapView {
    const { world, plane, state } = this;
    const roles = this.objectiveTerritories(mission);
    const zones: MiniMapView['zones'] = [];
    const rings: MiniMapView['rings'] = [];
    mission?.objectives.forEach((o, i) => {
      if (mission.isDone(i)) return;
      if (o.kind === 'bomb') zones.push({ x: o.zone.x, z: o.zone.z, precision: o.precision });
      if (o.kind === 'ring') rings.push({ x: o.gate.x, z: o.gate.z, yaw: o.gate.yaw, state: mission.isOpen(i) ? 'open' : 'waiting' });
    });
    const showPlane = state.phase === 'flying' || state.phase === 'landed';
    return {
      territories: world.territories.map((t) => {
        const done = roles.get(t.id);
        return { id: t.id, x: t.x, z: t.z, half: t.half, role: t.isHome ? 'home' : done === undefined ? 'neutral' : done ? 'done' : 'objective' };
      }),
      zones,
      rings,
      plane: showPlane ? { x: plane.position.x, z: plane.position.z, yaw: plane.yaw, autopilot: this.boundary.state === 'autopilot' } : null,
      objective: showPlane && objective ? { x: objective.x, z: objective.z } : null,
      boundaryRadius: WORLD.boundaryRadius,
      warning: state.phase === 'flying' && this.boundary.state !== 'inside',
    };
  }

  /** Screen position of a world point, or null when it is behind the camera or off screen. */
  private projectOnScreen(point: pc.Vec3): ScreenPoint | null {
    const cam = this.camera.entity;
    const depth = this.rel.copy(point).sub(cam.getPosition()).dot(cam.forward);
    if (depth <= 0.1) return null;
    const s = this.camera.camera.worldToScreen(point, this.screen);
    const { clientWidth: w, clientHeight: h } = this.app.graphicsDevice.canvas;
    if (s.x < 0 || s.y < 0 || s.x > w || s.y > h) return null;
    return { x: s.x, y: s.y };
  }

  /** Like projectOnScreen, but pins off-screen points to the screen edge with a direction. */
  private indicator(point: pc.Vec3): { x: number; y: number; onScreen: boolean; angle: number } {
    const cam = this.camera.entity;
    const { clientWidth: w, clientHeight: h } = this.app.graphicsDevice.canvas;
    const cx = w / 2;
    const cy = h / 2;
    const margin = 56;
    const rel = this.rel.copy(point).sub(cam.getPosition());
    let dx: number;
    let dy: number;
    if (rel.dot(cam.forward) > 0.1) {
      const s = this.camera.camera.worldToScreen(point, this.screen);
      if (s.x >= margin && s.x <= w - margin && s.y >= margin && s.y <= h - margin) {
        return { x: s.x, y: s.y, onScreen: true, angle: 0 };
      }
      dx = s.x - cx;
      dy = s.y - cy;
    } else {
      dx = rel.dot(cam.right);
      dy = -rel.dot(cam.up);
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    }
    const scale = Math.min((cx - margin) / Math.max(Math.abs(dx), 1e-6), (cy - margin) / Math.max(Math.abs(dy), 1e-6));
    return { x: cx + dx * scale, y: cy + dy * scale, onScreen: false, angle: Math.atan2(dy, dx) };
  }
}

/** Where an objective is, for markers and distances. */
function objectivePoint(o: Objective, world: World, out: pc.Vec3): pc.Vec3 {
  switch (o.kind) {
    case 'bomb': return out.set(o.zone.x, o.zone.top + 0.5, o.zone.z);
    case 'recon':
    case 'reach': return out.set(o.airspace.x, 0.5, o.airspace.z);
    case 'ring': return out.set(o.gate.x, o.gate.y, o.gate.z);
    case 'land': return out.set(world.home.x, 0.5, world.home.z);
  }
}

/**
 * The fold pose while building. A new plane goes from a flat sheet to finished; a refit re-creases
 * a recovered plane: wings up, then back down.
 */
function foldPose(progress: number, refit: boolean): number {
  if (!refit) return progress;
  return progress < 0.35 ? 1 - (progress / 0.35) * 0.5 : 0.5 + ((progress - 0.35) / 0.65) * 0.5;
}

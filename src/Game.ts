import * as pc from 'playcanvas';
import { AIRCRAFT, AIRCRAFT_ORDER, BOMB, CAMERA, DAMAGE, LANDING, MISSIONS, PALETTE, PLANE, TARGETS, WEAPONS, WORLD, type AircraftId } from './config';
import { aircraftRatings, RATING_KEYS, RATING_LABELS } from './aircraft/Aircraft';
import { Bombs, type BombImpact, type ZoneRef } from './aircraft/Bomb';
import { ChaseCamera } from './aircraft/ChaseCamera';
import { FlightTrails } from './aircraft/FlightTrails';
import { HangarPreview } from './aircraft/HangarPreview';
import { assessTouchdown, hardLandingReason } from './aircraft/Landing';
import { clamp, PlaneController, yawFromDirection, type Collision } from './aircraft/PlaneController';
import { distanceToShape, footprint } from './combat/Collision';
import { blastDamage, impactDamage, roughLandingDamage } from './combat/Damage';
import type { Destructible } from './combat/Destructibles';
import { layoutTargetRange } from './combat/Destructibles';
import { Projectiles, type ShotImpact } from './combat/Projectiles';
import type { Mission, Objective } from './missions/Mission';
import { generateOffers } from './missions/MissionGenerator';
import { Boundary } from './systems/Boundary';
import { GameState, type BuildKind, type CrashCause } from './systems/GameState';
import { Input, MOUSE_LEFT, MOUSE_RIGHT } from './systems/Input';
import { LocalStats } from './systems/LocalStats';
import { ResourceManager } from './systems/ResourceManager';
import type { GarageView } from './ui/Garage';
import {
  HUD,
  type AircraftStatusView,
  type GroundView,
  type HudView,
  type ObjectiveView,
  type ResultView,
  type ScreenPoint,
  type TargetIndicator,
  type TargetLabelView,
  type TerritoryLabel,
  type TrackerView,
} from './ui/HUD';
import type { MiniMapView } from './ui/MiniMap';
import { Effects } from './world/Effects';
import { MissionMarkers } from './world/MissionMarkers';
import { TargetRange } from './world/TargetRange';
import { buildWorld, type World } from './world/WorldGenerator';

/** Ignore an Esc key press this soon after the browser released pointer lock (it was the same press). */
const ESC_AFTER_UNLOCK_MS = 300;
/** Distance at which the nose and aim reticles are projected. */
const RETICLE_RANGE = 60;
/** The autopilot cruises home at this height. */
const AUTOPILOT_ALTITUDE = 22;
/** The sortie report waits this long after a crash, so the wreck can be seen. */
const CRASH_REPORT_DELAY = 1.2;
/** At most this many target labels at once, nearest first. */
const MAX_TARGET_LABELS = 6;
const KEY_TO_CARD: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

/**
 * Wires the rules (GameState, missions, paper) to the 3D scene, input and HUD, and runs the frame
 * loop. The rules never touch rendering; this class translates between the two.
 */
export class Game {
  readonly boundary = new Boundary();
  paused = false;

  private lastAutoPause = -Infinity;
  private lastHint = -Infinity;
  /** The landing rollout has finished and the ground crew can work. */
  private rolledToStop = false;
  private crashTime = 0;
  private crashCause: CrashCause | null = null;
  private readonly crashPoint = new pc.Vec3();
  /** Where the last bomb landed, and how much longer the camera keeps it in view. */
  private readonly impactPoint = new pc.Vec3();
  private impactCamTime = 0;
  /** Health of the plane being refitted when the refit began, to animate the repair. */
  private refitFrom = 1;
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
    readonly career: LocalStats,
    readonly range: TargetRange,
    readonly plane: PlaneController,
    readonly bombs: Bombs,
    readonly projectiles: Projectiles,
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
    const targetSpecs = layoutTargetRange(world.territories);
    const range = new TargetRange(app, targetSpecs);
    const resources = new ResourceManager();
    const missionContext = {
      territories: world.territories,
      homeId: world.home.id,
      launch: world.launchPosition,
      dummies: targetSpecs.filter((s) => s.kind === 'dummy'),
      obstacles: targetSpecs.flatMap((s) => s.shapes.map(footprint)),
    };
    const state = new GameState(resources, () => generateOffers(missionContext, Math.random));
    const career = LocalStats.browser();
    if (career.data.lastAircraft) state.aircraft = career.data.lastAircraft;

    const ground = (x: number, z: number) => {
      const t = world.territories.find((p) => p.containsXZ(x, z));
      return t ? t.top : null;
    };

    let game: Game | undefined;
    const hud = new HUD(hudRoot, {
      build: () => game?.build(),
      select: (index) => game?.select(index),
      selectAircraft: (id) => game?.selectAircraft(id),
      rearm: () => game?.rearm(),
      takeOff: () => game?.takeOff(),
      endSortie: () => game?.endSortie(),
      continueToDesk: () => game?.continueToDesk(),
      resume: () => game?.resume(),
    });
    game = new Game(
      app,
      world,
      resources,
      state,
      career,
      range,
      new PlaneController(app, state.aircraft),
      new Bombs(app),
      new Projectiles(app),
      new ChaseCamera(app),
      new Effects(app, ground),
      new MissionMarkers(app, world, (id) => range.get(id)?.spec ?? null),
      new FlightTrails(app),
      new HangarPreview(app),
      new Input(canvas),
      hud,
    );
    game.bindEvents();
    game.refreshPad();
    game.camera.updateDesk(0, world.launchPosition, world.launchYaw, true);
    app.on('update', (dt: number) => game!.tick(dt));
    app.start();
    return game;
  }

  // ---- Player actions -------------------------------------------------------------------------

  select(index: number): void {
    if (!this.paused) this.state.select(index);
  }

  selectAircraft(id: AircraftId): void {
    if (this.paused) return;
    if (this.state.phase === 'building') {
      this.hint('Folding in progress', 'Wait for this plane, or launch it and land to switch.');
      return;
    }
    this.state.selectAircraft(id);
  }

  /** Q / E: the previous or next design in the garage. */
  cycleAircraft(step: number): void {
    const i = AIRCRAFT_ORDER.indexOf(this.state.aircraft);
    this.selectAircraft(AIRCRAFT_ORDER[(i + step + AIRCRAFT_ORDER.length) % AIRCRAFT_ORDER.length]);
  }

  /** Fold a new plane, refit a recovered one or roll a stowed one out, on the launch pad. */
  build(): void {
    if (this.paused) return;
    const waiting = this.state.hangar.get(this.state.aircraft);
    this.refitFrom = waiting ? waiting.health / AIRCRAFT[this.state.aircraft].maxHealth : 1;
    if (!this.state.build()) return;
    this.plane.setAircraft(this.state.plane!.id);
    this.plane.setDamage(this.refitFrom);
    this.parkPlane(this.state.buildKind === 'fold' ? 0 : 1);
  }

  launch(): void {
    if (this.paused || !this.state.launch()) return;
    this.plane.setDamage(1);
    this.plane.launch();
    this.boundary.reset();
    this.input.consumeMouse(); // ignore mouse travel from before take-off
    this.input.requestPointerLock();
  }

  dropBomb(): void {
    if (this.paused || !this.state.dropBomb()) return;
    // The ball released is the one that disappears from the rack: slot `bombsLoaded` after the drop.
    const kind = this.state.plane!.bombs.kind;
    this.bombs.release(this.plane.getBombPosition(this.v1, this.state.bombsLoaded), this.plane.getVelocity(this.v2), kind);
  }

  /** Fires one ink round from the next barrel, towards the point the guns converge on. */
  private fire(): void {
    const barrel = this.state.fire();
    if (barrel === null) return;
    const gun = this.state.plane!.gun;
    const muzzle = this.plane.getMuzzle(this.v1, barrel);
    const aimPoint = this.plane.getForward(this.v2).mulScalar(WEAPONS.convergence).add(this.plane.position);
    const velocity = aimPoint.sub(muzzle).normalize().mulScalar(gun.speed).add(this.plane.getVelocity(this.v3));
    this.projectiles.fire(muzzle, velocity, gun.damage, gun.range);
  }

  /** On the ground at home: the ground crew tops up ink and range. */
  rearm(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (!this.state.rearm() && this.state.rearmProgress === null) this.hint('Fully armed', 'Ink and range are already topped up.');
  }

  /** From wherever the plane stopped after landing. */
  takeOff(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (!this.state.takeOff()) return;
    this.plane.launch();
    this.rolledToStop = false;
    this.boundary.reset();
    this.input.consumeMouse();
    this.input.requestPointerLock();
  }

  /** After landing: the plane goes into the hangar and the report comes up. */
  endSortie(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (this.state.endSortie()) this.input.exitPointerLock();
  }

  /** From the report: back to the desk for the next sortie. */
  continueToDesk(): void {
    if (this.paused) return;
    if (this.state.phase === 'crashed' && this.crashTime < CRASH_REPORT_DELAY) return;
    if (!this.state.continueToDesk()) return;
    this.impactCamTime = 0;
    this.rolledToStop = false;
    this.bombs.clear();
    this.projectiles.clear();
    this.trails.clear();
    this.boundary.reset();
    this.range.restoreAll();
    this.refreshPad();
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
    const atDesk = state.phase === 'desk' || state.phase === 'building' || state.phase === 'ready';
    switch (state.phase) {
      case 'desk':
      case 'building':
      case 'ready':
        if (state.phase === 'building') {
          plane.setFold(foldPose(state.buildProgress, state.buildKind));
          if (state.buildKind === 'refit') plane.setDamage(this.refitFrom + (1 - this.refitFrom) * state.buildProgress);
        }
        // Dragging on the canvas turns the preview.
        if (this.input.isButtonHeld(MOUSE_LEFT) && !this.input.pointerLocked) this.preview.drag(mouse.dx, mouse.dy);
        camera.updateDesk(dt, world.launchPosition, world.launchYaw);
        break;
      case 'flying':
        this.fly(dt, mouse);
        break;
      case 'landed':
      case 'debrief':
        if (plane.rollout(dt, world.home) && !this.rolledToStop) {
          this.rolledToStop = true;
          this.input.exitPointerLock(); // free the cursor for the ground crew's buttons
        }
        camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        break;
      case 'crashed':
        this.crashTime += dt;
        camera.updateWatch(dt, this.crashPoint);
        break;
    }

    // The bombs are loaded at take-off; on the pad they would only sit in the way of the fold.
    plane.setBombs(state.phase === 'flying' || state.phase === 'landed' ? state.bombsLoaded : 0);
    if (state.durability && !atDesk) plane.setDamage(state.durability.fraction);
    const shown = atDesk ? state.selectedMission : state.mission;
    if (this.markers.shown !== shown) this.markers.show(shown);

    for (const impact of this.bombs.update(dt, this.openZones(), world.territories, this.range.colliders)) this.onBombImpact(impact);
    for (const impact of this.projectiles.update(dt, this.range.colliders, world.territories)) this.onShotImpact(impact);
    this.range.update(dt);
    this.markers.update(dt);
    this.trails.update(dt, plane, state.durability?.fraction ?? 1);
    const parked = atDesk && plane.status === 'parked' && plane.spec.id === state.aircraft;
    this.preview.update(dt, world.launchPosition, state.aircraft, state.phase === 'desk', parked ? 1.6 : 0);
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
    const result = plane.fly(
      dt,
      {
        mouseDX: mouse.dx,
        mouseDY: mouse.dy,
        throttle: input.axis('KeyS', 'KeyW'),
        bank: input.axis('KeyD', 'KeyA'),
        boost: input.isHeld('ShiftLeft') || input.isHeld('ShiftRight'),
        autoLevel: !this.onApproach(),
        autopilot,
        gliding: state.outOfRange,
      },
      world.territories,
      this.range.solids,
    );
    for (const collision of result.collisions) {
      this.onCollision(collision);
      if (state.phase !== 'flying') return; // that one destroyed the plane
    }
    switch (result.outcome) {
      case 'flying':
        state.updateFlight(plane.prevPosition, plane.position, dt);
        if (input.isButtonHeld(MOUSE_LEFT) && !this.paused) this.fire();
        if (state.phase === 'flying') this.camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        break;
      case 'touchdown':
        this.effects.burst(plane.position, 'dust');
        this.rolledToStop = false;
        state.land(world.home.id);
        this.camera.updateFollow(dt, plane, world.territories, null);
        break;
      case 'void':
        state.crash('void');
        break;
    }
  }

  /** Flew into something: what it costs depends on how hard. Props take a beating too. */
  private onCollision(c: Collision): void {
    const { state, plane } = this;
    let damage = c.kind === 'rough-landing' ? roughLandingDamage(c.state) : impactDamage(c.closing);
    if (c.kind === 'object') {
      const target = this.range.get(c.id);
      const ram = Math.round(impactDamage(c.closing) * DAMAGE.ramMultiplier);
      // Paper and cardboard give way: they hurt less than a platform does.
      if (target) damage = Math.round(damage * TARGETS.hardness[target.spec.kind]);
      if (target && ram > 0) this.damageTarget(target, ram, this.range.centre(target, this.v3));
    }
    if (damage <= 0) return;
    this.effects.burst(plane.position, 'thud');
    const { dealt, destroyed } = state.damageAircraft(damage, c.kind === 'rough-landing' ? 'landing' : 'impact');
    if (destroyed || dealt <= 0) return;
    if (c.kind === 'rough-landing') {
      this.hud.banner(`Rough landing! −${dealt}`, `${hardLandingReason(c.check)} Go around and try again.`, 'bad', 3);
    } else {
      const what = c.kind === 'object' ? (this.range.get(c.id)?.spec.name.toLowerCase() ?? 'a prop') : c.id;
      this.hud.banner(`Ouch! −${dealt}`, `You hit ${what}. Keep clear of platforms and props.`, 'bad', 2.2);
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

  private onBombImpact(impact: BombImpact & { bomb: keyof typeof BOMB.kinds }): void {
    const point = this.impactPoint.set(impact.x, impact.y, impact.z);
    let struck = false;
    if (impact.kind !== 'void') {
      const hit = impact.kind === 'target';
      this.effects.bombImpact(point, hit || impact.kind === 'object');
      const at = this.projectOnScreen(this.v3.copy(point));
      if (at) this.hud.pop(hit ? 'BOOM!' : impact.kind === 'object' ? 'WHAM!' : 'SPLAT!', hit || impact.kind === 'object' ? 'good' : 'bad', at);
      // The blast damages every prop and practice plane around the impact.
      const kind = BOMB.kinds[impact.bomb];
      for (const target of this.range.targets) {
        if (!target.alive) continue;
        const distance = Math.min(...target.spec.shapes.map((s) => distanceToShape(point, s)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0 && this.damageTarget(target, damage, this.range.labelPoint(target, this.v2)) > 0) struck = true;
      }
    }
    this.impactCamTime = impact.kind === 'void' ? 0 : CAMERA.bombCamLinger;
    this.state.resolveBomb(impact.kind === 'target' ? impact.objective : null, struck);
  }

  private onShotImpact(impact: ShotImpact & { damage: number }): void {
    const point = this.v1.set(impact.x, impact.y, impact.z);
    if (impact.kind === 'platform') {
      this.effects.inkHit(point, true);
      return;
    }
    this.effects.inkHit(point, false);
    const target = this.range.get(impact.id);
    if (!target) return;
    this.state.recordShotHit();
    const alive = target.alive;
    const dealt = this.damageTarget(target, impact.damage, point);
    if (dealt > 0) this.hud.hitMarker(alive && !target.alive);
  }

  /** Damages a prop or practice plane, with numbers, effects and the bookkeeping. Returns the damage dealt. */
  private damageTarget(target: Destructible, amount: number, at: pc.Vec3): number {
    const { dealt, destroyed } = this.range.damage(target.id, amount);
    if (dealt <= 0) return 0;
    const screen = this.projectOnScreen(this.v3.copy(at));
    if (screen) this.hud.damageNumber(dealt, screen, destroyed);
    if (destroyed) {
      const centre = this.range.centre(target, this.v3);
      if (target.spec.kind === 'dummy') {
        this.effects.wreck(centre, pc.Vec3.ZERO, PALETTE.dummyAccent, 0.8, PALETTE.dummyPaper);
        const p = this.projectOnScreen(centre);
        if (p) this.hud.pop('SHOT DOWN!', 'good', p);
      } else {
        this.effects.burst(centre, 'cardboard');
        const p = this.projectOnScreen(centre);
        if (p) this.hud.pop('CRUNCH!', 'good', p);
      }
    }
    this.state.recordDamage(dealt, destroyed ? target.id : null);
    return dealt;
  }

  /** The newest falling bomb, or for a moment after it lands, the impact point. */
  private bombCamFocus(dt: number): pc.Vec3 | null {
    const falling = this.bombs.newest();
    if (falling) return falling;
    if (this.impactCamTime <= 0) return null;
    this.impactCamTime -= dt;
    return this.impactPoint;
  }

  /**
   * At the desk, the pad shows the chosen design if one is waiting in the hangar (crumpled if it
   * came back damaged); otherwise it is empty and only the blueprint preview turns above it.
   */
  private refreshPad(): void {
    const { state, plane } = this;
    if (state.phase !== 'desk') return;
    const waiting = state.hangar.get(state.aircraft);
    if (!waiting) {
      plane.hide();
      return;
    }
    plane.setAircraft(state.aircraft);
    plane.setDamage(waiting.health / AIRCRAFT[state.aircraft].maxHealth);
    this.parkPlane(1);
  }

  private parkPlane(fold: number): void {
    const pad = this.v1.copy(this.world.launchPosition);
    pad.y = PLANE.parkedHeight;
    this.plane.park(pad, this.world.launchYaw, this.world.home.id, fold);
  }

  /** A short banner for "you can't do that now" moments, not repeated in quick succession. */
  private hint(title: string, subtitle: string): void {
    if (performance.now() - this.lastHint < 2500) return;
    this.lastHint = performance.now();
    this.hud.banner(title, subtitle, 'info', 2.5);
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
      else if (code === 'KeyQ') this.cycleAircraft(-1);
      else if (code === 'KeyE') this.cycleAircraft(1);
      else if (code === 'KeyF') this.build();
      else if (code === 'Space') {
        if (state.phase === 'landed') this.takeOff();
        else this.launch();
      } else if (code === 'KeyR') {
        if (state.phase === 'landed') this.rearm();
        else if (state.phase === 'flying') this.hint('Rearm at home', 'Land on T1, then press R to top up ink and range.');
      } else if (code === 'Enter' || code === 'NumpadEnter') {
        if (state.phase === 'landed') this.endSortie();
        else this.continueToDesk();
      }
    });
    input.onCanvasClick((button) => {
      if (state.phase !== 'flying' || this.paused) return;
      if (button === MOUSE_RIGHT) this.dropBomb();
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
        case 'aircraft-selected':
          this.career.rememberAircraft(event.aircraft);
          this.refreshPad();
          break;
        case 'stowed':
          hud.banner(`${AIRCRAFT[event.aircraft].name} stowed`, 'It waits in the hangar, ready to roll out for free.', 'info', 2.2);
          break;
        case 'build-refused':
          if (event.reason === 'incompatible') {
            hud.banner(`The ${state.chosen.name} can't fly this mission`, `${event.detail}. Pick another plane (Q/E) or mission.`, 'bad', 3);
          } else {
            hud.banner('Not enough paper', `You need ${event.cost}. Your home territory keeps producing paper.`, 'bad', 2.5);
          }
          break;
        case 'launch-refused':
          hud.banner(`Wrong plane for this mission`, `${event.detail}. Choose another mission, or switch planes (Q/E).`, 'bad', 3);
          break;
        case 'ready':
          this.effects.burst(this.plane.position, 'fold');
          break;
        case 'launched':
          this.career.recordSortie(state.plane!.id);
          hud.banner('Mission active', state.mission!.title, 'info', 1.8);
          break;
        case 'out-of-ammo':
          hud.banner('Out of ink!', 'Land on T1 and press R to rearm.', 'bad', 2.5);
          break;
        case 'range-exhausted':
          hud.banner('Out of range!', 'The plane can only glide now. Head home and land to rearm.', 'bad', 3.5);
          break;
        case 'damaged':
          hud.damageFlash(event.amount);
          break;
        case 'target-destroyed':
          this.career.recordTargetDestroyed();
          break;
        case 'bomb-missed':
          if (event.remaining > 0 || state.bombsFalling > 0) {
            hud.banner('Missed!', `${event.remaining} bomb${event.remaining === 1 ? '' : 's'} left. Line up and try again.`, 'bad', 2);
          }
          break;
        case 'objective-complete':
          this.onObjectiveComplete(event.objective, event.index);
          break;
        case 'mission-succeeded':
          this.career.recordMissionCompleted();
          if (state.phase === 'landed') break; // the touchdown banner reports it
          hud.banner(
            'Mission complete!',
            state.phase === 'flying' ? `+${event.reward} paper · Land on T1 to recover your plane` : `+${event.reward} paper`,
            'good',
            3.5,
          );
          break;
        case 'mission-failed':
          if (event.reason === 'missed') hud.banner('Out of bombs!', 'Every target needs a hit. Mission failed.', 'bad', 3);
          else if (event.reason === 'out-of-time') hud.banner('Out of time!', 'Mission failed. Land on T1 to recover the plane.', 'bad', 3);
          break;
        case 'crashed':
          this.onCrashed(event.cause);
          break;
        case 'landed': {
          const mission = state.mission;
          if (mission?.status === 'succeeded' && mission.objectives.some((o) => o.kind === 'land')) {
            hud.banner('Mission complete!', `+${mission.reward} paper · Plane recovered`, 'good', 3.5);
          } else {
            hud.banner('Touchdown!', 'Safe on T1. The ground crew is ready.', 'good', 2.5);
          }
          break;
        }
        case 'rearmed':
          hud.banner('Rearmed', 'Ink and range topped up. Space to take off.', 'good', 2);
          break;
        case 'paper-reset':
          hud.banner('Paper reset', `${this.resources.paper} paper restored`, 'info', 1.6);
          break;
      }
    });
  }

  /** The plane is gone: it bursts into paper and its crumpled remains tumble away. */
  private onCrashed(cause: CrashCause): void {
    const { plane, hud } = this;
    this.crashPoint.copy(plane.position);
    this.crashTime = 0;
    this.crashCause = cause;
    if (cause !== 'void') this.effects.wreck(plane.position, plane.getVelocity(this.v2), plane.spec.accent, 1);
    const at = this.projectOnScreen(this.v3.copy(plane.position));
    if (at && cause !== 'void') hud.pop('CRUMPLED!', 'bad', at);
    plane.crash();
    this.career.recordPlaneLost();
    this.input.exitPointerLock(); // free the cursor for the Continue button
    if (cause === 'hard-landing') {
      hud.banner('Hard landing!', `${hardLandingReason(plane.lastTouchdown ?? assessTouchdown(plane.touchdownState()))} The plane is wrecked.`, 'bad', 4);
    } else if (cause === 'void') {
      hud.banner('Plane lost in the void', 'No reward for an unfinished mission.', 'bad', 4);
    } else {
      hud.banner('Plane destroyed!', 'It hit too hard and crumpled. Fast impacts tear paper apart.', 'bad', 4);
    }
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

    const from = choosing ? world.launchPosition : plane.position;
    const goal = this.currentGoal(mission, from);
    let target: TargetIndicator | null = null;
    if (goal) {
      const distance = goal.solid
        ? this.v2.copy(goal.point).sub(from).length()
        : Math.hypot(goal.point.x - from.x, goal.point.z - from.z);
      target = { ...this.indicator(goal.point), label: `${goal.label} · ${Math.round(distance)} m`, tone: goal.tone, near: !goal.solid && distance < 15 };
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

    const kind = state.phase === 'desk' ? state.buildKindFor(state.aircraft) : state.buildKind;
    const name = (state.plane ?? state.chosen).name;
    const buildCost = state.buildCost;
    let buildNote: string | null = null;
    let noteTone: 'bad' | 'info' = 'info';
    const fit = state.phase === 'desk' || state.phase === 'ready' ? state.suitability(state.plane?.id ?? state.aircraft) : null;
    if (fit?.level === 'unsuitable') {
      noteTone = 'bad';
      buildNote = `The ${name} can't fly this mission: ${fit.reason}. Choose another plane (Q/E) or mission.`;
    } else if (state.phase === 'desk') {
      const waiting = state.hangar.get(state.aircraft);
      if (!resources.canAfford(buildCost)) {
        const wait = state.income.timeToAfford(resources.paper, buildCost);
        noteTone = 'bad';
        buildNote =
          `Need ${buildCost} paper to ${kind === 'refit' ? 'refit' : 'fold'} a ${name}, you have ${resources.paper}.` +
          (wait !== null ? ` Your home makes paper: ready in about ${Math.ceil(wait)} s.` : ' Fly a mission to earn more.');
      } else if (waiting?.condition === 'recovered') {
        buildNote = `Your recovered ${name} is in the hangar: a refit costs ${buildCost} instead of ${AIRCRAFT[state.aircraft].cost}.`;
      } else if (waiting?.condition === 'ready') {
        buildNote = `Your ${name} is stowed in the hangar, ready to roll out for free.`;
      }
    } else if (state.phase === 'ready') {
      buildNote = 'Q / E stows this plane in the hangar and switches to another.';
    }

    const landing = this.onApproach()
      ? (() => {
          const s = plane.touchdownState();
          return { speed: s.speed, sink: s.sink, rollDeg: (s.roll * 180) / Math.PI, check: assessTouchdown(s) };
        })()
      : null;

    const f = plane.flight;
    const favorite = this.career.favorite;
    return {
      paper: resources.paper,
      career: {
        missionsCompleted: this.career.data.missionsCompleted,
        planesLost: this.career.data.planesLost,
        targetsDestroyed: this.career.data.targetsDestroyed,
        favorite: favorite ? AIRCRAFT[favorite].name : null,
      },
      phase: state.phase,
      paused: this.paused,
      income: {
        producing: state.income.isProducing(resources.paper),
        amount: state.income.amount,
        interval: state.income.interval,
        progress: state.income.progress,
        cap: state.income.cap,
      },
      build: { cost: buildCost, kind, name, canBuild: state.canBuild(), note: buildNote, noteTone, progress: state.buildProgress },
      garage: choosing ? this.garageView() : null,
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
              fits: AIRCRAFT_ORDER.map((id) => ({
                id,
                name: AIRCRAFT[id].name,
                level: state.suitability(id, m).level,
                selected: id === (state.plane?.id ?? state.aircraft),
              })),
            };
          })
        : null,
      selected: state.selected,
      tracker: !choosing && mission ? this.tracker(mission, from) : null,
      flight: flying
        ? {
            speed: plane.speed,
            speedFrac: (plane.speed - f.minSpeed) / (f.maxSpeed + f.boostSpeed - f.minSpeed),
            throttleFrac: (plane.throttleSpeed - f.minSpeed) / (f.maxSpeed + f.boostSpeed - f.minSpeed),
            altitude: plane.position.y,
            boost: { state: plane.boost.state, level: plane.boost.level },
            autopilot: this.boundary.state === 'autopilot',
          }
        : null,
      aircraft: this.aircraftStatus(),
      ground: this.groundView(),
      landing,
      boundary: { state: this.boundary.state, countdown: this.boundary.countdown },
      result: this.result(),
      pointerLocked: this.input.pointerLocked,
      nose,
      aim,
      target,
      labels,
      targets: flying || state.phase === 'landed' ? this.targetLabels(mission, target?.onScreen ? goal?.targetId ?? null : null) : [],
      minimap: this.minimapView(mission, goal?.point ?? null),
    };
  }

  private garageView(): GarageView {
    const { state, resources } = this;
    const mission = state.selectedMission;
    const chosen = state.chosen;
    const ratings = aircraftRatings(chosen);
    const fit = state.suitability(chosen.id, mission);
    const bombKind = BOMB.kinds[chosen.bombs.kind];
    return {
      cards: AIRCRAFT_ORDER.map((id) => {
        const spec = AIRCRAFT[id];
        const waiting = state.hangar.get(id);
        const cost = state.buildCostFor(id);
        return {
          id,
          name: spec.name,
          roleLabel: spec.roleLabel,
          accent: css(spec.accent),
          cost: spec.cost,
          buildCost: cost,
          buildKind: state.buildKindFor(id),
          hangar: waiting?.condition ?? null,
          hangarHealth: waiting ? waiting.health / spec.maxHealth : null,
          suitability: state.suitability(id, mission).level,
          selected: id === state.aircraft,
          affordable: resources.canAfford(cost),
        };
      }),
      inspector: {
        name: chosen.name,
        roleLabel: chosen.roleLabel,
        accent: css(chosen.accent),
        tagline: chosen.tagline,
        ratings: RATING_KEYS.map((key) => ({ key, label: RATING_LABELS[key], value: ratings[key] })),
        loadout: [
          `${chosen.gunLabel} · ${chosen.gun.ammo} ink`,
          `${chosen.bombs.capacity} ${bombKind.label.toLowerCase()}${chosen.bombs.capacity === 1 ? '' : 's'}`,
          `${chosen.maxHealth} health · ${(chosen.range / 1000).toFixed(1)} km range`,
        ],
        suitability: { level: fit.level, reason: fit.reason, missionTitle: mission.title },
      },
      locked: state.phase === 'building',
    };
  }

  private aircraftStatus(): AircraftStatusView | null {
    const { state } = this;
    const spec = state.plane;
    if (!spec || !state.durability || !state.gun || (state.phase !== 'flying' && state.phase !== 'landed')) return null;
    const bomb = BOMB.kinds[spec.bombs.kind];
    return {
      name: spec.name,
      roleLabel: spec.roleLabel,
      accent: css(spec.accent),
      health: state.durability.health,
      maxHealth: spec.maxHealth,
      rangeLeft: state.rangeLeft,
      range: spec.range,
      gun: { label: spec.gunLabel, ammo: state.gun.ammo, capacity: state.gun.capacity, ready: state.canFire() },
      bombs: {
        label: bomb.label + 's',
        loaded: state.bombsLoaded,
        capacity: Math.min(spec.bombs.capacity, state.mission?.spec.bombs ?? 0),
        falling: state.bombsFalling,
        cooldown: state.bombCooldown / BOMB.dropCooldown,
        ready: state.canDropBomb(),
      },
      airborne: state.phase === 'flying',
    };
  }

  private groundView(): GroundView | null {
    const { state } = this;
    if (state.phase !== 'landed') return null;
    const mission = state.mission;
    let missionLine = '';
    let missionTone: GroundView['missionTone'] = 'info';
    if (mission?.status === 'succeeded') {
      missionLine = `Mission complete · +${mission.reward} paper. End the sortie for your report.`;
      missionTone = 'good';
    } else if (mission?.status === 'failed') {
      missionLine = 'Mission failed. End the sortie to recover the plane.';
      missionTone = 'bad';
    } else if (mission) {
      const left = mission.timeLeft;
      missionLine = `Mission still in progress${left !== null ? ` · ${Math.ceil(left)} s left` : ''}. Ending the sortie abandons it.`;
    }
    return { stopped: this.rolledToStop, rearming: state.rearmProgress, canRearm: state.canRearm(), missionLine, missionTone };
  }

  /** Names, roles and health over nearby practice planes, and over props once they are damaged. */
  private targetLabels(mission: Mission | null, skip: string | null): TargetLabelView[] {
    const eye = this.camera.entity.getPosition();
    const wanted = new Set<string>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind !== 'destroy' || !mission.isOpen(i) || !mission.isActive) return;
      const done = mission.destroyedTargets(i);
      for (const id of o.targets) if (!done.has(id)) wanted.add(id);
    });
    const near: Array<{ target: Destructible; distance: number }> = [];
    for (const target of this.range.targets) {
      if (!target.alive || target.id === skip) continue;
      if (target.spec.kind !== 'dummy' && target.health >= target.spec.maxHealth) continue;
      const p = this.range.labelPoint(target, this.v3);
      const distance = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      if (distance <= TARGETS.labelRange) near.push({ target, distance });
    }
    near.sort((a, b) => a.distance - b.distance);
    const views: TargetLabelView[] = [];
    for (const { target, distance } of near) {
      if (views.length >= MAX_TARGET_LABELS) break;
      const p = this.projectOnScreen(this.range.labelPoint(target, this.v3));
      if (!p) continue;
      views.push({
        id: target.id,
        x: p.x,
        y: p.y,
        name: target.spec.name,
        role: target.spec.role,
        health: target.durability.fraction,
        mission: wanted.has(target.id),
        far: clamp((distance - 30) / (TARGETS.labelRange - 30), 0, 1),
      });
    }
    return views;
  }

  /** What the target marker points at: the nearest open objective, or home once the mission is over. */
  private currentGoal(
    mission: Mission | null,
    from: pc.Vec3,
  ): Goal | null {
    const { state, world } = this;
    if (state.phase === 'debrief' || state.phase === 'crashed' || !mission) return null;
    const point = new pc.Vec3();
    if ((state.phase === 'flying' || state.phase === 'landed') && !mission.isActive) {
      if (state.phase === 'landed') return null;
      point.set(world.home.x, 0.5, world.home.z);
      return { point, label: `${world.home.id} · Land`, tone: 'home', solid: false, territoryId: world.home.id };
    }
    let best: Goal | null = null;
    let bestDistance = Infinity;
    for (const i of mission.openObjectives()) {
      const o = mission.objectives[i];
      if (o.kind === 'destroy') {
        // Point at the nearest practice plane still to shoot down.
        const done = mission.destroyedTargets(i);
        for (const id of o.targets) {
          const t = this.range.get(id);
          if (!t || done.has(id)) continue;
          const d = Math.hypot(t.spec.x - from.x, t.spec.z - from.z);
          if (d >= bestDistance) continue;
          bestDistance = d;
          best = { point: new pc.Vec3(t.spec.x, t.spec.y, t.spec.z), label: t.spec.name, tone: 'target', solid: true, territoryId: o.territoryId, targetId: id };
        }
        continue;
      }
      const p = objectivePoint(o, world, new pc.Vec3());
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= bestDistance) continue;
      bestDistance = d;
      switch (o.kind) {
        case 'bomb':
          best = { point: p, label: o.precision ? `${o.territoryId} spot` : o.territoryId, tone: 'target', solid: false, territoryId: o.territoryId };
          break;
        case 'recon':
        case 'reach':
          best = { point: p, label: o.territoryId, tone: 'target', solid: false, territoryId: o.territoryId };
          break;
        case 'ring':
          best = { point: p, label: `Ring ${o.number}/${mission.objectives.length}`, tone: 'ring', solid: true, territoryId: null };
          break;
        case 'land':
          best = { point: p, label: `${world.home.id} · Land`, tone: 'home', solid: false, territoryId: world.home.id };
          break;
      }
    }
    return best;
  }

  /** Territories with objectives on them → whether they are all done. */
  private objectiveTerritories(mission: Mission | null): Map<string, boolean> {
    const result = new Map<string, boolean>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind !== 'bomb' && o.kind !== 'recon' && o.kind !== 'reach' && o.kind !== 'destroy') return;
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
      case 'destroy': return `Shoot down practice planes on ${o.territoryId} (${mission.destroyedTargets(index).size}/${o.count})`;
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
          progress: o.kind === 'recon' || o.kind === 'destroy' ? mission.progress[i] : null,
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
    if (phase === 'debrief' || phase === 'crashed') return '';
    const spec = this.state.plane;
    if (mission.status === 'succeeded') {
      return phase === 'landed'
        ? 'Rearm (R) and take off (Space) to keep practising, or end the sortie (Enter).'
        : `Now land on T1 to recover your plane: a refit costs ${spec?.refitCost ?? 0} instead of ${spec?.cost ?? 0}.`;
    }
    if (mission.status === 'failed') {
      const why = mission.failure === 'out-of-time' ? 'The clock ran out.' : 'Every bomb is gone.';
      return `${why} Land on T1 to recover the plane anyway.`;
    }
    if (phase === 'landed') return 'R rearms ink and range for free. Space takes off again.';
    const next = mission.objectives[mission.openObjectives()[0]];
    switch (next?.kind) {
      case 'bomb': return 'Line up on the target and right-click to drop. The ball keeps your speed, so release before you are over it.';
      case 'recon': return `Stay low over ${next.territoryId}: time only counts inside the blue zone, below ${next.airspace.ceiling} m. Mind the pencil stands.`;
      case 'reach': return `Get into ${next.territoryId}'s airspace before the clock runs out. Shift boosts.`;
      case 'ring': return 'Fly through the orange ring. The next one lights up when you pass.';
      case 'land': return 'Slow down (S), line up with T1 and descend gently.';
      case 'destroy': return 'Hold left-click to fire ink along your nose. Slow down, line up and lead the target a little.';
      default: return '';
    }
  }

  private result(): ResultView | null {
    const { state } = this;
    const mission = state.mission;
    const sortie = state.sortie;
    if (!mission || !sortie || !state.plane) return null;
    const recovered = state.phase === 'debrief';
    if (!recovered && !(state.phase === 'crashed' && this.crashTime >= CRASH_REPORT_DELAY)) return null;
    const failure: Record<string, string> = {
      missed: 'Failed: out of bombs',
      'out-of-time': 'Failed: out of time',
      'aircraft-lost': 'Failed: plane lost',
      abandoned: 'Failed: landed before finishing',
    };
    const succeeded = mission.status === 'succeeded';
    const spec = state.plane;
    return {
      recovered,
      headline: recovered ? 'Plane recovered' : this.crashCause === 'hard-landing' ? 'Hard landing' : this.crashCause === 'void' ? 'Lost in the void' : 'Plane destroyed',
      aircraftName: spec.name,
      missionTitle: mission.title,
      missionLine: succeeded ? `Complete · +${mission.reward}` : failure[mission.failure ?? 'abandoned'],
      missionTone: succeeded ? 'good' : 'bad',
      planeLine: recovered ? `in the hangar, refit ${spec.refitCost}` : `destroyed, next costs ${spec.cost}`,
      time: mission.elapsed,
      damageDealt: sortie.damageDealt,
      damageTaken: sortie.damageTaken,
      targetsDestroyed: sortie.targetsDestroyed,
      bombsDropped: sortie.bombsDropped,
      bombHits: sortie.bombHits,
      shotsFired: sortie.shotsFired,
      shotsHit: sortie.shotsHit,
      paperSpent: sortie.paperSpent,
      paperEarned: sortie.paperEarned,
    };
  }

  private minimapView(mission: Mission | null, objective: pc.Vec3 | null): MiniMapView {
    const { world, plane, state } = this;
    const roles = this.objectiveTerritories(mission);
    const zones: MiniMapView['zones'] = [];
    const rings: MiniMapView['rings'] = [];
    const targets: MiniMapView['targets'] = [];
    mission?.objectives.forEach((o, i) => {
      if (mission.isDone(i)) return;
      if (o.kind === 'bomb') zones.push({ x: o.zone.x, z: o.zone.z, precision: o.precision });
      if (o.kind === 'ring') rings.push({ x: o.gate.x, z: o.gate.z, yaw: o.gate.yaw, state: mission.isOpen(i) ? 'open' : 'waiting' });
      if (o.kind === 'destroy') {
        const done = mission.destroyedTargets(i);
        for (const id of o.targets) {
          const t = this.range.get(id);
          if (t && !done.has(id)) targets.push({ x: t.spec.x, z: t.spec.z });
        }
      }
    });
    const showPlane = state.phase === 'flying' || state.phase === 'landed';
    return {
      territories: world.territories.map((t) => {
        const done = roles.get(t.id);
        return { id: t.id, x: t.x, z: t.z, half: t.half, role: t.isHome ? 'home' : done === undefined ? 'neutral' : done ? 'done' : 'objective' };
      }),
      zones,
      rings,
      targets,
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

/**
 * What the target marker points at. `solid` goals (rings, practice planes) are measured in 3D;
 * the rest by ground distance. `targetId` names the practice plane, if it is one.
 */
interface Goal {
  point: pc.Vec3;
  label: string;
  tone: TargetIndicator['tone'];
  solid: boolean;
  territoryId: string | null;
  targetId?: string;
}

/** Where an objective is, for markers and distances. */
function objectivePoint(o: Objective, world: World, out: pc.Vec3): pc.Vec3 {
  switch (o.kind) {
    case 'bomb': return out.set(o.zone.x, o.zone.top + 0.5, o.zone.z);
    case 'recon':
    case 'reach': return out.set(o.airspace.x, 0.5, o.airspace.z);
    case 'ring': return out.set(o.gate.x, o.gate.y, o.gate.z);
    case 'land': return out.set(world.home.x, 0.5, world.home.z);
    case 'destroy': {
      const t = world.territories.find((x) => x.id === o.territoryId)!;
      return out.set(t.x, 0.5, t.z);
    }
  }
}

/**
 * The fold pose while building. A new plane goes from a flat sheet to finished; a refit re-creases
 * a recovered plane: wings up, then back down. A stowed plane just rolls out finished.
 */
function foldPose(progress: number, kind: BuildKind): number {
  if (kind === 'fold') return progress;
  if (kind === 'rollout') return 1;
  return progress < 0.35 ? 1 - (progress / 0.35) * 0.5 : 0.5 + ((progress - 0.35) / 0.65) * 0.5;
}

function css(color: readonly [number, number, number]): string {
  return `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;
}

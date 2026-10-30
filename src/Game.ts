import * as pc from 'playcanvas';
import { AIRCRAFT, AIRCRAFT_ORDER, BOMB, CAMERA, DAMAGE, DEFENSES, LANDING, MISSIONS, PALETTE, PLANE, TARGETS, THREAT, WEAPONS, WORLD, type AircraftId } from './config';
import { aircraftRatings, RATING_KEYS, RATING_LABELS } from './aircraft/Aircraft';
import { Bombs, type BombImpact, type ZoneRef } from './aircraft/Bomb';
import { ChaseCamera } from './aircraft/ChaseCamera';
import { FlightTrails } from './aircraft/FlightTrails';
import { HangarPreview } from './aircraft/HangarPreview';
import { assessTouchdown, hardLandingReason } from './aircraft/Landing';
import { clamp, PlaneController, yawFromDirection, type Collision } from './aircraft/PlaneController';
import { distanceToShape, footprint, type Collider } from './combat/Collision';
import { blastDamage, impactDamage, roughLandingDamage } from './combat/Damage';
import type { Destructible } from './combat/Destructibles';
import { layoutTargetRange } from './combat/Destructibles';
import { Projectiles, type ShotImpact } from './combat/Projectiles';
import { EnemyFire, isRocket, type FireEvent } from './defenses/EnemyFire';
import { DefenseNetwork, type DefenseEvent, type Installation, type Target } from './defenses/Installation';
import { layoutDefenses, overHome, type DefenseLayout } from './defenses/Layout';
import type { Mission, Objective } from './missions/Mission';
import { defenseList, generateOffers } from './missions/MissionGenerator';
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
  type ThreatSummary,
  type TrackerView,
} from './ui/HUD';
import type { IconName } from './ui/icons';
import type { MiniMapView } from './ui/MiniMap';
import { Sounds } from './ui/Sounds';
import type { ThreatRingItem, ThreatView } from './ui/ThreatHud';
import { DefenseModels } from './world/DefenseModels';
import { Effects } from './world/Effects';
import { EnemyFireView } from './world/EnemyFireView';
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
/** At most this many target labels at once, mission targets and nearest first. */
const MAX_TARGET_LABELS = 8;
/** Incoming rockets show on the threat ring within this distance. */
const ROCKET_WARNING_RANGE = 160;
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
  /** The territory whose spotting was last announced with a sound. */
  private warned: string | null = null;
  /** Health of the plane being refitted when the refit began, to animate the repair. */
  private refitFrom = 1;
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private readonly v3 = new pc.Vec3();
  private readonly rel = new pc.Vec3();
  private readonly screen = new pc.Vec3();
  /** Everything the plane can fly into on the defended territories, besides the installations themselves. */
  private readonly barriers: Collider[];

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
    readonly defenses: DefenseNetwork,
    readonly defenseModels: DefenseModels,
    readonly enemyFire: EnemyFire,
    readonly enemyFireView: EnemyFireView,
    readonly sounds: Sounds,
    layout: DefenseLayout,
  ) {
    this.barriers = layout.barriers.map((b) => ({ id: b.id, shapes: b.solids }));
  }

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
    const rangeFootprints = targetSpecs.flatMap((s) => s.shapes.map(footprint));
    const layout = layoutDefenses(world.territories, rangeFootprints);
    const defenses = new DefenseNetwork(layout.installations);
    const resources = new ResourceManager();
    const missionContext = {
      territories: world.territories,
      homeId: world.home.id,
      launch: world.launchPosition,
      dummies: targetSpecs.filter((s) => s.kind === 'dummy'),
      obstacles: [
        ...rangeFootprints,
        ...layout.installations.map((i) => ({ x: i.x, z: i.z, r: i.footprint })),
        ...layout.barriers.flatMap((b) => b.solids.map(footprint)),
      ],
      installations: layout.installations,
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
      new MissionMarkers(app, world, (id) => {
        const target = range.get(id)?.spec;
        if (target) return target;
        const i = defenses.get(id)?.spec;
        return i ? { x: i.x, z: i.z, r: i.footprint + 0.6 } : null;
      }),
      new FlightTrails(app),
      new HangarPreview(app),
      new Input(canvas),
      hud,
      defenses,
      new DefenseModels(app, layout, defenses, world),
      new EnemyFire(),
      new EnemyFireView(app),
      new Sounds(),
      layout,
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
    this.bombs.release(this.plane.getBombPosition(this.v1, this.state.bombsLoaded), this.plane.getVelocity(this.v2), kind, this.state.releaseClean);
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
    // Defenses come back when the scenario resets: a new sortie, a fresh set of targets.
    this.defenses.restoreAll();
    this.defenseModels.restoreAll();
    this.enemyFire.clear();
    this.enemyFireView.clear();
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

    this.updateDefenses(dt);
    const standing = [...this.range.colliders, ...this.installationColliders()];
    for (const impact of this.bombs.update(dt, this.openZones(), world.territories, standing)) this.onBombImpact(impact);
    const shootable = [...standing, ...this.enemyFire.rocketColliders()];
    for (const impact of this.projectiles.update(dt, shootable, world.territories)) this.onShotImpact(impact);
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
      [...this.range.solids, ...this.installationSolids(), ...this.barriers],
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

  /** Flew into something: what it costs depends on how hard. Props and defenses take a beating too. */
  private onCollision(c: Collision): void {
    const { state, plane } = this;
    let damage = c.kind === 'rough-landing' ? roughLandingDamage(c.state) : impactDamage(c.closing);
    if (c.kind === 'object') {
      const target = this.range.get(c.id);
      const installation = this.defenses.get(c.id);
      const ram = Math.round(impactDamage(c.closing) * DAMAGE.ramMultiplier);
      // Paper and cardboard give way: they hurt less than a platform does.
      if (target) damage = Math.round(damage * TARGETS.hardness[target.spec.kind]);
      else if (installation) damage = Math.round(damage * DEFENSES.hardness[installation.spec.kind]);
      else damage = Math.round(damage * DEFENSES.hardness.barrier);
      if (target && ram > 0) this.damageTarget(target, ram, this.range.centre(target, this.v3));
      if (installation && ram > 0) this.damageInstallation(installation, ram, this.defenseModels.centre(installation.id, this.v3));
    }
    if (damage <= 0) return;
    this.effects.burst(plane.position, 'thud');
    const { dealt, destroyed } = state.damageAircraft(damage, c.kind === 'rough-landing' ? 'landing' : 'impact');
    if (destroyed || dealt <= 0) return;
    if (c.kind === 'rough-landing') {
      this.hud.banner(`Rough landing! −${dealt}`, `${hardLandingReason(c.check)} Go around and try again.`, 'bad', 3);
    } else {
      const what =
        c.kind === 'object'
          ? (this.range.get(c.id)?.spec.name.toLowerCase() ?? this.defenses.get(c.id)?.spec.name.toLowerCase() ?? 'a barrier wall')
          : c.id;
      this.hud.banner(`Ouch! −${dealt}`, `You hit ${what}. Keep clear of platforms and props.`, 'bad', 2.2);
    }
  }

  // ---- Defenses -------------------------------------------------------------------------------

  /**
   * The defenses look for the plane and shoot; their rounds and rockets fly; the models follow.
   * Nothing shoots over home, and rockets lose track of a plane that gets there.
   */
  private updateDefenses(dt: number): void {
    const { plane, state, world } = this;
    const flying = state.phase === 'flying';
    const p = plane.position;
    const safe = overHome(world.home, p.x, p.z);
    let target: Target | null = null;
    if (flying && !safe) {
      const v = plane.getVelocity(this.v2);
      target = { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, signature: plane.spec.signature };
    }
    const { orders, events } = this.defenses.update(dt, target);
    for (const order of orders) {
      this.enemyFire.spawn(order);
      if (target) state.recordIncoming();
      if (order.kind === 'rocket') this.effects.burst(this.v1.set(order.x, order.y, order.z), 'dust');
    }
    for (const event of events) this.onDefenseEvent(event);
    const planeTarget = flying
      ? { x: p.x, y: p.y, z: p.z, px: plane.prevPosition.x, py: plane.prevPosition.y, pz: plane.prevPosition.z, radius: plane.spec.hitRadius }
      : null;
    for (const event of this.enemyFire.update(dt, planeTarget, !safe, world.territories)) this.onEnemyFire(event);
    // A blip when the territory being approached notices the plane (not every radar on the map).
    const approached = flying ? this.approachedTerritory() : null;
    const spotted = approached !== null && this.defenses.isAware(approached);
    if (spotted && this.warned !== approached) this.sounds.play('spotted');
    this.warned = spotted ? approached : null;
    this.defenseModels.update(dt, flying ? p : null, approached);
    this.enemyFireView.update(dt, this.enemyFire, this.camera.entity.getPosition());
    const locking = flying ? this.defenses.installations.filter((i) => i.state === 'locking') : [];
    this.sounds.lockTone(dt, locking.length > 0 ? Math.max(...locking.map((i) => i.lock)) : null);
  }

  private onDefenseEvent(event: DefenseEvent): void {
    if (this.state.phase !== 'flying') return;
    switch (event.type) {
      case 'launch':
        this.sounds.play('launch');
        break;
      case 'lock-broken':
        this.hud.threatNote('Lock broken', 'good');
        break;
    }
  }

  /** Enemy fire landed: on the plane (damage, from which way), on a platform, or nowhere. */
  private onEnemyFire(event: FireEvent): void {
    const point = this.v1.set(event.x, event.y, event.z);
    const rocket = event.shot.kind === 'rocket';
    if (event.type === 'hit') {
      if (rocket) this.effects.explosion(point, 0.7);
      else this.effects.enemyInkHit(point, false);
      const source = this.defenses.get(event.shot.source);
      const by = source ? `${source.spec.name} on ${source.spec.territoryId}` : null;
      const { dealt } = this.state.damageAircraft(event.shot.damage, rocket ? 'blast' : 'projectile', by);
      if (dealt > 0) {
        this.sounds.play('hit');
        if (source) this.hud.damageDirection(this.bearing(source.spec.x, source.spec.z), dealt);
        if (rocket) {
          const at = this.projectOnScreen(point);
          if (at) this.hud.pop('BANG!', 'bad', at);
        }
      }
      return;
    }
    if (event.type === 'ground') {
      if (rocket) this.effects.explosion(point, 0.5);
      else this.effects.enemyInkHit(point, true);
    } else if (rocket) {
      this.effects.burst(point, 'dust');
    }
  }

  /** Damages a defense, with numbers, effects, the collapse and the bookkeeping. Returns the damage dealt. */
  private damageInstallation(i: Installation, amount: number, at: pc.Vec3): number {
    const { dealt, destroyed } = i.damage(Math.round(amount));
    if (dealt <= 0) return 0;
    const screen = this.projectOnScreen(this.v3.copy(at));
    if (screen) this.hud.damageNumber(dealt, screen, destroyed);
    if (destroyed) {
      const centre = this.defenseModels.centre(i.id, this.v3);
      this.effects.explosion(centre, 1.1, 'wreck');
      this.sounds.play('collapse');
      const p = this.projectOnScreen(centre);
      const word = { turret: 'TURRET DOWN!', launcher: 'LAUNCHER DOWN!', radar: 'RADAR DOWN!', supply: 'DEPOT BURNS!' }[i.spec.kind];
      if (p) this.hud.pop(word, 'good', p);
      const t = i.spec.territoryId;
      const left = this.defenses.on(t).filter((x) => x.isWeapon && x.alive).length;
      const detail = {
        turret: left > 0 ? `${left} weapon${left === 1 ? '' : 's'} left on ${t}.` : `${t} has no weapons left.`,
        launcher: `No more rockets from ${t}.`,
        radar: `${t}'s guns now see less far.`,
        supply: `${t}'s supplies are burning.`,
      }[i.spec.kind];
      this.hud.banner(`${i.spec.name} destroyed`, detail, 'good', 2.4);
    }
    this.state.recordDamage(dealt, destroyed ? i.id : null, true);
    return dealt;
  }

  /** Standing installations, for ink rounds and bombs. */
  private installationColliders(): Collider[] {
    return this.defenses.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.shapes }));
  }

  /** Standing installations, for the plane to fly into. Wrecks are flattened and don't count. */
  private installationSolids(): Collider[] {
    return this.defenses.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.solids }));
  }

  /**
   * The defended territory the plane is over, or else the one whose weapons' reach it is closest
   * to entering (within DEFENSES.approachMargin), or null.
   */
  private approachedTerritory(): string | null {
    const p = this.plane.position;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const t of this.world.territories) {
      if (t.threat === 0) continue;
      // How far outside the nearest weapon's reach the plane is (negative: inside it).
      let outside = Infinity;
      for (const w of this.defenses.on(t.id)) {
        if (w.isWeapon) outside = Math.min(outside, Math.hypot(w.spec.x - p.x, w.spec.z - p.z) - w.spec.range);
      }
      const score = t.containsXZ(p.x, p.z) ? -Infinity : outside;
      if (score > DEFENSES.approachMargin || score >= bestScore) continue;
      bestScore = score;
      best = t.id;
    }
    return best;
  }

  /** Bearing of (x, z) from the plane, relative to the view: 0 straight ahead, positive to the right. */
  private bearing(x: number, z: number): number {
    const cam = this.camera.entity;
    const f = cam.forward;
    const r = cam.right;
    const dx = x - this.plane.position.x;
    const dz = z - this.plane.position.z;
    return Math.atan2(dx * r.x + dz * r.z, dx * f.x + dz * f.z);
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

  private onBombImpact(impact: BombImpact & { bomb: keyof typeof BOMB.kinds; clean: boolean }): void {
    const point = this.impactPoint.set(impact.x, impact.y, impact.z);
    let struck = false;
    if (impact.kind !== 'void') {
      const hit = impact.kind === 'target';
      this.effects.bombImpact(point, hit || impact.kind === 'object');
      const at = this.projectOnScreen(this.v3.copy(point));
      if (at) this.hud.pop(hit ? 'BOOM!' : impact.kind === 'object' ? 'WHAM!' : 'SPLAT!', hit || impact.kind === 'object' ? 'good' : 'bad', at);
      // The blast damages every prop, practice plane and installation around the impact.
      const kind = BOMB.kinds[impact.bomb];
      for (const target of this.range.targets) {
        if (!target.alive) continue;
        const distance = Math.min(...target.spec.shapes.map((s) => distanceToShape(point, s)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0 && this.damageTarget(target, damage, this.range.labelPoint(target, this.v2)) > 0) struck = true;
      }
      for (const installation of this.defenses.installations) {
        if (!installation.alive) continue;
        const distance = Math.min(...installation.spec.shapes.map((s) => distanceToShape(point, s)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0 && this.damageInstallation(installation, damage, this.defenseModels.labelPoint(installation.id, this.v2)) > 0) struck = true;
      }
    }
    this.impactCamTime = impact.kind === 'void' ? 0 : CAMERA.bombCamLinger;
    this.state.resolveBomb(impact.kind === 'target' ? impact.objective : null, struck, impact.clean);
  }

  private onShotImpact(impact: ShotImpact & { damage: number }): void {
    const point = this.v1.set(impact.x, impact.y, impact.z);
    if (impact.kind === 'platform') {
      this.effects.inkHit(point, true);
      return;
    }
    this.effects.inkHit(point, false);
    if (isRocket(impact.id)) {
      if (!this.enemyFire.shootDown(impact.id)) return;
      this.state.recordShotHit();
      this.effects.explosion(point, 0.45);
      this.sounds.play('pop');
      this.hud.hitMarker(true);
      const at = this.projectOnScreen(point);
      if (at) this.hud.pop('POP!', 'good', at);
      return;
    }
    const installation = this.defenses.get(impact.id);
    if (installation) {
      this.state.recordShotHit();
      // Cardboard depots shrug off most of the ink.
      const factor = installation.spec.kind === 'supply' ? DEFENSES.supply.inkFactor : 1;
      const dealt = this.damageInstallation(installation, impact.damage * factor, point);
      if (dealt > 0) this.hud.hitMarker(!installation.alive);
      return;
    }
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
      // Browsers only allow sound after a key press or click.
      this.sounds.unlock();
      if (code === 'KeyM') {
        this.sounds.muted = !this.sounds.muted;
        hud.banner(this.sounds.muted ? 'Sound off' : 'Sound on', 'M toggles warning sounds.', 'info', 1.4);
        return;
      }
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
      this.sounds.unlock();
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
          this.career.recordTargetDestroyed(event.defense);
          break;
        case 'bomb-missed':
          if (event.tooHigh) {
            hud.banner("Too high: it doesn't count", 'The run was blown. Leave the zone and come in again lower.', 'bad', 3);
          } else if (event.remaining > 0 || state.bombsFalling > 0) {
            hud.banner('Missed!', `${event.remaining} bomb${event.remaining === 1 ? '' : 's'} left. Line up and try again.`, 'bad', 2);
          }
          break;
        case 'approach-blown': {
          // Pulling up after a clean release is fine: that bomb still counts.
          if (state.bombsFalling > 0) break;
          const o = state.mission?.objectives[event.index];
          const ceiling = o?.kind === 'bomb' && o.approach ? o.approach.ceiling : 0;
          hud.banner('Too high! Run blown', `Leave the zone and come back in below ${ceiling} m.`, 'bad', 2.6);
          break;
        }
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
    } else if (cause === 'shot-down') {
      const by = this.state.sortie?.killedBy;
      hud.banner('Shot down!', by ? `Brought down by the ${by.charAt(0).toLowerCase()}${by.slice(1)}.` : 'Enemy fire tore it apart.', 'bad', 4);
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
      const next = mission.objectives[mission.openObjectives()[0]];
      this.hud.banner('Reconnaissance complete', next?.kind === 'escape' ? `Now get clear: more than ${next.distance} m from ${next.territoryId}.` : '', 'good', 2.4);
    } else if (objective.kind === 'reach') {
      this.hud.banner('Delivered!', '', 'good', 2);
    } else if (objective.kind === 'destroy' && objective.what !== 'practice') {
      this.hud.banner('Objective complete', this.objectiveLabel(mission, mission.openObjectives()[0] ?? index), 'good', 2.4);
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
      target = {
        ...this.indicator(goal.point),
        label: `${goal.label} · ${Math.round(distance)} m`,
        tone: goal.tone,
        icon: goal.icon,
        near: !goal.solid && distance < 15,
      };
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
        defensesDestroyed: this.career.data.defensesDestroyed,
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
              codename: m.spec.codename ?? '',
              title: m.title,
              description: m.spec.description,
              difficulty: m.spec.difficulty,
              difficultyLabel: d.label,
              stars: d.stars,
              multiplier: d.multiplier,
              reward: m.reward,
              bombs: m.spec.bombs,
              timeLimit: m.spec.timeLimit,
              threat: this.threatSummary(m),
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
      threat: flying ? this.threatView() : null,
    };
  }

  /** The danger on a mission card or in the tracker. */
  private threatSummary(m: Mission): ThreatSummary {
    const t = m.spec.threat;
    if (!t || t.level === 0) {
      return { level: 0, label: THREAT.levels[0].label, detail: m.spec.type === 'rings' ? 'Course clear of defenses' : 'No known defenses' };
    }
    const parts: string[] = [];
    if (t.turrets || t.launchers) parts.push(defenseList(t.turrets, t.launchers));
    if (t.radars) parts.push(t.radars === 1 ? 'radar' : `${t.radars} radars`);
    const where = m.spec.type === 'rings' ? `Course passes ${t.territories.join(', ')}` : t.territories.join(' + ');
    return { level: t.level, label: THREAT.levels[t.level].label, detail: `${where}: ${parts.join(' · ')}` };
  }

  /**
   * The warnings in flight: the defended territory being approached (or flown over) and how it
   * regards the plane; a marker for each defense following it and each rocket coming; the lock.
   */
  private threatView(): ThreatView {
    const { plane, world, defenses } = this;
    const p = plane.position;
    let panel: ThreatView['panel'] = null;
    const t = world.territories.find((x) => x.id === this.approachedTerritory());
    if (t) {
      const all = defenses.on(t.id);
      const weapons = all.filter((i) => i.isWeapon);
      const engaged = weapons.some((w) => w.alive && (w.state === 'firing' || w.state === 'locking'));
      panel = {
        territoryId: t.id,
        level: t.threat,
        label: THREAT.levels[t.threat].label,
        status: weapons.every((w) => !w.alive) ? 'neutralised' : engaged ? 'engaged' : defenses.isAware(t.id) ? 'spotted' : 'clear',
        installations: all.map((i) => ({ id: i.id, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.engaged })),
      };
    }

    // On the ring: weapons shooting or locking on, and those following the plane that it is about to fly into.
    const ring: ThreatRingItem[] = [];
    for (const i of defenses.engaged()) {
      const reach = Math.hypot(i.spec.x - p.x, i.spec.z - p.z) - i.spec.range;
      if (i.state === 'tracking' && reach > 10) continue;
      ring.push({
        id: i.id,
        angle: this.bearing(i.spec.x, i.spec.z),
        icon: i.spec.kind,
        state: i.state === 'idle' || i.state === 'destroyed' ? 'tracking' : i.state,
        distance: Math.hypot(i.spec.x - p.x, i.spec.ground + i.spec.pivot - p.y, i.spec.z - p.z),
      });
    }
    let nearest = Infinity;
    let rockets = 0;
    for (const shot of this.enemyFire.shots) {
      if (shot.kind !== 'rocket') continue;
      const d = Math.hypot(shot.x - p.x, shot.y - p.y, shot.z - p.z);
      if (d > ROCKET_WARNING_RANGE) continue;
      rockets++;
      nearest = Math.min(nearest, d);
      ring.push({ id: `rocket-${shot.id}`, angle: this.bearing(shot.x, shot.z), icon: 'rocket', state: 'incoming', distance: d });
    }
    const locking = defenses.installations.filter((i) => i.state === 'locking');
    const lock: ThreatView['lock'] =
      rockets > 0
        ? { state: 'incoming', progress: 1, distance: nearest, count: rockets }
        : locking.length > 0
          ? { state: 'locking', progress: Math.max(...locking.map((i) => i.lock)), distance: 0, count: locking.length }
          : null;
    return { panel, ring, lock };
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

  /**
   * Names, roles and health over nearby practice planes, props once they are damaged, and every
   * standing defense (with what it is doing to the plane). Mission targets first, then the nearest.
   */
  private targetLabels(mission: Mission | null, skip: string | null): TargetLabelView[] {
    const eye = this.camera.entity.getPosition();
    const wanted = new Set<string>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind !== 'destroy' || !mission.isOpen(i) || !mission.isActive) return;
      const done = mission.destroyedTargets(i);
      for (const id of o.targets) if (!done.has(id)) wanted.add(id);
    });
    type Near = Omit<TargetLabelView, 'x' | 'y' | 'far' | 'mission'> & { point: pc.Vec3; distance: number };
    const near: Near[] = [];
    for (const target of this.range.targets) {
      if (!target.alive || target.id === skip) continue;
      if (target.spec.kind !== 'dummy' && target.health >= target.spec.maxHealth) continue;
      const point = this.range.labelPoint(target, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > TARGETS.labelRange) continue;
      const s = target.spec;
      near.push({ id: s.id, name: s.name, role: s.role, health: target.durability.fraction, icon: s.kind === 'dummy' ? 'practice' : null, state: null, point, distance });
    }
    for (const i of this.defenses.installations) {
      if (!i.alive || i.id === skip) continue;
      const point = this.defenseModels.labelPoint(i.id, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > DEFENSES.labelRange) continue;
      const state = i.isWeapon ? (i.state === 'destroyed' ? 'idle' : i.state) : null;
      near.push({ id: i.id, name: i.spec.name, role: i.spec.role, health: i.durability.fraction, icon: i.spec.kind, state, point, distance });
    }
    near.sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || a.distance - b.distance);
    const views: TargetLabelView[] = [];
    for (const n of near) {
      if (views.length >= MAX_TARGET_LABELS) break;
      const p = this.projectOnScreen(n.point);
      if (!p) continue;
      const range = n.icon && n.icon !== 'practice' ? DEFENSES.labelRange : TARGETS.labelRange;
      views.push({
        id: n.id, x: p.x, y: p.y, name: n.name, role: n.role, health: n.health, icon: n.icon, state: n.state,
        mission: wanted.has(n.id),
        far: clamp((n.distance - 30) / (range - 30), 0, 1),
      });
    }
    return views;
  }

  /** What the target marker points at: the nearest open objective, or home once the mission is over. */
  private currentGoal(mission: Mission | null, from: pc.Vec3): Goal | null {
    const { state, world } = this;
    if (state.phase === 'debrief' || state.phase === 'crashed' || !mission) return null;
    const point = new pc.Vec3();
    if ((state.phase === 'flying' || state.phase === 'landed') && !mission.isActive) {
      if (state.phase === 'landed') return null;
      point.set(world.home.x, 0.5, world.home.z);
      return { point, label: `${world.home.id} · Land`, tone: 'home', icon: 'land', solid: false, territoryId: world.home.id };
    }
    let best: Goal | null = null;
    let bestDistance = Infinity;
    for (const i of mission.openObjectives()) {
      const o = mission.objectives[i];
      if (o.kind === 'destroy') {
        // Point at the nearest target still standing: a practice plane or an installation.
        const done = mission.destroyedTargets(i);
        for (const id of o.targets) {
          if (done.has(id)) continue;
          const t = this.range.get(id);
          const inst = this.defenses.get(id);
          if (!t && !inst) continue;
          const at = t ? new pc.Vec3(t.spec.x, t.spec.y, t.spec.z) : this.defenseModels.centre(id, new pc.Vec3());
          const d = Math.hypot(at.x - from.x, at.z - from.z);
          if (d >= bestDistance) continue;
          bestDistance = d;
          best = {
            point: at,
            label: t ? t.spec.name : inst!.spec.name,
            tone: 'target',
            icon: t ? 'practice' : inst!.spec.kind,
            solid: true,
            territoryId: o.territoryId,
            targetId: id,
          };
        }
        continue;
      }
      const p = objectivePoint(o, world, new pc.Vec3());
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= bestDistance) continue;
      bestDistance = d;
      switch (o.kind) {
        case 'bomb':
          best = { point: p, label: o.precision ? `${o.territoryId} spot` : o.territoryId, tone: 'target', icon: 'bomb', solid: false, territoryId: o.territoryId };
          break;
        case 'recon':
          best = { point: p, label: o.territoryId, tone: 'target', icon: 'recon', solid: false, territoryId: o.territoryId };
          break;
        case 'reach':
          best = { point: p, label: o.territoryId, tone: 'target', icon: 'reach', solid: false, territoryId: o.territoryId };
          break;
        case 'survive':
          best = { point: p, label: `Hold out over ${o.territoryId}`, tone: 'target', icon: 'survive', solid: false, territoryId: o.territoryId };
          break;
        case 'escape':
          best = { point: p, label: 'Escape', tone: 'home', icon: 'escape', solid: false, territoryId: null };
          break;
        case 'ring':
          best = { point: p, label: `Ring ${o.number}/${mission.objectives.length}`, tone: 'ring', icon: 'ring', solid: true, territoryId: null };
          break;
        case 'land':
          best = { point: p, label: `${world.home.id} · Land`, tone: 'home', icon: 'land', solid: false, territoryId: world.home.id };
          break;
      }
    }
    return best;
  }

  /** Territories with objectives on them → whether they are all done. */
  private objectiveTerritories(mission: Mission | null): Map<string, boolean> {
    const result = new Map<string, boolean>();
    mission?.objectives.forEach((o, i) => {
      if (o.kind === 'ring' || o.kind === 'land' || o.kind === 'escape') return;
      result.set(o.territoryId, (result.get(o.territoryId) ?? true) && mission.isDone(i));
    });
    return result;
  }

  private objectiveLabel(mission: Mission, index: number): string {
    const o = mission.objectives[index];
    if (!o) return '';
    switch (o.kind) {
      case 'bomb':
        if (o.approach) return `Bomb ${o.territoryId} from below ${o.approach.ceiling} m`;
        return o.precision ? `Hit the ink spot on ${o.territoryId}` : `Hit the bullseye on ${o.territoryId}`;
      case 'recon': return `Scout ${o.territoryId} below ${o.airspace.ceiling} m`;
      case 'reach': return `Reach ${o.territoryId}'s airspace`;
      case 'ring': return `Ring ${o.number} of ${mission.objectives.length}`;
      case 'land': return `Land on ${o.territoryId}`;
      case 'survive': return `Hold out ${o.duration} s over ${o.territoryId} (${Math.floor(mission.progress[index] * o.duration)}/${o.duration})`;
      case 'escape': return `Escape: ${o.distance} m clear of ${o.territoryId}`;
      case 'destroy': {
        const n = mission.destroyedTargets(index).size;
        switch (o.what) {
          case 'radar': return `Destroy the radar on ${o.territoryId}`;
          case 'supply': return `Destroy the supply depot on ${o.territoryId}`;
          case 'defense': return `Destroy defenses on ${o.territoryId} (${n}/${o.count})`;
          default: return `Shoot down practice planes on ${o.territoryId} (${n}/${o.count})`;
        }
      }
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
          progress: o.kind === 'recon' || o.kind === 'destroy' || o.kind === 'survive' ? mission.progress[i] : null,
          distance: Math.hypot(p.x - from.x, p.z - from.z),
        });
      });
    }
    const d = MISSIONS.difficulty[mission.spec.difficulty];
    return {
      title: mission.title,
      codename: mission.spec.codename ?? '',
      threat: this.threatSummary(mission),
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
    if (phase === 'landed') return 'R rearms ink and range for free. Space takes off again. Destroyed defenses stay down until the sortie ends.';
    const index = mission.openObjectives()[0];
    const next = mission.objectives[index];
    switch (next?.kind) {
      case 'bomb':
        if (next.approach) {
          return mission.approachState(index) === 'blown'
            ? `Run blown! Fly out beyond ${next.approach.radius} m and come back in below ${next.approach.ceiling} m.`
            : `Stay below ${next.approach.ceiling} m (under the blue sheet) within ${next.approach.radius} m of the target. Low flying hides you from rockets but not from props.`;
        }
        return 'Line up on the target and right-click to drop. The ball keeps your speed, so release before you are over it.';
      case 'recon': return `Stay low over ${next.territoryId}: time only counts inside the blue zone, below ${next.airspace.ceiling} m. Mind the pencil stands.`;
      case 'reach': return `Get into ${next.territoryId}'s airspace before the clock runs out. Shift boosts.`;
      case 'ring': return 'Fly through the orange ring. The next one lights up when you pass.';
      case 'land': return 'Slow down (S), line up with T1 and descend gently.';
      case 'survive': return `Stay inside the red zone over ${next.territoryId}, below ${next.airspace.ceiling} m. Keep turning: steady flight is easy to hit.`;
      case 'escape': return `Get out past the blue line, more than ${next.distance} m from ${next.territoryId}. Fly fast and keep turning.`;
      case 'destroy':
        switch (next.what) {
          case 'radar': return `The radar is the tall dish. Without it, ${next.territoryId}'s guns notice you later.`;
          case 'supply': return 'Bomb the supply depot: the roof with the target painted on. Ink barely dents it.';
          case 'defense': return 'Shoot or bomb the ringed defenses. Come in behind a turret: it can\'t turn to face you there.';
          default: return 'Hold left-click to fire ink along your nose. Slow down, line up and lead the target a little.';
        }
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
    const health = state.durability?.health ?? 0;
    const survival = recovered
      ? `Survived · ${Math.ceil(health)}/${spec.maxHealth} health`
      : this.crashCause === 'shot-down' && sortie.killedBy
        ? `Shot down by the ${sortie.killedBy.charAt(0).toLowerCase()}${sortie.killedBy.slice(1)}`
        : this.crashCause === 'hard-landing' ? 'Lost: hard landing' : this.crashCause === 'void' ? 'Lost in the void' : 'Lost: crashed';
    return {
      recovered,
      headline: recovered
        ? 'Plane recovered'
        : this.crashCause === 'hard-landing' ? 'Hard landing' : this.crashCause === 'void' ? 'Lost in the void' : this.crashCause === 'shot-down' ? 'Shot down' : 'Plane destroyed',
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
      defensesDestroyed: sortie.defensesDestroyed,
      enemyShots: sortie.enemyShots,
      enemyHits: sortie.enemyHits,
      survival,
      survived: recovered,
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
          if (done.has(id)) continue;
          const at = this.range.get(id)?.spec ?? this.defenses.get(id)?.spec;
          if (at) targets.push({ x: at.x, z: at.z });
        }
      }
    });
    const showPlane = state.phase === 'flying' || state.phase === 'landed';
    // Weapons show their reach near the plane in flight, and on the mission's territories.
    const reachFor = new Set(mission?.spec.threat?.territories ?? []);
    return {
      territories: world.territories.map((t) => {
        const done = roles.get(t.id);
        return { id: t.id, x: t.x, z: t.z, half: t.half, threat: t.threat, role: t.isHome ? 'home' : done === undefined ? 'neutral' : done ? 'done' : 'objective' };
      }),
      defenses: this.defenses.installations.map((i) => {
        const near = showPlane && Math.hypot(i.spec.x - plane.position.x, i.spec.z - plane.position.z) < i.spec.range + DEFENSES.approachMargin * 2;
        const reach = i.isWeapon && (near || reachFor.has(i.spec.territoryId)) ? { range: i.spec.range, facing: i.spec.facing, arc: i.spec.arc } : null;
        return { x: i.spec.x, z: i.spec.z, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.isWeapon && i.engaged, reach };
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
 * What the target marker points at. `solid` goals (rings, practice planes, installations) are
 * measured in 3D; the rest by ground distance. `targetId` names the target, if it is one.
 */
interface Goal {
  point: pc.Vec3;
  label: string;
  tone: TargetIndicator['tone'];
  icon: IconName;
  solid: boolean;
  territoryId: string | null;
  targetId?: string;
}

/**
 * Where an objective is, for markers and distances. An escape's point is where the escape line
 * crosses the way home, so the marker points out of danger.
 */
function objectivePoint(o: Objective, world: World, out: pc.Vec3): pc.Vec3 {
  switch (o.kind) {
    case 'bomb': return out.set(o.zone.x, o.zone.top + 0.5, o.zone.z);
    case 'recon':
    case 'reach':
    case 'survive': return out.set(o.airspace.x, 0.5, o.airspace.z);
    case 'ring': return out.set(o.gate.x, o.gate.y, o.gate.z);
    case 'land': return out.set(world.home.x, 0.5, world.home.z);
    case 'escape': {
      const dx = world.home.x - o.x;
      const dz = world.home.z - o.z;
      const len = Math.hypot(dx, dz) || 1;
      return out.set(o.x + (dx / len) * o.distance, 0.5, o.z + (dz / len) * o.distance);
    }
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

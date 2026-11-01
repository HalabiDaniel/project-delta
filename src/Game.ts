import * as pc from 'playcanvas';
import { AI, AIRCRAFT, AIRCRAFT_ORDER, BASE, BOMB, CAMERA, DAMAGE, DEFENSES, DIRECTOR, EVENTS, LANDING, PALETTE, PLANE, PLAYER_ID, RAIDS, TARGETS, THREAT, TIERS, WEAPONS, WORLD, type AircraftId, type Side } from './config';
import { Base, STORE, type BaseEvent } from './base/Base';
import { BaseMode } from './base/BaseMode';
import { chooseRaidTarget, raidLoss, raidPace, RaidTracker, raidTargetFor, type RaidReport } from './base/Raids';
import type { AiAircraft, BombOrder, Contact, Strike } from './ai/AiAircraft';
import { AirTraffic, type AirEvent, type Raid } from './ai/AirTraffic';
import { leadPoint } from './ai/Gunnery';
import { aircraftRatings, RATING_KEYS, RATING_LABELS } from './aircraft/Aircraft';
import { Bombs, type BombImpact, type TaggedImpact, type ZoneRef } from './aircraft/Bomb';
import { ChaseCamera } from './aircraft/ChaseCamera';
import { FlightTrails } from './aircraft/FlightTrails';
import { HangarPreview } from './aircraft/HangarPreview';
import { assessTouchdown, hardLandingReason } from './aircraft/Landing';
import { clamp, PlaneController, yawFromDirection, type Collision } from './aircraft/PlaneController';
import { distanceToShape, footprint, type Collider, type MovingSphere } from './combat/Collision';
import { blastDamage, impactDamage, roughLandingDamage } from './combat/Damage';
import type { Destructible } from './combat/Destructibles';
import { layoutTargetRange } from './combat/Destructibles';
import { Projectiles, type ShotImpact } from './combat/Projectiles';
import { isRocket, Ordnance, type AircraftTarget, type FireEvent } from './combat/Ordnance';
import { DefenseNetwork, type DefenseEvent, type Installation, type Target } from './defenses/Installation';
import { layoutDefenses, overHome, slotPoint, type DefenseLayout, type InstallationKind } from './defenses/Layout';
import { decorFootprints } from './world/territories/decor';
import { MissionDirector, SLOT_LABELS, type Situation } from './director/MissionDirector';
import { OPTIONAL_LABELS, remainingRewards, type Payout } from './director/Operations';
import { skillBand } from './director/Performance';
import { EVENT_LABELS, WorldEvents, type EventKind } from './director/WorldEvents';
import type { Mission, Objective } from './missions/Mission';
import { defenseList, type MissionContext } from './missions/MissionGenerator';
import { medalCriteria, Progress, type SortieProgress } from './progress/Progress';
import { Boundary } from './systems/Boundary';
import { foldPose, GameState, type BuildKind, type CrashCause } from './systems/GameState';
import { Input, MOUSE_LEFT } from './systems/Input';
import { Controls, type Action, type Device, type InputContext } from './input/Controls';
import { Ledger } from './systems/Ledger';
import { LocalStats } from './systems/LocalStats';
import { ResourceManager } from './systems/ResourceManager';
import { openStore, SaveManager, SAVE_VERSION, UI_SCALES, type SaveData } from './systems/SaveGame';
import { DevPanel } from './ui/DevPanel';
import { STEER_SECONDS, Tutorial, tutorialEventFor } from './progress/Tutorial';
import { dashboardView } from './ui/dashboardView';
import { failureText, nextStepText, paperBreakdown } from './ui/reportText';
import { PerfMonitor, type PerfSnapshot } from './ui/PerfOverlay';
import { Logbook, type LogbookView } from './ui/Logbook';
import type { GarageView } from './ui/Garage';
import {
  HUD,
  type AlertTone,
  type DashboardView,
  type MissionCardView,
  type SessionView,
  type AircraftStatusView,
  type GroundView,
  type HintMode,
  type HudView,
  type ObjectiveView,
  type RaidAlertView,
  type ResultView,
  type ScreenPoint,
  type TargetIndicator,
  type TargetLabelView,
  type TerritoryLabel,
  type ThreatSummary,
  type TrackerView,
} from './ui/HUD';
import { BUILDING_ICONS } from './ui/BaseHud';
import { compass } from './ui/format';
import { MISSION_ICONS, SAY } from './ui/strings';
import type { IconName } from './ui/icons';
import type { MiniMapView } from './ui/MiniMap';
import { Sounds } from './ui/Sounds';
import type { AircraftMarkerView, AirView } from './ui/AirHud';
import type { ThreatRingItem, ThreatView } from './ui/ThreatHud';
import { AircraftModels } from './world/AircraftModels';
import { DefenseModels } from './world/DefenseModels';
import { Effects } from './world/Effects';
import { OrdnanceView } from './world/OrdnanceView';
import { MissionMarkers } from './world/MissionMarkers';
import { TargetRange } from './world/TargetRange';
import { buildWorld, type World } from './world/WorldGenerator';
import { installOutlines, type OutlineRenderer } from './render/outline/OutlineRenderer';
import {
  browserStorage,
  loadGraphics,
  matchesPreset,
  outlineChoice,
  saveGraphics,
  SHADOW_RESOLUTION,
  withIntensity,
  withOutlines,
  withPreset,
  type GraphicsSettings,
} from './render/GraphicsSettings';
import { setShadowQuality } from './render/lighting';
import { AssetLibrary } from './assets/AssetLibrary';
import { TextureBank } from './render/shading/textures';
import { PaperShading } from './render/shading/PaperShading';
import { installMaterials, MaterialLibrary } from './render/materials/MaterialLibrary';

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
/** Enemy aircraft get a marker within this distance (mission targets, raiders and friends always). */
const AIRCRAFT_MARKER_RANGE = 230;
/** …and an edge chevron when off screen within this one. */
const AIRCRAFT_EDGE_RANGE = 140;
/** Sounds of other aircraft (gunfire, crashes) carry this far. */
const HEARING = 120;
/** The mini-map shows enemy aircraft this close to the plane, even beyond T1's radar. */
const SIGHT_RANGE = 120;
const PICK_TO_CARD: Partial<Record<Action, number>> = { pick1: 0, pick2: 1, pick3: 2, pick4: 3 };
const PICK_TO_SLOT: Partial<Record<Action, number>> = { pick0: 0, pick1: 1, pick2: 2, pick3: 3, pick4: 4, pick5: 5, pick6: 6, pick7: 7 };
/** The report on the last sortie's medal, records and bonuses, kept until the next sortie. */
interface SortieOutcome {
  progress: SortieProgress;
  payouts: Payout[];
  criteria: Record<'bronze' | 'silver' | 'gold', string> | null;
  operation: string | null;
}

/**
 * Wires the rules (GameState, missions, paper) to the 3D scene, input and HUD, and runs the frame
 * loop. The rules never touch rendering; this class translates between the two.
 */
export class Game {
  readonly boundary = new Boundary();
  paused = false;

  private lastAutoPause = -Infinity;
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
  /** Sorties launched this visit: raids only start once the player has flown. */
  private sortiesFlown = 0;
  /** When the player last hit each AI aircraft (performance.now()), to show its health bar. */
  private readonly hitAt = new Map<string, number>();
  /** Aircraft that have just flashed past the plane, so each pass whooshes once. */
  private readonly passing = new Set<string>();
  /** What each AI bomber's bombs are aimed at, and whose side dropped them. */
  private readonly bombOwners = new Map<string, Pick<BombOrder, 'side' | 'strike'>>();
  private lastInkSound = 0;
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private readonly v3 = new pc.Vec3();
  private readonly rel = new pc.Vec3();
  private readonly screen = new pc.Vec3();
  /** Everything the plane can fly into on the defended territories, besides the installations themselves. */
  private readonly barriers: Collider[];
  /** The last sortie's medal, records and bonuses, for the report. */
  private outcome: SortieOutcome | null = null;
  /** The summary of the previous visit, shown once on arrival (null once dismissed). */
  welcome: { session: SaveData['lastSession']; restored: boolean; problems: string[] } | null = null;
  /** Abandoning an operation and resetting progress both ask twice. */
  private confirming: { what: 'abandon' | 'reset'; until: number } | null = null;
  private alarmKey = '';
  private readonly logbook: Logbook;
  private readonly dev: DevPanel;
  /** Base management on T1 (B). */
  readonly baseMode: BaseMode;
  /** Every raid on T1 under way, keeping score for its defense report. */
  private readonly raidTrackers = new Map<number, RaidTracker>();
  /** The last defense report, kept for the base view. */
  private lastRaid: RaidReport | null = null;
  /** Settings saved with the game: key hints, HUD size, and which first-time tips were shown. */
  hints: HintMode = 'auto';
  uiScale = 1;
  private readonly tipsSeen = new Set<string>();
  /** Lifetime sorties, for when key hints stop showing (auto). */
  private sortiesTotal = 0;
  /** Graphics settings: this computer's, kept apart from the save. */
  graphics: GraphicsSettings = loadGraphics(browserStorage());
  private outlines: OutlineRenderer | null = null;
  /** Licensed and own models in use, e.g. `paperwars.assets.report()` in the console. */
  assets: AssetLibrary | null = null;
  private perfMonitor: PerfMonitor | null = null;
  /** The interactive tutorial (first visit), saved with the game. */
  tutorial = new Tutorial();
  /** Seconds flown with the controls in hand, for the tutorial's "fly" step. */
  private steerTime = 0;
  /** The plane lost last sortie, for the dashboard's quick rebuild (null once something else flies). */
  private lostPlane: AircraftId | null = null;
  /** Rearm and go: take off as soon as the ground crew is done. */
  private rearmThenGo = false;

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
    readonly ordnance: Ordnance,
    readonly ordnanceView: OrdnanceView,
    readonly sounds: Sounds,
    readonly airTraffic: AirTraffic,
    readonly aircraftModels: AircraftModels,
    readonly aiBombs: Bombs,
    readonly layout: DefenseLayout,
    readonly director: MissionDirector,
    readonly events: WorldEvents,
    readonly progress: Progress,
    readonly ledger: Ledger,
    readonly saves: SaveManager,
    readonly missionContext: () => MissionContext,
    readonly base: Base,
  ) {
    this.barriers = layout.barriers.map((b) => ({ id: b.id, shapes: b.solids }));
    this.logbook = new Logbook(hud.root, () => this.logbookView(), () => this.toggleLogbook(false));
    this.dev = new DevPanel(hud.root, this);
    this.baseMode = new BaseMode(base);
    this.controls = new Controls(input);
  }

  /** Keyboard, mouse and controller as named actions (src/input/). */
  readonly controls: Controls;

  /** What the controller's buttons mean right now. */
  private inputContext(): InputContext {
    if (this.paused || this.logbook.open || this.welcome) return 'menu';
    return this.state.phase === 'flying' ? 'flight' : 'home';
  }

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<Game> {
    const device = await pc.createGraphicsDevice(canvas, {
      deviceTypes: [pc.DEVICETYPE_WEBGL2],
      antialias: true,
    });
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);

    const options = new pc.AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.ParticleSystemComponentSystem];
    // Textures and glTF containers, for licensed models in assets/licensed/ (none needed otherwise).
    options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
    const app = new pc.AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());

    // The look: paper shading for every lit material, the material library, pencil outlines.
    const textures = new TextureBank(device);
    new PaperShading(device, textures);
    installMaterials(new MaterialLibrary(textures));
    const outlines = installOutlines(app);
    const assets = new AssetLibrary(app);
    await assets.preload();
    const graphics = loadGraphics(browserStorage());
    const world = buildWorld(app, assets, graphics.detail);
    const targetSpecs = layoutTargetRange(world.territories);
    const range = new TargetRange(app, targetSpecs);
    const rangeFootprints = targetSpecs.flatMap((s) => s.shapes.map(footprint));
    // Nothing is built into a landmark: the decoration's ground counts as taken.
    const decorGround = decorFootprints(world.territories);
    const layout = layoutDefenses(world.territories, [...rangeFootprints, ...decorGround]);
    const defenses = new DefenseNetwork(layout.installations);
    // The saved game, if there is one (IndexedDB, else local storage). A bad save never stops the game.
    const saves = new SaveManager(await openStore());
    const { data: saved, problems } = await saves.load();
    if (problems.length > 0) console.warn('paperwars: problems with the saved game', problems);
    const resources = new ResourceManager();
    const ledger = new Ledger();
    ledger.watch(resources);
    // T1 as a base: the paper store, and whatever the player has built (a new game starts with one turret).
    const base = new Base(world.home, defenses, resources);
    if (saved?.base) base.load(saved.base);
    else base.startFresh();
    resources.capacity = base.capacity;
    const staticContext = {
      territories: world.territories,
      homeId: world.home.id,
      launch: world.launchPosition,
      dummies: targetSpecs.filter((s) => s.kind === 'dummy'),
      obstacles: [
        ...rangeFootprints,
        ...decorGround,
        ...layout.installations.map((i) => ({ x: i.x, z: i.z, r: i.footprint })),
        ...layout.barriers.flatMap((b) => b.solids.map(footprint)),
      ],
    };
    // Each raid picks one of T1's structures to go for when it sets out.
    const airTraffic = new AirTraffic(world.territories, world.home, () => chooseRaidTarget(base).strike);
    let events: WorldEvents | null = null;
    // Missions only ever see the installations still standing, and the territories' states.
    const missionContext = (): MissionContext => ({
      ...staticContext,
      installations: layout.installations.filter((i) => defenses.get(i.id)?.alive ?? true),
      states: events?.territoryStates,
    });
    let state: GameState | null = null;
    const situation = (): Situation => ({
      paper: resources.paper,
      costs: Object.fromEntries(AIRCRAFT_ORDER.map((id) => [id, state?.buildCostFor(id) ?? AIRCRAFT[id].cost])) as Record<AircraftId, number>,
      airRoom: airTraffic.room,
      raidActive: airTraffic.activeRaid !== null,
    });
    const director = new MissionDirector(missionContext, situation);
    events = new WorldEvents({
      context: missionContext,
      store: homeStore(layout, world),
      room: () => airTraffic.room,
      spawn: (orders) => airTraffic.spawn(orders),
      leave: (id) => airTraffic.get(id)?.leave(),
      standing: (id) => range.get(id)?.alive ?? false,
    });
    const progress = new Progress();
    const career = LocalStats.browser();

    if (saved) {
      resources.restore(saved.paper);
      ledger.load(saved.ledger.entries, saved.ledger.totals, new Map(saved.ledger.byAircraft), new Map(saved.ledger.byType));
      progress.data = saved.progress;
      if (saved.director) director.load(saved.director);
      else director.deal();
    } else {
      director.deal();
    }
    state = new GameState(resources, () => director.missions);
    if (saved) {
      state.aircraft = saved.aircraft;
      for (const h of saved.hangar) state.hangar.set(h.id, { condition: h.condition, health: Math.min(h.health, AIRCRAFT[h.id].maxHealth), invested: h.invested });
      // A plane that was in the air when the page closed is back at T1, as if it had landed.
      if (saved.inFlight && !state.hangar.has(saved.inFlight.aircraft) && saved.inFlight.health > 0) {
        state.hangar.set(saved.inFlight.aircraft, { condition: 'recovered', health: Math.min(saved.inFlight.health, AIRCRAFT[saved.inFlight.aircraft].maxHealth), invested: 0 });
      }
    } else if (career.data.lastAircraft) {
      state.aircraft = career.data.lastAircraft;
    }

    const ground = (x: number, z: number) => {
      const t = world.territories.find((p) => p.containsXZ(x, z));
      return t ? t.top : null;
    };

    let game: Game | undefined;
    const hud = new HUD(hudRoot, {
      build: () => game?.build(),
      launch: () => game?.launch(),
      select: (index) => game?.select(index),
      selectAircraft: (id) => game?.selectAircraft(id),
      rearm: () => game?.rearm(),
      takeOff: () => game?.takeOff(),
      endSortie: () => game?.endSortie(),
      continueToDesk: () => game?.continueToDesk(),
      resume: () => game?.resume(),
      swap: () => game?.swapCard(),
      abandonOperation: () => game?.abandonOperation(),
      openLogbook: () => game?.toggleLogbook(true),
      openMenu: () => game?.pause(),
      resetProgress: () => game?.resetProgress(),
      dismissWelcome: () => game?.dismissWelcome(),
      toggleSound: () => game?.toggleSound(),
      setHints: (mode) => game?.setHints(mode),
      setUiScale: (scale) => game?.setUiScale(scale),
      setGraphicsPreset: (preset) => game?.setGraphics(withPreset(game.graphics, preset)),
      setOutlines: (choice) => game?.setGraphics(withOutlines(game.graphics, choice)),
      setOutlineIntensity: (intensity) => game?.setGraphics(withIntensity(game.graphics, intensity)),
      toggleBase: () => game?.toggleBase(),
      skipTutorial: () => game?.tutorial.skip(),
      restartTutorial: () => game?.tutorial.restart(),
      quickRebuild: () => game?.quickRebuild(),
      quickRepair: () => game?.quickRepair(),
      rearmAndGo: () => game?.rearmAndGo(),
      base: {
        selectSlot: (id) => game?.baseAction('select', id),
        choose: (kind) => game?.baseAction('choose', kind),
        build: () => game?.baseAction('build'),
        upgrade: () => game?.baseAction('upgrade'),
        repair: () => game?.baseAction('repair'),
        repairAll: () => game?.baseAction('repair-all'),
        remove: () => game?.baseAction('remove'),
      },
    });
    game = new Game(
      app,
      world,
      resources,
      state,
      career,
      range,
      new PlaneController(app, state.aircraft, assets.models),
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
      new HangarPreview(app, assets.models),
      new Input(canvas),
      hud,
      defenses,
      new DefenseModels(app, layout, defenses, world, assets.models),
      new Ordnance(),
      new OrdnanceView(app),
      new Sounds(),
      airTraffic,
      new AircraftModels(app, undefined, assets.models),
      new Bombs(app, 6),
      layout,
      director,
      events,
      progress,
      ledger,
      saves,
      missionContext,
      base,
    );
    game.sortiesTotal = Object.values(progress.data.mastery).reduce((sum, m) => sum + (m?.flights ?? 0), 0);
    if (saved) {
      game.sounds.muted = saved.settings.muted;
      if (saved.settings.dev) game.dev.toggle(true);
      game.welcome = { session: saved.lastSession, restored: true, problems };
      game.hints = saved.settings.hints;
      game.uiScale = saved.settings.uiScale;
      for (const t of saved.settings.tips) game.tipsSeen.add(t);
    }
    game.tutorial = Tutorial.fromSave(saved?.tutorial ?? null, game.sortiesTotal > 0);
    game.tutorial.onChange(() => game!.requestSave());
    game.hud.setScale(game.uiScale);
    game.outlines = outlines;
    game.assets = assets;
    game.setGraphics(graphics);
    game.perfMonitor = new PerfMonitor(app, () => outlines.stats(), new URLSearchParams(window.location.search).has('perf'));
    if (new URLSearchParams(window.location.search).has('dev')) game.dev.toggle(true);
    // The session summary is kept for next time, and the game saved, whenever the page goes away.
    const leave = () => void game!.saveNow();
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && leave());
    game.bindEvents();
    game.refreshPad();
    game.camera.updateDesk(0, world.launchPosition, world.launchYaw, true);
    app.on('update', (dt: number) => game!.tick(dt));
    app.on('update', () => {
      outlines.update();
      game!.perfMonitor?.frame();
    });
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
      this.alert('plane', 'Folding', null, 'info', 1.6);
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
    // With nothing affordable, F folds the free emergency Swift instead.
    const emergency = this.state.emergencyAvailable() && !this.state.resources.canAfford(this.state.buildCost);
    if (emergency) this.refitFrom = 1;
    if (!(emergency ? this.state.buildEmergency() : this.state.build())) return;
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
    if (!this.controls.padFlying) this.input.requestPointerLock();
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
    this.inkSound();
  }

  /** On the ground at home: the ground crew tops up ink and range. */
  rearm(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (!this.state.rearm() && this.state.rearmProgress === null) this.alert('rearm', 'Full', null, 'info', 1.4);
  }

  /** From wherever the plane stopped after landing. */
  takeOff(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (!this.state.takeOff()) return;
    this.plane.launch();
    this.rolledToStop = false;
    this.boundary.reset();
    this.input.consumeMouse();
    if (!this.controls.padFlying) this.input.requestPointerLock();
  }

  /** Landed at home: rearm, then take off as soon as the ground crew is done (at once if nothing is needed). */
  rearmAndGo(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (this.state.rearm() || this.state.rearmProgress !== null) this.rearmThenGo = true;
    else this.takeOff();
  }

  /** At the desk: the plane lost last sortie, chosen again and folded in one go. */
  quickRebuild(): void {
    const id = this.lostPlane;
    if (this.paused || !id || this.state.phase !== 'desk') return;
    if (this.state.aircraft !== id) this.selectAircraft(id);
    this.build();
  }

  /** At the desk: everything on the home desk repaired, without opening base management. */
  quickRepair(): void {
    if (this.paused || !this.atHome) return;
    if (this.base.needsRepair.length === 0) return;
    if (!this.base.repairAll()) this.alert('paper', 'Need paper', `−${Math.max(0, this.base.repairAllCost - this.resources.paper)}`, 'bad', 2);
  }

  /** After landing: the plane goes into the hangar and the report comes up. */
  endSortie(): void {
    if (this.paused || this.state.phase !== 'landed' || !this.rolledToStop) return;
    if (this.state.endSortie()) this.input.exitPointerLock();
  }

  /** From the report: back to the desk for the next sortie. */
  continueToDesk(): void {
    if (this.paused) return;
    if (this.state.phase !== 'debrief' && this.state.phase !== 'crashed') return;
    if (this.state.phase === 'crashed' && this.crashTime < CRASH_REPORT_DELAY) return;
    // Defenses come back when the scenario resets, except what the world remembers: wrecks on
    // territories still on alert or disabled. Done before the cards are dealt, which check targets.
    const keep = this.events.persistentWrecks;
    this.range.restoreAll();
    this.defenses.restoreAll(keep);
    this.defenseModels.restoreAll(keep);
    this.director.validate();
    if (!this.state.continueToDesk()) return;
    this.outcome = null;
    this.events.hold(this.director.operation?.status === 'active' ? this.director.operation.territoryId : null);
    this.impactCamTime = 0;
    this.rolledToStop = false;
    this.bombs.clear();
    this.projectiles.clear();
    this.trails.clear();
    this.boundary.reset();
    this.ordnance.clear();
    this.ordnanceView.clear();
    // The mission's aircraft are cleared away; patrols and a raid on its way carry on.
    this.airTraffic.reset();
    this.aiBombs.clear();
    this.hitAt.clear();
    this.refreshPad();
    this.input.exitPointerLock();
    this.camera.updateDesk(0, this.world.launchPosition, this.world.launchYaw, true);
    // Back at the desk: anything on T1 that needs repairs.
    const repairs = this.base.needsRepair.length;
    if (repairs > 0) this.alert('repair', `${repairs} to repair`, String(this.base.repairAllCost), 'warn', 3);
  }

  /** X: swaps the selected card for another (a limited number of times). */
  swapCard(): void {
    const { state, director } = this;
    if (this.paused || (state.phase !== 'desk' && state.phase !== 'building' && state.phase !== 'ready')) return;
    if (state.selected >= director.offers.length) {
      this.alert('swap', 'No swap', null, 'info', 1.6);
      return;
    }
    if (director.swaps <= 0) {
      this.alert('swap', 'No swaps', `0/${DIRECTOR.swaps.max}`, 'bad', 1.6);
      return;
    }
    if (!director.canSwap(state.selected)) {
      this.alert('radar', 'Operation on', null, 'info', 1.6);
      return;
    }
    const mission = director.swap(state.selected);
    if (!mission) return;
    state.updateOffers(director.missions);
    state.select(director.missions.indexOf(mission));
    this.alert('swap', 'Swapped', `${director.swaps}/${DIRECTOR.swaps.max}`, 'info', 1.6);
    this.requestSave();
  }

  /** Gives up the operation under way (asks twice): what it paid is kept, the bonus is not. */
  abandonOperation(): void {
    const op = this.director.operation;
    if (this.paused || !op || op.status !== 'active') return;
    if (this.state.phase !== 'desk' && this.state.phase !== 'building' && this.state.phase !== 'ready') return;
    if (!this.confirm('abandon')) {
      this.alert('close', 'Abandon?', `−${op.bonus}`, 'bad', 3);
      return;
    }
    this.director.abandonOperation();
    this.events.hold(null);
    this.state.updateOffers(this.director.missions);
    this.alert('close', 'Abandoned', null, 'info', 2);
    this.requestSave();
  }

  /** Deletes all local progress (asks twice), then starts over. */
  resetProgress(): void {
    if (!this.confirm('reset')) {
      this.alert('remove', 'Reset all?', null, 'bad', 3.5);
      return;
    }
    void this.saves.reset().then(() => {
      this.career.clear();
      window.location.reload();
    });
  }

  /** True on the second ask within a few seconds. */
  private confirm(what: 'abandon' | 'reset'): boolean {
    const now = performance.now();
    if (this.confirming?.what === what && now < this.confirming.until) {
      this.confirming = null;
      return true;
    }
    this.confirming = { what, until: now + 4000 };
    return false;
  }

  toggleLogbook(open = !this.logbook.open): void {
    if (open && this.state.phase === 'flying') return;
    this.logbook.toggle(open);
    if (open) this.dismissWelcome();
  }

  dismissWelcome(): void {
    this.welcome = null;
  }

  toggleSound(): void {
    this.sounds.muted = !this.sounds.muted;
    this.alert(this.sounds.muted ? 'mute' : 'sound', this.sounds.muted ? 'Sound off' : 'Sound on', null, 'info', 1.4);
    this.requestSave();
  }

  setHints(mode: HintMode): void {
    this.hints = mode;
    this.requestSave();
  }

  setUiScale(scale: number): void {
    this.uiScale = UI_SCALES.includes(scale) ? scale : 1;
    this.hud.setScale(this.uiScale);
    this.requestSave();
  }

  /** Key hints show for the first few sorties (auto), always, or never; H shows them while held. */
  /** Frame timing and rendering counts (also shown with ?perf). */
  perf(): PerfSnapshot | null {
    return this.perfMonitor?.snapshot() ?? null;
  }

  /** Applies and remembers graphics settings (outlines, shadows, decoration, resolution). */
  setGraphics(settings: GraphicsSettings): void {
    this.graphics = settings;
    saveGraphics(browserStorage(), settings);
    this.outlines?.configure({ enabled: settings.outlines, quality: settings.outlineQuality, intensity: settings.outlineIntensity });
    const shadows = SHADOW_RESOLUTION[settings.shadows];
    setShadowQuality(this.world.sun, { enabled: shadows > 0, resolution: shadows });
    for (const d of this.world.dressings.values()) d.setDetail(settings.detail);
    const device = this.app.graphicsDevice;
    const ratio = Math.min(window.devicePixelRatio || 1, settings.resolution);
    if (device.maxPixelRatio !== ratio) {
      device.maxPixelRatio = ratio;
      this.app.resizeCanvas();
    }
  }

  private get showHints(): boolean {
    if (this.controls.held('hints')) return true;
    return this.hints === 'on' || (this.hints === 'auto' && this.sortiesTotal < BASE.hintSorties);
  }

  /** Base management is available at home: at the desk, or landed and rolled to a stop. */
  private get atHome(): boolean {
    const phase = this.state.phase;
    return phase === 'desk' || phase === 'building' || phase === 'ready' || (phase === 'landed' && this.rolledToStop);
  }

  /** B: into base management (the camera rises above T1) and back out. */
  toggleBase(open = !this.baseMode.open): void {
    if (this.paused) return;
    if (open && !this.atHome) {
      this.alert('home', 'Land first', null, 'info', 1.6);
      return;
    }
    if (open) {
      this.baseMode.enter();
      this.tutorial.note('base-opened');
      this.dismissWelcome();
      this.input.exitPointerLock();
      this.tip('base', 'Click a slot, pick a building, build. Damage stays until you repair.', ['B']);
    } else {
      this.baseMode.exit();
      this.defenseModels.showPreview(null);
    }
  }

  /** The base management buttons and keys. */
  baseAction(action: 'select' | 'choose' | 'build' | 'upgrade' | 'repair' | 'repair-all' | 'remove', arg?: string): void {
    if (this.paused || !this.baseMode.open) return;
    const m = this.baseMode;
    switch (action) {
      case 'select':
        if (arg) m.selectSlot(arg);
        break;
      case 'choose':
        if (arg) m.choose(arg as Parameters<BaseMode['choose']>[0]);
        break;
      case 'build':
        m.build();
        break;
      case 'upgrade':
        m.upgrade();
        break;
      case 'repair':
        m.repair();
        break;
      case 'repair-all':
        m.repairAll();
        break;
      case 'remove':
        m.remove();
        break;
    }
  }

  /** What the base did: models follow, with a fold-up animation for new buildings, and the player hears about it. */
  private onBaseEvent(e: BaseEvent): void {
    const { base, hud } = this;
    switch (e.type) {
      case 'built': {
        const id = base.idOf(e.slot);
        this.defenseModels.sync(new Set([id]));
        this.defenseModels.showPreview(null);
        const i = base.installation(e.slot);
        if (i) this.effects.burst(this.v1.set(i.spec.x, i.spec.ground + 1.2, i.spec.z), 'fold');
        this.sounds.play('spotted');
        this.alert(BUILDING_ICONS[e.kind], BASE.buildings[e.kind].short, `−${e.cost}`, 'good', 1.8);
        break;
      }
      case 'upgraded': {
        this.defenseModels.sync();
        const i = base.installation(e.slot);
        if (i) this.effects.burst(this.v1.set(i.spec.x, i.spec.ground + 1.5, i.spec.z), 'ring');
        this.sounds.play('spotted');
        this.alert('upgrade', `${BASE.buildings[e.kind].short} ${'★'.repeat(e.level - 1)}`, `−${e.cost}`, 'good', 1.8);
        break;
      }
      case 'repaired':
        for (const key of e.keys) {
          const i = base.installation(key);
          if (i) this.effects.burst(this.v1.set(i.spec.x, i.spec.ground + 1, i.spec.z), 'fold');
        }
        this.alert('repair', e.keys.length > 1 ? `${e.keys.length} repaired` : 'Repaired', `−${e.cost}`, 'good', 1.8);
        break;
      case 'removed':
        this.defenseModels.sync();
        this.alert('remove', `${BASE.buildings[e.kind].short} removed`, e.refund > 0 ? `+${e.refund}` : null, 'info', 1.8);
        break;
      case 'refused': {
        const what = { paper: 'Need paper', slot: 'Wrong slot', unique: 'Only one', 'max-level': 'Max level', destroyed: 'Repair first', intact: 'Intact' }[e.reason];
        hud.alert(e.reason === 'paper' ? 'paper' : 'warn', what, e.reason === 'paper' ? `−${e.missing}` : null, 'bad', 1.8);
        break;
      }
    }
    // Capacity and production change with the buildings.
    this.resources.capacity = base.capacity;
    this.requestSave();
  }

  /** An alert below the objective. */
  private alert(icon: IconName, title: string, value: string | null, tone: AlertTone, seconds = 2.4): void {
    this.hud.alert(icon, title, value, tone, seconds);
  }

  /** A first-time tip, once per save. */
  private tip(id: string, text: string, keys: string[] = []): void {
    if (this.tipsSeen.has(id)) return;
    this.tipsSeen.add(id);
    this.hud.tip(text, keys);
    this.requestSave();
  }

  /** Saves soon (writes are gathered). */
  requestSave(): void {
    this.saves.schedule(() => this.buildSave());
  }

  /** Saves at once (the page is going away). */
  async saveNow(): Promise<void> {
    this.saves.schedule(() => this.buildSave());
    await this.saves.flush();
  }

  /** Everything worth keeping. A plane in the air is saved as coming back to T1. */
  buildSave(): SaveData {
    const { state } = this;
    const airborne = (state.phase === 'flying' || state.phase === 'landed') && state.plane && !state.emergency;
    const onPad = (state.phase === 'building' || state.phase === 'ready') && state.plane && !state.emergency;
    const hangar = [...state.hangar].map(([id, h]) => ({ id, condition: h.condition, health: h.health, invested: h.invested }));
    // A plane on the pad was paid for: it waits in the hangar, ready to roll out.
    if (onPad && !state.hangar.has(state.plane!.id)) hangar.push({ id: state.plane!.id, condition: 'ready', health: state.durability?.health ?? state.plane!.maxHealth, invested: state.sortie?.paperSpent ?? 0 });
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      paper: this.resources.paper,
      aircraft: state.aircraft,
      hangar,
      inFlight: airborne ? { aircraft: state.plane!.id, health: state.durability?.health ?? 0 } : null,
      director: this.director.save(),
      progress: this.progress.data,
      ledger: {
        entries: this.ledger.entries,
        totals: this.ledger.totals,
        byAircraft: [...this.ledger.byAircraft],
        byType: [...this.ledger.byType],
      },
      settings: { muted: this.sounds.muted, dev: this.dev.open, hints: this.hints, uiScale: this.uiScale, tips: [...this.tipsSeen] },
      lastSession: this.progress.session.sorties > 0 ? this.progress.session : (this.welcome?.session ?? null),
      base: this.base.save(),
      tutorial: this.tutorial.record(),
    };
  }

  /**
   * The sortie is over (the plane is home or lost): rate the mission, update records, streaks and
   * mastery, advance the director (and any operation), pay the bonuses, and save.
   */
  private sortieOver(recovered: boolean): void {
    const { state, director, progress } = this;
    const mission = state.mission;
    const sortie = state.sortie;
    const plane = state.plane;
    if (!mission || !sortie || !plane) return;
    const opBefore = director.operation;
    const offer = director.offerFor(mission);
    const p = progress.sortieEnded({ mission, sortie, aircraft: plane.id, maxHealth: plane.maxHealth, recovered, operationCompleted: false });
    const success = mission.status === 'succeeded';
    const damageTaken = Math.min(1, sortie.damageTaken / plane.maxHealth);
    director.afterSortie(
      mission,
      {
        type: mission.spec.type, tier: mission.tier, success, failure: mission.failure, lost: !recovered, landed: recovered,
        damageDealt: sortie.damageDealt, damageTaken, time: mission.elapsed, par: mission.spec.par ?? 0,
        shotsFired: sortie.shotsFired, shotsHit: sortie.shotsHit, aircraft: plane.id, reward: success ? mission.reward : 0, medal: p.medal,
      },
      { success, recovered, damageTaken, time: mission.elapsed, par: mission.spec.par ?? 0, reward: success ? mission.reward : 0 },
    );
    const payouts = director.takePayouts();
    if (p.streakBonus > 0) payouts.unshift({ amount: p.streakBonus, label: `Streak bonus: ${p.streak} in a row` });
    for (const payout of payouts) state.payBonus(payout.amount, payout.label);
    let operation: string | null = null;
    if (offer?.operationId && opBefore) {
      const stage = offer.stage ?? 0;
      if (opBefore.status === 'completed') {
        operation = `${opBefore.codename} complete! Bonus +${opBefore.bonus}`;
        const a = progress.unlockNow('operation');
        if (a) p.achievements.push(a);
      } else if (success) operation = `${opBefore.codename}: stage ${stage + 1} of ${opBefore.stages.length} done`;
      else operation = `${opBefore.codename}: stage ${stage + 1} still open, try again`;
    }
    this.events.bound = null;
    this.ledger.recordSortie({ aircraft: plane.id, type: mission.spec.type, spent: sortie.paperSpent, earned: sortie.paperEarned, success, lost: !recovered });
    this.outcome = { progress: p, payouts, criteria: success ? medalCriteria(mission) : null, operation };
    if (p.achievements.length > 0) this.sounds.play('kill');
    this.requestSave();
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
    if (this.state.phase === 'flying' && !this.controls.padFlying) this.input.requestPointerLock();
  }

  // ---- Frame loop -----------------------------------------------------------------------------

  private tick(rawDt: number): void {
    const dt = Math.min(rawDt, 0.05);
    this.controls.context = this.inputContext();
    this.controls.screen = `${this.state.phase}|${this.baseMode.open}|${this.paused}|${this.logbook.open}|${!!this.welcome}`;
    this.controls.update(dt);
    const mouse = this.input.consumeMouse();
    if (!this.paused) this.simulate(dt, mouse);
    this.hud.render(this.view());
  }

  private simulate(dt: number, mouse: { dx: number; dy: number }): void {
    const { world, plane, camera, state, base, resources } = this;
    // T1's buildings set how fast paper comes in and how much the store holds.
    state.income.perMinute = base.production;
    state.income.capacity = base.capacity;
    resources.capacity = base.capacity;
    state.tick(dt);
    base.recordIncome(state.income.lastPaid);
    this.progress.session.seconds += dt;
    this.updateWorld(dt);
    const atDesk = state.phase === 'desk' || state.phase === 'building' || state.phase === 'ready';
    // Base management is only open at home.
    if (this.baseMode.open && !this.atHome) this.toggleBase(false);
    switch (state.phase) {
      case 'desk':
      case 'building':
      case 'ready':
        if (state.phase === 'building') {
          plane.setFold(foldPose(state.buildProgress, state.buildKind));
          if (state.buildKind === 'refit') plane.setDamage(this.refitFrom + (1 - this.refitFrom) * state.buildProgress);
        }
        // Dragging on the canvas turns the preview.
        if (this.input.isButtonHeld(MOUSE_LEFT) && !this.input.pointerLocked && !this.baseMode.open) this.preview.drag(mouse.dx, mouse.dy);
        else if (!this.baseMode.open) {
          // The right stick turns the preview too.
          const turn = this.controls.previewTurn();
          if (turn.x !== 0 || turn.y !== 0) this.preview.drag(turn.x * 700 * dt, turn.y * 300 * dt);
        }
        if (this.baseMode.open) camera.updateBase(dt, world.home, world.launchYaw);
        else camera.updateDesk(dt, world.launchPosition, world.launchYaw);
        break;
      case 'flying':
        this.rearmThenGo = false;
        this.fly(dt, mouse);
        break;
      case 'landed':
      case 'debrief':
        if (this.rearmThenGo && state.phase === 'landed' && state.rearmProgress === null && this.rolledToStop) {
          this.rearmThenGo = false;
          this.takeOff();
          break;
        }
        if (plane.rollout(dt, world.home) && !this.rolledToStop) {
          this.rolledToStop = true;
          this.input.exitPointerLock(); // free the cursor for the ground crew's buttons
        }
        if (this.baseMode.open) camera.updateBase(dt, world.home, world.launchYaw);
        else camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        break;
      case 'crashed':
        this.crashTime += dt;
        camera.updateWatch(dt, this.crashPoint);
        break;
    }

    plane.animate(dt);
    world.homeDressing.updateHangar(dt, state.hangar.size);
    // The bombs are loaded at take-off; on the pad they would only sit in the way of the fold.
    plane.setBombs(state.phase === 'flying' || state.phase === 'landed' ? state.bombsLoaded : 0);
    if (state.durability && !atDesk) plane.setDamage(state.durability.fraction);
    const shown = atDesk ? state.selectedMission : state.mission;
    if (this.markers.shown !== shown) this.markers.show(shown);

    this.updateAir(dt);
    this.detectRaids();
    this.updateDefenses(dt);
    // The slots on T1, lit up in base management, and the see-through building where it would go.
    const pads = this.baseMode.highlights();
    this.defenseModels.setSlots(pads.map((p) => {
      const at = this.base.installation(p.id)?.spec ?? buildingSpecAt(this.base, p.id);
      return { id: p.id, x: at.x, z: at.z, highlight: p.highlight };
    }));
    const preview = this.baseMode.preview();
    this.defenseModels.showPreview(preview?.spec ?? null, preview?.valid ?? true);
    const standing = [...this.range.colliders, ...this.installationColliders()];
    for (const impact of this.bombs.update(dt, this.openZones(), world.territories, standing)) this.onBombImpact(impact);
    for (const impact of this.aiBombs.update(dt, [], world.territories, standing)) this.onAiBombImpact(impact);
    const shootable = [...standing, ...this.ordnance.rocketColliders()];
    for (const impact of this.projectiles.update(dt, shootable, world.territories, this.enemyAircraft())) this.onShotImpact(impact);
    this.aircraftModels.update(dt, this.airTraffic.aircraft);
    this.range.update(dt);
    this.markers.update(dt);
    this.trails.update(dt, plane, state.durability?.fraction ?? 1);
    const parked = atDesk && plane.status === 'parked' && plane.spec.id === state.aircraft;
    this.preview.update(dt, world.launchPosition, state.aircraft, state.phase === 'desk', parked ? 1.6 : 0);
    this.effects.update(dt);
  }

  private fly(dt: number, mouse: { dx: number; dy: number }): void {
    const { plane, world, controls, state } = this;
    const before = this.boundary.state;
    const boundary = this.boundary.update(dt, plane.position.x, plane.position.z);
    // The warning panel covers the countdown and the autopilot; only the hand-back needs a banner.
    if (before === 'autopilot' && boundary === 'inside') this.alert('plane', 'Control', null, 'info', 1.6);
    const p = plane.position;
    const autopilot =
      boundary === 'autopilot'
        ? { yaw: yawFromDirection(world.home.x - p.x, world.home.z - p.z), pitch: clamp((AUTOPILOT_ALTITUDE - p.y) * 0.04, -0.35, 0.35) }
        : null;
    // The left stick steers as mouse movement would, with a little help near enemy aircraft.
    const stick = controls.stickMouse(plane.motion, PLANE, dt, plane.position, this.enemyAircraft());
    this.camera.setLook(controls.look());
    const result = plane.fly(
      dt,
      {
        mouseDX: mouse.dx + stick.dx,
        mouseDY: mouse.dy + stick.dy,
        throttle: controls.throttle(),
        bank: controls.bank(),
        boost: controls.held('boost'),
        autoLevel: !this.onApproach(),
        autopilot,
        gliding: state.outOfRange,
      },
      world.territories,
      this.solids(),
    );
    for (const collision of result.collisions) {
      this.onCollision(collision);
      if (state.phase !== 'flying') return; // that one destroyed the plane
    }
    switch (result.outcome) {
      case 'flying':
        if (this.tutorial.current === 'steer' && !autopilot) {
          this.steerTime += dt;
          if (this.steerTime >= STEER_SECONDS) this.tutorial.note('steered');
        }
        state.updateFlight(plane.prevPosition, plane.position, dt);
        if (controls.held('firePrimary') && !this.paused) this.fire();
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
      if (installation?.side === 'enemy' && ram > 0) this.damageInstallation(installation, ram, this.defenseModels.centre(installation.id, this.v3));
    }
    if (damage <= 0) return;
    this.effects.burst(plane.position, 'thud');
    const { dealt, destroyed } = state.damageAircraft(damage, c.kind === 'rough-landing' ? 'landing' : 'impact');
    if (destroyed || dealt <= 0) return;
    if (c.kind === 'rough-landing') {
      this.alert('land', 'Rough landing', `−${dealt}`, 'bad', 2.6);
      this.tip('rough', `${hardLandingReason(c.check)} Slow, gentle, wings level.`);
    } else {
      const what =
        c.kind === 'object'
          ? (this.range.get(c.id)?.spec.name.toLowerCase() ?? this.defenses.get(c.id)?.spec.name.toLowerCase() ?? 'a barrier wall')
          : c.id;
      this.alert('damage', 'Ouch', `−${dealt}`, 'bad', 2);
      void what;
    }
  }

  // ---- Aircraft -------------------------------------------------------------------------------

  /**
   * The AI aircraft fly a step: missions', raids' and ambient patrols'. Their rounds join the
   * ordnance in flight and their bombs fall; what happened to them is reported as events.
   */
  private updateAir(dt: number): void {
    const { plane, state, world } = this;
    const flying = state.phase === 'flying';
    let player: Contact | null = null;
    if (flying) {
      const p = plane.position;
      const v = plane.getVelocity(this.v2);
      player = {
        id: PLAYER_ID, side: 'player', x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z,
        signature: plane.spec.signature, radius: plane.spec.hitRadius, shielded: this.playerShielded(), role: 'player',
      };
    }
    const out = this.airTraffic.update(dt, {
      territories: world.territories,
      obstacles: this.solids(),
      player,
      visible: (q) => this.inView(q),
      // Raids keep their own pace, but wait their turn behind other world events.
      raids: state.phase !== 'debrief' && state.phase !== 'crashed' && this.sortiesFlown >= RAIDS.afterSorties && this.events.raidsAllowed(this.sortiesFlown),
      patrol: state.mission?.isActive ? state.mission.patrolProgress : 0,
      // The director paces raids: slower while T1 recovers, the player struggles or is busy.
      raidPace: raidPace({
        vulnerable: this.base.vulnerable(),
        integrity: this.base.integrity,
        skill: this.director.performance.skill,
        struggling: this.director.performance.struggling,
        onMission: flying && !!state.mission?.isActive && state.mission.spec.type !== 'bomber-intercept',
      }),
    });
    const eye = this.camera.entity.getPosition();
    for (const shot of out.shots) {
      this.ordnance.spawn(shot);
      if (shot.target === PLAYER_ID) state.recordIncoming();
      if (Math.hypot(shot.x - eye.x, shot.y - eye.y, shot.z - eye.z) < HEARING * 0.6) this.inkSound();
    }
    for (const bomb of out.bombs) {
      this.bombOwners.set(bomb.source, { side: bomb.side, strike: bomb.strike });
      this.aiBombs.release(bomb, { x: bomb.vx, y: bomb.vy, z: bomb.vz }, 'standard', true, bomb.source);
    }
    for (const event of out.events) this.onAirEvent(event);

    // A whoosh for every aircraft that flashes past close by.
    if (flying) {
      for (const a of this.airTraffic.aircraft) {
        const near = a.position.distance(plane.position) < 9;
        if (near && !this.passing.has(a.id)) this.sounds.play('whoosh');
        if (near) this.passing.add(a.id);
        else this.passing.delete(a.id);
      }
    }
    // The combat track swells while enemy aircraft are fighting the player, and a little while a raid is coming.
    const attacked = flying && this.airTraffic.aircraft.some((a) => a.side === 'enemy' && a.attacking && a.targetId === PLAYER_ID);
    const raid = this.airTraffic.raids.some((r) => r.stage === 'inbound');
    this.sounds.combat(dt, attacked ? 1 : raid ? 0.35 : 0);
  }

  /**
   * World time: events start and end, territory states run out, bonuses are paid, the event card
   * follows what is going on, and defenders on alert get their fix at once.
   */
  private updateWorld(dt: number): void {
    const { events, director, state } = this;
    events.update(dt, this.sortiesFlown);
    for (const note of events.takeNotes()) {
      if (note.event && note.event.status === 'active') this.sounds.play(note.event.kind === 'supply-run' ? 'spotted' : 'bandit');
      if (note.event?.kind === 'raid') continue; // the raid alert says it
      const short = shortNote(note.title, note.detail);
      this.alert(note.event ? EVENT_ICONS[note.event.kind] : short.icon, short.title, short.value, note.tone, 3);
    }
    for (const payout of [...events.takePayouts(), ...director.takePayouts()]) {
      if (state.sortie && (state.phase === 'flying' || state.phase === 'landed')) state.payBonus(payout.amount, payout.label);
      else this.resources.earn(payout.amount, 'bonus', payout.label);
      if (payout.label.startsWith('Shipment') || payout.label.startsWith('Convoy')) {
        const a = this.progress.unlockNow('world-event');
        if (a) this.alert('medal', a.title, null, 'good', 3);
      }
      this.requestSave();
    }
    // The event card: the newest active event's, until it ends (unless it is being flown).
    const live = events.active.find((e) => e.mission);
    const current = director.event;
    const flying = current && current.mission === state.mission && state.mission?.status !== 'available';
    if (!flying && (current?.eventId ?? null) !== (live?.id ?? null)) {
      director.setEvent(live ? { slot: 'event', source: 'event', mission: live.mission!, recipe: null, eventId: live.id, reasons: [`World event: ${EVENT_LABELS[live.kind]}`, live.detail] } : null);
      state.updateOffers(director.missions);
    }
    const alarm = [...events.alarmed].sort().join(',');
    if (alarm !== this.alarmKey) {
      this.alarmKey = alarm;
      this.defenses.setAlarm(events.alarmed);
    }
  }

  /** What anything flying can hit: props, standing installations and walls. */
  private solids(): Collider[] {
    return [...this.range.solids, ...this.installationSolids(), ...this.barriers, ...this.world.decorColliders];
  }

  /** Enemy aircraft, for the player's ink: their spheres and this step's movement. */
  private enemyAircraft(): MovingSphere[] {
    return this.airTraffic.aircraft
      .filter((a) => a.alive && a.side === 'enemy')
      .map((a) => {
        const p = a.model.position;
        const q = a.model.prevPosition;
        return { id: a.id, x: p.x, y: p.y, z: p.z, px: q.x, py: q.y, pz: q.z, r: a.spec.hitRadius };
      });
  }

  /** Could the camera see this point? Aircraft only appear and vanish where it can't. */
  private inView(p: { x: number; y: number; z: number }): boolean {
    const cam = this.camera.entity;
    const eye = cam.getPosition();
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > AI.hiddenDistance) return false;
    const f = cam.forward;
    return (dx * f.x + dy * f.y + dz * f.z) / (d || 1) > 0.3;
  }

  /** Hostile aircraft hold their fire: the plane is over home, or has only just taken off. */
  private playerShielded(): boolean {
    const p = this.plane.position;
    return overHome(this.world.home, p.x, p.z) || this.plane.airborneFor < AI.launchShield;
  }

  /** Gunfire nearby: a short tick, not too often. */
  private inkSound(): void {
    const now = performance.now();
    if (now - this.lastInkSound < 90) return;
    this.lastInkSound = now;
    this.sounds.play('ink');
  }

  private onAirEvent(e: AirEvent): void {
    const { state, hud } = this;
    switch (e.type) {
      case 'destroyed':
        this.onAircraftDown(e.aircraft, e.byPlayer, e.cause, e.by);
        break;
      case 'collision':
        if (this.near(e.at)) this.effects.burst(this.v1.set(e.at.x, e.at.y, e.at.z), 'thud');
        break;
      case 'escaped':
        state.aircraftEscaped(e.aircraft.id);
        this.events.aircraftEscaped(e.aircraft.id);
        break;
      case 'engaging':
        if (e.target === PLAYER_ID && state.phase === 'flying') {
          this.sounds.play('bandit');
          hud.threatNote(`${e.aircraft.skill.label} ${e.aircraft.spec.name} on your tail!`, 'bad');
        } else if (state.mission?.escorting(e.target)) {
          hud.threatNote(`Enemy ${e.aircraft.spec.name} going for your bomber!`, 'bad');
        }
        break;
      case 'released':
        state.bombReleased(e.aircraft.id);
        if (e.aircraft.side === 'enemy' && this.airTraffic.raids.some((r) => r.bomber === e.aircraft.id)) {
          this.alert('bomb', 'Bomb away', null, 'bad', 2.2);
        }
        break;
      case 'raid':
        this.onRaid(e.raid);
        break;
    }
  }

  /**
   * A raid changed stage. Every raid gets a tracker for its defense report from the start, but the
   * player only hears about one once T1 detects it (see detectRaids): no radar, late warning.
   */
  private onRaid(raid: Raid): void {
    const { state } = this;
    if (raid.stage === 'inbound') {
      if (!this.raidTrackers.has(raid.id)) {
        const key = this.raidTargetKey(raid);
        const target = raidTargetFor(this.base, key);
        this.raidTrackers.set(raid.id, new RaidTracker(raid.id, new Set([raid.bomber, ...raid.escorts]), target, raidLoss(this.base.vulnerable(), key === STORE)));
      }
      if (raid.detected) this.announceRaid(raid);
      return;
    }
    if (raid.stage !== 'over') return;
    this.events.raidEnded(raid);
    if (this.director.validate()) state.updateOffers(this.director.missions);
    switch (raid.outcome) {
      case 'intercepted':
      case 'driven-off':
        state.raidDefended(raid.participated, raid.mission);
        if (!raid.mission && raid.participated) this.alert('shield', 'Raid stopped', `+${RAIDS.reward}`, 'good', 3);
        break;
      case 'missed':
        this.alert('shield', 'Bomb missed', null, 'good', 2.2);
        break;
    }
    const tracker = this.raidTrackers.get(raid.id);
    this.raidTrackers.delete(raid.id);
    if (!tracker || raid.outcome === 'cancelled' || !raid.outcome) return;
    const report = tracker.finish(raid.outcome, this.base.repairAllCost);
    this.lastRaid = report;
    const stats = this.base.stats;
    stats.raids++;
    if (report.repelled) stats.repelled++;
    stats.paperLost += report.paperLost;
    this.hud.raidReport(report);
    // After a raid that hurt, T1 gets time to recover before the next.
    if (!report.repelled && (report.paperLost > 0 || report.destroyed.length > 0)) this.airTraffic.delayRaids(RAIDS.recovery);
    if (report.repairCost > 0) this.tip('repair', 'Damaged buildings stay damaged. Repair them in the base.', ['B']);
    this.requestSave();
  }

  /** Which of T1's structures a raid is aimed at (by where its bomb is meant to land). */
  private raidTargetKey(raid: Raid): string {
    const strike = raid.strike;
    if (!strike) return STORE;
    for (const key of [STORE, ...this.base.buildings.keys()]) {
      const i = this.base.installation(key);
      if (i && Math.abs(i.spec.x - strike.x) < 0.5 && Math.abs(i.spec.z - strike.z) < 0.5) return key;
    }
    return STORE;
  }

  /** T1 has seen a raider coming: the alarm, the alert, and the emergency card on the board. */
  private announceRaid(raid: Raid): void {
    const { state } = this;
    // Home is under attack: an emergency defense card goes on the board (unless a mission sent it).
    if (!this.events.events.some((e) => e.raidId === raid.id)) this.events.raidStarted(raid);
    if (this.director.validate()) state.updateOffers(this.director.missions);
    this.sounds.play('raid');
    const tracker = this.raidTrackers.get(raid.id);
    const what = tracker ? tracker.target.name.split(' ').slice(-1)[0] : null;
    this.alert('raid', SAY.raidInbound, what ? what.charAt(0).toUpperCase() + what.slice(1) : null, 'bad', 3.5);
    this.tip('raid', 'A raid is coming for T1. Fly out to meet it, or trust your guns. A radar warns you earlier.', ['F', 'Space']);
  }

  /**
   * Raids nobody has noticed yet: T1 notices each one once its bomber comes within the detection
   * range (the radar's, or close in without one). Until then there is no warning at all.
   */
  private detectRaids(): void {
    const home = this.world.home;
    const range = this.base.detectionRange;
    for (const raid of this.airTraffic.raids) {
      if (raid.detected || raid.stage === 'over') continue;
      const bomber = this.airTraffic.get(raid.bomber);
      if (!bomber) continue;
      if (Math.hypot(bomber.position.x - home.x, bomber.position.z - home.z) > range && raid.stage === 'inbound') continue;
      raid.detected = true;
      this.announceRaid(raid);
    }
    // Until its bomb falls, what a hit would cost follows the paper in the store.
    for (const t of this.raidTrackers.values()) t.potentialLoss = raidLoss(this.base.vulnerable(), t.target.key === STORE);
  }

  /** An AI aircraft went down: it crumples, and the player hears about it if it was theirs or mattered. */
  private onAircraftDown(a: AiAircraft, byPlayer: boolean, cause: 'shot' | 'crash', by: string | null = null): void {
    const { hud, state } = this;
    const at = a.position;
    const enemy = a.side === 'enemy';
    this.effects.wreck(at, a.model.getVelocity(this.v2), enemy ? PALETTE.enemyAccent : PALETTE.friendlyAccent, a.role === 'bomber' ? 1.3 : 1, enemy ? PALETTE.enemyPaper : PALETTE.paper);
    if (this.near(at)) this.sounds.play('crumple');
    this.hitAt.delete(a.id);
    const credit = enemy && (byPlayer || a.playerDamage > 0);
    const screen = this.projectOnScreen(this.v3.copy(at));
    // T1's own guns keep score.
    const byBase = !!by && this.base.keyOf(by) !== null;
    if (enemy && byBase) this.base.recordKill(by!, a.role === 'bomber');
    for (const t of this.raidTrackers.values()) if (t.involves(a.id)) t.raiderDown(!byBase && (byPlayer || a.playerDamage > 0));
    if (credit) {
      this.sounds.play('kill');
      if (screen) hud.pop('SHOT DOWN!', 'good', screen);
      this.career.recordAircraftDestroyed(a.role === 'bomber');
      this.alert(a.role, 'Shot down', a.purpose === 'ambient' ? null : AI.roleLabels[a.role], 'good', 2.2);
    } else if (enemy && byBase) {
      if (screen) hud.pop('DOWN!', 'good', screen);
      this.alert('turret', 'T1 got it', null, 'good', 2.2);
    } else if (enemy && screen) {
      hud.pop(cause === 'crash' ? 'CRASHED!' : 'DOWN!', 'info', screen);
    } else if (!enemy) {
      this.alert(a.role, `${a.spec.name} down`, null, 'bad', 2.6);
    }
    const onMission = !!state.mission?.isActive && missionAircraft(state.mission).has(a.id);
    this.events.aircraftDown(a.id, credit, onMission);
    state.aircraftDestroyed(a.id, a.role, credit);
  }

  /** A round or rocket struck an AI aircraft. */
  private onAircraftHit(target: string, shot: { side: Side; source: string; damage: number; kind: 'ink' | 'rocket' }, point: pc.Vec3): void {
    if (shot.kind === 'rocket') this.effects.explosion(point, 0.6);
    else if (shot.side === 'enemy') this.effects.enemyInkHit(point, false);
    else this.effects.inkHit(point, false);
    const { dealt } = this.airTraffic.damage(target, shot.damage, shot.source, false);
    if (dealt > 0 && shot.side === 'player') {
      this.base.recordDamage(shot.source, dealt);
      for (const t of this.raidTrackers.values()) if (t.involves(target)) t.raiderHit(dealt, false);
    }
  }

  /** An AI bomber's bomb landed: did it hit what it was aimed at, and what did the blast catch? */
  private onAiBombImpact(impact: TaggedImpact): void {
    const owner = impact.tag ? this.bombOwners.get(impact.tag) : undefined;
    if (!owner || !impact.tag) return;
    const point = this.v1.set(impact.x, impact.y, impact.z);
    const s = owner.strike;
    const miss = Math.hypot(impact.x - s.x, impact.z - s.z);
    const hostile = owner.side === 'enemy';
    const hit = impact.kind !== 'void' && miss <= s.radius + (hostile ? BOMB.kinds.standard.blastRadius / 2 : 0.3);
    const raid = hostile ? this.airTraffic.raids.find((r) => r.bomber === impact.tag && r.stage !== 'over') : undefined;
    const tracker = raid ? this.raidTrackers.get(raid.id) : undefined;
    if (impact.kind !== 'void') {
      this.effects.bombImpact(point, hit);
      // The blast catches the other side's installations: no credit to the player.
      const kind = BOMB.kinds.standard;
      for (const i of this.defenses.installations) {
        if (!i.alive || i.side === owner.side) continue;
        const distance = Math.min(...i.spec.shapes.map((shape) => distanceToShape(point, shape)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0 && this.damageInstallation(i, damage, this.defenseModels.labelPoint(i.id, this.v2), false) > 0) {
          if (i.side === 'player') tracker?.structureHit(i.spec.name, !i.alive);
        }
      }
      const at = this.projectOnScreen(this.v3.copy(point));
      if (at) this.hud.pop(hit ? 'KABOOM!' : 'SPLAT!', hostile === hit ? 'bad' : 'good', at);
    }
    if (hostile && hit) {
      // A bomb on target destroys a share of the vulnerable paper; the protected reserve is safe.
      const key = tracker?.target.key ?? STORE;
      const lost = this.state.raidHit(raidLoss(this.base.vulnerable(), key === STORE), this.base.protectedPaper, `Raid hit the ${(tracker?.target.name ?? 'paper store').toLowerCase()}`);
      tracker?.hit(lost);
      this.alert('raid', SAY.baseHit, lost > 0 ? `−${lost}` : null, 'bad', 3);
    }
    this.airTraffic.bombLanded(impact.tag, hit);
    if (!hostile) {
      this.state.escortStrike(impact.tag, hit);
      const supply = this.events.about(impact.tag)?.kind === 'supply-run';
      this.events.supplyDropped(impact.tag, hit);
      if (!hit) this.alert(supply ? 'supply' : 'bomber', 'Missed', null, 'bad', 2.2);
    }
  }

  /** Close enough to the camera to hear. */
  private near(p: { x: number; y: number; z: number }): boolean {
    const eye = this.camera.entity.getPosition();
    return Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) < HEARING;
  }

  // ---- Defenses -------------------------------------------------------------------------------

  /**
   * The defenses look for aircraft of the other side and shoot; their rounds and rockets fly; the
   * models follow. Nothing enemy shoots over home, and rockets lose track of a plane that gets there.
   */
  private updateDefenses(dt: number): void {
    const { plane, state, world } = this;
    const flying = state.phase === 'flying';
    const p = plane.position;
    const safe = overHome(world.home, p.x, p.z);
    const targets: Target[] = [];
    if (flying && !safe) {
      const v = plane.getVelocity(this.v2);
      targets.push({ id: PLAYER_ID, side: 'player', x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, signature: plane.spec.signature });
    }
    for (const a of this.airTraffic.aircraft) {
      if (!a.alive) continue;
      const c = a.contact();
      targets.push({ id: c.id, side: c.side, x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz, signature: c.signature });
    }
    const { orders, events } = this.defenses.update(dt, targets);
    for (const order of orders) {
      this.ordnance.spawn(order);
      if (order.target === PLAYER_ID) state.recordIncoming();
      if (order.kind === 'rocket') this.effects.burst(this.v1.set(order.x, order.y, order.z), 'dust');
    }
    for (const event of events) this.onDefenseEvent(event);
    const aircraft: AircraftTarget[] = [];
    if (flying) {
      const q = plane.prevPosition;
      aircraft.push({ id: PLAYER_ID, side: 'player', x: p.x, y: p.y, z: p.z, px: q.x, py: q.y, pz: q.z, radius: plane.spec.hitRadius, shielded: safe });
    }
    for (const a of this.airTraffic.aircraft) {
      if (!a.alive) continue;
      const m = a.model.position;
      const q = a.model.prevPosition;
      aircraft.push({ id: a.id, side: a.side, x: m.x, y: m.y, z: m.z, px: q.x, py: q.y, pz: q.z, radius: a.spec.hitRadius });
    }
    for (const event of this.ordnance.update(dt, aircraft, world.territories)) this.onFire(event);
    // A blip when the territory being approached notices the plane (not every radar on the map).
    const approached = flying ? this.approachedTerritory() : null;
    const spotted = approached !== null && this.defenses.isAware(approached, PLAYER_ID);
    if (spotted && this.warned !== approached) this.sounds.play('spotted');
    this.warned = spotted ? approached : null;
    this.defenseModels.update(dt, flying ? p : null, approached, this.baseMode.open ? world.home.id : null);
    this.ordnanceView.update(dt, this.ordnance, this.camera.entity.getPosition());
    const locking = flying ? this.lockingOnPlayer() : [];
    this.sounds.lockTone(dt, locking.length > 0 ? Math.max(...locking.map((i) => i.lock)) : null);
  }

  /** Launchers locking on to the player's plane. */
  private lockingOnPlayer(): Installation[] {
    return this.defenses.installations.filter((i) => i.state === 'locking' && i.targetId === PLAYER_ID);
  }

  private onDefenseEvent(event: DefenseEvent): void {
    if (this.state.phase !== 'flying' || event.target !== PLAYER_ID) return;
    switch (event.type) {
      case 'launch':
        this.sounds.play('launch');
        break;
      case 'lock-broken':
        this.hud.threatNote('Lock broken', 'good');
        break;
    }
  }

  /** A round or rocket landed: on the plane (damage, from which way), on a platform, or nowhere. */
  private onFire(event: FireEvent): void {
    const point = this.v1.set(event.x, event.y, event.z);
    const rocket = event.shot.kind === 'rocket';
    if (event.type === 'hit') {
      if (event.target !== PLAYER_ID) {
        this.onAircraftHit(event.target, event.shot, point);
        return;
      }
      if (rocket) this.effects.explosion(point, 0.7);
      else this.effects.enemyInkHit(point, false);
      const source = this.defenses.get(event.shot.source);
      const shooter = source ? null : this.airTraffic.get(event.shot.source);
      const by = source ? `${source.spec.name} on ${source.spec.territoryId}` : shooter ? `enemy ${shooter.skill.label.toLowerCase()} ${shooter.spec.name}` : null;
      const { dealt } = this.state.damageAircraft(event.shot.damage, rocket ? 'blast' : 'projectile', by);
      if (dealt > 0) {
        this.sounds.play('hit');
        const from = source ? source.spec : shooter?.position;
        if (from) this.hud.damageDirection(this.bearing(from.x, from.z), dealt);
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

  /**
   * Damages a defense, with numbers, effects, the collapse and the bookkeeping. Returns the damage
   * dealt. Without `credit` (an AI bomber's bomb) it counts for nobody, and only shows if it collapses.
   */
  private damageInstallation(i: Installation, amount: number, at: pc.Vec3, credit = true): number {
    const { dealt, destroyed } = i.damage(Math.round(amount));
    if (dealt <= 0) return 0;
    if (!credit) {
      if (destroyed) {
        this.effects.explosion(this.defenseModels.centre(i.id, this.v3), 1.1, 'wreck');
        if (i.side === 'player') {
          this.sounds.play('collapse');
          const key = this.base.keyOf(i.id);
          const kind = key ? (this.base.at(key)?.kind ?? null) : null;
          this.alert(kind ? BUILDING_ICONS[kind] : 'store', kind ? `${BASE.buildings[kind].short} wrecked` : 'Store wrecked', null, 'bad', 3);
        }
      }
      return dealt;
    }
    const screen = this.projectOnScreen(this.v3.copy(at));
    if (screen) this.hud.damageNumber(dealt, screen, destroyed);
    if (destroyed) {
      const centre = this.defenseModels.centre(i.id, this.v3);
      this.effects.explosion(centre, 1.1, 'wreck');
      this.sounds.play('collapse');
      const p = this.projectOnScreen(centre);
      const word = { turret: 'TURRET DOWN!', launcher: 'LAUNCHER DOWN!', radar: 'RADAR DOWN!', supply: 'DEPOT BURNS!', workshop: 'WORKSHOP DOWN!', storage: 'BOX DOWN!' }[i.spec.kind];
      if (p) this.hud.pop(word, 'good', p);
      const t = i.spec.territoryId;
      const left = this.defenses.on(t).filter((x) => x.isWeapon && x.alive).length;
      this.alert(KIND_ICONS[i.spec.kind], 'Destroyed', i.isWeapon ? `${left} left` : null, 'good', 2.2);
    }
    this.state.recordDamage(dealt, destroyed ? i.id : null, true, i.spec.kind === 'turret');
    if (destroyed && i.side === 'enemy') {
      const t = i.spec.territoryId;
      this.events.recordDestroyed(i.id, t, this.defenses.on(t).filter((x) => x.isWeapon && x.alive).length);
    }
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
        if (!installation.alive || installation.side !== 'enemy') continue;
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
      if (!this.ordnance.shootDown(impact.id)) return;
      this.state.recordShotHit();
      this.effects.explosion(point, 0.45);
      this.sounds.play('pop');
      this.hud.hitMarker(true);
      const at = this.projectOnScreen(point);
      if (at) this.hud.pop('POP!', 'good', at);
      return;
    }
    const ai = this.airTraffic.get(impact.id);
    if (ai) {
      this.state.recordShotHit();
      const { dealt, destroyed } = this.airTraffic.damage(ai.id, impact.damage, PLAYER_ID, true);
      if (dealt <= 0) return;
      this.state.recordDamage(dealt, null);
      for (const t of this.raidTrackers.values()) if (t.involves(ai.id)) t.raiderHit(dealt, true);
      this.hitAt.set(ai.id, performance.now());
      const at = this.projectOnScreen(point);
      if (at) this.hud.damageNumber(dealt, at, destroyed);
      this.hud.hitMarker(destroyed);
      return;
    }
    const installation = this.defenses.get(impact.id);
    if (installation?.side === 'player') return; // the player's own guns and stores shrug it off
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
    if (destroyed) {
      const mission = this.state.mission;
      const onMission = !!mission?.isActive && mission.objectives.some((o) => o.kind === 'destroy' && o.targets.includes(target.id));
      this.events.targetDestroyed(target.id, true, onMission);
    }
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

  // ---- Wiring ---------------------------------------------------------------------------------

  /** Every action from the keyboard, mouse or controller (see src/input/Controls.ts). */
  private onAction(action: Action, device: Device): void {
    const { state } = this;
    // Browsers only allow sound after a key press or click.
    this.sounds.unlock();
    if (this.welcome && action !== 'dev') {
      this.dismissWelcome();
      if (action === 'confirm' || action === 'back' || action === 'pause') return;
    }
    switch (action) {
      case 'sound':
        return this.toggleSound();
      case 'dev':
        this.dev.toggle();
        this.requestSave();
        return;
      case 'logbook':
        return this.toggleLogbook();
      case 'back':
      case 'pause':
        if (this.logbook.open) return this.toggleLogbook(false);
        if (action === 'back' && this.baseMode.open && !this.paused) return this.toggleBase(false);
        // The controller's B only backs out of things; pausing is its Menu button.
        if (action === 'back' && device === 'gamepad' && !this.paused) return;
        if (action === 'back' && performance.now() - this.lastAutoPause < ESC_AFTER_UNLOCK_MS) return;
        if (this.paused) this.resume();
        else this.pause();
        return;
    }
    if (this.paused || this.logbook.open) return;
    if (action === 'base') return this.toggleBase();
    if (this.baseMode.open) {
      // Base management: number keys pick slots (0 the store), Enter builds, U upgrades, R repairs, X removes.
      const slot = PICK_TO_SLOT[action];
      if (slot !== undefined) {
        const id = slot === 0 ? STORE : BASE.slots[slot - 1]?.id;
        if (id) this.baseAction('select', id);
      } else if (action === 'confirm') this.baseAction('build');
      else if (action === 'upgrade') this.baseAction('upgrade');
      else if (action === 'service') this.baseAction('repair');
      else if (action === 'swap' || action === 'remove') this.baseAction('remove');
      else if (action === 'launch' && (state.phase === 'ready' || state.phase === 'landed')) {
        this.toggleBase(false);
        if (state.phase === 'landed') this.takeOff();
        else this.launch();
      }
      return;
    }
    const card = PICK_TO_CARD[action];
    if (card !== undefined) return this.select(card);
    switch (action) {
      case 'prevMission':
      case 'nextMission': {
        const n = state.offers.length;
        if (n > 0 && state.phase !== 'flying') this.select((state.selected + (action === 'nextMission' ? 1 : -1) + n) % n);
        return;
      }
      case 'swap':
        return this.swapCard();
      case 'prevAircraft':
        return this.cycleAircraft(-1);
      case 'nextAircraft':
        return this.cycleAircraft(1);
      case 'fold':
        return this.build();
      case 'launch':
        if (state.phase === 'landed') this.takeOff();
        else this.launch();
        return;
      case 'service':
        if (state.phase === 'landed') this.rearm();
        else if (state.phase === 'flying') this.alert('home', 'Rearm at T1', null, 'info', 1.6);
        return;
      case 'fireSecondary':
        if (state.phase === 'flying') this.dropBomb();
        return;
      case 'confirm':
        if (device === 'gamepad') return this.padConfirm();
        if (state.phase === 'landed') this.endSortie();
        else this.continueToDesk();
        return;
    }
  }

  /** The controller's A with nothing highlighted: the next step of the sortie. */
  private padConfirm(): void {
    switch (this.state.phase) {
      case 'desk':
        return this.build();
      case 'ready':
        return this.launch();
      case 'landed':
        return this.takeOff();
      case 'debrief':
      case 'crashed':
        return this.continueToDesk();
    }
  }

  private bindEvents(): void {
    const { input, hud, state } = this;

    this.controls.onAction((action, device) => this.onAction(action, device));
    input.onCanvasClick(() => this.sounds.unlock());
    this.controls.onPad((e) => {
      if (e.kind === 'connected') {
        this.alert('plane', 'Controller connected', null, 'info', 2);
        return;
      }
      this.alert('warn', 'Controller disconnected', null, 'warn', 2.6);
      // Losing the controller mid-flight pauses, rather than leaving the plane unattended.
      if (state.phase === 'flying' && !this.paused && this.controls.device === 'gamepad') this.pause();
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
      if (source !== 'income' && source !== 'restore') hud.paperDelta(delta);
      if (source !== 'restore' && source !== 'reset') this.progress.paper(delta, source === 'spend');
      if (source !== 'income') this.requestSave();
    });
    // Earnings that didn't fit: the store is full.
    this.resources.onOverflow((lost, source) => {
      if (source === 'income') return;
      this.alert('capacity', SAY.storageFull, `−${lost}`, 'warn', 3);
      this.tip('storage', 'Storage full: paper beyond capacity is lost. Spend it, or build storage boxes.', ['B']);
    });
    this.base.onEvent((e) => this.onBaseEvent(e));
    state.onEvent((event) => {
      const step = tutorialEventFor(event.type);
      if (step) this.tutorial.note(step);
      if (event.type === 'built') this.lostPlane = null;
      if (event.type === 'crashed' && state.plane && !state.emergency) this.lostPlane = state.plane.id;
      switch (event.type) {
        case 'aircraft-selected':
          this.career.rememberAircraft(event.aircraft);
          this.refreshPad();
          this.requestSave();
          break;
        case 'stowed':
          this.alert('home', `${AIRCRAFT[event.aircraft].name} stowed`, null, 'info', 1.8);
          break;
        case 'build-refused':
          if (event.reason === 'incompatible') {
            this.alert('wrecked', 'Wrong plane', null, 'bad', 2.4);
            this.tip('unsuitable', `${event.detail}. Switch plane with Q / E, or pick another card.`, ['Q', 'E']);
          } else {
            this.alert('paper', 'Need paper', `−${Math.max(0, event.cost - this.resources.paper)}`, 'bad', 2);
          }
          break;
        case 'launch-refused':
          this.alert('wrecked', 'Wrong plane', null, 'bad', 2.4);
          break;
        case 'ready':
          this.effects.burst(this.plane.position, 'fold');
          break;
        case 'launched': {
          this.sortiesFlown++;
          this.sortiesTotal++;
          this.dismissWelcome();
          const mission = state.mission!;
          this.director.accepted(mission);
          const offer = this.director.offerFor(mission);
          if (offer?.eventId) {
            // Flying an event's card: it won't expire under the player, and a raid pays through the mission.
            this.events.bound = offer.eventId;
            const raidId = this.events.get(offer.eventId)?.raidId;
            const raid = this.airTraffic.raids.find((r) => r.id === raidId);
            if (raid) raid.mission = true;
          }
          this.airTraffic.startMission(mission.spec.aircraft ?? []);
          this.career.recordSortie(state.plane!.id);
          this.alert(MISSION_ICONS[mission.spec.type], 'Go', null, 'info', 1.4);
          if (this.tutorial.finished)
            this.tip(
            'flight',
            this.controls.device === 'gamepad'
              ? 'Left stick steers, right stick looks around. Hold RT for ink, LT drops a bomb, RB boosts.'
              : 'Mouse steers. Hold left click for ink, right click drops a bomb. Shift boosts.',
            ['LMB', 'RMB', 'Shift'],
          );
          this.requestSave();
          break;
        }
        case 'sortie-ended':
          this.sortieOver(true);
          break;
        case 'out-of-ammo':
          this.alert('ink', 'Out of ink', null, 'bad', 2.2);
          break;
        case 'range-exhausted':
          this.alert('range', SAY.gliding, null, 'bad', 3);
          break;
        case 'damaged':
          hud.damageFlash(event.amount);
          break;
        case 'target-destroyed':
          this.career.recordTargetDestroyed(event.defense);
          break;
        case 'bomb-missed':
          if (event.tooHigh) {
            this.alert('altitude', 'Too high', null, 'bad', 2.4);
          } else if (event.remaining > 0 || state.bombsFalling > 0) {
            this.alert('bombload', 'Missed', `${event.remaining} left`, 'bad', 2);
          }
          break;
        case 'approach-blown': {
          // Pulling up after a clean release is fine: that bomb still counts.
          if (state.bombsFalling > 0) break;
          const o = state.mission?.objectives[event.index];
          const ceiling = o?.kind === 'bomb' && o.approach ? o.approach.ceiling : 0;
          this.alert('altitude', 'Run blown', `<${ceiling} m`, 'bad', 2.4);
          break;
        }
        case 'objective-complete':
          this.onObjectiveComplete(event.objective, event.index);
          break;
        case 'mission-succeeded':
          this.airTraffic.endMission();
          this.career.recordMissionCompleted();
          if (state.phase === 'landed') break; // the touchdown banner reports it
          this.alert('ok', 'Complete', `+${event.reward}`, 'good', 3);
          if (state.phase === 'flying') this.tip('recover', 'Land on T1 to keep your plane: a refit is much cheaper than a new one.');
          break;
        case 'mission-failed':
          this.airTraffic.endMission();
          if (event.reason === 'missed') this.alert('bombload', 'Out of bombs', null, 'bad', 3);
          else if (event.reason === 'out-of-time') this.alert('clock', 'Out of time', null, 'bad', 3);
          else if (event.reason === 'target-escaped') this.alert('escape', 'It got away', null, 'bad', 3);
          else if (event.reason === 'target-bombed') this.alert('bomb', 'Too late', null, 'bad', 3);
          else if (event.reason === 'escort-lost') this.alert('bomber', 'Bomber lost', null, 'bad', 3);
          break;
        case 'crashed':
          this.onCrashed(event.cause);
          this.sortieOver(false);
          break;
        case 'landed': {
          const mission = state.mission;
          if (mission?.status === 'succeeded' && mission.objectives.some((o) => o.kind === 'land')) {
            this.alert('ok', 'Complete', `+${mission.reward}`, 'good', 3);
          } else {
            this.alert('land', 'Touchdown', null, 'good', 2);
          }
          break;
        }
        case 'rearmed':
          this.alert('rearm', 'Rearmed', null, 'good', 1.8);
          break;
        case 'paper-reset':
          this.alert('paper', 'Paper reset', String(this.resources.paper), 'info', 1.6);
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
      this.alert('land', 'Hard landing', null, 'bad', 3.5);
      this.tip('hard-landing', `${hardLandingReason(plane.lastTouchdown ?? assessTouchdown(plane.touchdownState()))} Slow, gentle, wings level.`);
    } else if (cause === 'shot-down') {
      const by = this.state.sortie?.killedBy;
      this.alert('crumple', 'Shot down', null, 'bad', 3.5);
      void by;
    } else if (cause === 'void') {
      this.alert('crumple', 'Lost', null, 'bad', 3.5);
    } else {
      this.alert('crumple', 'Crumpled', null, 'bad', 3.5);
    }
  }

  private onObjectiveComplete(objective: Objective, _index: number): void {
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
      this.alert('bomb', 'Hit', left > 0 ? `${left} left` : null, 'good', 2.2);
    } else if (objective.kind === 'recon') {
      const next = mission.objectives[mission.openObjectives()[0]];
      this.alert('recon', 'Scouted', next?.kind === 'escape' ? `${next.distance} m out` : null, 'good', 2.2);
    } else if (objective.kind === 'reach') {
      this.alert('reach', 'Delivered', null, 'good', 2);
    } else if (objective.kind === 'destroy' && objective.what !== 'practice') {
      this.alert('ok', 'Done', null, 'good', 2);
    }
  }

  // ---- HUD view -------------------------------------------------------------------------------

  private view(): HudView {
    const { plane, world, state, resources, base } = this;
    const flying = state.phase === 'flying';
    const choosing = state.phase === 'desk' || state.phase === 'building' || state.phase === 'ready';
    const mission = choosing ? state.selectedMission : state.mission;
    const baseOpen = this.baseMode.open;

    let nose: ScreenPoint | null = null;
    let aim: ScreenPoint | null = null;
    if (flying) {
      nose = this.projectOnScreen(plane.getForward(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
      aim = this.projectOnScreen(plane.getAimDirection(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
    }

    const from = choosing ? world.launchPosition : plane.position;
    const goal = this.currentGoal(mission, from);
    let target: TargetIndicator | null = null;
    // An aircraft carries its own marker (and edge chevron): no second label on top of it.
    if (goal && !(goal.targetId && this.airTraffic.get(goal.targetId))) {
      const distance = goal.solid
        ? this.v2.copy(goal.point).sub(from).length()
        : Math.hypot(goal.point.x - from.x, goal.point.z - from.z);
      target = {
        ...this.indicator(goal.point),
        label: goal.label,
        distance,
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
      if (p) labels.push({ id: t.id, role: t.isHome ? 'home' : objectiveTerritories.get(t.id) === false ? 'objective' : 'neutral', state: this.events.stateOf(t.id), x: p.x, y: p.y });
    }

    const kind = state.phase === 'desk' ? state.buildKindFor(state.aircraft) : state.buildKind;
    const name = (state.plane ?? state.chosen).name;
    const buildCost = state.buildCost;
    let note: string | null = null;
    let tag: string | null = null;
    let noteTone: 'bad' | 'info' = 'info';
    const fit = state.phase === 'desk' || state.phase === 'ready' ? state.suitability(state.plane?.id ?? state.aircraft) : null;
    if (fit?.level === 'unsuitable') {
      noteTone = 'bad';
      tag = '✗';
      note = `The ${name} can't fly this mission: ${fit.reason}. Choose another plane (Q/E) or mission.`;
    } else if (state.phase === 'desk' && state.emergencyAvailable()) {
      const fit = state.suitability(state.aircraft);
      noteTone = 'bad';
      tag = 'Scrap';
      note = `You can't afford any plane: a free emergency Swift has half the ink, no bomb, for one sortie.${fit.level === 'unsuitable' || state.selectedMission.spec.bombs > 0 ? ' Pick a mission without bombs for it.' : ''}`;
    } else if (state.phase === 'desk' && !resources.canAfford(buildCost)) {
      const wait = state.income.timeToAfford(resources.paper, buildCost);
      noteTone = 'bad';
      tag = `−${buildCost - resources.paper}`;
      note = `Need ${buildCost} paper, you have ${resources.paper}.${wait !== null ? ` Ready in about ${Math.ceil(wait)} s.` : ' Fly a mission to earn more.'}`;
    }

    const landing = this.onApproach()
      ? (() => {
          const s = plane.touchdownState();
          if (!this.tipsSeen.has('landing')) this.tip('landing', 'Landing on T1: slow, gentle descent, wings level. The checks turn green.');
          return { speed: s.speed, sink: s.sink, rollDeg: (s.roll * 180) / Math.PI, check: assessTouchdown(s) };
        })()
      : null;

    // First-time tips: the desk, and each kind of objective the first time it comes up.
    if (choosing && !this.welcome && !baseOpen && !this.paused && this.tutorial.finished) this.tip('desk', 'Pick a card, pick a plane, fold it, launch. B opens your base.', ['1', 'Q', 'F', 'Space']);
    if (flying && mission?.isActive && !this.paused) {
      const next = mission.objectives[mission.openObjectives()[0]];
      if (next && !this.tipsSeen.has(`obj-${next.kind}`)) {
        const hint = this.trackerHint(mission, state.phase);
        if (hint) this.tip(`obj-${next.kind}`, hint);
      }
    }

    const tutorialContext = { phase: state.phase, bombs: state.bombsLoaded > 0 || state.bombsFalling > 0, baseOpen };
    this.tutorial.update(tutorialContext);
    const f = plane.flight;
    const income = state.income;
    return {
      phase: state.phase,
      paused: this.paused,
      baseMode: baseOpen,
      hints: this.showHints,
      economy: {
        paper: resources.paper,
        capacity: base.capacity,
        rate: income.ratePerMinute(resources.paper),
        state: income.stateFor(resources.paper),
        progress: income.progressFor(resources.paper),
        protectedPaper: base.protectedPaper,
        streak: this.progress.data.streak.current,
        repairs: base.needsRepair.length,
      },
      desk: {
        cost: buildCost, kind, name, note, tag, noteTone, progress: state.buildProgress,
        emergency: state.emergencyAvailable() && !resources.canAfford(buildCost),
        canBuild: state.canBuild() || (state.emergencyAvailable() && state.suitability(state.aircraft).level !== 'unsuitable' && state.selectedMission.spec.bombs === 0),
      },
      swaps: this.director.swaps,
      welcome: this.welcome && choosing ? { restored: this.welcome.restored, paper: resources.paper, session: this.welcome.session ? sessionView(this.welcome.session) : null, problems: this.welcome.problems.length } : null,
      menu: {
        session: sessionView(this.progress.session),
        settings: {
          muted: this.sounds.muted,
          hints: this.hints,
          uiScale: this.uiScale,
          graphics: {
            preset: matchesPreset(this.graphics) ? this.graphics.preset : null,
            outlines: outlineChoice(this.graphics),
            intensity: this.graphics.outlineIntensity,
          },
        },
        saveNote: this.saveNote(),
        confirmingReset: this.confirming?.what === 'reset' && performance.now() < this.confirming.until,
      },
      garage: choosing && !baseOpen ? this.garageView() : null,
      cards: choosing ? state.offers.map((m) => this.cardView(m)) : null,
      selected: state.selected,
      tracker: !choosing && mission && !baseOpen ? this.tracker(mission, from) : null,
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
      pointerLocked: this.input.pointerLocked || this.controls.padFlying,
      nose,
      aim,
      target,
      labels,
      targets: flying || (state.phase === 'landed' && !baseOpen) ? this.targetLabels(mission, target?.onScreen ? goal?.targetId ?? null : null) : [],
      minimap: this.minimapView(mission, goal?.point ?? null),
      threat: flying ? this.threatView() : null,
      air: this.airView(flying, aim),
      raid: this.raidAlert(),
      base: baseOpen
        ? this.baseMode.view(
            (x, z) => this.projectOnScreen(this.v3.set(x, 1.2, z)),
            state.phase === 'ready' || state.phase === 'landed',
            this.lastRaid,
          )
        : null,
      tutorial: this.tutorial.view(tutorialContext),
      dashboard: choosing && !baseOpen ? this.dashboardView(buildCost, kind) : null,
    };
  }

  /** The home dashboard at the desk. */
  private dashboardView(buildCost: number, kind: BuildKind): DashboardView {
    const { state, resources } = this;
    const mission = state.selectedMission;
    return dashboardView({
      paper: resources.paper,
      rate: state.income.ratePerMinute(resources.paper),
      base: this.base,
      hangar: state.hangar,
      mission: mission ? { title: mission.title, reward: mission.reward, bombs: mission.spec.bombs } : null,
      plane: { id: state.aircraft, fit: state.suitability(state.aircraft).level, cost: buildCost, kind, canBuild: state.canBuild() },
      lostPlane: this.lostPlane,
      onPad: state.phase !== 'desk',
      raidInbound: this.airTraffic.raids.some((r) => r.stage !== 'over' && r.detected),
      emergency: state.emergencyAvailable() && !resources.canAfford(buildCost),
    });
  }

  /** One mission card: its slot, tier, modifiers, reward breakdown, operation or event. */
  private cardView(m: Mission): MissionCardView {
    const { state, director } = this;
    const offer = director.offerFor(m);
    const tier = TIERS[m.tier];
    const parts = m.spec.rewardParts;
    const op = offer?.operationId && director.operation?.id === offer.operationId ? director.operation : null;
    const event = offer?.eventId ? this.events.get(offer.eventId) : undefined;
    const slot = offer?.slot ?? 'safe';
    return {
      type: m.spec.type,
      codename: m.spec.codename ?? '',
      title: m.title,
      description: m.spec.description,
      slot,
      slotLabel: op ? 'Operation' : offer?.source === 'recovery' ? 'Recovery' : offer?.source === 'forced' ? 'Forced' : event ? (event.kind === 'raid' ? 'Emergency' : 'World event') : SLOT_LABELS[slot],
      tier: m.tier,
      tierLabel: tier.label,
      stars: tier.stars,
      multiplier: tier.multiplier,
      reward: m.reward,
      rewardNote: parts
        ? `Reward = B ${Math.round(parts.base)} × D ${parts.difficulty} × M ${parts.modifier.toFixed(2)}${parts.floor ? ` (at least ${parts.floor})` : ''}`
        : '',
      modifiers: (m.spec.modifiers ?? []).map((id) => ({ id, label: DIRECTOR.modifiers[id].label, detail: DIRECTOR.modifiers[id].detail })),
      recommended: slot !== 'event' && m.tier === director.performance.recommendedTier && state.offers.find((x) => x.tier === m.tier) === m,
      expires: event?.timeLeft ?? null,
      operation: op
        ? {
            codename: op.codename,
            territoryId: op.territoryId,
            stage: offer!.stage ?? 0,
            stages: op.stages.map((st) => ({ label: st.label, status: st.status, optional: OPTIONAL_LABELS[st.optional.kind], met: st.optional.met, skipped: !!st.skipped })),
            bonus: op.bonus,
            earned: op.earned,
            remaining: remainingRewards(op),
            active: op.status === 'active',
            confirming: this.confirming?.what === 'abandon' && performance.now() < this.confirming.until,
          }
        : null,
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
  }

  /** Where the game is saved, and when it last was. */
  private saveNote(): string {
    const where = { indexeddb: 'this browser (IndexedDB)', localstorage: 'this browser (local storage)', memory: 'memory only: storage is blocked' }[this.saves.store.kind];
    const ago = this.saves.lastSaved ? Math.round((Date.now() - this.saves.lastSaved) / 1000) : null;
    return `Progress is saved in ${where}${ago !== null ? `, last ${ago < 5 ? 'just now' : `${ago} s ago`}` : ''}.`;
  }

  /** The logbook's contents. */
  private logbookView(): LogbookView {
    const favorite = this.career.favorite;
    const base = this.base;
    return {
      career: {
        missionsCompleted: this.career.data.missionsCompleted,
        planesLost: this.career.data.planesLost,
        targetsDestroyed: this.career.data.targetsDestroyed,
        defensesDestroyed: this.career.data.defensesDestroyed,
        aircraftDestroyed: this.career.data.aircraftDestroyed,
        favorite: favorite ? AIRCRAFT[favorite].name : null,
      },
      base: {
        stats: base.stats,
        production: base.production,
        capacity: base.capacity,
        protectedPaper: base.protectedPaper,
        buildings: [...base.buildings.values()].map((b) => ({
          name: BASE.buildings[b.kind].name, icon: BUILDING_ICONS[b.kind], level: b.level, status: base.status(b.slot), kills: b.kills, bombers: b.bombers, damage: b.damage,
        })),
      },
      progress: this.progress.data,
      session: sessionView(this.progress.session),
      ledger: this.ledger,
      performance: this.director.performance.breakdown,
      skill: this.director.performance.skill,
      band: skillBand(this.director.performance.skill),
      recommended: TIERS[this.director.performance.recommendedTier].label,
    };
  }

  /**
   * The air war on screen: markers on nearby aircraft (with edge chevrons for those off screen),
   * the lead sight for the enemy nearest the nose, and the incoming-bomber alert.
   */
  private airView(flying: boolean, aim: ScreenPoint | null): AirView {
    const { plane, state } = this;
    const markers: AircraftMarkerView[] = [];
    let lead: ScreenPoint | null = null;
    if (flying) {
      const p = plane.position;
      const wanted = state.mission?.isActive ? missionAircraft(state.mission) : new Set<string>();
      const now = performance.now();
      const gun = state.plane?.gun ?? plane.spec.gun;
      const fwd = plane.getForward(new pc.Vec3());
      let leadTarget: AiAircraft | null = null;
      let leadAngle = 0.5;
      for (const a of this.airTraffic.aircraft) {
        if (!a.alive) continue;
        const d = a.position.distance(p);
        const raider = this.airTraffic.raids.some((r) => r.bomber === a.id && r.stage !== 'over');
        const important = wanted.has(a.id) || raider || a.side === 'player' || this.events.about(a.id)?.aircraft[0] === a.id;
        if (d > AIRCRAFT_MARKER_RANGE && !important) continue;
        const at = this.indicator(new pc.Vec3().copy(a.position));
        if (!at.onScreen && d > AIRCRAFT_EDGE_RANGE && !important) continue;
        const aimedAt = !!aim && at.onScreen && Math.hypot(aim.x - at.x, aim.y - at.y) < 70;
        const recentlyHit = now - (this.hitAt.get(a.id) ?? -Infinity) < 3000;
        const attacking = a.side === 'enemy' && a.attacking && (a.targetId === PLAYER_ID || !!(a.targetId && state.mission?.escorting(a.targetId)));
        markers.push({
          id: a.id, x: at.x, y: at.y, onScreen: at.onScreen, angle: at.angle,
          side: a.side, icon: a.role, name: `${a.side === 'enemy' ? 'Enemy' : 'Your'} ${a.spec.name}`, detail: this.aircraftDetail(a),
          status: attacking ? 'attacking' : a.state === 'bomb-run' ? 'bombing' : a.role === 'scout' && a.state === 'evade' ? 'running' : a.leaving || a.state === 'disengage' ? 'leaving' : null,
          distance: d, health: a.durability.fraction, showHealth: recentlyHit || aimedAt || d < 45 || wanted.has(a.id) || raider,
          far: clamp((d - 40) / 160, 0, 1), mission: wanted.has(a.id) || raider || this.events.about(a.id)?.aircraft[0] === a.id, attacking: a.side === 'enemy' && a.attacking && a.targetId === PLAYER_ID,
          compact: false,
        });
        if (a.side !== 'enemy' || d > gun.range * 1.1) continue;
        const angle = Math.acos(clamp(((a.position.x - p.x) * fwd.x + (a.position.y - p.y) * fwd.y + (a.position.z - p.z) * fwd.z) / (d || 1), -1, 1));
        if (angle < leadAngle) {
          leadAngle = angle;
          leadTarget = a;
        }
      }
      if (leadTarget) {
        const t = leadTarget.contact();
        const point = leadPoint(p, plane.getVelocity(new pc.Vec3()), t, { x: t.vx, y: t.vy, z: t.vz }, gun.speed, 1);
        lead = this.projectOnScreen(new pc.Vec3(point.x, point.y, point.z));
      }
    }
    // Crowded markers: the most important ones keep their tags, the rest shrink to brackets.
    const rank = (m: AircraftMarkerView) => (m.attacking ? 0 : m.mission ? 1 : 2) * 1000 + m.distance;
    const placed: AircraftMarkerView[] = [];
    for (const m of [...markers].sort((a, b) => rank(a) - rank(b))) {
      if (!m.onScreen) continue;
      m.compact = placed.some((o) => Math.abs(o.x - m.x) < 130 && Math.abs(o.y - m.y) < 64);
      if (!m.compact) placed.push(m);
    }
    return { markers, lead };
  }

  /** What an aircraft's marker says it is doing. */
  private aircraftDetail(a: AiAircraft): string {
    const raid = this.airTraffic.raids.find((r) => r.bomber === a.id && r.stage === 'inbound');
    const event = this.events.about(a.id);
    if (event?.aircraft[0] === a.id) {
      if (event.kind === 'convoy') return a.attacking ? 'Convoy · firing!' : `Enemy convoy · bounty +${EVENTS.bounty.convoy}`;
      if (event.kind === 'supply-run') return a.state === 'bomb-run' ? 'Dropping supplies!' : `Supply run to ${this.world.home.id}`;
    }
    if (a.side === 'player') return a.state === 'bomb-run' ? 'Bombing run!' : a.leaving ? 'Heading home' : `Escort it to ${a.orders.strike?.territoryId ?? 'its target'}`;
    if (a.attacking && a.targetId === PLAYER_ID) return 'Attacking you!';
    if (a.attacking && a.targetId && this.state.mission?.escorting(a.targetId)) return 'Attacking your bomber!';
    if (raid) return a.state === 'bomb-run' ? 'Bombing run!' : `Raider · ETA ${Math.ceil(raid.eta)} s`;
    if (a.role === 'scout' && (a.state === 'evade' || (a.leaving && a.purpose === 'mission'))) return 'Running!';
    if (a.state === 'disengage') return 'Breaking off';
    if (a.leaving) return 'Heading home';
    return `${AI.roleLabels[a.role]} · ${a.skill.label}`;
  }

  /**
   * The early-warning alert for the most urgent raid T1 knows about: where it comes from, how long
   * until it gets there, what it is after, how many guns are ready, and what to do.
   */
  private raidAlert(): RaidAlertView | null {
    const raids = this.airTraffic.raids.filter((r) => r.stage !== 'over' && r.detected);
    if (raids.length === 0) return null;
    const raid = raids.reduce((a, b) => (b.eta < a.eta ? b : a));
    const bomber = this.airTraffic.get(raid.bomber);
    const home = this.world.home;
    const tracker = this.raidTrackers.get(raid.id);
    const key = tracker?.target.key ?? STORE;
    const kind = key === STORE ? 'store' : (this.base.at(key)?.kind ?? 'store');
    const r = this.base.readiness;
    const { phase } = this.state;
    const response =
      phase === 'flying' ? null
      : phase === 'landed' ? { key: 'Space', label: SAY.takeOff }
      : phase === 'ready' ? { key: 'Space', label: SAY.launch }
      : phase === 'desk' ? { key: 'F', label: 'Fold' }
      : null;
    const mission = this.state.mission;
    return {
      state: raid.stage === 'released' ? 'released' : 'inbound',
      direction: bomber ? compass(bomber.position.x - home.x, bomber.position.z - home.z) : '?',
      eta: raid.eta,
      target: tracker?.target.name ?? 'Paper store',
      targetIcon: BUILDING_ICONS[kind],
      ready: r.ready,
      total: r.total,
      escorted: raid.escorts.length > 0,
      distance: this.state.phase === 'flying' && bomber ? bomber.position.distance(this.plane.position) : null,
      reward: raid.mission && mission ? mission.reward : RAIDS.reward,
      mission: raid.mission,
      response,
    };
  }

  /** The danger on a mission card or in the tracker. */
  private threatSummary(m: Mission): ThreatSummary {
    const t = m.spec.threat;
    const air = t?.air ? airList(t.air) : null;
    const airIcons: IconName[] = t?.air ? [...(t.air.fighters ? ['fighter' as const] : []), ...(t.air.scouts ? ['scout' as const] : []), ...(t.air.bombers ? ['bomber' as const] : [])] : [];
    if (t?.air && t.level === 0) {
      // Nothing on the ground: the danger is in the air, as strong as its pilots.
      const level = ({ easy: 1, medium: 2, hard: 3 } as const)[t.air.skill];
      return { level, label: 'Air threat', detail: `No ground defenses · ${air}`, icons: airIcons };
    }
    if (!t || t.level === 0) {
      return { level: 0, label: THREAT.levels[0].label, detail: m.spec.type === 'rings' ? 'Course clear of defenses' : 'No known defenses', icons: [] };
    }
    const parts: string[] = [];
    if (t.turrets || t.launchers) parts.push(defenseList(t.turrets, t.launchers));
    if (t.radars) parts.push(t.radars === 1 ? 'radar' : `${t.radars} radars`);
    const where = m.spec.type === 'rings' ? `Course passes ${t.territories.join(', ')}` : t.territories.join(' + ');
    if (air) parts.push(air);
    const icons: IconName[] = [...(t.turrets ? ['turret' as const] : []), ...(t.launchers ? ['launcher' as const] : []), ...(t.radars ? ['radar' as const] : []), ...airIcons];
    return { level: t.level, label: THREAT.levels[t.level].label, detail: `${where}: ${parts.join(' · ')}`, icons };
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
      const engaged = weapons.some((w) => w.alive && w.targetId === PLAYER_ID && (w.state === 'firing' || w.state === 'locking'));
      panel = {
        territoryId: t.id,
        level: t.threat,
        label: THREAT.levels[t.threat].label,
        status: weapons.every((w) => !w.alive) ? 'neutralised' : engaged ? 'engaged' : defenses.isAware(t.id, PLAYER_ID) ? 'spotted' : 'clear',
        installations: all.map((i) => ({ id: i.id, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.engaged })),
      };
    }

    // On the ring: weapons shooting or locking on, and those following the plane that it is about to fly into.
    const ring: ThreatRingItem[] = [];
    for (const i of defenses.engagedWith(PLAYER_ID)) {
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
    // Enemy fighters coming for the plane.
    for (const a of this.airTraffic.aircraft) {
      if (a.side !== 'enemy' || a.targetId !== PLAYER_ID || !a.attacking) continue;
      const d = a.position.distance(p);
      ring.push({ id: a.id, angle: this.bearing(a.position.x, a.position.z), icon: a.role, state: d < a.spec.gun.range ? 'firing' : 'tracking', distance: d });
    }
    let nearest = Infinity;
    let rockets = 0;
    for (const shot of this.ordnance.shots) {
      if (shot.kind !== 'rocket') continue;
      const d = Math.hypot(shot.x - p.x, shot.y - p.y, shot.z - p.z);
      if (d > ROCKET_WARNING_RANGE) continue;
      rockets++;
      nearest = Math.min(nearest, d);
      ring.push({ id: `rocket-${shot.id}`, angle: this.bearing(shot.x, shot.z), icon: 'rocket', state: 'incoming', distance: d });
    }
    const locking = this.lockingOnPlayer();
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
          { icon: 'ink', value: String(chosen.gun.ammo), label: `${chosen.gunLabel} · ink` },
          { icon: 'bombload', value: String(chosen.bombs.capacity), label: bombKind.label + (chosen.bombs.capacity === 1 ? '' : 's') },
          { icon: 'health', value: String(chosen.maxHealth), label: 'Health' },
          { icon: 'range', value: `${(chosen.range / 1000).toFixed(1)} km`, label: 'Range' },
        ],
        record: (() => {
          const m = this.progress.data.mastery[chosen.id];
          if (!m || m.flights === 0) return null;
          const acc = chosen.bombs.capacity > 1 && m.bombsDropped > 0 ? `${Math.round((m.bombHits / m.bombsDropped) * 100)}% bombs on target` : m.shotsFired > 0 ? `${Math.round((m.shotsHit / m.shotsFired) * 100)}% ink on target` : '';
          return `Your record: ${m.flights} flight${m.flights === 1 ? '' : 's'} · ${m.missions} done${acc ? ` · ${acc}` : ''}`;
        })(),
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
    return {
      stopped: this.rolledToStop,
      rearming: state.rearmProgress,
      canRearm: state.canRearm(),
      status: mission?.status ?? null,
      reward: mission?.reward ?? 0,
      timeLeft: mission?.timeLeft ?? null,
    };
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
      const shipment = this.events.about(target.id)?.kind === 'high-value';
      if (shipment) wanted.add(target.id);
      if (target.spec.kind !== 'dummy' && target.health >= target.spec.maxHealth && !shipment) continue;
      const point = this.range.labelPoint(target, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > TARGETS.labelRange * (shipment ? 1.6 : 1)) continue;
      const s = target.spec;
      near.push({
        id: s.id, name: shipment ? 'Paper shipment' : s.name, role: shipment ? 'High-value target' : s.role, health: target.durability.fraction,
        icon: s.kind === 'dummy' ? 'practice' : shipment ? 'supply' : null, state: null, side: null, point, distance,
      });
    }
    for (const i of this.defenses.installations) {
      if (!i.alive || i.id === skip) continue;
      const point = this.defenseModels.labelPoint(i.id, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > DEFENSES.labelRange) continue;
      const state: TargetLabelView['state'] = !i.isWeapon ? null : i.targetId === PLAYER_ID && i.state !== 'destroyed' ? i.state : 'idle';
      // T1's own buildings only show once damaged (or while shooting at raiders).
      if (i.side === 'player' && i.durability.fraction >= 1 && !i.engaged) continue;
      const role = i.side === 'player' && i.engaged ? 'Firing at raiders' : i.spec.role;
      near.push({ id: i.id, name: i.spec.name, role, health: i.durability.fraction, icon: KIND_ICONS[i.spec.kind], state, side: i.side === 'enemy' ? 'enemy' : 'player', point, distance });
    }
    near.sort((a, b) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || a.distance - b.distance);
    const views: TargetLabelView[] = [];
    for (const n of near) {
      if (views.length >= MAX_TARGET_LABELS) break;
      const p = this.projectOnScreen(n.point);
      if (!p) continue;
      const range = n.icon && n.icon !== 'practice' ? DEFENSES.labelRange : TARGETS.labelRange;
      views.push({
        id: n.id, x: p.x, y: p.y, name: n.name, role: n.role, health: n.health, icon: n.icon, state: n.state, side: n.side,
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
      if (o.kind === 'intercept' || o.kind === 'escort') {
        // Point at the aircraft itself while it is in the air: the nearest target, or the bomber to protect.
        const done = mission.destroyedTargets(i);
        const ids = o.kind === 'intercept' ? o.targets.filter((id) => !done.has(id)) : [o.escort];
        let flying = false;
        for (const id of ids) {
          const a = this.airTraffic.get(id);
          if (!a) continue;
          flying = true;
          const d = Math.hypot(a.position.x - from.x, a.position.z - from.z);
          if (d >= bestDistance) continue;
          bestDistance = d;
          best =
            o.kind === 'escort'
              ? { point: new pc.Vec3().copy(a.position), label: `Your ${a.spec.name}`, tone: 'home', icon: 'escort', solid: true, territoryId: null, targetId: id }
              : { point: new pc.Vec3().copy(a.position), label: `Enemy ${a.spec.name}`, tone: 'target', icon: a.role, solid: true, territoryId: null, targetId: id };
        }
        if (flying) continue;
      }
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
            label: o.what === 'shipment' ? 'Paper shipment' : t ? t.spec.name : inst!.spec.name,
            tone: 'target',
            icon: o.what === 'shipment' ? 'supply' : t ? 'practice' : inst!.spec.kind,
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
        case 'intercept':
          best = { point: p, label: o.territoryId, tone: 'target', icon: o.what === 'aircraft' ? 'fighter' : o.what === 'convoy' ? 'bomber' : o.what, solid: false, territoryId: o.territoryId };
          break;
        case 'escort':
          best = { point: p, label: `${o.territoryId} · bomber's target`, tone: 'target', icon: 'bomb', solid: false, territoryId: o.territoryId };
          break;
        case 'patrol':
          best = { point: p, label: `Patrol over ${o.territoryId}`, tone: 'target', icon: 'patrol', solid: false, territoryId: o.territoryId };
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

  /** An objective in a few words and numbers: "Bomb T5", "Hold T6 12/20s", "Fighters T8 1/2". */
  private objectiveLabel(mission: Mission, index: number): string {
    const o = mission.objectives[index];
    if (!o) return '';
    switch (o.kind) {
      case 'bomb':
        if (o.approach) return `Low bomb ${o.territoryId} <${o.approach.ceiling} m`;
        return o.precision ? `Ink spot ${o.territoryId}` : `Bomb ${o.territoryId}`;
      case 'recon': return `Scout ${o.territoryId} <${o.airspace.ceiling} m`;
      case 'reach': return `Reach ${o.territoryId}`;
      case 'ring': return `Ring ${o.number}/${mission.objectives.length}`;
      case 'land': return `Land ${o.territoryId}`;
      case 'survive': return `Hold ${o.territoryId} ${Math.floor(mission.progress[index] * o.duration)}/${o.duration}s`;
      case 'escape': return `Escape ${o.territoryId} ${o.distance} m`;
      case 'destroy': {
        const n = mission.destroyedTargets(index).size;
        switch (o.what) {
          case 'radar': return `Radar ${o.territoryId}`;
          case 'supply': return `Depot ${o.territoryId}`;
          case 'defense': return `Defenses ${o.territoryId} ${n}/${o.count}`;
          case 'shipment': return `Shipment ${o.territoryId}`;
          default: return `Practice ${o.territoryId} ${n}/${o.count}`;
        }
      }
      case 'intercept': {
        const n = mission.destroyedTargets(index).size;
        switch (o.what) {
          case 'bomber': return 'Bomber';
          case 'scout': return 'Scout';
          case 'fighter': return o.count > 1 ? `Fighters ${o.territoryId} ${n}/${o.count}` : `Fighter ${o.territoryId}`;
          case 'convoy': return 'Convoy';
          default: return `Intruders ${n}/${o.count}`;
        }
      }
      case 'escort': return `Escort to ${o.territoryId}`;
      case 'patrol': return `Patrol ${o.territoryId} ${Math.floor(mission.progress[index] * o.duration)}/${o.duration}s`;
    }
  }

  private objectiveIcon(o: Objective): IconName {
    switch (o.kind) {
      case 'destroy':
        return o.what === 'radar' ? 'radar' : o.what === 'supply' || o.what === 'shipment' ? 'supply' : o.what === 'defense' ? 'turret' : 'practice';
      case 'intercept':
        return o.what === 'scout' ? 'scout' : o.what === 'fighter' ? 'fighter' : o.what === 'aircraft' ? 'patrol' : 'bomber';
      default:
        return o.kind;
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
        label: `Rings ${done}/${rings.length}`,
        icon: 'ring',
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
          icon: this.objectiveIcon(o),
          done: mission.isDone(i),
          open: mission.isOpen(i) && mission.isActive,
          progress: o.kind === 'recon' || o.kind === 'destroy' || o.kind === 'survive' || o.kind === 'patrol' || (o.kind === 'intercept' && o.count > 1) ? mission.progress[i] : null,
          distance: Math.hypot(p.x - from.x, p.z - from.z),
        });
      });
    }
    const d = TIERS[mission.tier];
    const offer = this.director.offerFor(mission);
    const op = offer?.operationId ? (this.director.operation?.id === offer.operationId ? this.director.operation : this.director.lastOperation) : null;
    const stage = op && offer?.stage !== undefined ? op.stages[offer.stage] : null;
    return {
      title: mission.title,
      codename: mission.spec.codename ?? '',
      operation: op && stage ? `Stage ${offer!.stage! + 1} of ${op.stages.length} · optional: ${OPTIONAL_LABELS[stage.optional.kind].toLowerCase()} (+${stage.optional.bonus}) · bonus +${op.bonus} at the end` : null,
      modifiers: (mission.spec.modifiers ?? []).map((id) => DIRECTOR.modifiers[id].label),
      threat: this.threatSummary(mission),
      type: mission.spec.type,
      difficultyLabel: d.label,
      stars: d.stars,
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
      const why: Record<string, string> = {
        'out-of-time': 'The clock ran out.',
        missed: 'Every bomb is gone.',
        'target-escaped': 'It got away.',
        'target-bombed': 'The bomber released its bomb.',
        'escort-lost': 'Your bomber was shot down.',
      };
      return `${why[mission.failure ?? ''] ?? 'The mission is lost.'} Land on T1 to recover the plane anyway.`;
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
          case 'shipment': return 'The shipment is the stack of crates in a corner of the platform. A bomb finishes it; ink takes a while.';
          default: return 'Hold left-click to fire ink along your nose. Slow down, line up and lead the target a little.';
        }
      case 'intercept':
        switch (next.what) {
          case 'bomber': return "Fly out to meet the bomber: it holds a steady course. Get behind it and keep firing. T1's guns help near home.";
          case 'scout': return 'Come up behind it: once it spots you it runs for the edge of the map. Shift boosts to catch it.';
          case 'fighter': return "It will turn on you. Keep turning so it can't line up, and aim at the small circle to lead your shots.";
          case 'convoy': return 'The supply Widewing is slow and steady: get behind it and keep firing. Mind its escort, if it has one.';
          default: return 'Shoot down every intruder: scouts run for the edge, fighters fight back.';
        }
      case 'escort': return 'Stay close to your bomber and shoot down the fighters that go for it. Its bomb run is slow and straight.';
      case 'patrol': return `Stay over ${next.territoryId}, below ${next.airspace.ceiling} m. Intruders turn up while you patrol.`;
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
      'target-escaped': 'Failed: it got away',
      'target-bombed': 'Failed: the bomb was released',
      'escort-lost': 'Failed: your bomber was lost',
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
      aircraftDestroyed: sortie.aircraftDestroyed,
      bombersIntercepted: sortie.bombersIntercepted,
      objectivesProtected: sortie.objectivesProtected,
      paperLost: sortie.paperLost,
      paperOverflow: sortie.paperOverflow,
      survival,
      survived: recovered,
      health: recovered ? health / spec.maxHealth : 0,
      paperSpent: sortie.paperSpent,
      paperEarned: sortie.paperEarned,
      medal: this.outcome?.progress.medal ?? null,
      criteria: this.outcome?.criteria ?? null,
      bonuses: this.outcome?.payouts ?? [],
      records: this.outcome?.progress.records ?? [],
      achievements: this.outcome?.progress.achievements ?? [],
      streak: this.outcome?.progress.streak ?? 0,
      operation: this.outcome?.operation ?? null,
      failure: succeeded ? null : failureText(mission.failure),
      paper: paperBreakdown({
        reward: succeeded ? mission.reward : 0,
        missionTitle: mission.title,
        bonuses: this.outcome?.payouts ?? [],
        earned: sortie.paperEarned,
        spent: sortie.paperSpent,
        lost: sortie.paperLost,
        overflow: sortie.paperOverflow,
      }),
      next: nextStepText({ succeeded, recovered, aircraftName: spec.name, refitCost: spec.refitCost, cost: spec.cost, repairs: this.base.needsRepair.length }),
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
        return { x: i.spec.x, z: i.spec.z, kind: i.spec.kind, alive: i.alive, engaged: i.alive && i.isWeapon && i.engaged, friendly: i.side === 'player', reach };
      }),
      zones,
      rings,
      targets,
      plane: showPlane ? { x: plane.position.x, z: plane.position.z, yaw: plane.yaw, autopilot: this.boundary.state === 'autopilot' } : null,
      // Enemy aircraft show only when someone can see them: T1's radar (or lookouts), the plane, or the mission.
      aircraft: this.airTraffic.aircraft
        .filter((a) => {
          if (a.side === 'player') return true;
          const raid = this.airTraffic.raids.find((r) => (r.bomber === a.id || r.escorts.includes(a.id)) && r.stage !== 'over');
          if (raid) return raid.detected;
          if (mission?.isActive && missionAircraft(mission).has(a.id)) return true;
          if (Math.hypot(a.position.x - world.home.x, a.position.z - world.home.z) <= this.base.detectionRange) return true;
          return showPlane && a.position.distance(plane.position) < SIGHT_RANGE;
        })
        .map((a) => {
          const raid = this.airTraffic.raids.find((r) => r.bomber === a.id && r.stage === 'inbound');
          const strike = a.orders.strike;
          return {
            x: a.position.x, z: a.position.z, yaw: a.model.yaw, side: a.side, role: a.role,
            raid: raid && strike ? { x: strike.x, z: strike.z } : null,
            mission: !!mission?.isActive && missionAircraft(mission).has(a.id),
          };
        }),
      objective: showPlane && objective ? { x: objective.x, z: objective.z } : null,
      radar: { x: world.home.x, z: world.home.z, range: this.base.detectionRange, state: !this.base.radar ? 'none' : this.base.radar.alive ? 'on' : 'off' },
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
    case 'survive':
    case 'patrol': return out.set(o.airspace.x, 0.5, o.airspace.z);
    case 'escort': return out.set(o.zone.x, o.zone.top + 0.5, o.zone.z);
    case 'ring': return out.set(o.gate.x, o.gate.y, o.gate.z);
    case 'land': return out.set(world.home.x, 0.5, world.home.z);
    case 'escape': {
      const dx = world.home.x - o.x;
      const dz = world.home.z - o.z;
      const len = Math.hypot(dx, dz) || 1;
      return out.set(o.x + (dx / len) * o.distance, 0.5, o.z + (dz / len) * o.distance);
    }
    case 'destroy':
    case 'intercept': {
      const t = world.territories.find((x) => x.id === o.territoryId)!;
      return out.set(t.x, 0.5, t.z);
    }
  }
}

function css(color: readonly [number, number, number]): string {
  return `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;
}

/** What raiders bomb: the paper store on home. */
function homeStore(layout: DefenseLayout, world: World): Strike {
  const store = layout.installations.find((i) => i.territoryId === world.home.id && i.kind === 'supply');
  const at = store ?? { x: world.home.x, z: world.home.z };
  return { territoryId: world.home.id, x: at.x, y: world.home.top, z: at.z, radius: RAIDS.hitRadius };
}

/** A session summary as the HUD shows it. */
function sessionView(s: NonNullable<SaveData['lastSession']>): SessionView {
  const medal = s.bestMedal ? `${s.bestMedal.charAt(0).toUpperCase()}${s.bestMedal.slice(1)} medal` : null;
  const reward = s.bestReward ? `+${s.bestReward.amount} (${s.bestReward.title})` : null;
  return {
    missionsCompleted: s.missionsCompleted,
    missionsFailed: s.missionsFailed,
    paperEarned: s.paperEarned,
    paperSpent: s.paperSpent,
    aircraftLost: s.aircraftLost,
    enemiesDestroyed: s.enemiesDestroyed,
    best: [medal, reward, s.bestStreak >= 2 ? `${s.bestStreak} in a row` : null].filter(Boolean).join(' · ') || '—',
    achievements: s.achievements,
    minutes: Math.round(s.seconds / 60),
  };
}

/** The AI aircraft a mission is about: the ones to shoot down and the bomber to protect. */
function missionAircraft(mission: Mission): Set<string> {
  const ids = new Set<string>();
  for (const o of mission.objectives) {
    if (o.kind === 'intercept') for (const id of o.targets) ids.add(id);
    if (o.kind === 'escort') ids.add(o.escort);
  }
  return ids;
}

/** "Air: 2 regular fighters + 1 scout". */
function airList(air: { fighters: number; scouts: number; bombers: number; skill: keyof typeof AI.skill }): string {
  const skill = AI.skill[air.skill].label.toLowerCase();
  const parts: string[] = [];
  const add = (n: number, what: string) => n > 0 && parts.push(`${n} ${what}${n === 1 ? '' : 's'}`);
  add(air.fighters, 'fighter');
  add(air.scouts, 'scout');
  add(air.bombers, 'bomber');
  return `Air: ${parts.join(' + ')} (${skill})`;
}

/** Icons for installations, by kind. */
const KIND_ICONS: Record<InstallationKind, IconName> = { turret: 'turret', launcher: 'launcher', radar: 'radar', supply: 'supply', workshop: 'workshop', storage: 'storage' };

const EVENT_ICONS: Record<EventKind, IconName> = { raid: 'raid', 'high-value': 'supply', convoy: 'bomber', 'supply-run': 'escort' };

/** A world event's note, cut down to an alert: a few words and the number in it. */
function shortNote(title: string, detail: string): { icon: IconName; title: string; value: string | null } {
  const value = /[+−-]\d+/.exec(detail)?.[0]?.replace('-', '−') ?? null;
  const t = title.replace(/!$/, '');
  const rules: Array<[RegExp, IconName, (m: RegExpExecArray) => string]> = [
    [/^Paper shipment on (T\d)/, 'supply', (m) => `Shipment ${m[1]}`],
    [/^Enemy convoy/, 'bomber', () => 'Convoy'],
    [/^Supply run inbound/, 'escort', () => 'Supply run'],
    [/^Convoy destroyed/, 'bomber', () => 'Convoy down'],
    [/^Shipment destroyed/, 'supply', () => 'Shipment down'],
    [/^Supply (plane lost|run turned back)/, 'escort', () => 'Supplies lost'],
    [/^Supplies delivered/, 'supply', () => 'Supplies'],
    [/^(T\d)'s defenses are down/, 'offline', (m) => `${m[1]} defenses down`],
  ];
  for (const [re, icon, make] of rules) {
    const m = re.exec(t);
    if (m) return { icon, title: make(m), value };
  }
  return { icon: 'info', title: t.split(' ').slice(0, 3).join(' '), value };
}

/** Where a slot is on T1, built on or not. */
function buildingSpecAt(base: Base, slot: string): { x: number; z: number } {
  return slotPoint(base.home, slot) ?? { x: base.home.x, z: base.home.z };
}

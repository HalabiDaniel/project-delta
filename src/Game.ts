import * as pc from 'playcanvas';
import { AI, AIRCRAFT, AIRCRAFT_ORDER, BOMB, CAMERA, DAMAGE, DEFENSES, DIRECTOR, ECONOMY, EVENTS, LANDING, PALETTE, PLANE, PLAYER_ID, RAIDS, TARGETS, THREAT, TIERS, WEAPONS, WORLD, type AircraftId } from './config';
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
import { layoutDefenses, overHome, type DefenseLayout } from './defenses/Layout';
import { MissionDirector, SLOT_LABELS, type Situation } from './director/MissionDirector';
import { OPTIONAL_LABELS, remainingRewards, type Payout } from './director/Operations';
import { skillBand } from './director/Performance';
import { EVENT_LABELS, WorldEvents } from './director/WorldEvents';
import type { Mission, Objective } from './missions/Mission';
import { defenseList, type MissionContext } from './missions/MissionGenerator';
import { medalCriteria, Progress, type SortieProgress } from './progress/Progress';
import { Boundary } from './systems/Boundary';
import { GameState, type BuildKind, type CrashCause } from './systems/GameState';
import { Input, MOUSE_LEFT, MOUSE_RIGHT } from './systems/Input';
import { Ledger } from './systems/Ledger';
import { LocalStats } from './systems/LocalStats';
import { ResourceManager } from './systems/ResourceManager';
import { openStore, SaveManager, SAVE_VERSION, type SaveData } from './systems/SaveGame';
import { DevPanel } from './ui/DevPanel';
import { Logbook, type LogbookView } from './ui/Logbook';
import type { GarageView } from './ui/Garage';
import {
  HUD,
  type MissionCardView,
  type SessionView,
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
import type { AircraftMarkerView, AirView, RaidAlertView } from './ui/AirHud';
import type { ThreatRingItem, ThreatView } from './ui/ThreatHud';
import { AircraftModels } from './world/AircraftModels';
import { DefenseModels } from './world/DefenseModels';
import { Effects } from './world/Effects';
import { OrdnanceView } from './world/OrdnanceView';
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
/** Enemy aircraft get a marker within this distance (mission targets, raiders and friends always). */
const AIRCRAFT_MARKER_RANGE = 230;
/** …and an edge chevron when off screen within this one. */
const AIRCRAFT_EDGE_RANGE = 140;
/** Sounds of other aircraft (gunfire, crashes) carry this far. */
const HEARING = 120;
const KEY_TO_CARD: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
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
  ) {
    this.barriers = layout.barriers.map((b) => ({ id: b.id, shapes: b.solids }));
    this.logbook = new Logbook(hud.root, () => this.logbookView(), () => this.toggleLogbook(false));
    this.dev = new DevPanel(hud.root, this);
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
    // The saved game, if there is one (IndexedDB, else local storage). A bad save never stops the game.
    const saves = new SaveManager(await openStore());
    const { data: saved, problems } = await saves.load();
    if (problems.length > 0) console.warn('paperwars: problems with the saved game', problems);
    const resources = new ResourceManager();
    const ledger = new Ledger();
    ledger.watch(resources);
    const staticContext = {
      territories: world.territories,
      homeId: world.home.id,
      launch: world.launchPosition,
      dummies: targetSpecs.filter((s) => s.kind === 'dummy'),
      obstacles: [
        ...rangeFootprints,
        ...layout.installations.map((i) => ({ x: i.x, z: i.z, r: i.footprint })),
        ...layout.barriers.flatMap((b) => b.solids.map(footprint)),
      ],
    };
    const airTraffic = new AirTraffic(world.territories, world.home, homeStore(layout, world));
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
      resetProgress: () => game?.resetProgress(),
      dismissWelcome: () => game?.dismissWelcome(),
      toggleSound: () => game?.toggleSound(),
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
      new Ordnance(),
      new OrdnanceView(app),
      new Sounds(),
      airTraffic,
      new AircraftModels(app),
      new Bombs(app, 6),
      layout,
      director,
      events,
      progress,
      ledger,
      saves,
      missionContext,
    );
    if (saved) {
      game.sounds.muted = saved.settings.muted;
      if (saved.settings.dev) game.dev.toggle(true);
      game.welcome = { session: saved.lastSession, restored: true, problems };
    }
    if (new URLSearchParams(window.location.search).has('dev')) game.dev.toggle(true);
    // The session summary is kept for next time, and the game saved, whenever the page goes away.
    const leave = () => void game!.saveNow();
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && leave());
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
    // With nothing affordable, F folds the free emergency Dart instead.
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
    this.inkSound();
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
  }

  /** X: swaps the selected card for another (a limited number of times). */
  swapCard(): void {
    const { state, director } = this;
    if (this.paused || (state.phase !== 'desk' && state.phase !== 'building' && state.phase !== 'ready')) return;
    if (state.selected >= director.offers.length) {
      this.hint("Event cards can't be swapped", 'Ignore it if you like: it costs nothing.');
      return;
    }
    if (director.swaps <= 0) {
      this.hint('No swaps left', `You get one back after every sortie (up to ${DIRECTOR.swaps.max}).`);
      return;
    }
    if (!director.canSwap(state.selected)) {
      this.hint('Operation under way', 'Abandon the operation to replace its card.');
      return;
    }
    const mission = director.swap(state.selected);
    if (!mission) return;
    state.updateOffers(director.missions);
    state.select(director.missions.indexOf(mission));
    this.hud.banner('Card swapped', `${director.swaps} swap${director.swaps === 1 ? '' : 's'} left.`, 'info', 1.6);
    this.requestSave();
  }

  /** Gives up the operation under way (asks twice): what it paid is kept, the bonus is not. */
  abandonOperation(): void {
    const op = this.director.operation;
    if (this.paused || !op || op.status !== 'active') return;
    if (this.state.phase !== 'desk' && this.state.phase !== 'building' && this.state.phase !== 'ready') return;
    if (!this.confirm('abandon')) {
      this.hud.banner(`Abandon ${op.codename}?`, `You keep the ${op.earned} paper it has paid; the +${op.bonus} bonus is lost. Click again to confirm.`, 'bad', 3);
      return;
    }
    this.director.abandonOperation();
    this.events.hold(null);
    this.state.updateOffers(this.director.missions);
    this.hud.banner(`${op.codename} abandoned`, `You keep the ${op.earned} paper it paid.`, 'info', 2.4);
    this.requestSave();
  }

  /** Deletes all local progress (asks twice), then starts over. */
  resetProgress(): void {
    if (!this.confirm('reset')) {
      this.hud.banner('Reset all progress?', 'Paper, planes, records, achievements and history will be deleted. Click again to confirm.', 'bad', 3.5);
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
    this.hud.banner(this.sounds.muted ? 'Sound off' : 'Sound on', 'M toggles warning sounds.', 'info', 1.4);
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
      settings: { muted: this.sounds.muted, dev: this.dev.open },
      lastSession: this.progress.session.sorties > 0 ? this.progress.session : (this.welcome?.session ?? null),
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
    this.progress.session.seconds += dt;
    this.updateWorld(dt);
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

    this.updateAir(dt);
    this.updateDefenses(dt);
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
      this.solids(),
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
      if (installation?.side === 'enemy' && ram > 0) this.damageInstallation(installation, ram, this.defenseModels.centre(installation.id, this.v3));
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
      this.hud.banner(note.title, note.detail, note.tone, 3.4);
    }
    for (const payout of [...events.takePayouts(), ...director.takePayouts()]) {
      if (state.sortie && (state.phase === 'flying' || state.phase === 'landed')) state.payBonus(payout.amount, payout.label);
      else this.resources.earn(payout.amount, 'bonus', payout.label);
      if (payout.label.startsWith('Shipment') || payout.label.startsWith('Convoy')) {
        const a = this.progress.unlockNow('world-event');
        if (a) this.hud.banner(`Achievement: ${a.title}`, a.detail, 'good', 3);
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
    return [...this.range.solids, ...this.installationSolids(), ...this.barriers];
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
        this.onAircraftDown(e.aircraft, e.byPlayer, e.cause);
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
          hud.banner('Bomb released!', `It is falling on your paper store on ${this.world.home.id}.`, 'bad', 2.5);
        }
        break;
      case 'raid':
        this.onRaid(e.raid);
        break;
    }
  }

  private onRaid(raid: Raid): void {
    const { hud, state } = this;
    if (raid.stage === 'over') {
      this.events.raidEnded(raid);
      if (this.director.validate()) state.updateOffers(this.director.missions);
    }
    if (raid.stage === 'inbound') {
      // Home is under attack: an emergency defense card goes on the board (unless a mission sent it).
      if (!this.events.events.some((e) => e.raidId === raid.id)) this.events.raidStarted(raid);
      if (this.director.validate()) state.updateOffers(this.director.missions);
      this.sounds.play('raid');
      const escort = raid.escorts.length > 0 ? ', with a fighter escort' : '';
      hud.banner('Incoming bomber!', `Enemy Widewing from beyond ${raid.origin}${escort} · ETA ${Math.ceil(raid.eta)} s`, 'bad', 4);
      return;
    }
    if (raid.stage !== 'over') return;
    switch (raid.outcome) {
      case 'intercepted':
      case 'driven-off':
        state.raidDefended(raid.participated, raid.mission);
        if (!raid.mission) {
          const how = raid.outcome === 'intercepted' ? 'Raider shot down' : 'Raider turned back';
          hud.banner(
            raid.participated ? `${how}! +${RAIDS.reward}` : `${how}`,
            raid.participated ? 'Your paper store is safe. Defense reward paid.' : `${this.world.home.id}'s guns saw it off. No reward without your help.`,
            'good',
            3,
          );
        }
        break;
      case 'missed':
        hud.banner('Their bomb missed!', 'Your paper store is untouched.', 'good', 2.5);
        break;
    }
  }

  /** An AI aircraft went down: it crumples, and the player hears about it if it was theirs or mattered. */
  private onAircraftDown(a: AiAircraft, byPlayer: boolean, cause: 'shot' | 'crash'): void {
    const { hud, state } = this;
    const at = a.position;
    const enemy = a.side === 'enemy';
    this.effects.wreck(at, a.model.getVelocity(this.v2), enemy ? PALETTE.enemyAccent : PALETTE.friendlyAccent, a.role === 'bomber' ? 1.3 : 1, enemy ? PALETTE.enemyPaper : PALETTE.paper);
    if (this.near(at)) this.sounds.play('crumple');
    this.hitAt.delete(a.id);
    const credit = enemy && (byPlayer || a.playerDamage > 0);
    const screen = this.projectOnScreen(this.v3.copy(at));
    if (credit) {
      this.sounds.play('kill');
      if (screen) hud.pop('SHOT DOWN!', 'good', screen);
      this.career.recordAircraftDestroyed(a.role === 'bomber');
      const detail =
        a.purpose === 'ambient' ? 'A patrol plane: no bounty, but one less in the sky.'
        : a.role === 'bomber' && a.purpose === 'raid' ? 'Bomber intercepted. Your paper store is safe.'
        : `${a.skill.label} ${AI.roleLabels[a.role].toLowerCase()} down.`;
      hud.banner(`Enemy ${a.spec.name} destroyed`, detail, 'good', 2.6);
    } else if (enemy && screen) {
      hud.pop(cause === 'crash' ? 'CRASHED!' : 'DOWN!', 'info', screen);
    } else if (!enemy) {
      hud.banner(`Your ${a.spec.name} is down!`, 'Enemy fighters got to it.', 'bad', 3);
    }
    const onMission = !!state.mission?.isActive && missionAircraft(state.mission).has(a.id);
    this.events.aircraftDown(a.id, credit, onMission);
    state.aircraftDestroyed(a.id, a.role, credit);
  }

  /** A round or rocket struck an AI aircraft. */
  private onAircraftHit(target: string, shot: { side: 'player' | 'enemy'; source: string; damage: number; kind: 'ink' | 'rocket' }, point: pc.Vec3): void {
    if (shot.kind === 'rocket') this.effects.explosion(point, 0.6);
    else if (shot.side === 'enemy') this.effects.enemyInkHit(point, false);
    else this.effects.inkHit(point, false);
    this.airTraffic.damage(target, shot.damage, shot.source, false);
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
    if (impact.kind !== 'void') {
      this.effects.bombImpact(point, hit);
      // The blast catches the other side's installations: no credit to the player.
      const kind = BOMB.kinds.standard;
      for (const i of this.defenses.installations) {
        if (!i.alive || i.side === owner.side) continue;
        const distance = Math.min(...i.spec.shapes.map((shape) => distanceToShape(point, shape)));
        const damage = blastDamage(kind.damage, kind.blastRadius, distance);
        if (damage > 0) this.damageInstallation(i, damage, this.defenseModels.labelPoint(i.id, this.v2), false);
      }
      const at = this.projectOnScreen(this.v3.copy(point));
      if (at) this.hud.pop(hit ? 'KABOOM!' : 'SPLAT!', hostile === hit ? 'bad' : 'good', at);
    }
    this.airTraffic.bombLanded(impact.tag, hit);
    if (hostile) {
      if (!hit) return;
      const lost = this.state.raidHit();
      this.hud.banner(
        'Paper store hit!',
        lost > 0 ? `The raid cost you ${lost} paper.` : `Your last ${ECONOMY.protectedPaper} paper is protected.`,
        'bad',
        3,
      );
    } else {
      this.state.escortStrike(impact.tag, hit);
      const supply = this.events.about(impact.tag)?.kind === 'supply-run';
      this.events.supplyDropped(impact.tag, hit);
      if (!hit) this.hud.banner(supply ? 'The supplies missed the store' : 'Your bomber missed', 'It is going round for another run. Keep it covered.', 'bad', 2.5);
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
    this.defenseModels.update(dt, flying ? p : null, approached);
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
        if (i.side === 'player') this.hud.banner(`Your ${i.spec.name.toLowerCase()} is wrecked`, 'It is rebuilt when the sortie ends.', 'bad', 2.4);
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
      if (this.welcome && code !== 'Backquote') {
        this.dismissWelcome();
        if (code === 'Enter' || code === 'NumpadEnter' || code === 'Escape') return;
      }
      if (code === 'KeyM') {
        this.toggleSound();
        return;
      }
      if (code === 'Backquote') {
        this.dev.toggle();
        this.requestSave();
        return;
      }
      if (code === 'KeyL') {
        this.toggleLogbook();
        return;
      }
      if (code === 'Escape') {
        if (this.logbook.open) {
          this.toggleLogbook(false);
          return;
        }
        if (performance.now() - this.lastAutoPause < ESC_AFTER_UNLOCK_MS) return;
        if (this.paused) this.resume();
        else this.pause();
        return;
      }
      if (this.paused) return;
      if (this.logbook.open) return;
      if (code in KEY_TO_CARD) this.select(KEY_TO_CARD[code]);
      else if (code === 'KeyX') this.swapCard();
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
      if (source !== 'income' && source !== 'restore') hud.paperDelta(delta);
      if (source !== 'restore' && source !== 'reset') this.progress.paper(delta, source === 'spend');
      if (source !== 'income') this.requestSave();
    });
    state.onEvent((event) => {
      switch (event.type) {
        case 'aircraft-selected':
          this.career.rememberAircraft(event.aircraft);
          this.refreshPad();
          this.requestSave();
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
        case 'launched': {
          this.sortiesFlown++;
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
          hud.banner('Mission active', mission.title, 'info', 1.8);
          this.requestSave();
          break;
        }
        case 'sortie-ended':
          this.sortieOver(true);
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
          this.airTraffic.endMission();
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
          this.airTraffic.endMission();
          if (event.reason === 'missed') hud.banner('Out of bombs!', 'Every target needs a hit. Mission failed.', 'bad', 3);
          else if (event.reason === 'out-of-time') hud.banner('Out of time!', 'Mission failed. Land on T1 to recover the plane.', 'bad', 3);
          else if (event.reason === 'target-escaped') hud.banner('It got away!', 'Mission failed. Land on T1 to recover the plane.', 'bad', 3);
          else if (event.reason === 'target-bombed') hud.banner('Too late!', 'The bomber released its bomb. Mission failed.', 'bad', 3);
          else if (event.reason === 'escort-lost') hud.banner('Your bomber is down!', 'Mission failed. Land on T1 to recover the plane.', 'bad', 3);
          break;
        case 'crashed':
          this.onCrashed(event.cause);
          this.sortieOver(false);
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
    // An aircraft carries its own marker (and edge chevron): no second label on top of it.
    if (goal && !(goal.targetId && this.airTraffic.get(goal.targetId))) {
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
      if (p) labels.push({ id: t.id, role: t.isHome ? 'home' : objectiveTerritories.get(t.id) === false ? 'objective' : 'neutral', state: this.events.stateOf(t.id), x: p.x, y: p.y });
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
    } else if (state.phase === 'desk' && state.emergencyAvailable()) {
      const fit = state.suitability(state.aircraft);
      noteTone = 'bad';
      buildNote =
        `You can't afford any plane. Fold a free emergency Dart (F): half the ink, no bomb, for one sortie.` +
        (fit.level === 'unsuitable' || state.selectedMission.spec.bombs > 0 ? ' Pick a mission without bombs for it.' : '');
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
        aircraftDestroyed: this.career.data.aircraftDestroyed,
        favorite: favorite ? AIRCRAFT[favorite].name : null,
      },
      phase: state.phase,
      paused: this.paused,
      income: {
        state: state.income.stateFor(resources.paper),
        amount: state.income.amount,
        interval: state.income.interval,
        progress: state.income.progressFor(resources.paper),
        cap: state.income.cap,
        taper: state.income.taper,
      },
      ledger: this.ledger.recent(4).map((e) => ({ label: e.source === 'income' ? `Home production ×${e.count}` : e.label, delta: e.delta })),
      streak: { current: this.progress.data.streak.current, rate: Progress.streakRate(this.progress.data.streak.current + 1) },
      build: {
        cost: buildCost, kind, name, note: buildNote, noteTone, progress: state.buildProgress,
        emergency: state.emergencyAvailable() && !resources.canAfford(buildCost),
        canBuild: state.canBuild() || (state.emergencyAvailable() && state.suitability(state.aircraft).level !== 'unsuitable' && state.selectedMission.spec.bombs === 0),
      },
      swaps: this.director.swaps,
      welcome: this.welcome && choosing ? { restored: this.welcome.restored, paper: resources.paper, session: this.welcome.session ? sessionView(this.welcome.session) : null, problems: this.welcome.problems.length } : null,
      menu: {
        session: sessionView(this.progress.session),
        muted: this.sounds.muted,
        saveNote: this.saveNote(),
        confirmingReset: this.confirming?.what === 'reset' && performance.now() < this.confirming.until,
      },
      garage: choosing ? this.garageView() : null,
      cards: choosing ? state.offers.map((m) => this.cardView(m)) : null,
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
      air: this.airView(flying, aim),
    };
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
    return {
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
        markers.push({
          id: a.id, x: at.x, y: at.y, onScreen: at.onScreen, angle: at.angle,
          side: a.side, icon: a.role, name: `${a.side === 'enemy' ? 'Enemy' : 'Your'} ${a.spec.name}`, detail: this.aircraftDetail(a),
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
    return { markers, lead, raid: this.raidAlert() };
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

  /** The most urgent raid on T1 still to be settled, for the alert card. */
  private raidAlert(): RaidAlertView | null {
    const raids = this.airTraffic.raids.filter((r) => r.stage !== 'over');
    if (raids.length === 0) return null;
    const raid = raids.reduce((a, b) => (b.eta < a.eta ? b : a));
    const bomber = this.airTraffic.get(raid.bomber);
    const mission = this.state.mission;
    return {
      state: raid.stage === 'released' ? 'released' : 'inbound',
      title: raid.stage === 'released' ? 'BOMB AWAY!' : 'INCOMING BOMBER',
      subtitle: `Enemy Widewing approaching ${this.world.home.id} from ${raid.origin}${raid.escorts.length > 0 ? ' · escorted' : ''}`,
      eta: raid.eta,
      target: 'Home territory · paper store',
      objective: `Intercept before bomb release (a hit costs ${RAIDS.penalty} paper)`,
      rewardLabel: raid.mission ? 'Mission reward' : 'Defense reward',
      reward: `+${raid.mission && mission ? mission.reward : RAIDS.reward} paper`,
      distance: this.state.phase === 'flying' && bomber ? bomber.position.distance(this.plane.position) : null,
    };
  }

  /** The danger on a mission card or in the tracker. */
  private threatSummary(m: Mission): ThreatSummary {
    const t = m.spec.threat;
    const air = t?.air ? airList(t.air) : null;
    if (t?.air && t.level === 0) {
      // Nothing on the ground: the danger is in the air, as strong as its pilots.
      const level = ({ easy: 1, medium: 2, hard: 3 } as const)[t.air.skill];
      return { level, label: 'Air threat', detail: `No ground defenses · ${air}` };
    }
    if (!t || t.level === 0) {
      return { level: 0, label: THREAT.levels[0].label, detail: m.spec.type === 'rings' ? 'Course clear of defenses' : 'No known defenses' };
    }
    const parts: string[] = [];
    if (t.turrets || t.launchers) parts.push(defenseList(t.turrets, t.launchers));
    if (t.radars) parts.push(t.radars === 1 ? 'radar' : `${t.radars} radars`);
    const where = m.spec.type === 'rings' ? `Course passes ${t.territories.join(', ')}` : t.territories.join(' + ');
    if (air) parts.push(air);
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
          `${chosen.gunLabel} · ${chosen.gun.ammo} ink`,
          `${chosen.bombs.capacity} ${bombKind.label.toLowerCase()}${chosen.bombs.capacity === 1 ? '' : 's'}`,
          `${chosen.maxHealth} health · ${(chosen.range / 1000).toFixed(1)} km range`,
          ...(() => {
            const m = this.progress.data.mastery[chosen.id];
            if (!m || m.flights === 0) return [];
            const acc = chosen.bombs.capacity > 1 && m.bombsDropped > 0 ? `${Math.round((m.bombHits / m.bombsDropped) * 100)}% bombs on target` : m.shotsFired > 0 ? `${Math.round((m.shotsHit / m.shotsFired) * 100)}% ink on target` : '';
            return [`Your record: ${m.flights} flight${m.flights === 1 ? '' : 's'} · ${m.missions} done${acc ? ` · ${acc}` : ''}`];
          })(),
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
      const shipment = this.events.about(target.id)?.kind === 'high-value';
      if (shipment) wanted.add(target.id);
      if (target.spec.kind !== 'dummy' && target.health >= target.spec.maxHealth && !shipment) continue;
      const point = this.range.labelPoint(target, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > TARGETS.labelRange * (shipment ? 1.6 : 1)) continue;
      const s = target.spec;
      near.push({
        id: s.id, name: shipment ? 'Paper shipment' : s.name, role: shipment ? 'High-value target' : s.role, health: target.durability.fraction,
        icon: s.kind === 'dummy' ? 'practice' : shipment ? 'supply' : null, state: null, point, distance,
      });
    }
    for (const i of this.defenses.installations) {
      if (!i.alive || i.id === skip) continue;
      const point = this.defenseModels.labelPoint(i.id, new pc.Vec3());
      const distance = point.distance(eye);
      if (distance > DEFENSES.labelRange) continue;
      const state: TargetLabelView['state'] = !i.isWeapon ? null : i.targetId === PLAYER_ID && i.state !== 'destroyed' ? i.state : 'idle';
      const role = i.side === 'player' && i.engaged ? 'Firing at raiders' : i.spec.role;
      near.push({ id: i.id, name: i.spec.name, role, health: i.durability.fraction, icon: i.spec.kind, state, point, distance });
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
          case 'shipment': return `Destroy the paper shipment on ${o.territoryId}`;
          default: return `Shoot down practice planes on ${o.territoryId} (${n}/${o.count})`;
        }
      }
      case 'intercept': {
        const n = mission.destroyedTargets(index).size;
        switch (o.what) {
          case 'bomber': return 'Shoot down the bomber before it releases';
          case 'scout': return 'Shoot down the scout before it gets away';
          case 'fighter': return o.count > 1 ? `Shoot down the enemy fighters over ${o.territoryId} (${n}/${o.count})` : `Shoot down the enemy fighter over ${o.territoryId}`;
          case 'convoy': return 'Shoot down the convoy before it leaves the map';
          default: return `Shoot down the intruders (${n}/${o.count})`;
        }
      }
      case 'escort': return `Keep the bomber flying until it hits ${o.territoryId}`;
      case 'patrol': return `Patrol ${o.duration} s over ${o.territoryId} (${Math.floor(mission.progress[index] * o.duration)}/${o.duration})`;
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
      survival,
      survived: recovered,
      paperSpent: sortie.paperSpent,
      paperEarned: sortie.paperEarned,
      medal: this.outcome?.progress.medal ?? null,
      criteria: this.outcome?.criteria ?? null,
      bonuses: this.outcome?.payouts ?? [],
      records: this.outcome?.progress.records ?? [],
      achievements: this.outcome?.progress.achievements ?? [],
      streak: this.outcome?.progress.streak ?? 0,
      operation: this.outcome?.operation ?? null,
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
      aircraft: this.airTraffic.aircraft.map((a) => {
        const raid = this.airTraffic.raids.find((r) => r.bomber === a.id && r.stage === 'inbound');
        const strike = a.orders.strike;
        return {
          x: a.position.x, z: a.position.z, yaw: a.model.yaw, side: a.side, role: a.role,
          raid: raid && strike ? { x: strike.x, z: strike.z } : null,
          mission: !!mission?.isActive && missionAircraft(mission).has(a.id),
        };
      }),
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

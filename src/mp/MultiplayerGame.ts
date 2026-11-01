import * as pc from 'playcanvas';
import { AIRCRAFT, AIRCRAFT_ORDER, PALETTE, PVP, type AircraftId, type BombKind, type Side } from '../config';
import { Bombs } from '../aircraft/Bomb';
import { ChaseCamera } from '../aircraft/ChaseCamera';
import { FlightModel, type AircraftStatus } from '../aircraft/FlightModel';
import { FlightTrails } from '../aircraft/FlightTrails';
import { PlaneController } from '../aircraft/PlaneController';
import { PLANE_SHAPES } from '../aircraft/PlaneShapes';
import { Durability } from '../combat/Damage';
import { Gun } from '../combat/Gun';
import { Ordnance, type Shot } from '../combat/Ordnance';
import { BaseMode } from '../base/BaseMode';
import { buildingSpec, homeDefenses, type InstallationSpec } from '../defenses/Layout';
import { DefenseNetwork, type InstallationState as InstState } from '../defenses/Installation';
import { Mission } from '../missions/Mission';
import { PoseBuffer, ServerClock, angleDiff, type Pose } from '../net/Interpolation';
import { Predictor, type PredictionWorld } from '../net/Prediction';
import {
  NET,
  PLAYER_COLOURS,
  planeOwner,
  type CardDTO,
  type Command,
  type Emote,
  type InputFrame,
  type MeDTO,
  type NetEvent,
  type OwnFlight,
  type WelcomeDTO,
} from '../net/protocol';
import { INSTALLATION_STATES, PLANE_STATUSES, signedAngle, type WorldState } from '../net/schema';
import { ownerOfSide, sharedWorld, sideOf, territoryName } from '../net/World';
import { emergencyDart, GameState, type GamePhase } from '../systems/GameState';
import { Input, MOUSE_LEFT, MOUSE_RIGHT } from '../systems/Input';
import { ResourceManager } from '../systems/ResourceManager';
import { HUD } from '../ui/HUD';
import type { IconName } from '../ui/icons';
import { Sounds } from '../ui/Sounds';
import { AircraftModels, type ShownAircraft } from '../world/AircraftModels';
import { DefenseModels } from '../world/DefenseModels';
import { Effects } from '../world/Effects';
import { launchPoint } from '../world/Grid';
import { MissionMarkers } from '../world/MissionMarkers';
import { OrdnanceView } from '../world/OrdnanceView';
import type { Territory } from '../world/Territory';
import { HOME_DESK } from '../world/territories/themes';
import { Dressing } from '../world/territories/Dressing';
import { buildSharedScene, type SharedScene, type World } from '../world/WorldGenerator';
import { AssetLibrary } from '../assets/AssetLibrary';
import { installOutlines, type OutlineRenderer } from '../render/outline/OutlineRenderer';
import { instanceScenery, type Instancer } from '../render/Instancer';
import { LoadingScreen } from '../ui/LoadingScreen';
import { browserStorage, DETAIL_DISTANCE, loadGraphics, saveGraphics, SHADOW_RESOLUTION, withIntensity, withOutlines, withPreset, type GraphicsSettings } from '../render/GraphicsSettings';
import { setShadowQuality } from '../render/lighting';
import { TextureBank } from '../render/shading/textures';
import { PaperShading } from '../render/shading/PaperShading';
import { installMaterials, MaterialLibrary } from '../render/materials/MaterialLibrary';
import { PROPS } from '../assets/manifest';
import { Lobby, type ClaimView } from './Lobby';
import { MpHud, type MpHudView, type ScoreRow } from './MpHud';
import { NetBase } from './NetBase';
import { NetClient } from './NetClient';
import { MpViews } from './MpViews';
import './mp.css';

const STEP = NET.step;
/** An emote shows over the plane this long (seconds). */
const EMOTE_TIME = 2.2;
/** A wing waggle lasts this long. */
const WAGGLE_TIME = 1.3;
/** Corrections bigger than this snap instead of easing (metres). */
const SNAP_ERROR = 8;

const ICONS = new Set<string>([
  'bomb', 'turret', 'launcher', 'radar', 'supply', 'recon', 'land', 'fighter', 'scout', 'bomber', 'paper', 'ink', 'range', 'rearm', 'plane',
  'home', 'repair', 'upgrade', 'build', 'remove', 'shield', 'raid', 'ok', 'warn', 'wrecked', 'offline', 'clock', 'kills', 'crumple', 'damage', 'swap', 'close', 'info',
]);

/**
 * An aircraft someone else flies (another player, or the AI on the server), drawn from the states
 * the server sends: a pose buffer interpolated a little in the past, through a flight model used
 * only for its pose (so the shared plane models, trails and labels work as for AI planes).
 */
export class RemoteAircraft implements ShownAircraft {
  readonly buffer = new PoseBuffer();
  readonly model: FlightModel;
  readonly durability = { fraction: 1 };
  alive = true;
  /** Wing waggle (emote) time left, and the emote shown over it. */
  waggle = 0;
  emote: Emote | null = null;
  emoteUntil = 0;
  status: AircraftStatus = 'flying';
  role = 'fighter';
  bombs = 0;
  target: string | null = null;
  attacking = false;
  leaving = false;

  constructor(
    readonly id: string,
    public side: Side,
    public spec: { id: AircraftId },
  ) {
    this.model = new FlightModel(AIRCRAFT[spec.id]);
    this.model.status = 'flying';
  }
}

interface OwnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * paperwars.io in multiplayer: the browser's half of a shared classroom. The server decides
 * everything that matters (where planes are, hits, damage, paper, missions, territories); this
 * class shows it and sends the player's controls.
 *
 * - The pilot's own plane is predicted: every 1/60 s the controls become a numbered input frame,
 *   flown at once through the same flight model the server uses and sent to the server. The
 *   server's state for the plane (OwnFlight, 20 times a second) is rewound to and the unconfirmed
 *   frames replayed; the difference is eased out over a few frames rather than snapped.
 * - Everyone else's plane, and the AI's, are interpolated between the server's states, drawn
 *   NET.interpolationDelay in the past so movement stays smooth.
 * - Rounds, rockets and bombs are drawn from the server's events; the pilot's own rounds are drawn
 *   the moment the trigger is pulled, and their hits come back from the server.
 * - The HUD is single-player's, fed from mirrors of the rule classes (GameState, Base, Mission)
 *   that the server's private messages keep up to date, plus the multiplayer layer (MpHud).
 */
export class MultiplayerGame {
  readonly net = new NetClient();
  readonly shared = sharedWorld();
  readonly territories: Territory[] = this.shared.territories;
  /** The installations as the server reports them, for drawing and labels. */
  readonly network: DefenseNetwork;
  me: string | null = null;
  paused = false;
  /** The HUD as last drawn (it is only drawn while we have a home): closed when the session ends. */
  private lastHud: ReturnType<MpViews['hud']> | null = null;
  /** The private state, merged from the server's sections. */
  readonly priv: MeDTO = {};
  /** Mirrors of the rule classes, filled from the private state. */
  readonly resources = new ResourceManager();
  state: GameState | null = null;
  base: NetBase | null = null;
  baseMode: BaseMode | null = null;
  home: Territory | null = null;
  readonly launch = new pc.Vec3();
  launchYaw = 0;
  offers: Mission[] = [];
  private readonly missions = new Map<string, Mission>();
  readonly cards = new Map<Mission, CardDTO>();
  /** Territory → owner id, as last seen. */
  readonly owners = new Map<string, string>();
  readonly remotes = new Map<string, RemoteAircraft>();
  readonly ais = new Map<string, RemoteAircraft>();
  readonly clock = new ServerClock();
  readonly predictor: Predictor;
  graphics: GraphicsSettings = loadGraphics(browserStorage());
  /** Repeated scenery drawn instanced (v0.0.11). */
  instancer: Instancer | null = null;
  markers: MissionMarkers | null = null;
  readonly views: MpViews;
  crashPoint = new pc.Vec3();
  crashedAt = -Infinity;
  /** When the player last hit each aircraft (ms), to show its health bar. */
  readonly hitAt = new Map<string, number>();
  claimError: string | null = null;
  roomTitle = 'Classroom';

  private readonly dressings = new Map<string, Dressing>();
  private readonly outbox: InputFrame[] = [];
  private acc = 0;
  private mouseX = 0;
  private mouseY = 0;
  private bombQueued = false;
  private readonly prev: OwnPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private readonly offset = new pc.Vec3();
  /** Rounds and rockets in flight, for drawing only (the server's events start and end them). */
  readonly fx = new Ordnance();
  private readonly fxIds = new Map<number, Shot>();
  private cosmeticCooldown = 0;
  private cosmeticBarrel = 0;
  private cosmeticBombs = 0;
  private readonly snapshot: number[] = [];
  private readonly tmp: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private readonly v1 = new pc.Vec3();
  private readonly v2 = new pc.Vec3();
  private lastPhase: GamePhase | null = null;
  private lastPaper = -1;
  private touchTimer = 0;
  private outlines: OutlineRenderer | null = null;
  private lastStateTime = -1;
  private resumed = false;

  private constructor(
    readonly app: pc.AppBase,
    readonly scene: SharedScene,
    readonly hud: HUD,
    readonly mpHud: MpHud,
    readonly lobby: Lobby,
    readonly input: Input,
    readonly camera: ChaseCamera,
    readonly effects: Effects,
    readonly trails: FlightTrails,
    readonly plane: PlaneController,
    readonly bombs: Bombs,
    readonly ordnanceView: OrdnanceView,
    readonly aircraftModels: AircraftModels,
    readonly defenseModels: DefenseModels,
    readonly sounds: Sounds,
    readonly assets: AssetLibrary,
    network: DefenseNetwork,
  ) {
    this.network = network;
    this.predictor = new Predictor(AIRCRAFT.dart);
    this.views = new MpViews(this);
  }

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<MultiplayerGame> {
    const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    const options = new pc.AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.ParticleSystemComponentSystem];
    options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
    const app = new pc.AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());

    const textures = new TextureBank(device);
    new PaperShading(device, textures);
    installMaterials(new MaterialLibrary(textures));
    const outlines = installOutlines(app);
    const assets = new AssetLibrary(app);
    const loading = new LoadingScreen();
    await assets.preload(undefined, (p) => loading.progress(p));
    loading.done(assets.failures());

    const shared = sharedWorld();
    const scene = buildSharedScene(app, shared.territories, assets);
    const network = new DefenseNetwork(shared.layout.installations);
    const ground = (x: number, z: number) => (shared.territories.some((t) => t.containsXZ(x, z)) ? 0 : null);

    let game: MultiplayerGame | undefined;
    const hud = new HUD(hudRoot, {
      build: () => game?.send({ a: 'build' }),
      launch: () => game?.launchPlane(),
      select: (i) => game?.send({ a: 'select', i }),
      selectAircraft: (id) => game?.send({ a: 'aircraft', id }),
      rearm: () => game?.send({ a: 'rearm' }),
      takeOff: () => game?.takeOff(),
      endSortie: () => game?.send({ a: 'end' }),
      continueToDesk: () => game?.send({ a: 'continue' }),
      resume: () => game?.resume(),
      swap: () => game?.send({ a: 'swap' }),
      abandonOperation: () => undefined,
      openLogbook: () => game?.hud.alert('book', 'Not in multiplayer', null, 'info', 1.6),
      openMenu: () => game?.pause(),
      resetProgress: () => game?.leaveSession(),
      moveDevice: () => game?.net.requestTransfer(),
      dismissWelcome: () => undefined,
      toggleSound: () => game?.toggleSound(),
      setHints: () => undefined,
      setUiScale: (scale) => game?.hud.setScale(scale),
      setGraphicsPreset: (preset) => game?.setGraphics(withPreset(game.graphics, preset)),
      setOutlines: (choice) => game?.setGraphics(withOutlines(game.graphics, choice)),
      setOutlineIntensity: (intensity) => game?.setGraphics(withIntensity(game.graphics, intensity)),
      toggleBase: () => game?.toggleBase(),
      base: {
        selectSlot: (id) => game?.baseAction((m) => m.selectSlot(id)),
        choose: (kind) => game?.baseAction((m) => m.choose(kind)),
        build: () => game?.baseAction((m) => m.build()),
        upgrade: () => game?.baseAction((m) => m.upgrade()),
        repair: () => game?.baseAction((m) => m.repair()),
        repairAll: () => game?.baseAction((m) => m.repairAll()),
        remove: () => game?.baseAction((m) => m.remove()),
      },
    });
    const mpHud = new MpHud(hudRoot);
    const lobby = new Lobby(hudRoot, {
      quick: (name) => void game?.enter(() => game!.net.quickJoin(name)),
      create: (name, title) => void game?.enter(() => game!.net.create(title, name)),
      join: (name, roomId) => void game?.enter(() => game!.net.join(roomId, name)),
      refresh: () => void game?.refreshRooms(),
      claim: (t) => game?.claim(t),
      setCode: (code) => {
        if (game) game.net.code = code;
      },
      leave: () => void game?.leaveSession(),
      singlePlayer: () => {
        void game?.net.leave();
        window.location.search = '';
      },
    });
    const players = (side: Side) => {
      const owner = ownerOfSide(side);
      const p = owner ? game?.room?.state.players.get(owner) : undefined;
      if (!p) return null;
      return { paper: PALETTE.paper, accent: PLAYER_COLOURS[p.colour % PLAYER_COLOURS.length] };
    };
    game = new MultiplayerGame(
      app,
      scene,
      hud,
      mpHud,
      lobby,
      new Input(canvas),
      new ChaseCamera(app),
      new Effects(app, ground),
      new FlightTrails(app),
      new PlaneController(app, 'falcon', assets.models),
      new Bombs(app, 16),
      new OrdnanceView(app),
      new AircraftModels(app, players, assets.models),
      new DefenseModels(app, shared.layout, network, { territories: shared.territories }, assets.models),
      new Sounds(),
      assets,
      network,
    );
    game.outlines = outlines;
    game.setGraphics(game.graphics);
    game.bindInput();
    game.camera.updateDesk(0, new pc.Vec3(0, 0, 0), 0, true);
    app.on('update', (dt: number) => game!.tick(dt));
    // After the game has moved everything: repeated scenery drawn instanced (v0.0.11).
    game.instancer = instanceScenery(app, game.camera.entity.camera ?? null);
    game.instancer.detailDistance = DETAIL_DISTANCE[game.graphics.preset];
    app.on('update', () => outlines.update());
    app.start();
    // A refresh lands back in the session if the server still keeps our place.
    void game.start();
    return game;
  }

  get room() {
    return this.net.room;
  }

  // ---- Sessions -----------------------------------------------------------------------------------

  private async start(): Promise<void> {
    const room = await this.net.resume();
    if (room) {
      this.resumed = true;
      this.attach();
      return;
    }
    await this.refreshRooms();
  }

  async refreshRooms(): Promise<void> {
    if (this.room) return;
    try {
      const rooms = await this.net.list();
      this.lobby.showRooms(rooms, this.net.lastError ? `Disconnected: ${this.net.lastError}` : `Server: ${this.net.endpoint}`, this.net.lastError ? 'bad' : 'info');
    } catch {
      this.lobby.showRooms([], `No server at ${this.net.endpoint}. Start one with: npm run server`, 'bad');
    }
  }

  async enter(open: () => Promise<unknown>): Promise<void> {
    try {
      await open();
      this.lobby.clearCode();
      this.attach();
    } catch (error) {
      this.lobby.showRooms(null, error instanceof Error ? error.message : String(error), 'bad');
    }
  }

  /** A room was joined (or resumed): listen to it. */
  private attach(): void {
    const room = this.room!;
    // Our public player id comes with the welcome (the session id only names this connection).
    this.me = null;
    room.onMessage('welcome', (m: WelcomeDTO) => {
      this.me = m.id;
      if (m.reconnected) this.hud.alert('ok', 'Reconnected', null, 'good', 2);
    });
    room.onMessage('me', (m: MeDTO) => this.onPrivate(m));
    room.onMessage('own', (m: OwnFlight) => this.onOwn(m));
    room.onMessage('ev', (events: NetEvent[]) => {
      for (const e of events) this.onEvent(e);
    });
    room.onMessage('claimed', (m: { ok: boolean; error: string | null; territory: string }) => {
      this.claimError = m.ok ? null : `Can't claim ${m.territory}: ${m.error}`;
      if (m.ok) this.sounds.play('spotted');
    });
    room.onStateChange((s) => this.onState(s));
    this.net.onStatus((s) => {
      if (s === 'lost' || s === 'offline') {
        this.reset();
        this.paused = false;
        // The HUD stops drawing without a home: close its menu so the lobby isn't drawn over it.
        if (this.lastHud) this.hud.render({ ...this.lastHud, paused: false, welcome: null });
        void this.refreshRooms();
      }
    });
    this.lobby.showClaim(this.claimView());
    if (this.resumed) this.hud.alert('ok', 'Back in', null, 'good', 2);
  }

  claim(territoryId: string): void {
    this.claimError = null;
    this.net.claim(territoryId);
  }

  async leaveSession(): Promise<void> {
    await this.net.leave();
    this.reset();
    this.paused = false;
    await this.refreshRooms();
  }

  /** Forget the session (left or lost). */
  private reset(): void {
    this.me = null;
    this.state = null;
    this.base = null;
    this.baseMode = null;
    this.home = null;
    for (const k of Object.keys(this.priv)) delete (this.priv as Record<string, unknown>)[k];
    for (const r of [...this.remotes.values(), ...this.ais.values()]) r.alive = false;
    this.remotes.clear();
    this.ais.clear();
    this.aircraftModels.update(0, []);
    this.plane.hide();
    this.markers?.show(null);
    this.fx.clear();
    this.fxIds.clear();
    this.bombs.clear();
    this.predictor.reset();
    this.predictor.model.hide();
    for (const [id, d] of this.dressings) {
      d.root.destroy();
      this.dressings.delete(id);
      this.scene.platforms.get(id)!.render!.enabled = true;
      this.defenseModels.setTerritoryStatics(id, true);
    }
    this.owners.clear();
    this.input.exitPointerLock();
  }

  // ---- Commands -----------------------------------------------------------------------------------

  send(cmd: Command): void {
    if (this.paused || !this.state) return;
    this.sounds.unlock();
    this.net.command(cmd);
  }

  launchPlane(): void {
    if (this.state?.phase !== 'ready') return;
    this.send({ a: 'launch' });
    this.input.consumeMouse();
    this.input.requestPointerLock();
  }

  takeOff(): void {
    if (this.state?.phase !== 'landed') return;
    this.send({ a: 'takeoff' });
    this.input.requestPointerLock();
  }

  baseAction(act: (m: BaseMode) => unknown): void {
    if (this.paused || !this.baseMode?.open) return;
    act(this.baseMode);
  }

  get atHome(): boolean {
    const phase = this.state?.phase;
    return phase === 'desk' || phase === 'building' || phase === 'ready' || (phase === 'landed' && !!this.priv.plane?.stopped);
  }

  toggleBase(open = !this.baseMode?.open): void {
    if (this.paused || !this.baseMode) return;
    if (open && !this.atHome) {
      this.hud.alert('home', 'Land first', null, 'info', 1.6);
      return;
    }
    if (open) {
      this.baseMode.enter();
      this.input.exitPointerLock();
    } else {
      this.baseMode.exit();
      this.defenseModels.showPreview(null);
    }
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
    if (this.state?.phase === 'flying') this.input.requestPointerLock();
  }

  toggleSound(): void {
    this.sounds.muted = !this.sounds.muted;
    this.hud.alert(this.sounds.muted ? 'mute' : 'sound', this.sounds.muted ? 'Sound off' : 'Sound on', null, 'info', 1.4);
  }

  setGraphics(settings: GraphicsSettings): void {
    this.graphics = settings;
    saveGraphics(browserStorage(), settings);
    this.outlines?.configure({ enabled: settings.outlines, quality: settings.outlineQuality, intensity: settings.outlineIntensity });
    const shadows = SHADOW_RESOLUTION[settings.shadows];
    setShadowQuality(this.scene.sun, { enabled: shadows > 0, resolution: shadows });
    for (const d of this.dressings.values()) d.setDetail(settings.detail);
    if (this.instancer) this.instancer.detailDistance = DETAIL_DISTANCE[settings.preset];
    const device = this.app.graphicsDevice;
    const ratio = Math.min(window.devicePixelRatio || 1, settings.resolution);
    if (device.maxPixelRatio !== ratio) {
      device.maxPixelRatio = ratio;
      this.app.resizeCanvas();
    }
  }

  private bindInput(): void {
    const { input } = this;
    input.onKeyDown((code) => {
      this.sounds.unlock();
      if (!this.room || this.lobby.open) return;
      if (code === 'KeyM') return this.toggleSound();
      if (code === 'Escape') {
        if (this.baseMode?.open && !this.paused) return this.toggleBase(false);
        if (this.paused) this.resume();
        else this.pause();
        return;
      }
      if (this.paused || !this.state) return;
      const phase = this.state.phase;
      if (code === 'KeyB') return this.toggleBase();
      if (code === 'KeyZ' || code === 'KeyC' || code === 'KeyV') {
        this.net.emote(code === 'KeyZ' ? 'waggle' : code === 'KeyC' ? 'confetti' : 'heart');
        return;
      }
      if (this.baseMode?.open) {
        const slot = /^(?:Digit|Numpad)(\d)$/.exec(code)?.[1];
        if (slot !== undefined) this.baseMode.selectSlot(slot === '0' ? 'store' : `s${slot}`);
        else if (code === 'Enter' || code === 'NumpadEnter') this.baseMode.build();
        else if (code === 'KeyU') this.baseMode.upgrade();
        else if (code === 'KeyR') this.baseMode.repair();
        else if (code === 'KeyX' || code === 'Delete') this.baseMode.remove();
        return;
      }
      const card = /^(?:Digit|Numpad)([1-7])$/.exec(code)?.[1];
      if (card) return this.send({ a: 'select', i: Number(card) - 1 });
      if (code === 'KeyX') return this.send({ a: 'swap' });
      if (code === 'KeyQ' || code === 'KeyE') {
        const i = AIRCRAFT_ORDER.indexOf(this.state.aircraft);
        const next = AIRCRAFT_ORDER[(i + (code === 'KeyE' ? 1 : -1) + AIRCRAFT_ORDER.length) % AIRCRAFT_ORDER.length];
        return this.send({ a: 'aircraft', id: next });
      }
      if (code === 'KeyF') return this.send({ a: 'build' });
      if (code === 'Space') {
        if (phase === 'ready') this.launchPlane();
        else if (phase === 'landed') this.takeOff();
        else if (phase === 'flying') this.bombQueued = true;
        return;
      }
      if (code === 'KeyR' && phase === 'landed') return this.send({ a: 'rearm' });
      if ((code === 'Enter' || code === 'NumpadEnter') && phase === 'landed') return this.send({ a: 'end' });
      if ((code === 'Enter' || code === 'NumpadEnter') && (phase === 'debrief' || phase === 'crashed')) return this.send({ a: 'continue' });
    });
    input.onCanvasClick((button) => {
      this.sounds.unlock();
      if (this.paused || !this.state) return;
      if (this.state.phase === 'flying' && !input.pointerLocked) input.requestPointerLock();
      else if (button === MOUSE_RIGHT && this.state.phase === 'flying') this.bombQueued = true;
    });
  }

  // ---- Server messages ----------------------------------------------------------------------------

  private onPrivate(m: MeDTO): void {
    Object.assign(this.priv, m);
    const p = this.priv;
    if (p.territory && !this.home) this.becomeOwner(p.territory);
    const st = this.state;
    const base = this.base;
    if (!st || !base) return;
    if (m.economy) {
      this.resources.capacity = m.economy.capacity;
      this.resources.restore(m.economy.paper);
      st.income.perMinute = m.economy.production;
      st.income.capacity = m.economy.capacity;
      if (this.lastPaper >= 0 && m.economy.paper !== this.lastPaper) this.hud.paperDelta(m.economy.paper - this.lastPaper);
      this.lastPaper = m.economy.paper;
    }
    if (m.base) base.sync(m.base, this.resources.paper);
    else if (m.economy) base.resources.restore(this.resources.paper);
    if (m.garage) {
      st.aircraft = m.garage.chosen;
      st.hangar.clear();
      for (const h of m.garage.hangar) st.hangar.set(h.id, { condition: h.condition, health: h.health, invested: 0 });
    }
    if (m.offers) {
      this.offers = m.offers.map((c) => this.missionFor(c));
      st.offers = this.offers;
      // Forget cards that are gone (keeping the one in the air).
      const keep = new Set([...m.offers.map((c) => c.key), this.priv.mission?.key]);
      for (const key of [...this.missions.keys()]) if (!keep.has(key)) this.missions.delete(key);
    }
    if (m.selected !== undefined) st.selected = Math.min(m.selected, Math.max(0, st.offers.length - 1));
    if (m.mission !== undefined) st.mission = m.mission ? this.missionFor(m.mission) : null;
    if (m.progress !== undefined && st.mission && m.progress) {
      const mission = st.mission;
      mission.status = m.progress.status;
      mission.failure = m.progress.failure;
      mission.elapsed = m.progress.elapsed;
      m.progress.progress.forEach((v, i) => (mission.progress[i] = v));
    }
    if (m.plane !== undefined) {
      const d = m.plane;
      if (!d) {
        st.plane = null;
        st.durability = null;
        st.gun = null;
      } else {
        const spec = d.emergency ? emergencyDart() : AIRCRAFT[d.id];
        if (st.plane?.id !== spec.id || st.emergency !== d.emergency) {
          st.plane = spec;
          st.durability = new Durability(spec.maxHealth);
          st.gun = new Gun(spec.gun);
        }
        st.emergency = d.emergency;
        st.durability!.health = d.health;
        st.gun!.ammo = d.ammo;
        st.bombsLoaded = d.bombs;
        st.bombsFalling = d.falling;
        st.bombCooldown = d.cooldown;
        st.rangeLeft = d.range;
        st.rearmProgress = d.rearm;
        st.buildProgress = d.build;
        st.buildKind = d.buildKind;
        this.cosmeticBombs = d.bombs;
      }
    }
    if (m.phase) {
      st.phase = m.phase;
      this.onPhase(m.phase);
    }
    if (m.report && m.report.role === 'defender' && m.report.outcome === 'bombed') this.sounds.play('raid');
  }

  private missionFor(card: CardDTO): Mission {
    let mission = this.missions.get(card.key);
    if (!mission) {
      mission = new Mission(card.spec);
      this.missions.set(card.key, mission);
    }
    this.cards.set(mission, card);
    return mission;
  }

  /** Our territory was claimed: the mirrors, the desk on it, the launch point. */
  private becomeOwner(territoryId: string): void {
    const home = this.territories.find((t) => t.id === territoryId)!;
    this.home = home;
    const at = launchPoint(home);
    this.launch.set(at.x, 0, at.z);
    this.launchYaw = at.yaw;
    const side = sideOf(this.me!);
    this.base = new NetBase(home, side, (cmd) => this.send(cmd), new ResourceManager());
    this.base.onEvent((e) => {
      if (e.type !== 'refused') return;
      const what = { paper: 'Need paper', slot: 'Wrong slot', unique: 'Only one', 'max-level': 'Max level', destroyed: 'Repair first', intact: 'Intact' }[e.reason];
      this.hud.alert(e.reason === 'paper' ? 'paper' : 'warn', what, e.reason === 'paper' ? `−${e.missing}` : null, 'bad', 1.8);
    });
    this.baseMode = new BaseMode(this.base);
    this.state = new GameState(this.resources, () => this.offers);
    const world = { territories: this.territories, home, platforms: this.scene.platforms } as unknown as World;
    this.markers ??= new MissionMarkers(this.app, world, (id) => {
      const i = this.network.get(id)?.spec;
      return i ? { x: i.x, z: i.z, r: i.footprint + 0.6 } : null;
    });
    this.lobby.hide();
    this.camera.updateDesk(0, this.launch, this.launchYaw, true);
    this.hud.alert('home', territoryName(territoryId), 'yours', 'good', 3);
    this.hud.tip('Pick a card, pick a plane (Q/E), fold it (F), launch (Space). Tab shows the scoreboard; Z / C / V are emotes.', ['F', 'Space', 'Tab']);
  }

  private onPhase(phase: GamePhase): void {
    if (phase === this.lastPhase) return;
    const before = this.lastPhase;
    this.lastPhase = phase;
    const st = this.state!;
    if (phase === 'building' || phase === 'ready') {
      const spec = st.plane ?? AIRCRAFT[st.aircraft];
      this.plane.setAircraft(spec.id);
      this.plane.setDamage(1);
      this.plane.park(this.launch, this.launchYaw, this.home!.id, phase === 'ready' ? 1 : 0);
      this.predictor.flight.model.setAircraft(spec);
      this.predictor.flight.model.park({ x: this.launch.x, y: 0.35, z: this.launch.z }, this.launchYaw, this.home!.id);
      if (phase === 'ready' && before === 'building') this.effects.burst(this.plane.position, 'fold');
    }
    if (phase === 'flying' && before !== 'landed') {
      this.trails.clear();
      this.offset.set(0, 0, 0);
      this.cosmeticCooldown = 0;
      this.sounds.play('launch');
    }
    if (phase === 'desk') {
      this.plane.hide();
      this.predictor.reset();
      this.predictor.model.hide();
      this.trails.clear();
    }
    if (phase === 'crashed') {
      this.crashPoint.copy(this.plane.position);
      this.crashedAt = performance.now();
      this.plane.crash();
      this.predictor.model.crash();
      this.input.exitPointerLock();
    }
    if (phase === 'landed') this.effects.burst(this.plane.position, 'dust');
    if (phase === 'debrief') this.input.exitPointerLock();
    if (this.baseMode?.open && !this.atHome) this.toggleBase(false);
  }

  /** The server's state for our plane: rewind, replay, ease the difference out. */
  /** The server's input counters for us, for the network panel. */
  serverInputs: [number, number, number, number] = [0, 0, 0, 0];
  readonly errors: number[] = [];

  private onOwn(own: OwnFlight): void {
    this.serverInputs = own.inputs;
    const m = this.predictor.model;
    const bx = m.position.x;
    const by = m.position.y;
    const bz = m.position.z;
    const wasFlying = m.status === 'flying' || m.status === 'rolling';
    this.predictor.reconcile(own, this.predictionWorld());
    if (!wasFlying) {
      // Just launched: start from the server's plane, no easing.
      this.offset.set(0, 0, 0);
      this.savePrev();
      if (this.state?.plane) this.predictor.model.setAircraft(this.state.plane);
      this.predictor.reconcile(own, this.predictionWorld());
      return;
    }
    const dx = bx - m.position.x;
    const dy = by - m.position.y;
    const dz = bz - m.position.z;
    this.errors.push(Math.hypot(dx, dy, dz));
    if (this.errors.length > 600) this.errors.shift();
    if (Math.hypot(dx, dy, dz) > SNAP_ERROR) {
      this.offset.set(0, 0, 0);
      this.savePrev();
      return;
    }
    this.offset.x += dx;
    this.offset.y += dy;
    this.offset.z += dz;
    this.prev.x -= dx;
    this.prev.y -= dy;
    this.prev.z -= dz;
  }

  /** A schema patch: new states for everyone else's planes, the AI's and the installations. */
  private onState(s: WorldState): void {
    const now = performance.now() / 1000;
    if (s.time === this.lastStateTime) return;
    this.lastStateTime = s.time;
    this.clock.observe(s.time, now);
    // Players' planes (not our own: that one is predicted).
    const seen = new Set<string>();
    s.planes.forEach((p, id) => {
      if (id === this.me) return;
      seen.add(id);
      let r = this.remotes.get(id);
      const kind = p.kind as AircraftId;
      if (!r || r.spec.id !== kind) {
        if (r) r.alive = false;
        r = new RemoteAircraft(`pl:${id}`, sideOf(id), { id: kind });
        this.remotes.set(id, r);
      }
      r.status = PLANE_STATUSES[p.status] ?? 'flying';
      r.durability.fraction = p.hp / 255;
      r.bombs = p.bombs;
      r.buffer.push(s.time, { x: p.x, y: p.y, z: p.z, yaw: signedAngle(p.yaw), pitch: signedAngle(p.pitch), roll: signedAngle(p.roll) });
    });
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      r.alive = false;
      this.remotes.delete(id);
    }
    // AI aircraft.
    const ai = new Set<string>();
    s.ai.forEach((a, id) => {
      ai.add(id);
      let r = this.ais.get(id);
      if (!r) {
        r = new RemoteAircraft(id, a.side as Side, { id: a.kind as AircraftId });
        r.role = a.role;
        this.ais.set(id, r);
      }
      r.durability.fraction = a.hp / 255;
      r.target = a.target || null;
      r.attacking = a.attacking;
      r.leaving = a.leaving;
      r.buffer.push(s.time, { x: a.x, y: a.y, z: a.z, yaw: signedAngle(a.yaw), pitch: signedAngle(a.pitch), roll: signedAngle(a.roll) });
    });
    for (const [id, r] of this.ais) {
      if (ai.has(id)) continue;
      r.alive = false;
      this.ais.delete(id);
    }
    this.syncInstallations(s);
    this.syncTerritories(s);
    if (!this.home && this.room) this.lobby.showClaim(this.claimView());
  }

  /** The installations as the server has them: added, removed, aimed, damaged. */
  private syncInstallations(s: WorldState): void {
    let changed = false;
    s.installations.forEach((st, id) => {
      let i = this.network.get(id);
      if (!i) {
        const spec = this.specFor(id, st.kind, st.owner, st.slot, st.level);
        if (!spec) return;
        i = this.network.add(spec);
        changed = true;
      } else if (st.owner && (i.spec.level ?? 1) !== st.level && st.slot !== 'store') {
        const spec = this.specFor(id, st.kind, st.owner, st.slot, st.level);
        if (spec) {
          i = this.network.replace(spec);
          changed = true;
        }
      }
      i.durability.health = Math.round((st.hp / 255) * i.durability.max);
      const state = INSTALLATION_STATES[st.state] as InstState;
      i.state = i.alive ? (state === 'destroyed' ? 'idle' : state) : 'destroyed';
      i.lock = st.lock / 255;
      i.targetId = st.target || null;
      // Turn smoothly towards the server's aim (patches are 50 ms apart).
      i.pitch = signedAngle(st.pitch);
      i.yaw += angleDiff(i.yaw, signedAngle(st.yaw)) * 0.7;
    });
    for (const i of [...this.network.installations]) {
      if (s.installations.has(i.id)) continue;
      this.network.remove(i.id);
      changed = true;
    }
    if (changed) this.defenseModels.sync();
  }

  /** The spec of an installation the server reports: the AI's from the shared layout, a player's from their base. */
  private specFor(id: string, kind: string, owner: string, slot: string, level: number): InstallationSpec | null {
    if (!owner) return this.shared.layout.installations.find((i) => i.id === id) ?? null;
    const home = this.territories.find((t) => id.startsWith(`${t.id}-`));
    if (!home) return null;
    const side = sideOf(owner);
    if (slot === 'store') return homeDefenses(home, side)[0];
    if (kind === 'supply') return null;
    return buildingSpec(home, slot, kind as Parameters<typeof buildingSpec>[2], level, side);
  }

  /** Territory owners: a desk on every claimed territory, in its owner's tape. */
  private syncTerritories(s: WorldState): void {
    s.territories.forEach((t, id) => {
      const owner = t.owner;
      if ((this.owners.get(id) ?? '') === owner) return;
      if (owner) this.owners.set(id, owner);
      else this.owners.delete(id);
      const territory = this.territories.find((x) => x.id === id)!;
      territory.threat = t.threat as Territory['threat'];
      this.dressings.get(id)?.root.destroy();
      this.dressings.delete(id);
      const platform = this.scene.platforms.get(id)!;
      this.defenseModels.setTerritoryStatics(id, !owner);
      if (!owner) {
        platform.render!.enabled = true;
        return;
      }
      platform.render!.enabled = false;
      const dir = launchPoint(territory).dir;
      // Dressed as a desk with a runway; props that could be flown into are left out (the server doesn't know them).
      const layout = { ...HOME_DESK, landmark: null, props: HOME_DESK.props.filter((p) => !PROPS[p.prop].colliders?.length) };
      this.dressings.set(id, new Dressing(this.app, territory, layout, this.assets, this.graphics.detail, dir, true, owner === this.me ? 'tape/blue' : 'tape/masking'));
    });
  }

  claimView(): ClaimView {
    const s = this.room?.state;
    const players = s ? [...s.players.entries()] : [];
    return {
      title: this.roomTitle,
      cells: this.territories.map((t) => {
        const st = s?.territories.get(t.id);
        const owner = st?.owner || null;
        const p = owner ? s?.players.get(owner) : undefined;
        return {
          id: t.id, name: territoryName(t.id), threat: st?.threat ?? t.threat, owner, ownerName: p?.name ?? null, colour: p?.colour ?? 0,
          claimable: st?.claimable ?? t.id !== PVP.centre, mine: owner === this.me, connected: p?.connected ?? true,
        };
      }),
      players: players.map(([id, p]) => ({ name: p.name, colour: p.colour, territory: p.territory || null, connected: p.connected, me: id === this.me })),
      error: this.claimError,
    };
  }

  // ---- Events -------------------------------------------------------------------------------------

  private onEvent(e: NetEvent): void {
    const at = (p: number[]) => this.v1.set(p[0], p[1], p[2]);
    switch (e.t) {
      case 'shot': {
        const mine = !!this.me && (e.o === this.me || ownerOfSide(e.side) === this.me);
        const shot = this.fx.spawn({
          kind: e.k, source: e.o ? `pl:${e.o}` : `srv-${e.id}`, side: mine ? 'player' : 'enemy',
          x: e.p[0], y: e.p[1], z: e.p[2], vx: e.v[0], vy: e.v[1], vz: e.v[2], target: e.tg, damage: 0, travel: e.tr, radius: e.r,
        });
        this.fxIds.set(e.id, shot);
        if (this.near(e.p)) this.sounds.play(e.k === 'rocket' ? 'launch' : 'ink');
        break;
      }
      case 'end': {
        const shot = this.fxIds.get(e.id);
        if (shot) {
          shot.active = false;
          this.fxIds.delete(e.id);
        }
        const point = at(e.p);
        if (e.fx === 'pop') {
          this.effects.explosion(point, 0.45);
          if (this.near(e.p)) this.sounds.play('pop');
        } else if (e.k === 'rocket') {
          if (e.fx !== 'spent') this.effects.explosion(point, e.fx === 'hit' ? 0.7 : 0.5);
          else this.effects.burst(point, 'dust');
        } else if (e.fx !== 'spent') {
          this.effects.enemyInkHit(point, e.fx === 'ground');
        }
        break;
      }
      case 'dmg':
        this.onDamage(e);
        break;
      case 'drop':
        if (e.o !== this.me) this.bombs.release({ x: e.p[0], y: e.p[1], z: e.p[2] }, { x: e.v[0], y: e.v[1], z: e.v[2] }, e.kind as BombKind, true, `srv:${e.o}`);
        break;
      case 'boom': {
        const point = at(e.p);
        this.effects.bombImpact(point, e.on);
        const screen = this.views.project(point);
        if (screen && e.o === this.me) this.hud.pop(e.on ? 'BOOM!' : 'SPLAT!', e.on ? 'good' : 'bad', screen);
        break;
      }
      case 'down': {
        const mine = this.me && e.id === `pl:${this.me}`;
        const owner = planeOwner(e.id) ?? ownerOfSide(e.side);
        const colour = owner ? PLAYER_COLOURS[(this.room?.state.players.get(owner)?.colour ?? 0) % PLAYER_COLOURS.length] : PALETTE.enemyAccent;
        const point = mine ? this.plane.position : at(e.p);
        this.effects.wreck(point, this.v2.set(e.v[0], e.v[1], e.v[2]), colour, 1, e.side === 'enemy' ? PALETTE.enemyPaper : PALETTE.paper);
        if (this.near(e.p)) this.sounds.play('crumple');
        if (mine) this.crashPoint.copy(point);
        const r = this.ais.get(e.id) ?? (owner ? this.remotes.get(owner) : undefined);
        if (r) r.alive = false;
        break;
      }
      case 'kill': {
        const s = this.room?.state;
        const colourOf = (id: string | null) => (id ? (s?.players.get(id)?.colour ?? null) : null);
        const assists = e.assists.map((id) => s?.players.get(id)?.name ?? '?');
        this.mpHud.kill(e.killer ? e.killerName : e.killerName || null, colourOf(e.killer), e.victimName, e.victim ? colourOf(e.victim) : null, e.weapon, assists, e.killer === this.me || e.victim === this.me);
        if (e.killer === this.me && e.victim) this.sounds.play('kill');
        break;
      }
      case 'emote': {
        const r = e.o === this.me ? null : this.remotes.get(e.o);
        const now = performance.now() / 1000;
        if (r) {
          r.emote = e.e;
          r.emoteUntil = now + EMOTE_TIME;
          if (e.e === 'waggle') r.waggle = WAGGLE_TIME;
          if (e.e === 'confetti') this.effects.burst(this.v1.copy(r.model.position), 'fold');
        } else if (e.o === this.me) {
          if (e.e === 'confetti') this.effects.burst(this.v1.copy(this.plane.position), 'fold');
          if (e.e === 'waggle') this.ownWaggle = WAGGLE_TIME;
          this.hud.alert('plane', e.e === 'heart' ? '♥' : e.e === 'confetti' ? 'Confetti!' : 'Waggle', null, 'info', 1);
        }
        break;
      }
      case 'note':
        this.hud.alert((ICONS.has(e.icon) ? e.icon : 'info') as IconName, e.title, e.value, e.tone, 2.4);
        if (e.icon === 'raid' && e.tone !== 'good') this.sounds.play('raid');
        if (e.title === 'Locked on') this.sounds.play('lock');
        break;
      case 'news':
        this.mpHud.news(e.text, e.tone);
        break;
      case 'inst': {
        const i = this.network.get(e.id);
        if (i && e.wrecked) this.effects.explosion(this.defenseModels.centre(e.id, this.v1), 1.1, 'wreck');
        if (i && e.wrecked && this.near([i.spec.x, 0, i.spec.z])) this.sounds.play('collapse');
        break;
      }
    }
  }

  private ownWaggle = 0;
  private lastTickMs = 0;

  private onDamage(e: Extract<NetEvent, { t: 'dmg' }>): void {
    const point = this.v1.set(e.p[0], e.p[1], e.p[2]);
    const mine = this.me && e.tg === `pl:${this.me}`;
    if (mine) {
      this.hud.damageFlash(e.n);
      this.sounds.play('hit');
      const from = e.by ? this.remotes.get(e.by)?.model.position : null;
      if (from) this.hud.damageDirection(this.views.bearing(from.x, from.z), e.n);
      return;
    }
    if (e.by === this.me) {
      this.hitAt.set(e.tg, performance.now());
      const screen = this.views.project(point);
      if (screen) this.hud.damageNumber(e.n, screen, !!e.fatal);
      this.hud.hitMarker(!!e.fatal);
      if (e.fatal && planeOwner(e.tg) === null) {
        const pop = this.views.project(point);
        if (pop) this.hud.pop(this.network.get(e.tg) ? 'DESTROYED!' : 'SHOT DOWN!', 'good', pop);
      }
    }
  }

  private near(p: number[]): boolean {
    const eye = this.camera.entity.getPosition();
    return Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z) < 120;
  }

  // ---- The frame ----------------------------------------------------------------------------------

  predictionWorld(): PredictionWorld {
    const solids = this.network.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.solids }));
    for (const b of this.shared.layout.barriers) if (!this.owners.has(b.territoryId)) solids.push({ id: b.id, shapes: b.solids });
    return { home: this.home, territories: this.territories, solids };
  }

  private tick(rawDt: number): void {
    const dt = Math.min(rawDt, 0.1);
    const mouse = this.input.consumeMouse();
    if (!this.paused && this.input.pointerLocked) {
      this.mouseX += mouse.dx;
      this.mouseY += mouse.dy;
    }
    this.touchTimer -= dt;
    if (this.touchTimer <= 0) {
      this.touchTimer = 5;
      this.net.touch();
    }
    // Frames keep pace with real time even when drawing is slow (the engine clamps its own dt to
    // 0.1 s), so the server never runs dry and has to fly the plane on by itself.
    const nowMs = performance.now();
    const realDt = this.lastTickMs > 0 ? (nowMs - this.lastTickMs) / 1000 : dt;
    this.lastTickMs = nowMs;
    this.stepPrediction(Math.min(realDt, 1));
    this.flush();
    this.updateRemotes(dt);
    this.updateScene(dt);
    this.hud.root.classList.toggle('mp-pregame', !this.home);
    if (this.home) {
      this.lastHud = this.views.hud();
      this.hud.render(this.lastHud);
    }
    this.mpHud.render(this.mpView());
  }

  /** Fixed steps of the pilot's own plane, each one a frame for the server. */
  private stepPrediction(dt: number): void {
    const st = this.state;
    if (!st || !this.home || this.net.status !== 'connected') {
      this.acc = 0;
      return;
    }
    const input = this.input;
    this.acc = Math.min(this.acc + dt, 1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.savePrev();
      const m = this.predictor.model;
      const flying = st.phase === 'flying' && m.status === 'flying';
      const live = !this.paused && input.pointerLocked;
      const frame: InputFrame = {
        seq: this.predictor.nextSeq(),
        mx: live ? this.mouseX : 0,
        my: live ? this.mouseY : 0,
        throttle: this.paused ? 0 : (input.axis('KeyS', 'KeyW') as -1 | 0 | 1),
        bank: this.paused ? 0 : (input.axis('KeyD', 'KeyA') as -1 | 0 | 1),
        boost: !this.paused && (input.isHeld('ShiftLeft') || input.isHeld('ShiftRight')),
        autoLevel: !this.views.onApproach(),
        fire: flying && live && input.isButtonHeld(MOUSE_LEFT),
        bomb: flying && this.bombQueued,
      };
      this.mouseX = 0;
      this.mouseY = 0;
      this.bombQueued = false;
      this.outbox.push(frame);
      const result = this.predictor.apply(frame, this.predictionWorld());
      if (result?.collisions.length) this.effects.burst(this.plane.position, 'thud');
      this.cosmeticCooldown = Math.max(0, this.cosmeticCooldown - STEP);
      if (frame.fire) this.cosmeticFire();
      if (frame.bomb) this.cosmeticBomb();
    }
    this.offset.mulScalar(Math.exp(-dt * 9));
  }

  private savePrev(): void {
    const m = this.predictor.model;
    this.prev.x = m.position.x;
    this.prev.y = m.position.y;
    this.prev.z = m.position.z;
    this.prev.yaw = m.yaw;
    this.prev.pitch = m.pitch;
    this.prev.roll = m.roll;
  }

  /** Our own round, drawn at once from the predicted plane (the server decides what it hits). */
  private cosmeticFire(): void {
    const st = this.state!;
    const spec = st.plane;
    if (!spec || (st.gun?.ammo ?? 0) <= 0 || this.cosmeticCooldown > 0) return;
    this.cosmeticCooldown = spec.gun.interval;
    const m = this.predictor.model;
    const muzzles = PLANE_SHAPES[spec.id].muzzles;
    const [lx, ly, lz] = muzzles[this.cosmeticBarrel % muzzles.length];
    this.cosmeticBarrel = (this.cosmeticBarrel + 1) % spec.gun.barrels;
    const muzzle = m.toWorld(lx, ly, lz, { x: 0, y: 0, z: 0 });
    const aim = m.getForward(this.v1).mulScalar(45).add(m.position);
    const dir = this.v2.set(aim.x - muzzle.x, aim.y - muzzle.y, aim.z - muzzle.z).normalize().mulScalar(spec.gun.speed);
    const v = m.getVelocity(this.v1).add(dir);
    this.fx.spawn({ kind: 'ink', source: `pl:${this.me}`, side: 'player', x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: v.x, vy: v.y, vz: v.z, damage: 0, travel: spec.gun.range, radius: 0.12 });
    this.sounds.play('ink');
  }

  private cosmeticBomb(): void {
    const st = this.state!;
    const spec = st.plane;
    if (!spec || this.cosmeticBombs <= 0 || st.bombCooldown > 0) return;
    this.cosmeticBombs--;
    const m = this.predictor.model;
    const slots = PLANE_SHAPES[spec.id].bombSlots;
    const [lx, ly, lz] = slots[Math.min(this.cosmeticBombs, slots.length - 1)];
    const at = m.toWorld(lx, ly, lz, { x: 0, y: 0, z: 0 });
    this.bombs.release(at, m.getVelocity(this.v1), spec.bombs.kind, true, 'own');
  }

  private flush(): void {
    while (this.outbox.length > 0) this.net.sendFrames(this.outbox.splice(0, NET.framesPerMessage));
  }

  /** Everyone else: interpolated between the server's states, drawn a little in the past. */
  private updateRemotes(dt: number): void {
    const now = performance.now() / 1000;
    const renderTime = this.clock.now(now) - NET.interpolationDelay;
    const shown: ShownAircraft[] = [];
    for (const r of [...this.remotes.values(), ...this.ais.values()]) {
      if (!r.buffer.sample(renderTime, this.tmp)) continue;
      const m = r.model;
      m.prevPosition.copy(m.position);
      m.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      m.yaw = this.tmp.yaw;
      m.pitch = this.tmp.pitch;
      m.roll = this.tmp.roll;
      if (r.waggle > 0) {
        r.waggle = Math.max(0, r.waggle - dt);
        m.roll += Math.sin((WAGGLE_TIME - r.waggle) * 14) * 0.7 * Math.min(1, r.waggle * 3);
      }
      if (r.emote && now > r.emoteUntil) r.emote = null;
      // Parked and folding planes on other desks are shown too; crashed ones are the wreck's.
      if (r.status === 'hidden' || r.status === 'crashed') continue;
      shown.push(r);
    }
    this.aircraftModels.update(dt, shown);
  }

  private updateScene(dt: number): void {
    const st = this.state;
    const phase = st?.phase ?? null;
    const m = this.predictor.model;
    // Our own plane: the predicted pose between the last two steps, eased towards the server's.
    if (st && (m.status === 'flying' || m.status === 'rolling' || m.status === 'stopped')) {
      const k = this.acc / STEP;
      const motion = this.plane.motion;
      motion.loadState(m.saveState(this.snapshot));
      motion.position.set(
        this.prev.x + (m.position.x - this.prev.x) * k + this.offset.x,
        this.prev.y + (m.position.y - this.prev.y) * k + this.offset.y,
        this.prev.z + (m.position.z - this.prev.z) * k + this.offset.z,
      );
      motion.yaw = this.prev.yaw + angleDiff(this.prev.yaw, m.yaw) * k;
      motion.pitch = this.prev.pitch + angleDiff(this.prev.pitch, m.pitch) * k;
      motion.roll = this.prev.roll + angleDiff(this.prev.roll, m.roll) * k;
      if (this.ownWaggle > 0) {
        this.ownWaggle = Math.max(0, this.ownWaggle - dt);
        motion.roll += Math.sin((WAGGLE_TIME - this.ownWaggle) * 14) * 0.7 * Math.min(1, this.ownWaggle * 3);
      }
      if (this.plane.spec.id !== m.spec.id) this.plane.setAircraft(m.spec.id);
      this.plane.setDamage(st.durability?.fraction ?? 1);
      this.plane.setBombs(phase === 'flying' || phase === 'landed' ? st.bombsLoaded : 0);
      this.plane.pose(true);
    } else if (st && (phase === 'building' || phase === 'ready')) {
      if (phase === 'building') this.plane.setFold(st.buildKind === 'fold' ? st.buildProgress : st.buildKind === 'rollout' ? 1 : st.buildProgress < 0.35 ? 1 - (st.buildProgress / 0.35) * 0.5 : 0.5 + ((st.buildProgress - 0.35) / 0.65) * 0.5);
      else this.plane.setFold(1);
    }
    this.plane.animate(dt);
    // Home hangars: ours grows with the planes we keep in it; rivals' show their first level.
    for (const [id, d] of this.dressings) d.updateHangar(dt, id === this.home?.id ? (st?.hangar.size ?? 0) : 0);

    // The camera, as single-player's.
    const baseOpen = !!this.baseMode?.open;
    if (!st || !this.home) {
      this.camera.updateBase(dt, { x: 0, z: 0 }, 0.6);
    } else if (baseOpen) {
      this.camera.updateBase(dt, this.home, this.launchYaw);
    } else if (phase === 'desk' || phase === 'building' || phase === 'ready') {
      this.camera.updateDesk(dt, this.launch, this.launchYaw);
    } else if (phase === 'crashed') {
      this.camera.updateWatch(dt, this.crashPoint);
    } else {
      this.camera.updateFollow(dt, this.plane, this.territories, null);
    }

    // Base management: slot pads and the see-through preview.
    if (this.baseMode && this.base) {
      const pads = this.baseMode.highlights();
      this.defenseModels.setSlots(pads.map((p) => {
        const at = this.base!.installation(p.id)?.spec ?? { x: this.home!.x, z: this.home!.z };
        return { id: p.id, x: at.x, z: at.z, highlight: p.highlight };
      }));
      const preview = this.baseMode.preview();
      this.defenseModels.showPreview(preview?.spec ?? null, preview?.valid ?? true);
    }

    // Installations: radar dishes spin, flashes fade, wrecks collapse.
    for (const i of this.network.installations) {
      i.sinceShot += dt;
      if (i.spec.kind === 'radar' && i.alive) i.spin += dt * 1.6;
    }
    const flying = phase === 'flying';
    this.defenseModels.update(dt, flying ? this.plane.position : null, flying ? this.views.approachedTerritory() : null, baseOpen ? (this.home?.id ?? null) : null);

    // Rounds and rockets: drawn from the server's events (and our own, at once).
    const targets = [...this.remotes.values(), ...this.ais.values()]
      .filter((r) => r.alive && r.status === 'flying')
      .map((r) => ({ id: r.id, side: r.side === sideOf(this.me ?? '') ? ('player' as Side) : ('enemy' as Side), x: r.model.position.x, y: r.model.position.y, z: r.model.position.z, px: r.model.prevPosition.x, py: r.model.prevPosition.y, pz: r.model.prevPosition.z, radius: AIRCRAFT[r.spec.id].hitRadius }));
    if (flying) {
      const p = this.plane.position;
      targets.push({ id: `pl:${this.me}`, side: 'player', x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z, radius: this.plane.spec.hitRadius });
    }
    this.fx.update(dt, targets, this.territories);
    for (const [id, shot] of this.fxIds) if (!shot.active) this.fxIds.delete(id);
    this.ordnanceView.update(dt, this.fx, this.camera.entity.getPosition());
    // Bombs fall for show; the server's 'boom' says where they really landed.
    const solids = this.network.installations.filter((i) => i.alive).map((i) => ({ id: i.id, shapes: i.spec.shapes }));
    this.bombs.update(dt, [], this.territories, solids);

    if (this.markers && st) {
      const choosing = phase === 'desk' || phase === 'building' || phase === 'ready';
      const shown = choosing ? (st.offers[st.selected] ?? null) : st.mission;
      if (this.markers.shown !== shown) this.markers.show(shown);
      this.markers.update(dt);
    }
    this.trails.update(dt, this.plane, st?.durability?.fraction ?? 1);
    this.effects.update(dt);
    const attacked = flying && this.ais.size > 0 && this.views.threatened();
    this.sounds.combat(dt, attacked ? 1 : 0);
    const locks = flying ? this.network.installations.filter((i) => i.state === 'locking' && i.alive && this.views.lockingOnMe(i)) : [];
    this.sounds.lockTone(dt, locks.length > 0 ? Math.max(...locks.map((i) => i.lock)) : null);
  }

  // ---- Multiplayer HUD ----------------------------------------------------------------------------

  private mpView(): MpHudView {
    const s = this.room?.state;
    const now = performance.now() / 1000;
    const players = s ? [...s.players.entries()] : [];
    const scoreboard = this.input.isHeld('Tab') && this.room
      ? players
          .map(([id, p]): ScoreRow => ({
            id, name: p.name, colour: p.colour, territory: p.territory, score: p.score, kills: p.kills, deaths: p.deaths, assists: p.assists,
            raids: p.raids, defends: p.defends, missions: p.missions, ping: p.ping, connected: p.connected, me: id === this.me,
            status: ['At desk', 'Folding', 'On the pad', 'Flying', 'Landed', 'Debrief', 'Shot down'][p.phase] ?? '', protect: p.protect, shield: p.shield,
          }))
          .sort((a, b) => b.score - a.score || b.kills - a.kills)
      : null;
    const tags = [];
    for (const [id, r] of this.remotes) {
      const p = s?.players.get(id);
      if (!p || !r.alive || r.status === 'hidden' || r.status === 'crashed') continue;
      const point = this.v1.copy(r.model.position);
      point.y += 2.2;
      const screen = this.views.project(point);
      if (!screen) continue;
      const d = r.model.position.distance(this.camera.entity.getPosition());
      if (d > 260) continue;
      tags.push({
        id, x: screen.x, y: screen.y, name: p.name, colour: p.colour, health: r.durability.fraction, far: Math.min(1, Math.max(0, (d - 30) / 200)),
        hostile: true, plane: AIRCRAFT[r.spec.id].name, emote: r.emote && now < r.emoteUntil ? r.emote : null,
      });
    }
    const territories = [];
    for (const [tid, owner] of this.owners) {
      if (owner === this.me) continue; // our own desk has its home label
      const t = this.territories.find((x) => x.id === tid)!;
      const ts = s?.territories.get(tid);
      const p = s?.players.get(owner);
      const screen = this.views.project(this.v1.set(t.x, 1, t.z));
      if (!screen || !p) continue;
      if (this.state?.phase === 'flying' && Math.hypot(t.x - this.plane.position.x, t.z - this.plane.position.z) < t.size * 0.6) continue;
      territories.push({ id: tid, x: screen.x, y: screen.y, owner: p.name, colour: p.colour, mine: owner === this.me, safe: !!ts?.safe, alert: !!ts?.alert, away: !p.connected });
    }
    const attacks = this.priv.attacks ?? [];
    const incoming = attacks.find((a) => a.victim === this.me);
    const outgoing = attacks.find((a) => a.attacker === this.me);
    return {
      status: this.net.status,
      ping: this.net.rtt,
      players: s?.players.size ?? 0,
      maxPlayers: NET.maxPlayers,
      room: this.roomTitle,
      tags,
      territories,
      scoreboard,
      incoming: incoming ? { attacker: incoming.attackerName, colour: s?.players.get(incoming.attacker)?.colour ?? 0, detected: incoming.detected, distance: incoming.distance } : null,
      outgoing: outgoing ? { victim: outgoing.victimName, colour: s?.players.get(outgoing.victim)?.colour ?? 0 } : null,
      protection: this.priv.protection ?? null,
      emoteKeys: this.state?.phase === 'flying',
    };
  }
}


import * as pc from 'playcanvas';
import { CAMERA, PLANE } from './config';
import { Bomb, type BombImpact } from './aircraft/Bomb';
import { ChaseCamera } from './aircraft/ChaseCamera';
import { PlaneController } from './aircraft/PlaneController';
import { BombingMission } from './missions/BombingMission';
import { GameState, type CrashCause } from './systems/GameState';
import { Input } from './systems/Input';
import { ResourceManager } from './systems/ResourceManager';
import { HUD, type HudView, type ScreenPoint, type TargetIndicator, type TerritoryLabel } from './ui/HUD';
import { Effects } from './world/Effects';
import { buildWorld, type World } from './world/WorldGenerator';

/** Ignore an Esc key press this soon after the browser released pointer lock (it was the same press). */
const ESC_AFTER_UNLOCK_MS = 300;
/** Distance at which the nose and aim reticles are projected. */
const RETICLE_RANGE = 60;

/**
 * Wires the rules (GameState, mission, paper) to the 3D scene, input and HUD, and runs the frame
 * loop. The rules never touch rendering; this class translates between the two.
 */
export class Game {
  readonly resources = new ResourceManager();
  readonly mission = new BombingMission();
  readonly state = new GameState(this.resources, this.mission);
  paused = false;

  private returnQueued = false;
  private lastAutoPause = -Infinity;
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
    readonly plane: PlaneController,
    readonly bomb: Bomb,
    readonly camera: ChaseCamera,
    readonly effects: Effects,
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
    const camera = new ChaseCamera(app);
    const plane = new PlaneController(app);
    const bomb = new Bomb(app);
    const effects = new Effects(app);
    const input = new Input(canvas);

    let game: Game | undefined;
    const hud = new HUD(hudRoot, {
      fold: () => game?.fold(),
      resetPaper: () => game?.resetPaper(),
      returnHome: () => game?.requestReturn(),
      resume: () => game?.resume(),
    });
    game = new Game(app, world, plane, bomb, camera, effects, input, hud);
    game.bindEvents();
    camera.updateDesk(0, world.launchPosition, world.launchYaw, true);
    app.on('update', (dt: number) => game!.tick(dt));
    app.start();
    return game;
  }

  // ---- Player actions -------------------------------------------------------------------------

  /** Spend paper to fold a plane on the launch pad. Only possible at home with no plane out. */
  fold(): void {
    if (this.paused || !this.state.foldPlane()) return;
    const pad = this.v1.copy(this.world.launchPosition);
    pad.y = PLANE.parkedHeight;
    this.plane.park(pad, this.world.launchYaw, this.world.home.id);
    this.effects.burst(pad, 'fold');
  }

  launch(): void {
    if (this.paused || !this.state.launch()) return;
    this.plane.launch();
    this.input.consumeMouse(); // ignore mouse travel from before take-off
    this.input.requestPointerLock();
  }

  dropBomb(): void {
    if (this.paused || this.state.phase !== 'flying' || this.bomb.active) return;
    if (!this.plane.releaseBomb()) return;
    this.bomb.release(this.plane.getBombPosition(this.v1), this.plane.getVelocity(this.v2));
  }

  /** R: go home. A bomb that is already falling gets to land first, so its result still counts. */
  requestReturn(): void {
    if (this.paused) return;
    if (this.state.phase === 'crashed') {
      this.finishReturn();
    } else if (this.state.phase === 'flying') {
      if (this.bomb.active) this.returnQueued = true;
      else this.finishReturn();
    }
  }

  resetPaper(): void {
    this.state.resetPaper();
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
    const { world, plane, camera, input } = this;
    switch (this.state.phase) {
      case 'desk':
      case 'ready':
        plane.updateParked(dt);
        camera.updateDesk(dt, world.launchPosition, world.launchYaw);
        break;
      case 'flying': {
        const outcome = plane.fly(
          dt,
          {
            mouseDX: mouse.dx,
            mouseDY: mouse.dy,
            throttle: input.axis('KeyS', 'KeyW'),
            bank: input.axis('KeyD', 'KeyA'),
          },
          world.territories,
        );
        if (outcome === 'flying') camera.updateFollow(dt, plane, world.territories, this.bombCamFocus(dt));
        else this.loseAircraft(outcome === 'crashed-void' ? 'void' : 'impact');
        break;
      }
      case 'crashed':
        camera.updateWatch(dt, this.crashPoint);
        break;
    }

    const impact = this.bomb.update(dt, world.targetZone, world.territories);
    if (impact) this.onBombImpact(impact);
    if (this.returnQueued && !this.bomb.active) {
      this.returnQueued = false;
      this.finishReturn();
    }
    this.effects.update(dt);
  }

  private onBombImpact(impact: BombImpact): void {
    const point = this.impactPoint.set(impact.x, impact.y, impact.z);
    if (impact.kind === 'target') this.effects.burst(point, 'hit');
    else if (impact.kind === 'platform') this.effects.burst(point, 'thud');
    this.impactCamTime = impact.kind === 'void' ? 0 : CAMERA.bombCamLinger;
    this.state.resolveBomb(impact.kind === 'target');
  }

  /** The falling bomb, or for a moment after it lands, the impact point. */
  private bombCamFocus(dt: number): pc.Vec3 | null {
    if (this.bomb.active) return this.bomb.position;
    if (this.impactCamTime <= 0) return null;
    this.impactCamTime -= dt;
    return this.impactPoint;
  }

  private loseAircraft(cause: CrashCause): void {
    this.crashPoint.copy(this.plane.position);
    if (cause === 'impact') this.effects.burst(this.plane.position, 'crash');
    this.plane.crash();
    this.state.crash(cause);
    this.input.exitPointerLock(); // free the cursor for the Return button
  }

  private finishReturn(): void {
    this.returnQueued = false;
    this.impactCamTime = 0;
    if (!this.state.returnHome()) return;
    this.bomb.clear();
    this.plane.hide();
    this.input.exitPointerLock();
    this.camera.updateDesk(0, this.world.launchPosition, this.world.launchYaw, true);
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
      if (code === 'KeyF') this.fold();
      else if (code === 'Space') this.launch();
      else if (code === 'KeyR') this.requestReturn();
    });
    input.onCanvasClick(() => this.dropBomb());
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

    this.resources.onChange((_paper, delta) => hud.paperDelta(delta));
    state.onEvent((event) => {
      switch (event.type) {
        case 'launched':
          hud.banner('Mission active', this.mission.title, 'info', 1.8);
          break;
        case 'mission-succeeded':
          hud.banner('Bombing Successful!', `+${event.reward} Paper`, 'good', 3.5);
          break;
        case 'mission-failed':
          if (event.reason === 'missed') hud.banner('Missed!', 'The bomb did not hit the bullseye. Mission failed.', 'bad');
          else if (event.reason === 'returned') hud.banner('Returned without success', 'No reward this time.', 'info', 2.5);
          break;
        case 'crashed':
          hud.banner(
            event.cause === 'void' ? 'Plane lost in the void' : 'Plane crashed!',
            this.mission.status === 'succeeded' ? 'Your reward is safe. Press R to return to T1.' : 'No reward. Press R to return to T1.',
            'bad',
            4,
          );
          break;
        case 'fold-refused':
          hud.banner('Not enough paper', 'Use “Reset paper” to keep testing.', 'bad', 2.5);
          break;
        case 'paper-reset':
          hud.banner('Paper reset', `${this.resources.paper} paper restored`, 'info', 1.6);
          break;
      }
    });
  }

  // ---- HUD view -------------------------------------------------------------------------------

  private view(): HudView {
    const { plane, world, state, mission } = this;
    const flying = state.phase === 'flying';

    let nose: ScreenPoint | null = null;
    let aim: ScreenPoint | null = null;
    if (flying) {
      nose = this.projectOnScreen(plane.getForward(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
      aim = this.projectOnScreen(plane.getAimDirection(this.v1).mulScalar(RETICLE_RANGE).add(plane.position));
    }

    const from = flying || state.phase === 'crashed' ? plane.position : world.launchPosition;
    const zone = world.targetZone;
    const target = this.indicator(this.v2.set(zone.x, zone.top + 0.5, zone.z));
    if (target) target.distance = Math.hypot(zone.x - from.x, zone.z - from.z);

    const labels: TerritoryLabel[] = [];
    const eye = this.camera.entity.getPosition();
    for (const t of world.territories) {
      // The target has its own marker; in flight, a label on the platform below is just clutter.
      if (t.isTarget || (flying && Math.hypot(t.x - eye.x, t.z - eye.z) < t.size * 0.75)) continue;
      const p = this.projectOnScreen(this.v3.set(t.x, 0.3, t.z));
      if (p) labels.push({ id: t.id, role: t.isHome ? 'home' : 'neutral', x: p.x, y: p.y });
    }

    return {
      paper: this.resources.paper,
      planeCost: state.planeCost,
      stats: state.stats,
      phase: state.phase,
      paused: this.paused,
      canFold: state.canFold(),
      mission: {
        title: mission.title,
        targetId: mission.targetId,
        reward: mission.reward,
        status: mission.status,
        failure: mission.failure,
      },
      flight: flying
        ? {
            speed: plane.speed,
            speedFrac: (plane.speed - PLANE.minSpeed) / (PLANE.maxSpeed - PLANE.minSpeed),
            altitude: plane.position.y,
            bomb: plane.hasBomb ? 'loaded' : this.bomb.active ? 'falling' : 'used',
          }
        : null,
      pointerLocked: this.input.pointerLocked,
      returnQueued: this.returnQueued,
      nose,
      aim,
      target,
      labels,
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
  private indicator(point: pc.Vec3): TargetIndicator {
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
        return { x: s.x, y: s.y, onScreen: true, angle: 0, distance: 0 };
      }
      dx = s.x - cx;
      dy = s.y - cy;
    } else {
      dx = rel.dot(cam.right);
      dy = -rel.dot(cam.up);
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    }
    const scale = Math.min((cx - margin) / Math.max(Math.abs(dx), 1e-6), (cy - margin) / Math.max(Math.abs(dy), 1e-6));
    return { x: cx + dx * scale, y: cy + dy * scale, onScreen: false, angle: Math.atan2(dy, dx), distance: 0 };
  }
}

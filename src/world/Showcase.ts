import * as pc from 'playcanvas';
import type { ModelStore } from '../assets/CustomModels';
import { createPlaneModel, type PlaneModelView } from '../aircraft/JetModel';
import { AIRCRAFT_ORDER, PALETTE, type AircraftId } from '../config';
import type { BuildingModelId } from '../assets/CustomModels';
import { BuildingRig } from './BuildingRig';
import { Model } from './props/Model';

/**
 * The living desk (v0.0.16): the backdrop of Loading, Login, Create account and the main menu.
 * A sample base that looks like the game but is not it — one notebook sheet on a wooden desk
 * with a Command Center, Workshop, Hangar, Storage, Turret, Radar and Runway, a rival sheet at
 * the edge of the frame, planes flying slow loops overhead and one that waits on the runway,
 * then rolls, lifts off and leaves (a 36 s loop). Buildings animate through their rigs: the
 * radar sweeps, the turret scans, doors open, beacons blink.
 *
 * It lives far from the classroom (OFFSET) with a camera of its own, enabled only while a menu
 * is up, so the game's world is never drawn behind it. Two camera presets: `login` (the desk in
 * the left half of the screen) and `menu` (closer, from the opposite side, the desk in the right
 * half). The camera drifts very slowly; with reduced motion it stands still and the planes slow
 * down. Shadows follow the graphics setting (the sun's shadows are off on Low).
 *
 * The same rig also draws the menus' art: `thumbnails()` photographs each plane and building
 * against a clear background into data URLs (the cards' art areas), once, while loading.
 */

/** Far from the classroom: nothing of the game's world is inside the camera's range. */
const OFFSET = new pc.Vec3(6000, 0, 0);
/** The photo booth, further still. */
const BOOTH = new pc.Vec3(9000, 0, 0);
const SHEET = { w: 46, d: 34 } as const;
const LOOP_S = 36;
/** The sample base is drawn larger than the game's, like the design's close-up of a desk. */
const SCALE = 2.1;

export type ShowcasePreset = 'login' | 'menu';

interface Preset {
  /** Where the camera looks (sheet coordinates). */
  target: [number, number, number];
  /** Yaw around the target (degrees), pitch down (degrees), distance. */
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

/**
 * Login and Create account: the desk in the left half (the camera aims right of the sheet).
 * Main menu: the opposite side, closer, the desk in the right half.
 */
const PRESETS: Record<ShowcasePreset, Preset> = {
  login: { target: [21, 0, 3], yaw: 0, pitch: 52, distance: 74, fov: 40 },
  menu: { target: [17, 0, -2], yaw: 180, pitch: 48, distance: 70, fov: 40 },
};

interface Flyer {
  view: PlaneModelView;
  /** Loop radius, height, speed (rad/s), phase, centre (sheet coordinates). */
  r: number;
  h: number;
  w: number;
  phase: number;
  cx: number;
  cz: number;
}

const paint = (accent: readonly [number, number, number]) => ({ paper: PALETTE.paper, accent });

export class Showcase {
  readonly root = new pc.Entity('showcase');
  readonly camera: pc.Entity;
  private readonly rigs: Array<{ rig: BuildingRig; kind: BuildingModelId }> = [];
  private readonly flyers: Flyer[] = [];
  private taxi: PlaneModelView | null = null;
  private time = 0;
  private preset: ShowcasePreset = 'login';
  /** Eased camera pose, so switching presets glides. */
  private readonly cam = { yaw: PRESETS.login.yaw, pitch: PRESETS.login.pitch, distance: PRESETS.login.distance, tx: 13, ty: 0, tz: 2 };
  private hidden: pc.CameraComponent[] = [];
  private active = false;
  reducedMotion = false;
  private readonly v = new pc.Vec3();

  constructor(
    private readonly app: pc.AppBase,
    private readonly store: ModelStore,
    shadows: boolean,
  ) {
    this.root.setPosition(OFFSET);
    app.root.addChild(this.root);
    this.buildDesk(shadows);
    this.buildBase();
    this.buildPlanes();
    this.camera = new pc.Entity('showcase-camera');
    this.camera.addComponent('camera', {
      clearColor: new pc.Color(PALETTE.sky[0], PALETTE.sky[1], PALETTE.sky[2]),
      fov: PRESETS.login.fov,
      nearClip: 0.5,
      farClip: 700,
      priority: 10,
    });
    this.camera.enabled = false;
    app.root.addChild(this.camera);
    this.root.enabled = false;
  }

  // ---- Scene ------------------------------------------------------------------------------------

  private buildDesk(shadows: boolean): void {
    const device = this.app.graphicsDevice;
    const m = new Model();
    // The wooden desk fills every frame; the sheets sit on it with tape at the corners.
    m.part('wood/desk').box([520, 2, 520], { at: [0, -1.05, 0] });
    m.part('paper/graph').box([SHEET.w, 0.04, SHEET.d], { at: [0, 0.02, 0], rot: [0, -3, 0] });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      m.part('tape/blue').box([4, 0.06, 1.4], { at: [x * (SHEET.w / 2 - 1), 0.05, z * (SHEET.d / 2 - 0.4)], rot: [0, -3 + x * z * 40, 0] });
    }
    // The rival's sheet at the edge of the frame (red tape), and a pencil left on the desk.
    m.part('paper/notebook').box([36, 0.04, 28], { at: [-44, 0.02, 34], rot: [0, 9, 0] });
    m.part('tape/red').box([4, 0.06, 1.4], { at: [-28, 0.05, 22], rot: [0, 49, 0] });
    m.part('tape/red').box([4, 0.06, 1.4], { at: [-60, 0.05, 46], rot: [0, 49, 0] });
    m.part('pencil/yellow').box([34, 1.1, 1.1], { at: [34, 0.55, 26], rot: [0, -24, 0] });
    m.part('pencil/wood').box([3, 0.9, 0.9], { at: [50.5, 0.55, 18.8], rot: [0, -24, 0] });
    m.part('rubber/pink').box([5, 1.6, 3], { at: [40, 0.8, -26], rot: [0, 18, 0] });
    this.root.addChild(m.toEntity(device, 'showcase-desk', { castShadows: shadows, receiveShadows: true }));
  }

  private place(kind: BuildingModelId, x: number, z: number, yaw: number, level: number, parent = this.root): void {
    if (!BuildingRig.available(this.store, kind)) return;
    const rig = new BuildingRig(this.store, kind);
    rig.root.setLocalPosition(x, 0.04, z);
    rig.root.setLocalEulerAngles(0, yaw, 0);
    if (kind === 'runway') rig.root.setLocalScale(24 / 6.99, 0.5, 4.6 / 1.6);
    else rig.root.setLocalScale(SCALE, SCALE, SCALE);
    rig.show(level, 1, true);
    parent.addChild(rig.root);
    this.rigs.push({ rig, kind });
  }

  private buildBase(): void {
    this.place('workshop', -14, -8, 10, 2);
    this.place('command', 1, -8, 0, 2);
    this.place('hangar', 15, -8, -15, 1);
    this.place('radar', -16, 3, 20, 1);
    this.place('storage', -1, 3, 0, 2);
    this.place('turret', 10, 3, 0, 2);
    this.place('launcher', 17, 4, -10, 1);
    this.place('runway', -5, 12, -3, 1);
    // The rival's corner: a turret and a storage box.
    this.place('storage', -48, 36, 190, 1);
    this.place('turret', -38, 30, 180, 1);
  }

  private buildPlanes(): void {
    const device = this.app.graphicsDevice;
    const add = (id: AircraftId, accent: readonly [number, number, number]): PlaneModelView => {
      const view = createPlaneModel(device, this.store, id, paint(accent));
      view.setFold(1);
      view.setDamage(1);
      view.entity.setLocalScale(SCALE, SCALE, SCALE);
      this.root.addChild(view.entity);
      return view;
    };
    const loops: Array<[AircraftId, number, number, number, number, number, number]> = [
      // id, radius, height, rad/s, phase, centre x, centre z
      ['lightning', 24, 13, 0.16, 0, 0, -2],
      ['swift', 30, 18, -0.12, 2.1, -6, 0],
      ['widewing', 38, 24, 0.08, 4.2, 4, 4],
    ];
    for (const [id, r, h, w, phase, cx, cz] of loops) {
      this.flyers.push({ view: add(id, id === 'swift' ? PALETTE.enemyAccent : PALETTE.friendlyAccent), r, h, w, phase, cx, cz });
    }
    this.taxi = add('dart', PALETTE.friendlyAccent);
  }

  // ---- Use ----------------------------------------------------------------------------------------

  /** Shows the scene (its camera on, every other camera off) or gives the frame back to the game. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.root.enabled = on;
    this.camera.enabled = on;
    if (on) {
      this.hidden = this.app.root.findComponents('camera').filter((c) => (c as pc.CameraComponent).entity !== this.camera && (c as pc.CameraComponent).enabled) as pc.CameraComponent[];
      for (const c of this.hidden) c.enabled = false;
    } else {
      for (const c of this.hidden) c.enabled = true;
      this.hidden = [];
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  setPreset(p: ShowcasePreset, snap = false): void {
    this.preset = p;
    if (snap || this.reducedMotion) {
      const s = PRESETS[p];
      Object.assign(this.cam, { yaw: s.yaw, pitch: s.pitch, distance: s.distance, tx: s.target[0], ty: s.target[1], tz: s.target[2] });
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    const slow = this.reducedMotion ? 0.5 : 1;
    this.time += dt * slow;
    const t = this.time;

    // The camera: eases to its preset, then drifts a few degrees, very slowly.
    const s = PRESETS[this.preset];
    const k = 1 - Math.exp(-dt * 1.6);
    const c = this.cam;
    let dy = s.yaw - c.yaw;
    dy = ((dy + 540) % 360) - 180;
    c.yaw += dy * k;
    c.pitch += (s.pitch - c.pitch) * k;
    c.distance += (s.distance - c.distance) * k;
    c.tx += (s.target[0] - c.tx) * k;
    c.ty += (s.target[1] - c.ty) * k;
    c.tz += (s.target[2] - c.tz) * k;
    const drift = this.reducedMotion ? 0 : 1;
    const yaw = (c.yaw + drift * 5 * Math.sin(t * 0.045)) * pc.math.DEG_TO_RAD;
    const pitch = (c.pitch + drift * 2 * Math.sin(t * 0.06 + 1)) * pc.math.DEG_TO_RAD;
    const d = c.distance;
    const cam = this.camera;
    cam.camera!.fov = s.fov;
    this.v.set(OFFSET.x + c.tx + Math.sin(yaw) * Math.cos(pitch) * d, OFFSET.y + c.ty + Math.sin(pitch) * d, OFFSET.z + c.tz + Math.cos(yaw) * Math.cos(pitch) * d);
    cam.setPosition(this.v);
    cam.lookAt(OFFSET.x + c.tx, OFFSET.y + c.ty, OFFSET.z + c.tz);

    // Buildings: the radar sweeps, the turrets scan, the rest runs its own idle animation.
    for (const { rig, kind } of this.rigs) {
      const yawR = kind === 'radar' ? t * 1.2 : kind === 'turret' ? Math.sin(t * 0.35) * 1.1 : 0;
      rig.update(dt * slow, { yaw: yawR, pitch: kind === 'turret' ? 0.15 + 0.1 * Math.sin(t * 0.5) : 0, sinceShot: 99, alive: true });
    }

    // Planes on their loops, banked into the turn.
    for (const f of this.flyers) {
      const a = f.phase + t * f.w;
      const x = f.cx + Math.cos(a) * f.r;
      const z = f.cz + Math.sin(a) * f.r * 0.7;
      const y = f.h + Math.sin(a * 2) * 1.5;
      const e = f.view.entity;
      e.setLocalPosition(x, y, z);
      // Heading along the path (the model's nose is −Z).
      const vx = -Math.sin(a) * f.r * Math.sign(f.w);
      const vz = Math.cos(a) * f.r * 0.7 * Math.sign(f.w);
      const heading = Math.atan2(-vx, -vz) * pc.math.RAD_TO_DEG;
      e.setLocalEulerAngles(0, heading, 0);
      e.rotateLocal(0, 0, Math.sign(f.w) * 22);
      e.setLocalScale(SCALE, SCALE, SCALE);
      f.view.animate?.(dt, { status: 'flying', speed: 24, roll: Math.sign(f.w) * 0.4, pitch: 0, boost: { active: false } });
    }

    // The runway plane: waits, rolls, lifts off and climbs away, then is back on the pad.
    const p = this.taxi;
    if (p) {
      const u = t % LOOP_S;
      const start = { x: -15, z: 12.4 };
      const dir = { x: Math.cos(-3 * pc.math.DEG_TO_RAD), z: Math.sin(3 * pc.math.DEG_TO_RAD) };
      let along = 0;
      let y = 0.7;
      let climb = 0;
      if (u > 10) {
        const r = u - 10;
        along = 0.9 * r * r;
        if (along > 16) {
          const air = along - 16;
          y = 0.7 + air * air * 0.012 + air * 0.08;
          climb = Math.min(14, air * 1.4);
        }
      }
      p.entity.enabled = along < 260;
      p.entity.setLocalPosition(start.x + dir.x * along, y, start.z + dir.z * along);
      p.entity.setLocalEulerAngles(climb, -90 + 3, 0);
      p.animate?.(dt, { status: u > 10 ? 'flying' : 'parked', speed: u > 10 ? 18 : 0, roll: 0, pitch: climb * pc.math.DEG_TO_RAD, boost: { active: u > 11 && u < 16 } });
    }
  }

  // ---- Photo booth ---------------------------------------------------------------------------------

  /**
   * Photographs every plane and the base buildings once, for the cards' art (data URLs, keyed by
   * aircraft id or building model id). Renders through its own camera on a clear background; the
   * loading screen covers the canvas meanwhile. Resolves with whatever it managed.
   */
  async thumbnails(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const app = this.app;
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const booth = new pc.Entity('booth');
    booth.setPosition(BOOTH);
    app.root.addChild(booth);
    const cam = new pc.Entity('booth-camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0, 0, 0, 0), fov: 26, nearClip: 0.2, farClip: 200, priority: 20 });
    app.root.addChild(cam);
    const others = app.root.findComponents('camera').filter((c) => (c as pc.CameraComponent).entity !== cam && (c as pc.CameraComponent).enabled) as pc.CameraComponent[];
    for (const c of others) c.enabled = false;
    const crop = document.createElement('canvas');
    crop.width = 320;
    crop.height = 200;
    const ctx = crop.getContext('2d');
    const frame = () => new Promise<void>((resolve) => app.once('frameend', () => resolve()));
    const subjects: Array<{ key: string; make: () => pc.Entity | null; size: number; height: number }> = [
      ...AIRCRAFT_ORDER.map((id) => ({
        key: id,
        size: 2.6,
        height: 0,
        make: () => {
          const v = createPlaneModel(app.graphicsDevice, this.store, id, paint(PALETTE.friendlyAccent));
          v.setFold(1);
          v.setDamage(1);
          v.entity.setLocalEulerAngles(0, 145, 0);
          return v.entity;
        },
      })),
      ...(['command', 'workshop', 'hangar', 'storage', 'turret', 'launcher', 'radar', 'ink', 'helipad'] as BuildingModelId[]).map((kind) => ({
        key: `b:${kind}`,
        size: kind === 'hangar' || kind === 'command' ? 3.6 : 2.6,
        height: 1.4,
        make: () => {
          if (!BuildingRig.available(this.store, kind)) return null;
          const rig = new BuildingRig(this.store, kind);
          rig.show(kind === 'helipad' ? 1 : 2, 1, true);
          rig.root.setLocalEulerAngles(0, 210, 0);
          return rig.root;
        },
      })),
    ];
    try {
      for (const s of subjects) {
        const e = s.make();
        if (!e) continue;
        booth.addChild(e);
        // A three-quarter view from above, framed by the subject's size.
        const d = s.size * 2.6;
        cam.setPosition(BOOTH.x + d * 0.55, BOOTH.y + s.height + d * 0.62, BOOTH.z + d * 0.6);
        cam.lookAt(BOOTH.x, BOOTH.y + s.height * 0.55, BOOTH.z);
        await frame();
        await frame();
        await new Promise<void>((resolve) =>
          app.once('frameend', () => {
            if (ctx && canvas.width > 0 && canvas.height > 0) {
              const h = Math.min(canvas.height, canvas.width / 1.6);
              const w = h * 1.6;
              ctx.clearRect(0, 0, crop.width, crop.height);
              ctx.drawImage(canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 0, 0, crop.width, crop.height);
              try {
                out.set(s.key, crop.toDataURL('image/png'));
              } catch {
                /* a tainted canvas: no art, the icon stands in */
              }
            }
            resolve();
          }),
        );
        e.destroy();
      }
    } finally {
      booth.destroy();
      cam.destroy();
      for (const c of others) c.enabled = true;
    }
    return out;
  }
}

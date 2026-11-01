import * as pc from 'playcanvas';
import { BASE, DEFENSES, PALETTE, type ThreatLevel } from '../config';
import { Installation, type DefenseNetwork } from '../defenses/Installation';
import type { DefenseLayout, InstallationSpec } from '../defenses/Layout';
import { flatMaterial, type World } from './WorldGenerator';
import { materials } from '../render/materials/MaterialLibrary';
import { outline } from '../render/outline/OutlineRenderer';
import { MATERIALS } from '../render/style';
import { paperStore } from './props/buildings';
import { BuildingRig } from './BuildingRig';
import type { BuildingModelId, ModelStore } from '../assets/CustomModels';

type Color3 = readonly [number, number, number];

const RAD_TO_DEG = 180 / Math.PI;
/** Seconds an installation shudders after a hit, and takes to collapse once destroyed. */
const SHUDDER = 0.25;
const COLLAPSE = 0.8;
/** How far each kind tips over, and how much it squashes, as it collapses. */
const FALL: Record<string, { tilt: number; squash: number; sink: number }> = {
  turret: { tilt: 38, squash: 0.6, sink: 0.35 },
  launcher: { tilt: 28, squash: 0.65, sink: 0.3 },
  radar: { tilt: 82, squash: 1, sink: 0.1 },
  supply: { tilt: 8, squash: 0.35, sink: 0 },
  workshop: { tilt: 12, squash: 0.4, sink: 0 },
  storage: { tilt: 6, squash: 0.3, sink: 0 },
};

/** How a construction slot on T1 looks: a faint pad, or lit up while building. */
export type SlotHighlight = 'none' | 'fit' | 'no' | 'selected' | 'built';

interface View {
  inst: Installation;
  root: pc.Entity;
  /** Everything that tips over when it is destroyed. */
  body: pc.Entity;
  /** Turns: the turret's gun house, the launcher's cradle, the radar dish. */
  turn: pc.Entity | null;
  /** Elevates: the gun barrel, the rocket rails. */
  elevate: pc.Entity | null;
  flash: pc.Entity | null;
  /** Rockets waiting on the rails; the front one is gone while the launcher reloads. */
  rockets: pc.Entity[];
  ring: { entity: pc.Entity; material: pc.StandardMaterial } | null;
  /** Its own paint, so damage darkens only this one. */
  paint: pc.StandardMaterial;
  paintColor: Color3;
  /** Every part's normal material, to put back after a wreck is restored. */
  parts: Array<{ render: pc.RenderComponent; material: pc.Material }>;
  bodyYaw: number;
  shownHealth: number;
  shudder: number;
  /** 0 standing → 1 collapsed. */
  collapse: number;
  wrecked: boolean;
  fallX: number;
  fallZ: number;
  /** 0 → 1 while a new building folds up into place (1 for everything else). */
  assemble: number;
  /** The Model Lab model, when loaded (v0.0.11); null for the code-built stand-in. */
  rig: BuildingRig | null;
  level: number;
}

/** Which Model Lab model draws each kind: the paper store is the command centre, enemy depots are ink depots. */
function modelFor(kind: string, friendly: boolean): BuildingModelId | null {
  switch (kind) {
    case 'turret':
    case 'launcher':
    case 'radar':
    case 'workshop':
    case 'storage':
      return kind;
    case 'supply':
      return friendly ? 'command' : 'ink';
    default:
      return null;
  }
}

/**
 * Draws the defenses: ink turrets whose gun house and barrel follow what the rules aim at, rocket
 * launchers with paper rockets on their rails, radar stations with a turning dish, cardboard supply
 * depots with a target painted on the roof, low barrier walls, flags and edge trim in the
 * territory's threat colour, and a faint ring on the ground showing each weapon's reach (with a
 * gap for a turret's blind spot) when the plane comes near. Hits make them shudder and darken;
 * destroyed ones tip over into scorched wrecks that stay until the sortie ends.
 */
export class DefenseModels {
  private readonly views: View[] = [];
  private readonly byId = new Map<string, View>();
  private time = 0;
  private readonly root: pc.Entity;
  private preview: { key: string; entity: pc.Entity } | null = null;
  private readonly pads = new Map<string, { entity: pc.Entity; material: pc.StandardMaterial; state: SlotHighlight }>();

  private readonly mat = {
    dark: flatMaterial(PALETTE.defenseDark),
    barrel: flatMaterial(PALETTE.defenseBarrel),
    ink: flatMaterial(PALETTE.enemyInk),
    wreck: flatMaterial(PALETTE.wreck),
    wreckDark: flatMaterial([PALETTE.wreck[0] * 0.6, PALETTE.wreck[1] * 0.6, PALETTE.wreck[2] * 0.6]),
    dish: flatMaterial(PALETTE.radarDish),
    rocket: flatMaterial(PALETTE.rocketPaper),
    nose: flatMaterial(PALETTE.rocketNose),
    cardboardDark: flatMaterial(PALETTE.cardboardDark),
    tape: flatMaterial(PALETTE.tape),
    red: flatMaterial(PALETTE.bullseyeRed),
    white: flatMaterial(PALETTE.bullseyeWhite),
    pencil: flatMaterial(PALETTE.pencil),
    graphite: flatMaterial(PALETTE.graphite),
    flash: glow([1, 0.45, 0.85], 0.9),
    blueFlash: glow([0.45, 0.75, 1], 0.9),
    friendlyInk: flatMaterial(PALETTE.inkShot),
    paperWhite: flatMaterial(PALETTE.paper),
    level: flatMaterial(PALETTE.pencil),
    ghostOk: glow([0.35, 0.95, 0.55], 0.42),
    ghostNo: glow([1, 0.3, 0.25], 0.42),
    threat: {
      1: flatMaterial(PALETTE.threat1),
      2: flatMaterial(PALETTE.threat2),
      3: flatMaterial(PALETTE.threat3),
    } as Record<Exclude<ThreatLevel, 0>, pc.StandardMaterial>,
  };

  /** Per territory: its walls, flag and threat trim (hidden when a player claims it in multiplayer). */
  private readonly statics = new Map<string, pc.Entity>();
  /** Threat per territory: an AI installation's model level (1–3). */
  private readonly threats = new Map<string, number>();

  constructor(
    private readonly app: pc.AppBase,
    layout: DefenseLayout,
    private readonly network: DefenseNetwork,
    world: Pick<World, 'territories'> & { home?: { x: number; z: number } },
    private readonly models: ModelStore | null = null,
  ) {
    for (const t of world.territories) this.threats.set(t.id, t.threat);
    const root = new pc.Entity('defenses');
    this.root = root;
    app.root.addChild(root);
    // Walls, flags and trims never move: their pencil strokes are merged into one mesh per tier
    // and territory.
    const group = (territoryId: string) => {
      let g = this.statics.get(territoryId);
      if (!g) {
        g = new pc.Entity(`static-defenses-${territoryId}`);
        g.addChild(new pc.Entity('structures'));
        g.addChild(new pc.Entity('trims'));
        root.addChild(g);
        this.statics.set(territoryId, g);
      }
      return { statics: g.children[0] as pc.Entity, trims: g.children[1] as pc.Entity };
    };
    for (const t of world.territories) if (t.threat > 0) group(t.id).trims.addChild(this.trim(t.x, t.z, t.size, t.threat as Exclude<ThreatLevel, 0>));
    for (const inst of network.installations) this.addView(inst, false);
    const centre = world.home ?? { x: 0, z: 0 };
    for (const b of layout.barriers) {
      const statics = group(b.territoryId).statics;
      const wall = new pc.Entity('barrier');
      wall.setPosition(b.x, 0, b.z);
      wall.setEulerAngles(0, b.yaw * RAD_TO_DEG, 0);
      wall.addChild(part('box', this.mat.cardboardDark, 0, b.height / 2, 0, b.length, b.height, b.thickness));
      wall.addChild(part('box', this.mat.tape, 0, b.height + 0.01, 0, b.length + 0.02, 0.04, b.thickness * 0.6));
      statics.addChild(wall);
    }
    for (const f of layout.flags) {
      const statics = group(f.territoryId).statics;
      const flag = new pc.Entity('flag');
      flag.setPosition(f.x, 0, f.z);
      flag.addChild(part('cylinder', this.mat.pencil, 0, 2.2, 0, 0.22, 4.4, 0.22));
      flag.addChild(part('cone', this.mat.graphite, 0, 4.55, 0, 0.22, 0.3, 0.22));
      flag.addChild(part('box', this.mat.threat[f.level as Exclude<ThreatLevel, 0>], 0.75, 3.85, 0, 1.4, 0.9, 0.04));
      flag.setEulerAngles(0, Math.atan2(f.x - centre.x, f.z - centre.z) * RAD_TO_DEG, 0);
      statics.addChild(flag);
    }
    for (const g of this.statics.values()) {
      outline(g.children[0] as pc.Entity, 'structure', { merge: true });
      outline(g.children[1] as pc.Entity, 'background', { merge: true });
    }
  }

  /** Shows or hides a territory's walls, flag and trim (multiplayer: gone while a player owns it). */
  setTerritoryStatics(territoryId: string, visible: boolean): void {
    const g = this.statics.get(territoryId);
    if (g) g.enabled = visible;
  }

  /**
   * Follows the rules: aims, muzzle flashes, rockets on the rails, damage, collapse. `focus` is the
   * plane's position in flight, or null; range rings show for the weapons on `territoryId` (the
   * territory being approached) as the plane nears their reach.
   */
  update(dt: number, focus: { x: number; z: number } | null, territoryId: string | null = null, showRingsOf: string | null = null): void {
    this.time += dt;
    for (const v of this.views) {
      const i = v.inst;
      // A wreck the player paid to repair stands up again.
      if (i.alive && v.wrecked) this.restoreView(v);
      if (!i.alive && !v.wrecked) this.startCollapse(v);
      if (v.assemble < 1) {
        v.assemble = Math.min(1, v.assemble + dt / BASE.assembleTime);
        this.poseAssemble(v);
      }
      if (v.rig) {
        if (v.rig.show(v.level, i.durability.fraction, i.alive)) this.rigParts(v);
        v.rig.update(dt, { yaw: (i.spec.kind === 'radar' ? i.spin : i.yaw) - v.bodyYaw, pitch: i.pitch, sinceShot: i.alive ? i.sinceShot : 99, alive: i.alive });
      }
      if (v.wrecked) {
        if (v.collapse < 1) {
          v.collapse = Math.min(1, v.collapse + dt / COLLAPSE);
          this.poseCollapse(v);
        }
        if (v.ring) v.ring.entity.enabled = false;
        continue;
      }
      if (v.turn) v.turn.setLocalEulerAngles(0, ((i.spec.kind === 'radar' ? i.spin : i.yaw) - v.bodyYaw) * RAD_TO_DEG, 0);
      if (v.elevate) v.elevate.setLocalEulerAngles(i.pitch * RAD_TO_DEG, 0, 0);
      if (v.flash) {
        v.flash.enabled = i.sinceShot < 0.07;
        if (v.flash.enabled) v.flash.setLocalScale(0.6 + Math.random() * 0.4, 0.6 + Math.random() * 0.4, 0.9);
      }
      v.rockets.forEach((r, n) => (r.enabled = n > 0 || i.cooldown <= 0));

      const health = i.durability.fraction;
      if (health < v.shownHealth) v.shudder = SHUDDER;
      if (health !== v.shownHealth) {
        v.shownHealth = health;
        // The models show damage in their own states; the stand-ins darken.
        if (!v.rig) {
          const k = 0.55 + 0.45 * health;
          v.paint.diffuse.set(v.paintColor[0] * k, v.paintColor[1] * k, v.paintColor[2] * k);
          v.paint.update();
        }
      }
      const shake = v.shudder > 0 ? Math.sin(v.shudder * 80) * 5 * (v.shudder / SHUDDER) : 0;
      v.shudder = Math.max(0, v.shudder - dt);
      if (v.assemble >= 1) v.body.setLocalEulerAngles(shake * 0.5, v.bodyYaw * RAD_TO_DEG, shake * 0.4);

      if (v.ring) {
        const d = focus ? Math.hypot(focus.x - i.spec.x, focus.z - i.spec.z) - i.spec.range : Infinity;
        const always = i.spec.territoryId === showRingsOf;
        const show = always || (d < DEFENSES.ringMargin && i.spec.territoryId === territoryId);
        v.ring.entity.enabled = show;
        if (show) {
          const near = always ? 0.7 : 1 - Math.max(0, d) / DEFENSES.ringMargin;
          const pulse = i.engaged ? 0.12 * (0.5 + 0.5 * Math.sin(this.time * 8)) : 0;
          v.ring.material.opacity = 0.12 + 0.3 * near + pulse;
          v.ring.material.update();
        }
      }
    }
  }

  /** Everything standing again, between sorties, except the wrecks in `keep` and the player's own (they wait for repairs). */
  restoreAll(keep: ReadonlySet<string> = new Set()): void {
    for (const v of this.views) {
      if (!v.inst.alive && (keep.has(v.inst.id) || v.inst.side === 'player')) continue;
      this.restoreView(v);
    }
  }

  /**
   * Follows the network after the player built, upgraded or removed something: new installations
   * get a model (folding up into place if in `fresh`), replaced ones a new model, removed ones lose theirs.
   */
  sync(fresh: ReadonlySet<string> = new Set()): void {
    for (const v of [...this.views]) {
      if (this.network.get(v.inst.id) === v.inst) continue;
      this.removeView(v);
    }
    for (const inst of this.network.installations) {
      if (this.byId.get(inst.id)?.inst === inst) continue;
      this.addView(inst, fresh.has(inst.id));
    }
  }

  /**
   * A see-through model of a building where it would go (green if it can be built there, red if
   * not), or nothing.
   */
  showPreview(spec: InstallationSpec | null, valid = true): void {
    const key = spec ? `${spec.id}:${spec.kind}:${spec.level ?? 1}:${valid}` : '';
    if (this.preview?.key === key) return;
    if (this.preview) {
      this.preview.entity.destroy();
      this.preview = null;
    }
    if (!spec) return;
    const view = this.build(new Installation(spec));
    const ghost = valid ? this.mat.ghostOk : this.mat.ghostNo;
    for (const { render } of view.parts) {
      render.castShadows = false;
      for (const mi of render.meshInstances) mi.material = ghost;
    }
    view.root.findComponents('particlesystem').forEach((p) => ((p as pc.ParticleSystemComponent).enabled = false));
    if (view.flash) view.flash.enabled = false;
    view.root.setLocalScale(1.02, 1.02, 1.02);
    this.root.addChild(view.root);
    this.preview = { key, entity: view.root };
  }

  /** Painted pads for T1's construction slots, lit up as `highlight` says. */
  setSlots(slots: ReadonlyArray<{ id: string; x: number; z: number; highlight: SlotHighlight }>): void {
    for (const s of slots) {
      let pad = this.pads.get(s.id);
      if (!pad) {
        const material = glow([0.85, 0.92, 1], 0.35);
        const entity = new pc.Entity(`slot-${s.id}`);
        entity.setPosition(s.x, 0.04, s.z);
        const size = 5.6;
        const t = 0.32;
        for (const [x, z, sx, sz] of [[0, size / 2, size, t], [0, -size / 2, size, t], [size / 2, 0, t, size], [-size / 2, 0, t, size]] as const) {
          const strip = new pc.Entity('tape');
          strip.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: false });
          strip.setLocalPosition(x, 0, z);
          strip.setLocalScale(sx, 0.03, sz);
          entity.addChild(strip);
        }
        this.root.addChild(entity);
        pad = { entity, material, state: 'none' };
        this.pads.set(s.id, pad);
      }
      if (pad.state === s.highlight) continue;
      pad.state = s.highlight;
      const color: Color3 =
        s.highlight === 'fit' ? [0.3, 0.9, 0.5] : s.highlight === 'no' ? [1, 0.35, 0.3] : s.highlight === 'selected' ? [1, 0.85, 0.25] : [0.85, 0.92, 1];
      pad.material.emissive.set(color[0], color[1], color[2]);
      pad.material.opacity = s.highlight === 'none' ? 0.3 : s.highlight === 'built' ? 0.18 : 0.85;
      pad.material.update();
    }
  }

  /** Where an installation's label floats, and where effects for it go. */
  labelPoint(id: string, out: pc.Vec3): pc.Vec3 {
    const i = this.network.get(id)!;
    const rig = this.byId.get(id)?.rig;
    if (rig) return out.set(i.spec.x, i.spec.ground + rig.top + 0.5, i.spec.z);
    const top = i.spec.kind === 'radar' ? i.spec.pivot + 2.2 : i.spec.kind === 'supply' ? 3.6 : i.spec.kind === 'workshop' ? 4.2 : i.spec.kind === 'storage' ? 3.2 : i.spec.pivot + 2;
    return out.set(i.spec.x, i.spec.ground + top, i.spec.z);
  }

  private addView(inst: Installation, fresh: boolean): void {
    const view = this.build(inst);
    this.root.addChild(view.root);
    this.outlineView(view);
    if (view.ring) this.root.addChild(view.ring.entity);
    this.views.push(view);
    this.byId.set(inst.id, view);
    if (fresh) {
      view.assemble = 0;
      this.poseAssemble(view);
    }
  }

  /**
   * Pencil strokes for an installation, merged per rigid part: the body, the part that turns, the
   * part that elevates, and each rocket (they come and go as the launcher reloads).
   */
  private outlineView(v: View): void {
    // The Model Lab models are clean low-poly: no pencil strokes.
    if (v.rig) return;
    const moving = [v.turn, v.elevate, v.flash, ...v.rockets].filter((e): e is pc.Entity => e !== null);
    outline(v.body, 'structure', { merge: true, exclude: moving });
    if (v.turn) outline(v.turn, 'structure', { merge: true, exclude: moving.filter((e) => e !== v.turn) });
    if (v.elevate) outline(v.elevate, 'structure', { merge: true, exclude: moving.filter((e) => e !== v.elevate) });
    for (const r of v.rockets) outline(r, 'structure', { merge: true });
  }

  private removeView(v: View): void {
    v.root.destroy();
    v.ring?.entity.destroy();
    this.views.splice(this.views.indexOf(v), 1);
    if (this.byId.get(v.inst.id) === v) this.byId.delete(v.inst.id);
  }

  private restoreView(v: View): void {
    v.wrecked = false;
    v.collapse = 0;
    v.shudder = 0;
    v.shownHealth = -1;
    if (!v.rig) for (const { render, material } of v.parts) render.material = material;
    v.body.setLocalPosition(0, 0, 0);
    v.body.setLocalScale(1, 1, 1);
    v.body.setLocalEulerAngles(0, v.bodyYaw * RAD_TO_DEG, 0);
  }

  /** A new building folds up from a flat sheet: it rises, unfolds and settles with a little bounce. */
  private poseAssemble(v: View): void {
    const t = v.assemble;
    const rise = t < 0.7 ? (t / 0.7) ** 2 : 1 + 0.12 * Math.sin(((t - 0.7) / 0.3) * Math.PI);
    v.body.setLocalScale(1, Math.max(0.04, rise), 1);
    v.body.setLocalEulerAngles((1 - Math.min(1, t / 0.7)) * 70, v.bodyYaw * RAD_TO_DEG + (1 - t) * 90, 0);
  }

  centre(id: string, out: pc.Vec3): pc.Vec3 {
    const i = this.network.get(id)!;
    return out.set(i.spec.x, i.spec.ground + Math.min(i.spec.pivot, 2.5), i.spec.z);
  }

  private startCollapse(v: View): void {
    v.wrecked = true;
    v.collapse = 0;
    const a = Math.random() * Math.PI * 2;
    v.fallX = Math.cos(a);
    v.fallZ = Math.sin(a);
    if (v.flash) v.flash.enabled = false;
    if (v.rig) return;
    for (const { render, material } of v.parts) {
      if (render.entity === v.flash) continue;
      render.material = material === this.mat.dark || material === this.mat.barrel || material === this.mat.cardboardDark ? this.mat.wreckDark : this.mat.wreck;
    }
  }

  /** Tips and squashes the body, with a little bounce at the end. */
  private poseCollapse(v: View): void {
    const fall = FALL[v.inst.spec.kind];
    // A model already shows its wreck (critical damage); it only slumps a little further.
    const f = v.rig ? { tilt: Math.min(10, fall.tilt * 0.25), squash: 0.85 + fall.squash * 0.15, sink: fall.sink * 0.4 } : fall;
    const t = v.collapse;
    const ease = t < 0.75 ? (t / 0.75) ** 2 : 1 - 0.08 * Math.sin(((t - 0.75) / 0.25) * Math.PI);
    const tilt = f.tilt * ease;
    v.body.setLocalEulerAngles(v.fallZ * tilt, v.bodyYaw * RAD_TO_DEG, -v.fallX * tilt);
    v.body.setLocalPosition(0, -f.sink * ease, 0);
    v.body.setLocalScale(1, 1 - (1 - f.squash) * ease, 1);
  }

  private build(inst: Installation): View {
    const s = inst.spec;
    const root = new pc.Entity(`defense-${s.id}`);
    root.setPosition(s.x, s.ground, s.z);
    const body = new pc.Entity('body');
    root.addChild(body);
    const friendly = s.side === 'player';
    // T1's paper store is the art direction's custom cardboard building (textured card).
    const store = s.kind === 'supply' && friendly;
    const paintColor: Color3 = store
      ? MATERIALS['cardboard/side'].color
      : s.kind === 'supply' || s.kind === 'workshop' || s.kind === 'storage'
        ? PALETTE.cardboard
        : friendly
          ? PALETTE.friendlyDefense
          : PALETTE.defense;
    const paint = store ? materials().create(MATERIALS['cardboard/side']) : flatMaterial(paintColor);
    let turn: pc.Entity | null = null;
    let elevate: pc.Entity | null = null;
    let flash: pc.Entity | null = null;
    const rockets: pc.Entity[] = [];
    let bodyYaw = 0;
    const level = s.level ?? Math.max(1, Math.min(3, this.threats.get(s.territoryId) ?? 1));
    const modelId = modelFor(s.kind, friendly);
    const rig = this.models && modelId && BuildingRig.available(this.models, modelId) ? new BuildingRig(this.models, modelId) : null;
    if (rig) {
      rig.show(s.kind === 'supply' && friendly ? 1 : level, 1, true);
      body.addChild(rig.root);
      bodyYaw = s.facing;
    }

    switch (rig ? 'model' : s.kind) {
      case 'turret': {
        body.addChild(part('cylinder', this.mat.dark, 0, 0.35, 0, 2.4, 0.7, 2.4));
        body.addChild(part('cylinder', paint, 0, 1.05, 0, 1.6, 0.8, 1.6));
        turn = new pc.Entity('gun-house');
        turn.setLocalPosition(0, s.pivot, 0);
        turn.addChild(part('box', paint, 0, 0, 0.15, 1.5, 0.95, 1.7));
        // The ink pot that feeds the gun.
        turn.addChild(part('sphere', friendly ? this.mat.friendlyInk : this.mat.ink, 0, 0.6, 0.45, 0.85, 0.6, 0.85));
        elevate = new pc.Entity('barrel');
        const barrel = part('cylinder', this.mat.barrel, 0, 0, -0.9, 0.34, 1.2, 0.34);
        barrel.setLocalEulerAngles(90, 0, 0);
        elevate.addChild(barrel);
        const tip = part('cylinder', friendly ? this.mat.friendlyInk : this.mat.ink, 0, 0, -1.45, 0.46, 0.14, 0.46);
        tip.setLocalEulerAngles(90, 0, 0);
        elevate.addChild(tip);
        flash = part('sphere', friendly ? this.mat.blueFlash : this.mat.flash, 0, 0, -1.75, 0.7, 0.7, 0.9);
        flash.enabled = false;
        elevate.addChild(flash);
        turn.addChild(elevate);
        body.addChild(turn);
        break;
      }
      case 'launcher': {
        body.addChild(part('box', this.mat.dark, 0, 0.3, 0, 2.2, 0.6, 2.2));
        body.addChild(part('cylinder', paint, 0, 0.8, 0, 1.7, 0.4, 1.7));
        turn = new pc.Entity('cradle');
        turn.setLocalPosition(0, s.pivot, 0);
        turn.addChild(part('box', paint, 0.95, -0.15, 0, 0.22, 0.9, 1));
        turn.addChild(part('box', paint, -0.95, -0.15, 0, 0.22, 0.9, 1));
        elevate = new pc.Entity('rails');
        elevate.addChild(part('box', this.mat.dark, 0, -0.18, -0.2, 1.7, 0.12, 2.6));
        for (const x of [0, -0.55, 0.55]) {
          const rocket = new pc.Entity('rocket');
          rocket.setLocalPosition(x, 0.12, -0.2);
          const tube = part('cylinder', this.mat.rocket, 0, 0, 0, 0.36, 1.7, 0.36);
          tube.setLocalEulerAngles(90, 0, 0);
          rocket.addChild(tube);
          const nose = part('cone', this.mat.nose, 0, 0, -1.1, 0.36, 0.5, 0.36);
          nose.setLocalEulerAngles(-90, 0, 0);
          rocket.addChild(nose);
          rocket.addChild(part('box', this.mat.nose, 0, 0, 0.75, 0.7, 0.04, 0.3));
          rocket.addChild(part('box', this.mat.nose, 0, 0, 0.75, 0.04, 0.7, 0.3));
          elevate.addChild(rocket);
          rockets.push(rocket);
        }
        turn.addChild(elevate);
        body.addChild(turn);
        break;
      }
      case 'radar': {
        body.addChild(part('box', this.mat.dark, 0, 0.6, 0, 1.7, 1.2, 1.7));
        body.addChild(part('box', paint, 0, 1.32, 0, 1.2, 0.25, 1.2));
        body.addChild(part('cylinder', paint, 0, (s.pivot + 1.2) / 2, 0, 0.3, s.pivot - 1.2, 0.3));
        turn = new pc.Entity('dish');
        turn.setLocalPosition(0, s.pivot, 0);
        const dish = part('cylinder', this.mat.dish, 0, 0.2, 0, 3.4, 0.14, 3.4);
        dish.setLocalEulerAngles(-70, 0, 0);
        turn.addChild(dish);
        const feed = part('cylinder', this.mat.barrel, 0, 0.45, -0.75, 0.1, 1.5, 0.1);
        feed.setLocalEulerAngles(-70, 0, 0);
        turn.addChild(feed);
        turn.addChild(part('sphere', this.mat.nose, 0, 0.7, -1.45, 0.3, 0.3, 0.3));
        body.addChild(turn);
        break;
      }
      case 'supply': {
        bodyYaw = s.facing;
        if (store) {
          body.addChild(paperStore(paint).toEntity(this.app.graphicsDevice, 'paper-store'));
          break;
        }
        body.addChild(part('box', paint, -0.75, 0.8, 0.25, 2, 1.6, 2.6));
        body.addChild(part('box', paint, 1.05, 0.65, -0.15, 1.5, 1.3, 2.4));
        const top = part('box', this.mat.cardboardDark, 0.05, 2, 0.05, 2.3, 0.9, 2.1);
        top.setLocalEulerAngles(0, 9, 0);
        body.addChild(top);
        body.addChild(part('box', this.mat.tape, -0.75, 1.61, 0.25, 0.4, 0.02, 2.62));
        body.addChild(part('box', this.mat.tape, 1.05, 1.31, -0.15, 0.4, 0.02, 2.42));
        // The mark bombers aim for, painted on the roof.
        [[0.95, this.mat.red], [0.62, this.mat.white], [0.3, this.mat.red]].forEach(([r, m], n) => {
          const ring = part('cylinder', m as pc.StandardMaterial, 0.05, 2.46 + n * 0.012, 0.05, (r as number) * 2, 0.02, (r as number) * 2);
          body.addChild(ring);
        });
        body.addChild(part('cylinder', this.mat.pencil, 1.55, 2.4, 1, 0.12, 2.6, 0.12));
        body.addChild(part('box', friendly ? this.mat.friendlyInk : this.mat.red, 1.95, 3.35, 1, 0.8, 0.5, 0.03));
        break;
      }
      case 'workshop': {
        // A cardboard shed with a sawtooth roof, a paper roll on the side and a pencil chimney.
        bodyYaw = s.facing;
        body.addChild(part('box', paint, 0, 1, 0, 3.4, 2, 2.8));
        for (const x of [-1.1, 0, 1.1]) {
          const tooth = part('box', this.mat.cardboardDark, x, 2.25, 0, 1.05, 0.55, 2.9);
          tooth.setLocalEulerAngles(0, 0, 28);
          body.addChild(tooth);
        }
        const roll = part('cylinder', this.mat.paperWhite, -2, 0.55, 0.6, 1, 1.1, 1);
        roll.setLocalEulerAngles(90, 0, 0);
        body.addChild(roll);
        body.addChild(part('cylinder', this.mat.pencil, 1.2, 3.1, -0.8, 0.45, 1.6, 0.45));
        body.addChild(part('cone', this.mat.graphite, 1.2, 4.05, -0.8, 0.45, 0.35, 0.45));
        body.addChild(part('box', this.mat.friendlyInk, 0, 0.8, 1.41, 1.2, 1.4, 0.04));
        body.addChild(part('box', this.mat.tape, 0, 2.01, 0, 3.42, 0.08, 0.5));
        break;
      }
      case 'storage': {
        // A big taped box with its flaps open and a stack of paper peeking out.
        bodyYaw = s.facing;
        body.addChild(part('box', paint, 0, 1, 0, 3.2, 2, 3.2));
        body.addChild(part('box', this.mat.tape, 0, 1, 0, 3.22, 0.5, 3.22));
        body.addChild(part('box', this.mat.paperWhite, 0, 2.15, 0, 2.6, 0.3, 2.6));
        for (const [x, z, rx, rz] of [[0, 1.75, 35, 0], [0, -1.75, -35, 0], [1.75, 0, 0, -35], [-1.75, 0, 0, 35]] as const) {
          const flap = part('box', this.mat.cardboardDark, x, 2.3, z, Math.abs(x) > 0 ? 0.08 : 3, 0.9, Math.abs(z) > 0 ? 0.08 : 3);
          flap.setLocalEulerAngles(rx, 0, rz);
          body.addChild(flap);
        }
        body.addChild(part('box', this.mat.friendlyInk, 0, 1.2, 1.61, 1.4, 0.8, 0.04));
        break;
      }
    }
    // Upgraded stand-ins wear a pencil-yellow band per level above the first (the models show their level).
    if (!rig) for (let n = 1; n < (s.level ?? 1); n++) body.addChild(part('cylinder', this.mat.level, 0, 0.12 + n * 0.16, 0, 3, 0.1, 3));
    body.setLocalEulerAngles(0, bodyYaw * RAD_TO_DEG, 0);

    let ring: View['ring'] = null;
    if (inst.isWeapon) {
      const material = glow(friendly ? PALETTE.friendlyAccent : s.kind === 'turret' ? PALETTE.rangeTurret : PALETTE.rangeLauncher, 0.3);
      const arc = s.arc ?? Math.PI;
      const mesh = pc.Mesh.fromGeometry(
        this.app.graphicsDevice,
        new pc.TorusGeometry({ tubeRadius: 0.14, ringRadius: s.range, sectorAngle: (2 * arc * 180) / Math.PI, segments: 96, sides: 5 }),
      );
      const entity = new pc.Entity('range-ring');
      entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: false });
      entity.setPosition(s.x, s.ground + 0.12, s.z);
      // The sector starts at +X and sweeps towards +Z; turn it so its middle lies along the facing.
      entity.setEulerAngles(0, (arc + Math.PI / 2 + s.facing) * RAD_TO_DEG, 0);
      entity.enabled = false;
      ring = { entity, material };
    }

    const parts: View['parts'] = [];
    for (const r of root.findComponents('render') as pc.RenderComponent[]) parts.push({ render: r, material: r.material });
    const view: View = {
      inst, root, body, turn, elevate, flash, rockets, ring, paint, paintColor, parts, bodyYaw,
      shownHealth: -1, shudder: 0, collapse: 0, wrecked: false, fallX: 0, fallZ: 0, assemble: 1,
      rig, level: s.kind === 'supply' && friendly ? 1 : level,
    };
    if (rig) this.rigParts(view);
    return view;
  }

  /** After the rig swapped its model: the muzzle flash, the rockets on the pod, the meshes. */
  private rigParts(v: View): void {
    const rig = v.rig!;
    const friendly = v.inst.spec.side === 'player';
    v.flash?.destroy();
    v.flash = null;
    const muzzle = rig.nodes(/^muzzle_point$/)[0];
    if (muzzle && v.inst.spec.kind === 'turret') {
      // The muzzle point faces +Z in the model; the flash stretches along it.
      v.flash = part('sphere', friendly ? this.mat.blueFlash : this.mat.flash, 0, 0, 0.25, 0.5, 0.5, 0.7);
      v.flash.enabled = false;
      muzzle.addChild(v.flash);
    }
    v.rockets = rig.nodes(/^Rocket_\d+$/);
    v.parts.length = 0;
    for (const r of v.root.findComponents('render') as pc.RenderComponent[]) v.parts.push({ render: r, material: r.material });
  }

  /** Strips of threat colour along a defended platform's edges. */
  private trim(x: number, z: number, size: number, level: Exclude<ThreatLevel, 0>): pc.Entity {
    const root = new pc.Entity('threat-trim');
    root.setPosition(x, 0, z);
    const half = size / 2 - 0.3;
    const m = this.mat.threat[level];
    root.addChild(part('box', m, half, 0.03, 0, 0.6, 0.06, size));
    root.addChild(part('box', m, -half, 0.03, 0, 0.6, 0.06, size));
    root.addChild(part('box', m, 0, 0.03, half, size, 0.06, 0.6));
    root.addChild(part('box', m, 0, 0.03, -half, size, 0.06, 0.6));
    return root;
  }
}

function part(type: 'box' | 'cone' | 'cylinder' | 'sphere', material: pc.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): pc.Entity {
  const entity = new pc.Entity(type);
  entity.addComponent('render', { type, material, castShadows: true, receiveShadows: true });
  entity.setLocalPosition(x, y, z);
  entity.setLocalScale(sx, sy, sz);
  return entity;
}

/** Self-lit and see-through, for range rings and muzzle flashes. */
function glow(color: Color3, opacity: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(color[0], color[1], color[2]);
  m.opacity = opacity;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

import * as pc from 'playcanvas';
import { DEFENSES, PALETTE, type ThreatLevel } from '../config';
import type { DefenseNetwork, Installation } from '../defenses/Installation';
import type { DefenseLayout } from '../defenses/Layout';
import { flatMaterial, type World } from './WorldGenerator';

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
};

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
    threat: {
      1: flatMaterial(PALETTE.threat1),
      2: flatMaterial(PALETTE.threat2),
      3: flatMaterial(PALETTE.threat3),
    } as Record<Exclude<ThreatLevel, 0>, pc.StandardMaterial>,
  };

  constructor(
    private readonly app: pc.AppBase,
    layout: DefenseLayout,
    private readonly network: DefenseNetwork,
    world: World,
  ) {
    const root = new pc.Entity('defenses');
    app.root.addChild(root);
    for (const t of world.territories) if (t.threat > 0) root.addChild(this.trim(t.x, t.z, t.size, t.threat as Exclude<ThreatLevel, 0>));
    for (const inst of network.installations) {
      const view = this.build(inst);
      root.addChild(view.root);
      if (view.ring) root.addChild(view.ring.entity);
      this.views.push(view);
      this.byId.set(inst.id, view);
    }
    for (const b of layout.barriers) {
      const wall = new pc.Entity('barrier');
      wall.setPosition(b.x, 0, b.z);
      wall.setEulerAngles(0, b.yaw * RAD_TO_DEG, 0);
      wall.addChild(part('box', this.mat.cardboardDark, 0, b.height / 2, 0, b.length, b.height, b.thickness));
      wall.addChild(part('box', this.mat.tape, 0, b.height + 0.01, 0, b.length + 0.02, 0.04, b.thickness * 0.6));
      root.addChild(wall);
    }
    for (const f of layout.flags) {
      const flag = new pc.Entity('flag');
      flag.setPosition(f.x, 0, f.z);
      flag.addChild(part('cylinder', this.mat.pencil, 0, 2.2, 0, 0.22, 4.4, 0.22));
      flag.addChild(part('cone', this.mat.graphite, 0, 4.55, 0, 0.22, 0.3, 0.22));
      flag.addChild(part('box', this.mat.threat[f.level as Exclude<ThreatLevel, 0>], 0.75, 3.85, 0, 1.4, 0.9, 0.04));
      flag.setEulerAngles(0, Math.atan2(f.x - world.home.x, f.z - world.home.z) * RAD_TO_DEG, 0);
      root.addChild(flag);
    }
  }

  /**
   * Follows the rules: aims, muzzle flashes, rockets on the rails, damage, collapse. `focus` is the
   * plane's position in flight, or null; range rings show for the weapons on `territoryId` (the
   * territory being approached) as the plane nears their reach.
   */
  update(dt: number, focus: { x: number; z: number } | null, territoryId: string | null = null): void {
    this.time += dt;
    for (const v of this.views) {
      const i = v.inst;
      if (!i.alive && !v.wrecked) this.startCollapse(v);
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
        const k = 0.55 + 0.45 * health;
        v.paint.diffuse.set(v.paintColor[0] * k, v.paintColor[1] * k, v.paintColor[2] * k);
        v.paint.update();
      }
      const shake = v.shudder > 0 ? Math.sin(v.shudder * 80) * 5 * (v.shudder / SHUDDER) : 0;
      v.shudder = Math.max(0, v.shudder - dt);
      v.body.setLocalEulerAngles(shake * 0.5, v.bodyYaw * RAD_TO_DEG, shake * 0.4);

      if (v.ring) {
        const d = focus ? Math.hypot(focus.x - i.spec.x, focus.z - i.spec.z) - i.spec.range : Infinity;
        const show = d < DEFENSES.ringMargin && i.spec.territoryId === territoryId;
        v.ring.entity.enabled = show;
        if (show) {
          const near = 1 - Math.max(0, d) / DEFENSES.ringMargin;
          const pulse = i.engaged ? 0.12 * (0.5 + 0.5 * Math.sin(this.time * 8)) : 0;
          v.ring.material.opacity = 0.12 + 0.3 * near + pulse;
          v.ring.material.update();
        }
      }
    }
  }

  /** Everything standing again, between sorties. */
  restoreAll(): void {
    for (const v of this.views) {
      v.wrecked = false;
      v.collapse = 0;
      v.shudder = 0;
      v.shownHealth = -1;
      for (const { render, material } of v.parts) render.material = material;
      v.body.setLocalPosition(0, 0, 0);
      v.body.setLocalScale(1, 1, 1);
      v.body.setLocalEulerAngles(0, v.bodyYaw * RAD_TO_DEG, 0);
    }
  }

  /** Where an installation's label floats, and where effects for it go. */
  labelPoint(id: string, out: pc.Vec3): pc.Vec3 {
    const i = this.network.get(id)!;
    const top = i.spec.kind === 'radar' ? i.spec.pivot + 2.2 : i.spec.kind === 'supply' ? 3.6 : i.spec.pivot + 2;
    return out.set(i.spec.x, i.spec.ground + top, i.spec.z);
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
    for (const { render, material } of v.parts) {
      if (render.entity === v.flash) continue;
      render.material = material === this.mat.dark || material === this.mat.barrel || material === this.mat.cardboardDark ? this.mat.wreckDark : this.mat.wreck;
    }
  }

  /** Tips and squashes the body, with a little bounce at the end. */
  private poseCollapse(v: View): void {
    const f = FALL[v.inst.spec.kind];
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
    const paintColor: Color3 = s.kind === 'supply' ? PALETTE.cardboard : s.side === 'player' ? PALETTE.friendlyDefense : PALETTE.defense;
    const paint = flatMaterial(paintColor);
    let turn: pc.Entity | null = null;
    let elevate: pc.Entity | null = null;
    let flash: pc.Entity | null = null;
    const rockets: pc.Entity[] = [];
    let bodyYaw = 0;

    switch (s.kind) {
      case 'turret': {
        body.addChild(part('cylinder', this.mat.dark, 0, 0.35, 0, 2.4, 0.7, 2.4));
        body.addChild(part('cylinder', paint, 0, 1.05, 0, 1.6, 0.8, 1.6));
        turn = new pc.Entity('gun-house');
        turn.setLocalPosition(0, s.pivot, 0);
        turn.addChild(part('box', paint, 0, 0, 0.15, 1.5, 0.95, 1.7));
        // The ink pot that feeds the gun.
        turn.addChild(part('sphere', this.mat.ink, 0, 0.6, 0.45, 0.85, 0.6, 0.85));
        elevate = new pc.Entity('barrel');
        const barrel = part('cylinder', this.mat.barrel, 0, 0, -0.9, 0.34, 1.2, 0.34);
        barrel.setLocalEulerAngles(90, 0, 0);
        elevate.addChild(barrel);
        const tip = part('cylinder', this.mat.ink, 0, 0, -1.45, 0.46, 0.14, 0.46);
        tip.setLocalEulerAngles(90, 0, 0);
        elevate.addChild(tip);
        flash = part('sphere', this.mat.flash, 0, 0, -1.75, 0.7, 0.7, 0.9);
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
        body.addChild(part('box', this.mat.red, 1.95, 3.35, 1, 0.8, 0.5, 0.03));
        break;
      }
    }
    body.setLocalEulerAngles(0, bodyYaw * RAD_TO_DEG, 0);

    let ring: View['ring'] = null;
    if (inst.isWeapon) {
      const material = glow(s.kind === 'turret' ? PALETTE.rangeTurret : PALETTE.rangeLauncher, 0.3);
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
    return {
      inst, root, body, turn, elevate, flash, rockets, ring, paint, paintColor, parts, bodyYaw,
      shownHealth: -1, shudder: 0, collapse: 0, wrecked: false, fallX: 0, fallZ: 0,
    };
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

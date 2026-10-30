import * as pc from 'playcanvas';
import { PALETTE } from '../config';
import type { Mission, Objective, TargetZone } from '../missions/Mission';
import { flatMaterial, type World } from './WorldGenerator';

type Color3 = readonly [number, number, number];

/** Self-lit and see-through, for beacons and airspace volumes. */
function glowMaterial(color: Color3, opacity: number): pc.StandardMaterial {
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

type MarkerState = 'open' | 'waiting' | 'done' | 'off';

interface Marker {
  index: number;
  objective: Objective;
  state: MarkerState | null;
  /** The bullseye rings, the airspace box or the ring hoop. */
  body: pc.Entity | null;
  /** Bullseye rings that turn green once hit. */
  paint: pc.Entity[];
  beacon: pc.Entity | null;
  /** For destroy objectives: a ring under each target, by target id. */
  rings: Map<string, pc.Entity>;
  /** A low-level strike's ceiling: the sheet the plane must stay under near the target. */
  sheet: pc.Entity | null;
}

/** Where a target stands (and how big a ring it needs), so its marker ring can go under it. */
export type TargetLookup = (id: string) => { x: number; z: number; r?: number } | null;

/**
 * Draws the selected (or active) mission into the world: bullseyes on bombing targets, a column of
 * light over every objective that can be done right now, see-through airspace for reconnaissance
 * and deliveries, paper rings for flight challenges, and orange platforms for target territories.
 * Rebuilt whenever the mission changes; updated from the mission's progress every frame.
 */
export class MissionMarkers {
  private readonly root: pc.Entity;
  private markers: Marker[] = [];
  private mission: Mission | null = null;
  private readonly ringMeshes = new Map<number, pc.Mesh>();
  private time = 0;

  private readonly mat = {
    red: flatMaterial(PALETTE.bullseyeRed),
    white: flatMaterial(PALETTE.bullseyeWhite),
    ink: flatMaterial(PALETTE.precisionInk),
    done: flatMaterial(PALETTE.done),
    beaconBomb: glowMaterial(PALETTE.bullseyeRed, 0.3),
    beaconRecon: glowMaterial(PALETTE.recon, 0.3),
    beaconDelivery: glowMaterial(PALETTE.delivery, 0.3),
    beaconHome: glowMaterial(PALETTE.home, 0.3),
    airRecon: glowMaterial(PALETTE.recon, 0.09),
    airDelivery: glowMaterial(PALETTE.delivery, 0.09),
    airSurvive: glowMaterial(PALETTE.threat3, 0.08),
    beaconSurvive: glowMaterial(PALETTE.threat3, 0.3),
    escapeLine: glowMaterial(PALETTE.recon, 0.5),
    sheetClean: glowMaterial(PALETTE.recon, 0.1),
    sheetBlown: glowMaterial(PALETTE.bullseyeRed, 0.12),
    ringNext: glowMaterial(PALETTE.ringNext, 0.95),
    practiceRing: glowMaterial(PALETTE.target, 0.85),
    ringWaiting: flatMaterial(PALETTE.paper),
    platformTarget: flatMaterial(PALETTE.target),
    platformDone: flatMaterial(PALETTE.targetDone),
    platformNeutral: flatMaterial(PALETTE.neutral),
  };

  constructor(
    private readonly app: pc.AppBase,
    private readonly world: World,
    private readonly targetAt: TargetLookup = () => null,
  ) {
    this.root = new pc.Entity('mission-markers');
    app.root.addChild(this.root);
  }

  get shown(): Mission | null {
    return this.mission;
  }

  /** Rebuilds the markers for `mission` (or clears them for null). */
  show(mission: Mission | null): void {
    for (const child of [...this.root.children]) child.destroy();
    this.markers = [];
    this.mission = mission;
    if (!mission) {
      this.tintPlatforms();
      return;
    }
    mission.objectives.forEach((objective, index) => {
      const marker: Marker = { index, objective, state: null, body: null, paint: [], beacon: null, rings: new Map(), sheet: null };
      switch (objective.kind) {
        case 'bomb': {
          const [body, paint] = this.bullseye(objective.zone, objective.precision);
          marker.body = body;
          marker.paint = paint;
          marker.beacon = this.beacon(objective.zone.x, objective.zone.z, this.mat.beaconBomb, objective.precision ? 0.35 : 0.6);
          if (objective.approach) {
            const a = objective.approach;
            const sheet = new pc.Entity('low-ceiling');
            sheet.addComponent('render', { type: 'cylinder', material: this.mat.sheetClean, castShadows: false, receiveShadows: false });
            sheet.setPosition(a.x, a.ceiling, a.z);
            sheet.setLocalScale(a.radius * 2, 0.05, a.radius * 2);
            this.root.addChild(sheet);
            marker.sheet = sheet;
          }
          break;
        }
        case 'recon':
        case 'reach':
        case 'survive': {
          const a = objective.airspace;
          const box = new pc.Entity('airspace');
          const material = objective.kind === 'recon' ? this.mat.airRecon : objective.kind === 'reach' ? this.mat.airDelivery : this.mat.airSurvive;
          box.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: false });
          box.setPosition(a.x, a.ceiling / 2, a.z);
          box.setLocalScale(a.half * 2, a.ceiling, a.half * 2);
          this.root.addChild(box);
          marker.body = box;
          const beacon = objective.kind === 'recon' ? this.mat.beaconRecon : objective.kind === 'reach' ? this.mat.beaconDelivery : this.mat.beaconSurvive;
          marker.beacon = this.beacon(a.x, a.z, beacon, 0.8);
          break;
        }
        case 'escape': {
          // The line to cross: a ring around the territory, out beyond its weapons.
          const line = new pc.Entity('escape-line');
          line.addComponent('render', { meshInstances: [new pc.MeshInstance(this.torus(objective.distance, 0.3), this.mat.escapeLine)], castShadows: false });
          line.setPosition(objective.x, 0.2, objective.z);
          this.root.addChild(line);
          marker.body = line;
          break;
        }
        case 'ring':
          marker.body = this.ring(objective.gate.x, objective.gate.y, objective.gate.z, objective.gate.yaw, objective.gate.radius);
          break;
        case 'land': {
          const home = this.world.home;
          marker.beacon = this.beacon(home.x, home.z, this.mat.beaconHome, 0.8);
          break;
        }
        case 'destroy': {
          const t = this.world.territories.find((x) => x.id === objective.territoryId)!;
          marker.beacon = this.beacon(t.x, t.z, this.mat.beaconBomb, 0.6);
          for (const id of objective.targets) {
            const at = this.targetAt(id);
            if (!at) continue;
            const ring = new pc.Entity('target-ring');
            ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.torus(at.r ?? 2.1, 0.18), this.mat.practiceRing)], castShadows: false });
            ring.setPosition(at.x, t.top + 0.12, at.z);
            this.root.addChild(ring);
            marker.rings.set(id, ring);
          }
          break;
        }
      }
      this.markers.push(marker);
    });
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    const mission = this.mission;
    if (!mission) return;
    const over = mission.status === 'failed' || mission.status === 'succeeded';
    for (const m of this.markers) {
      const state: MarkerState = mission.isDone(m.index) ? 'done' : over ? 'off' : mission.isOpen(m.index) ? 'open' : 'waiting';
      if (state !== m.state) this.apply(m, state);
    }
    // Beacons breathe gently so they read as markers, not scenery.
    const pulse = 0.22 + 0.1 * Math.sin(this.time * 3);
    for (const key of ['beaconBomb', 'beaconRecon', 'beaconDelivery', 'beaconHome', 'beaconSurvive'] as const) {
      this.mat[key].opacity = pulse;
      this.mat[key].update();
    }
    for (const m of this.markers) {
      if (m.objective.kind === 'ring' && m.state === 'open' && m.body) {
        const s = 1 + 0.06 * Math.sin(this.time * 6);
        m.body.setLocalScale(s, s, s);
      }
      if (m.sheet) {
        m.sheet.enabled = m.state === 'open';
        const material = mission.approachState(m.index) === 'blown' ? this.mat.sheetBlown : this.mat.sheetClean;
        if (m.sheet.render!.material !== material) m.sheet.render!.material = material;
      }
      if (m.rings.size > 0) {
        // A ring stays under each target until it has been destroyed once.
        const destroyed = mission.destroyedTargets(m.index);
        const s = 1 + 0.08 * Math.sin(this.time * 5);
        for (const [id, ring] of m.rings) {
          ring.enabled = (m.state === 'open' || m.state === 'waiting') && !destroyed.has(id);
          ring.setLocalScale(s, 1, s);
        }
      }
    }
  }

  private apply(m: Marker, state: MarkerState): void {
    m.state = state;
    if (m.beacon) m.beacon.enabled = state === 'open';
    switch (m.objective.kind) {
      case 'bomb':
        if (state === 'done') for (const ring of m.paint) ring.render!.material = this.mat.done;
        break;
      case 'recon':
      case 'reach':
      case 'survive':
        if (m.body) m.body.enabled = state === 'open' || state === 'waiting';
        break;
      case 'escape':
        if (m.body) m.body.enabled = state === 'open';
        break;
      case 'ring':
        if (m.body) {
          m.body.enabled = state === 'open' || state === 'waiting';
          m.body.setLocalScale(1, 1, 1);
          // The hoop's render component holds its own mesh instance, so set the material there.
          const hoop = m.body.children[0] as pc.Entity;
          hoop.render!.meshInstances[0].material = state === 'open' ? this.mat.ringNext : this.mat.ringWaiting;
        }
        break;
      case 'land':
        break;
    }
    this.tintPlatforms();
  }

  /** Target territories are orange until everything on them is done, then pale green. */
  private tintPlatforms(): void {
    const status = new Map<string, boolean>();
    if (this.mission) {
      this.mission.objectives.forEach((o, i) => {
        if (o.kind === 'ring' || o.kind === 'land' || o.kind === 'escape') return;
        const done = this.mission!.isDone(i);
        status.set(o.territoryId, (status.get(o.territoryId) ?? true) && done);
      });
    }
    for (const t of this.world.territories) {
      if (t.isHome) continue;
      const done = status.get(t.id);
      const material = done === undefined ? this.mat.platformNeutral : done ? this.mat.platformDone : this.mat.platformTarget;
      const render = this.world.platforms.get(t.id)!.render!;
      if (render.material !== material) render.material = material;
    }
  }

  /** Red-white-red rings standing on the platform; ink-blue and white for precision spots. */
  private bullseye(zone: TargetZone, precision: boolean): [pc.Entity, pc.Entity[]] {
    const root = new pc.Entity('bullseye');
    root.setPosition(zone.x, 0, zone.z);
    const strong = precision ? this.mat.ink : this.mat.red;
    const rings: Array<[number, pc.StandardMaterial]> = [
      [zone.radius, strong],
      [zone.radius * 0.68, this.mat.white],
      [zone.radius * 0.36, strong],
    ];
    const paint: pc.Entity[] = [];
    rings.forEach(([radius, material], i) => {
      const height = zone.top + i * 0.02;
      const ring = new pc.Entity(`ring-${i}`);
      ring.addComponent('render', { type: 'cylinder', material, castShadows: false });
      ring.setLocalPosition(0, height / 2, 0);
      ring.setLocalScale(radius * 2, height, radius * 2);
      root.addChild(ring);
      if (material === strong) paint.push(ring);
    });
    this.root.addChild(root);
    return [root, paint];
  }

  private beacon(x: number, z: number, material: pc.Material, radius: number): pc.Entity {
    const beacon = new pc.Entity('beacon');
    beacon.addComponent('render', { type: 'cylinder', material, castShadows: false, receiveShadows: false });
    const height = 60;
    beacon.setPosition(x, height / 2 + 0.4, z);
    beacon.setLocalScale(radius * 2, height, radius * 2);
    this.root.addChild(beacon);
    return beacon;
  }

  private torus(radius: number, tube = 0.32): pc.Mesh {
    const key = radius * 1000 + tube;
    let mesh = this.ringMeshes.get(key);
    if (!mesh) {
      const geometry = new pc.TorusGeometry({ tubeRadius: tube, ringRadius: radius, segments: 36, sides: 8 });
      mesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, geometry);
      // The cache holds a reference: markers are destroyed on every mission change, and PlayCanvas
      // would otherwise destroy the mesh with the last of them.
      mesh.incRefCount();
      this.ringMeshes.set(key, mesh);
    }
    return mesh;
  }

  /** A paper hoop standing upright, facing along `yaw`. */
  private ring(x: number, y: number, z: number, yaw: number, radius: number): pc.Entity {
    const mesh = this.torus(radius);
    const root = new pc.Entity('ring-gate');
    root.setPosition(x, y, z);
    root.setEulerAngles(0, (yaw * 180) / Math.PI, 0);
    const hoop = new pc.Entity('hoop');
    hoop.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.mat.ringWaiting)], castShadows: true });
    // The torus is built lying flat; stand it up so it faces along the parent's -Z.
    hoop.setLocalEulerAngles(90, 0, 0);
    root.addChild(hoop);
    this.root.addChild(root);
    return root;
  }
}

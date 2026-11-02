import * as pc from 'playcanvas';
import type { AssetLibrary } from '../../assets/AssetLibrary';
import { PROPS } from '../../assets/manifest';
import type { Collider } from '../../combat/Collision';
import { WORLD } from '../../config';
import { outline } from '../../render/outline/OutlineRenderer';
import type { MaterialId } from '../../render/style';
import type { Place, Vec3 } from '../props/MeshBuilder';
import { LANDMARKS } from '../props/landmarks';
import { Model } from '../props/Model';
import { paperFlag, rand } from '../props/stationery';
import type { Territory } from '../Territory';
import { BuildingRig } from '../BuildingRig';
import { decorColliders, frameYaw } from './decor';
import { THEMES, type Detail, type TerritoryLayout } from './themes';

/**
 * Who a territory belongs to, as the dressing shows it: the player's own (blue tape and pennants),
 * another player's (red tape and pennants), the AI's defended ground (red tape) or nobody's (grey
 * tape). Mission markers add orange for objectives on top.
 */
export type Ownership = 'player' | 'rival' | 'hostile' | 'neutral';

const TAPE: Record<Ownership, MaterialId> = { player: 'tape/blue', rival: 'tape/red', hostile: 'tape/red', neutral: 'tape/grey' };
const PENNANT: Partial<Record<Ownership, MaterialId>> = { player: 'paper/blue', rival: 'paper/red' };

/**
 * A territory dressed in its theme: the platform's slab and the sheet on top, the owner's tape
 * border and pennants, the landmark and the props. Static decoration is merged per material into a
 * few meshes (and one pencil-stroke mesh per outline tier), so a dressed territory costs a handful
 * of draw calls however many props it has.
 *
 * Its collision shapes come from territories/decor.ts, the same pure function the server uses.
 */
export class Dressing {
  readonly root: pc.Entity;
  private details: pc.Entity | null = null;
  private surface: pc.Entity | null = null;
  /** The frame's turn about the vertical, degrees (setEulerAngles convention). */
  private readonly yaw: number;
  private readonly solid: Collider[];
  /** The aircraft hangar behind the runway's start (homes only), when its model has loaded. */
  readonly hangar: BuildingRig | null = null;
  /** The runway's model (homes only), when it has loaded; otherwise it is drawn as tape. */
  private readonly runwayModel: BuildingRig | null = null;
  private hangarLevel = 1;

  constructor(
    private readonly app: pc.AppBase,
    readonly territory: Territory,
    private readonly layout: TerritoryLayout,
    private readonly assets: AssetLibrary,
    private detail: Detail,
    /** The territory's facing, as the direction its u axis points (x, z). */
    facing: { x: number; z: number },
    /** Draws the home runway, launch card and hangar (homes only). */
    readonly runway = false,
    /** Whose it is: the tape's colour and the pennants. */
    private ownership: Ownership = territory.isHome ? 'player' : territory.threat > 0 ? 'hostile' : 'neutral',
  ) {
    this.root = new pc.Entity(`dressing-${territory.id}`);
    this.root.setPosition(territory.x, 0, territory.z);
    this.yaw = frameYaw(facing);
    this.root.setEulerAngles(0, this.yaw, 0);
    app.root.addChild(this.root);
    this.solid = decorColliders(territory, layout, facing);
    this.buildSurface();
    this.buildLandmark();
    this.buildDetails();
    if (runway && BuildingRig.available(assets.models, 'runway')) {
      // The lab's runway, stretched to the gameplay's runway and flattened so wheels sit on the desk.
      const rig = new BuildingRig(assets.models, 'runway');
      rig.root.setLocalPosition(0, 0.03, 0);
      rig.root.setLocalScale(WORLD.runwayLength / 6.99, 0.5, WORLD.runwayWidth / 1.6);
      rig.show(1, 1, true);
      this.root.addChild(rig.root);
      this.runwayModel = rig;
    }
    if (runway && BuildingRig.available(assets.models, 'hangar')) {
      // Behind the launch card, door towards the runway (the frame's +u): scenery, not a target.
      const rig = new BuildingRig(assets.models, 'hangar');
      rig.root.setLocalPosition(-WORLD.runwayLength / 2 - 1, 0.02, 0);
      rig.root.setLocalEulerAngles(0, -90, 0);
      rig.show(1, 1, true);
      this.root.addChild(rig.root);
      this.hangar = rig;
    }
  }

  /**
   * The hangar grows with the planes kept in it: level 1 for one or none, 2 for two or three,
   * 3 for four or more. The runway's lights blink.
   */
  updateHangar(dt: number, planesKept: number): void {
    this.runwayModel?.update(dt, { yaw: 0, pitch: 0, sinceShot: 99, alive: true });
    if (!this.hangar) return;
    const level = planesKept >= 4 ? 3 : planesKept >= 2 ? 2 : 1;
    if (level !== this.hangarLevel) {
      this.hangarLevel = level;
      this.hangar.show(level, 1, true);
    }
    this.hangar.update(dt, { yaw: 0, pitch: 0, sinceShot: 99, alive: true });
  }

  /** Every collision shape the dressing adds (landmark and tall props), in world space. */
  get colliders(): Collider[] {
    return this.solid;
  }

  /** Rebuilds the props for another decoration level (graphics settings). */
  setDetail(detail: Detail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.buildDetails();
  }

  /** A new owner: the tape and pennants change, nothing else. */
  setOwnership(ownership: Ownership): void {
    if (ownership === this.ownership) return;
    this.ownership = ownership;
    this.buildSurface();
  }

  private get device(): pc.GraphicsDevice {
    return this.app.graphicsDevice;
  }

  /** The slab, the sheet and its markings, the tape border and pennants, and on homes the runway and launch card. */
  private buildSurface(): void {
    this.surface?.destroy();
    const group = new pc.Entity('surface-group');
    this.root.addChild(group);
    this.surface = group;
    const theme = THEMES[this.layout.theme];
    const t = this.territory;
    const size = t.size;
    const surface = new Model();
    const decals = new Model();
    surface.part(theme.slab).box([size, t.thickness, size], { at: [0, -t.thickness / 2, 0] });
    const sheet = size - theme.sheetInset * 2;
    surface.part(this.layout.sheet ?? theme.sheet).box([sheet, 0.02, sheet], { at: [0, 0.01, 0] });

    // The owner's colour: strips of tape holding the sheet down, a little crooked.
    const tape = TAPE[this.ownership];
    const edge = sheet / 2;
    const strips: Array<[Vec3, number]> = [
      [[0, 0.028, edge], 0.5],
      [[0, 0.03, -edge], -0.4],
      [[edge, 0.032, 0], 90.6],
      [[-edge, 0.034, 0], 89.5],
    ];
    for (const [at, yaw] of strips) surface.part(tape).box([size - 1.2, 0.012, 1.3], { at, rot: [0, yaw, 0] });
    this.addMarkings(theme.markings, edge, decals);
    const pennant = PENNANT[this.ownership];
    if (pennant) {
      for (const [u, v] of this.layout.flags ?? []) {
        const yaw = (-Math.atan2(v, -u) * 180) / Math.PI;
        surface.add(paperFlag(pennant, 5.5), { at: [u, 0.02, v], rot: [0, yaw, 0] });
      }
    }

    if (this.runway && !BuildingRig.available(this.assets.models, 'runway')) this.addRunway(surface, decals);
    if (this.runway) this.addLaunchCard(surface, decals, BuildingRig.available(this.assets.models, 'runway') ? 0.08 : 0);

    const entity = surface.toEntity(this.device, 'surface', { castShadows: false });
    group.addChild(entity);
    outline(entity, 'structure', { merge: true });
    if (!decals.isEmpty) group.addChild(decals.toEntity(this.device, 'markings', { castShadows: false }));
  }

  /** The theme's flat markings on the sheet. */
  private addMarkings(kind: (typeof THEMES)[keyof typeof THEMES]['markings'], edge: number, decals: Model): void {
    const slab = THEMES[this.layout.theme].slab;
    switch (kind) {
      case 'margin':
        // Notebook margin and binder holes, drawn flat.
        decals.part('ink/red').box([0.14, 0.004, edge * 2], { at: [-edge + 3.6, 0.022, 0] });
        for (const v of [-11, 0, 11]) decals.part(slab).cylinder(0.55, 0.006, { sides: 12 }, { at: [-edge + 1.6, 0.02, v] });
        break;
      case 'box':
        // A flattened box: fold lines, and "this way up" arrows printed near a corner.
        for (const u of [-edge * 0.5, edge * 0.5]) decals.part('cardboard/dark').box([0.12, 0.004, edge * 2], { at: [u, 0.022, 0] });
        for (const [u, v] of [[-edge + 3, edge - 3], [edge - 3, -edge + 3]] as const) {
          for (const d of [-0.6, 0.6]) {
            decals.part('ink/black').box([0.12, 0.004, 1.6], { at: [u + d, 0.024, v] });
            decals.part('ink/black').box([0.5, 0.004, 0.12], { at: [u + d - 0.18, 0.024, v - 0.7], rot: [0, 40, 0] });
            decals.part('ink/black').box([0.5, 0.004, 0.12], { at: [u + d + 0.18, 0.024, v - 0.7], rot: [0, -40, 0] });
          }
        }
        break;
      case 'paint': {
        // Paint splashes, the same on every client (seeded by the territory).
        const paints: MaterialId[] = ['ink/red', 'ink/blue', 'paper/yellow', 'paper/green', 'paper/purple'];
        const seed = Number(this.territory.id.slice(1)) * 13;
        for (let i = 0; i < 14; i++) {
          const u = (rand(seed + i * 3) * 2 - 1) * (edge - 2);
          const v = (rand(seed + i * 5 + 1) * 2 - 1) * (edge - 2);
          const r = 0.4 + rand(seed + i * 7 + 2) * 1.2;
          const m = paints[i % paints.length];
          decals.part(m).cylinder(r, 0.004, { sides: 10 }, { at: [u, 0.022 + i * 0.0004, v] });
          decals.part(m).cylinder(r * 0.4, 0.004, { sides: 8 }, { at: [u + r * 1.1, 0.022 + i * 0.0004, v + r * 0.3] });
        }
        break;
      }
      case null:
        break;
    }
  }

  /** The runway as a strip of grey tape with white dashes (when its model isn't there). */
  private addRunway(surface: Model, decals: Model): void {
    const length = WORLD.runwayLength;
    const width = WORLD.runwayWidth;
    surface.part('tape/grey').box([length, 0.02, width], { at: [0, 0.04, 0] });
    for (let u = -length / 2 + 7; u < length / 2 - 6; u += 4) decals.part('paper/white').box([2, 0.006, 0.35], { at: [u + 1, 0.052, 0] });
    for (const end of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        decals.part('paper/white').box([1.8, 0.006, 0.6], { at: [end * (length / 2 - 1.2), 0.052, i * 1.2] });
      }
    }
  }

  /** The launch pad: an index card with a red header line and blue rules, at the runway's start. */
  private addLaunchCard(surface: Model, decals: Model, lift: number): void {
    const u = -(WORLD.runwayLength / 2 - 6);
    surface.part('paper/white').box([6, 0.03, 4.2], { at: [u, 0.065 + lift, 0], rot: [0, 1.5, 0] });
    decals.part('ink/red').box([0.09, 0.004, 4.1], { at: [u + 2.2, 0.082 + lift, 0], rot: [0, 1.5, 0] });
    for (const k of [-1, 0, 1]) decals.part('ink/blue').box([0.05, 0.004, 4.1], { at: [u + k * 1.3, 0.082 + lift, 0], rot: [0, 1.5, 0] });
  }

  private buildLandmark(): void {
    const spec = this.layout.landmark;
    if (!spec) return;
    const landmark = LANDMARKS[spec.id]();
    const place: Place = { at: [spec.at[0], 0.02, spec.at[1]], rot: [0, spec.yaw, 0] };
    const model = new Model().add(landmark.model, place);
    const entity = model.toEntity(this.device, `landmark-${spec.id}`);
    this.root.addChild(entity);
    outline(entity, 'structure', { merge: true });
    if (!landmark.decals.isEmpty) this.root.addChild(new Model().add(landmark.decals, place).toEntity(this.device, 'landmark-markings', { castShadows: false }));
  }

  /** The props allowed at this decoration level: merged builds, plus imported models as entities. */
  private buildDetails(): void {
    this.details?.destroy();
    const details = new pc.Entity('details');
    this.root.addChild(details);
    this.details = details;
    const props = new Model();
    const structures = new Model();
    const decals = new Model();
    for (const p of this.layout.props) {
      if ((p.detail ?? 1) > this.detail) continue;
      const def = PROPS[p.prop];
      const place: Place = { at: [p.at[0], 0.02, p.at[1]], rot: [0, p.yaw ?? 0, 0] };
      const made = this.assets.instance(p.prop);
      if (made.kind === 'built') {
        (def.tier === 'structure' ? structures : props).add(made.build.model, place);
        if (made.build.decals) decals.add(made.build.decals, place);
      } else {
        made.entity.setLocalPosition(place.at![0], place.at![1], place.at![2]);
        made.entity.setLocalEulerAngles(0, p.yaw ?? 0, 0);
        details.addChild(made.entity);
      }
    }
    for (const [model, name, tier] of [[props, 'props', 'prop'], [structures, 'structures', 'structure']] as const) {
      if (model.isEmpty) continue;
      const entity = model.toEntity(this.device, name);
      details.addChild(entity);
      outline(entity, tier, { merge: true });
    }
    if (!decals.isEmpty) details.addChild(decals.toEntity(this.device, 'prop-markings', { castShadows: false }));
  }
}

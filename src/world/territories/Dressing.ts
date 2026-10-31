import * as pc from 'playcanvas';
import type { AssetLibrary } from '../../assets/AssetLibrary';
import { PROPS } from '../../assets/manifest';
import type { Collider, Shape } from '../../combat/Collision';
import { WORLD } from '../../config';
import { outline } from '../../render/outline/OutlineRenderer';
import { transformPoint, type Place, type Vec3 } from '../props/MeshBuilder';
import { LANDMARKS } from '../props/landmarks';
import { Model } from '../props/Model';
import type { Territory } from '../Territory';
import { THEMES, type Detail, type TerritoryLayout } from './themes';

/**
 * A territory dressed in its theme: the platform's slab and the sheet on top, the owner's tape
 * border, the landmark and the props, with their collision shapes. Static decoration is merged
 * per material into a few meshes (and one pencil-stroke mesh per outline tier), so a dressed
 * territory costs a handful of draw calls however many props it has.
 */
export class Dressing {
  readonly root: pc.Entity;
  private details: pc.Entity | null = null;
  /** The frame's turn about the vertical, degrees (setEulerAngles convention). */
  private readonly yaw: number;
  private propColliders: Collider[] = [];
  private landmarkColliders: Collider[] = [];

  constructor(
    private readonly app: pc.AppBase,
    readonly territory: Territory,
    private readonly layout: TerritoryLayout,
    private readonly assets: AssetLibrary,
    private detail: Detail,
    /** The territory's facing, as the direction its u axis points (x, z). */
    facing: { x: number; z: number },
    /** Draws the home runway and launch card (T1 only). */
    private readonly runway = false,
    /** The owner's tape colour (default: blue for home, masking tape otherwise). */
    private readonly tape: 'tape/blue' | 'tape/masking' | 'tape/grey' | null = null,
  ) {
    this.root = new pc.Entity(`dressing-${territory.id}`);
    this.root.setPosition(territory.x, 0, territory.z);
    this.yaw = (Math.atan2(-facing.z, facing.x) * 180) / Math.PI;
    this.root.setEulerAngles(0, this.yaw, 0);
    app.root.addChild(this.root);
    this.buildSurface();
    this.buildLandmark();
    this.buildDetails();
  }

  /** Every collision shape the dressing adds (landmark and tall props), in world space. */
  get colliders(): Collider[] {
    return [...this.landmarkColliders, ...this.propColliders];
  }

  /** Rebuilds the props for another decoration level (graphics settings). */
  setDetail(detail: Detail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.buildDetails();
  }

  private get device(): pc.GraphicsDevice {
    return this.app.graphicsDevice;
  }

  /** The slab, the sheet, the tape border, and on T1 the runway and launch card. */
  private buildSurface(): void {
    const theme = THEMES[this.layout.theme];
    const t = this.territory;
    const size = t.size;
    const surface = new Model();
    const decals = new Model();
    surface.part(theme.slab).box([size, t.thickness, size], { at: [0, -t.thickness / 2, 0] });
    const sheet = size - theme.sheetInset * 2;
    surface.part(theme.sheet).box([sheet, 0.02, sheet], { at: [0, 0.01, 0] });

    // The owner's colour: strips of tape holding the sheet down, a little crooked.
    const tape = this.tape ?? (t.isHome ? 'tape/blue' : 'tape/masking');
    const edge = sheet / 2;
    const strips: Array<[Vec3, number, number]> = [
      [[0, 0.028, edge], 0.5, 0],
      [[0, 0.03, -edge], -0.4, 0],
      [[edge, 0.032, 0], 90.6, 0],
      [[-edge, 0.034, 0], 89.5, 0],
    ];
    for (const [at, yaw] of strips) surface.part(tape).box([size - 1.2, 0.012, 1.3], { at, rot: [0, yaw, 0] });
    // Notebook margin and binder holes, drawn flat.
    decals.part('ink/red').box([0.14, 0.004, sheet], { at: [-edge + 3.6, 0.022, 0] });
    for (const v of [-11, 0, 11]) decals.part(theme.slab).cylinder(0.55, 0.006, { sides: 12 }, { at: [-edge + 1.6, 0.02, v] });

    if (this.runway) this.addRunway(surface, decals);

    const entity = surface.toEntity(this.device, 'surface', { castShadows: false });
    this.root.addChild(entity);
    outline(entity, 'structure', { merge: true });
    const flat = decals.toEntity(this.device, 'markings', { castShadows: false });
    this.root.addChild(flat);
  }

  /**
   * The runway is a strip of grey tape with white dashes, the launch pad an index card at its
   * start. Same sizes and places as the gameplay expects (WORLD.runwayLength / runwayWidth).
   */
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
    // The launch card: an index card with a red header line and blue rules.
    const u = -(length / 2 - 6);
    surface.part('paper/white').box([6, 0.03, 4.2], { at: [u, 0.065, 0], rot: [0, 1.5, 0] });
    decals.part('ink/red').box([0.09, 0.004, 4.1], { at: [u + 2.2, 0.082, 0], rot: [0, 1.5, 0] });
    for (const k of [-1, 0, 1]) decals.part('ink/blue').box([0.05, 0.004, 4.1], { at: [u + k * 1.3, 0.082, 0], rot: [0, 1.5, 0] });
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
    this.landmarkColliders = [{ id: `${this.territory.id}-landmark`, shapes: landmark.colliders.map((s) => this.toWorld(s, place)) }];
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
    this.propColliders = [];
    this.layout.props.forEach((p, i) => {
      if ((p.detail ?? 1) > this.detail) return;
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
      if (def.colliders?.length) this.propColliders.push({ id: `${this.territory.id}-prop-${i}`, shapes: def.colliders.map((s) => this.toWorld(s, place)) });
    });
    for (const [model, name, tier] of [[props, 'props', 'prop'], [structures, 'structures', 'structure']] as const) {
      if (model.isEmpty) continue;
      const entity = model.toEntity(this.device, name);
      details.addChild(entity);
      outline(entity, tier, { merge: true });
    }
    if (!decals.isEmpty) details.addChild(decals.toEntity(this.device, 'prop-markings', { castShadows: false }));
  }

  /** A shape in a part's space → world space (parts only ever turn about the vertical). */
  private toWorld(shape: Shape, place: Place): Shape {
    const local = transformPoint([shape.x, shape.y, shape.z], place);
    const p = this.root.getWorldTransform().transformPoint(new pc.Vec3(local[0], local[1], local[2]));
    const yawDeg = (place.rot?.[1] ?? 0) + this.yaw;
    if (shape.kind === 'sphere') return { ...shape, x: p.x, y: p.y, z: p.z };
    return { ...shape, x: p.x, y: p.y, z: p.z, yaw: shape.yaw + (yawDeg * Math.PI) / 180 };
  }
}

import * as pc from 'playcanvas';
import { mergeStatic, type MergeResult } from './StaticMerge';

/**
 * GPU instancing for repeated scenery (v0.0.11). Many things in the classroom are copies of the
 * same mesh in the same material: sixteen desks, the AI's installations on fifteen desks (copies
 * of the same building variants), the practice targets' crates and stands. Drawn one by one they
 * cost a draw call each (and another per shadow pass). The instancer looks under the subtrees it
 * is given, groups the mesh instances that share a mesh, a material and their shadow flags, and
 * draws each group of two or more as one instanced draw, with the copies' world matrices
 * uploaded each frame.
 *
 * It leaves the scene graph alone: entities still move, animate, swap models, get enabled and
 * disabled and destroyed as before; the instancer only hides the original mesh instances it is
 * drawing for (`visible = false`, remembered so {@link shownByInstancer} can tell) and follows
 * whatever is there each frame. A mesh instance whose material is unique (a building's own window
 * glow, a target's own damage tint) stays a normal draw.
 *
 * Culling: each copy is tested against the camera's frustum, and small copies (detail parts)
 * beyond the detail distance are dropped, which is the level of detail that matters here.
 */

/** Groups smaller than this stay as ordinary draws. */
const MIN_GROUP = 2;
/** A group not used for this many frames is released. */
const IDLE_FRAMES = 120;
/** Meshes with a bounding radius below this (m, world) count as small details for distance culling. */
const SMALL_RADIUS = 1.2;

interface Group {
  key: string;
  mesh: pc.Mesh;
  material: pc.Material;
  entity: pc.Entity;
  mi: pc.MeshInstance;
  vb: pc.VertexBuffer | null;
  data: Float32Array;
  capacity: number;
  sources: pc.MeshInstance[];
  idle: number;
  /** Mesh bounding sphere in its own space. */
  centre: pc.Vec3;
  radius: number;
}

export interface InstancerStats {
  /** Instanced draws (groups drawn) and the copies in them. */
  groups: number;
  copies: number;
  /** Copies culled this frame (outside the view, or small and far). */
  culled: number;
  /** Mesh instances under the registered roots left as ordinary draws. */
  single: number;
}

/** Mesh instances the instancer hid because it draws them itself. */
const hidden = new WeakSet<pc.MeshInstance>();

/** Is this mesh instance on screen, either itself or as part of an instanced group? */
export function shownByInstancer(mi: pc.MeshInstance): boolean {
  return mi.visible || hidden.has(mi);
}

export class Instancer {
  private readonly roots: pc.Entity[] = [];
  private readonly groups = new Map<string, Group>();
  private readonly holder: pc.Entity;
  private readonly buckets = new Map<string, pc.MeshInstance[]>();
  private camera: pc.CameraComponent | null = null;
  /** Small copies further than this from the camera are not drawn (Infinity: always drawn). */
  detailDistance = Infinity;
  enabled = true;
  private last: InstancerStats = { groups: 0, copies: 0, culled: 0, single: 0 };
  private readonly sphere = new pc.BoundingSphere();
  private readonly tmp = new pc.Vec3();

  constructor(private readonly app: pc.AppBase) {
    this.holder = new pc.Entity('instanced');
    app.root.addChild(this.holder);
  }

  /** Draws the repeated meshes under this entity (and everything later added below it) instanced. */
  add(root: pc.Entity): void {
    if (!this.roots.includes(root)) this.roots.push(root);
  }

  setCamera(camera: pc.CameraComponent | null): void {
    this.camera = camera;
  }

  get stats(): InstancerStats {
    return this.last;
  }

  /** Call once a frame, after the scene has moved and before it is drawn. */
  update(): void {
    const buckets = this.buckets;
    for (const list of buckets.values()) list.length = 0;
    let single = 0;
    if (this.enabled) {
      for (let i = this.roots.length - 1; i >= 0; i--) {
        const root = this.roots[i];
        // Destroyed roots (no parent and no children left) drop out.
        if (!root.parent && root !== this.app.root) {
          this.roots.splice(i, 1);
          continue;
        }
        this.collect(root, buckets);
      }
    }
    let groups = 0;
    let copies = 0;
    let culled = 0;
    const frustum = this.camera?.frustum ?? null;
    const eye = this.camera ? this.camera.entity.getPosition() : null;
    const far2 = this.detailDistance * this.detailDistance;
    for (const [key, list] of buckets) {
      if (list.length < MIN_GROUP) {
        for (const mi of list) this.release(mi);
        single += list.length;
        continue;
      }
      let g = this.groups.get(key);
      if (!g) g = this.createGroup(key, list[0]);
      g.idle = 0;
      this.ensureCapacity(g, list.length);
      const small = g.radius > 0 && g.radius < SMALL_RADIUS;
      let n = 0;
      for (const mi of list) {
        if (!hidden.has(mi)) {
          hidden.add(mi);
          mi.visible = false;
        }
        const m = mi.node.getWorldTransform();
        if (frustum || (small && eye)) {
          m.transformPoint(g.centre, this.tmp);
          const scale = m.getScale(scaleTmp);
          const r = g.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
          if (small && eye && r < SMALL_RADIUS && this.tmp.distance(eye) ** 2 > far2) {
            culled++;
            continue;
          }
          if (frustum) {
            this.sphere.center.copy(this.tmp);
            this.sphere.radius = r;
            if (!frustum.containsSphere(this.sphere)) {
              culled++;
              continue;
            }
          }
        }
        g.data.set(m.data, n * 16);
        n++;
      }
      if (n > 0) g.vb!.setData(g.data);
      g.mi.instancingCount = n;
      g.mi.visible = n > 0;
      g.sources = list;
      groups += n > 0 ? 1 : 0;
      copies += n;
    }
    for (const [key, g] of this.groups) {
      const list = buckets.get(key);
      if (list && list.length >= MIN_GROUP) continue;
      g.mi.visible = false;
      g.mi.instancingCount = 0;
      if (++g.idle > IDLE_FRAMES) this.destroyGroup(g);
    }
    this.last = { groups, copies, culled, single };
  }

  /** Stops instancing everything (e.g. for a comparison): the originals draw again. */
  clear(): void {
    for (const g of [...this.groups.values()]) this.destroyGroup(g);
  }

  private collect(node: pc.GraphNode, buckets: Map<string, pc.MeshInstance[]>): void {
    if (node instanceof pc.Entity) {
      if (!node.enabled) return;
      const render = node.render;
      if (render && render.enabled) {
        for (const mi of render.meshInstances) {
          // Respect mesh instances something else switched off.
          if (!mi.visible && !hidden.has(mi)) continue;
          if (!mi.mesh || mi.skinInstance || mi.morphInstance || mi.instancingData) continue;
          const material = mi.material;
          if (!material || material.blendType !== pc.BLEND_NONE) {
            this.release(mi);
            continue;
          }
          const key = `${mi.mesh.id}|${material.id}|${mi.castShadow ? 1 : 0}${mi.receiveShadow ? 1 : 0}|${render.layers.join(',')}`;
          let list = buckets.get(key);
          if (!list) {
            list = [];
            buckets.set(key, list);
          }
          list.push(mi);
        }
      }
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) this.collect(children[i], buckets);
  }

  private release(mi: pc.MeshInstance): void {
    if (hidden.has(mi)) {
      hidden.delete(mi);
      mi.visible = true;
    }
  }

  private createGroup(key: string, first: pc.MeshInstance): Group {
    const mesh = first.mesh!;
    const material = first.material!;
    const mi = new pc.MeshInstance(mesh, material);
    mi.castShadow = first.castShadow;
    mi.receiveShadow = first.receiveShadow;
    const entity = new pc.Entity(`instanced:${material.name}`);
    const layers = (first.node as pc.Entity).render?.layers ?? [pc.LAYERID_WORLD];
    entity.addComponent('render', { meshInstances: [mi], castShadows: first.castShadow, receiveShadows: first.receiveShadow, layers: [...layers] });
    this.holder.addChild(entity);
    const aabb = mesh.aabb;
    const g: Group = {
      key,
      mesh,
      material,
      entity,
      mi,
      vb: null,
      data: new Float32Array(0),
      capacity: 0,
      sources: [],
      idle: 0,
      centre: aabb.center.clone(),
      radius: aabb.halfExtents.length(),
    };
    this.groups.set(key, g);
    return g;
  }

  private ensureCapacity(g: Group, count: number): void {
    if (count <= g.capacity && g.vb) return;
    const capacity = Math.max(4, 1 << Math.ceil(Math.log2(count)));
    g.vb?.destroy();
    g.data = new Float32Array(capacity * 16);
    g.vb = new pc.VertexBuffer(this.app.graphicsDevice, pc.VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice), capacity, {
      usage: pc.BUFFER_DYNAMIC,
      data: g.data,
    });
    g.capacity = capacity;
    g.mi.setInstancing(g.vb);
  }

  private destroyGroup(g: Group): void {
    for (const mi of g.sources) this.release(mi);
    this.groups.delete(g.key);
    g.mi.setInstancing(null);
    g.vb?.destroy();
    g.entity.destroy();
  }
}

const scaleTmp = new pc.Vec3();

/** Draw-call reduction one would expect from instancing a set of keys (for tests and reports). */
export function instancedDraws(keys: readonly string[]): { before: number; after: number } {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  let after = 0;
  for (const n of counts.values()) after += n >= MIN_GROUP ? 1 : n;
  return { before: keys.length, after };
}

/** Top-level scene entities whose repeated meshes are drawn instanced. */
const SCENERY = /^(classroom|backdrop|defenses|targets|territory-|dressing-)/;
/** Top-level entities that never move: their one-off meshes are merged per material kind. */
const STATIC = /^(classroom|backdrop)$/;

/** What the last {@link instanceScenery} merged, for the report. */
export let lastMerge: MergeResult = { merged: 0, meshes: 0 };

/**
 * Sets up instancing for the world's scenery (the classroom, the installations, the practice
 * targets, the territories) and keeps it updated after the game's own update each frame. Call it
 * once the world is built and the game's update handler is registered.
 */
export function instanceScenery(app: pc.AppBase, camera: pc.CameraComponent | null): Instancer {
  const instancer = new Instancer(app);
  instancer.setCamera(camera);
  lastMerge = { merged: 0, meshes: 0 };
  // `?nobatch` turns batching off, to compare draw calls and looks against it.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobatch')) {
    instancer.enabled = false;
    return instancer;
  }
  for (const c of app.root.children) {
    if (!(c instanceof pc.Entity) || !STATIC.test(c.name)) continue;
    const r = mergeStatic(c, app.graphicsDevice);
    lastMerge = { merged: lastMerge.merged + r.merged, meshes: lastMerge.meshes + r.meshes };
  }
  for (const c of app.root.children) if (c instanceof pc.Entity && SCENERY.test(c.name)) instancer.add(c);
  app.on('update', () => instancer.update());
  return instancer;
}

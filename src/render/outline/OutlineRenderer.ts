import * as pc from 'playcanvas';
import { OUTLINE, OUTLINE_TIERS, type OutlineTier, type StrokeStyle } from '../style';
import {
  buildEdgeTopology,
  STROKE_FLOATS,
  STROKE_INDICES,
  STROKE_VERTICES,
  writeStrokeIndices,
  writeStrokes,
  type EdgeTopology,
} from './EdgeTopology';
import { strokeFragmentGLSL, strokeVertexGLSL } from './strokeShader';

export type OutlineQuality = 'low' | 'medium' | 'high';

export interface OutlineSettings {
  enabled: boolean;
  quality: OutlineQuality;
  /** Multiplies every stroke's opacity: 0.5 faint … 1.5 bold. */
  intensity: number;
}

/** What each quality level changes, relative to the tier styles in ../style.ts. */
const QUALITY: Record<OutlineQuality, { width: number; fade: number; wobble: number; overshoot: number; creaseExtra: number; tiers: readonly OutlineTier[] }> = {
  low: { width: 0.9, fade: 0.6, wobble: 0, overshoot: 0, creaseExtra: 12, tiers: ['hero', 'structure', 'prop'] },
  medium: { width: 1, fade: 1, wobble: 1, overshoot: 1, creaseExtra: 0, tiers: OUTLINE_TIERS },
  high: { width: 1.05, fade: 1.3, wobble: 1.3, overshoot: 1.2, creaseExtra: -3, tiers: OUTLINE_TIERS },
};

export interface AttachOptions {
  /**
   * Merge every mesh under the root into one stroke mesh drawn with the root's transform (one
   * draw call). Only for parts that never move relative to the root and are never hidden on their
   * own; give those as `exclude` and attach them separately.
   */
  merge?: boolean;
  /** Subtrees to leave out. */
  exclude?: readonly pc.GraphNode[];
}

/** Lets the owner refresh or remove what it attached. */
export interface OutlineHandle {
  detach(): void;
}

/** Strokes for meshes whose vertices move (a plane folding up, crumpling). */
export interface DynamicOutline extends OutlineHandle {
  /** Re-reads part `index`'s positions (same vertices, new places). */
  update(index: number, positions: ArrayLike<number>): void;
}

interface Stroke {
  mi: pc.MeshInstance;
  tier: OutlineTier;
  /** Shown while this render component (and its entity) is enabled and its mesh instance visible. */
  render: pc.RenderComponent | null;
  source: pc.MeshInstance | null;
  /** Shown while this node is enabled (merged strokes). */
  node: pc.GraphNode;
  /** A mesh only this stroke uses (released with its mesh instance). */
  owned: pc.Mesh | null;
}

interface CachedEdges {
  topology: EdgeTopology;
  positions: Float32Array;
  strokes: pc.Mesh | null;
}

const FORMAT_SEMANTICS = [
  { semantic: pc.SEMANTIC_POSITION, components: 3 },
  { semantic: pc.SEMANTIC_ATTR8, components: 3 },
  { semantic: pc.SEMANTIC_ATTR9, components: 3 },
  { semantic: pc.SEMANTIC_ATTR10, components: 3 },
  { semantic: pc.SEMANTIC_ATTR11, components: 4 },
];

/** Coplanar edges (cosine above this) are left out of meshes that never change shape. */
const COPLANAR = 0.9995;

const tmpInverse = new pc.Mat4();
const tmpRelative = new pc.Mat4();
const tmpNormal = new pc.Mat3();

/**
 * The pencil-outline renderer: hand-drawn graphite strokes along the silhouettes, creases and
 * paper edges of the objects attached to it. The strokes are real geometry (one quad per mesh edge,
 * widened on screen by the shader), so they are cheap, never shimmer as the camera moves, and can
 * be styled per object: aircraft are drawn boldest, background scenery faintest. See
 * docs/ART_DIRECTION.md.
 *
 * Attach objects with `outline(entity, tier)` once they are built; strokes follow the entity's
 * transform, hide with it, and go when it is destroyed.
 */
export class OutlineRenderer {
  private readonly device: pc.GraphicsDevice;
  private readonly layer: pc.Layer;
  private readonly materials: Record<OutlineTier, pc.ShaderMaterial>;
  private readonly format: pc.VertexFormat;
  private readonly strokes = new Set<Stroke>();
  private readonly edgeCache = new WeakMap<pc.Mesh, CachedEdges>();
  private settings: OutlineSettings = { enabled: true, quality: 'medium', intensity: 1 };
  private pixelRatio = 1;

  constructor(app: pc.AppBase) {
    this.device = app.graphicsDevice;
    this.layer = app.scene.layers.getLayerById(pc.LAYERID_WORLD)!;
    this.format = new pc.VertexFormat(this.device, FORMAT_SEMANTICS.map((f) => ({ ...f, type: pc.TYPE_FLOAT32 })));
    const material = (tier: OutlineTier) => {
      const m = new pc.ShaderMaterial({
        uniqueName: 'PencilStroke',
        vertexGLSL: strokeVertexGLSL,
        fragmentGLSL: strokeFragmentGLSL,
        attributes: {
          vertex_position: pc.SEMANTIC_POSITION,
          aOther: pc.SEMANTIC_ATTR8,
          aNormalA: pc.SEMANTIC_ATTR9,
          aNormalB: pc.SEMANTIC_ATTR10,
          aInfo: pc.SEMANTIC_ATTR11,
        },
      });
      m.name = `pencil-${tier}`;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.cull = pc.CULLFACE_NONE;
      return m;
    };
    this.materials = { hero: material('hero'), structure: material('structure'), prop: material('prop'), background: material('background') };
    this.applySettings();
  }

  get current(): Readonly<OutlineSettings> {
    return this.settings;
  }

  configure(settings: OutlineSettings): void {
    this.settings = { ...settings, intensity: Math.max(0, Math.min(2, settings.intensity)) };
    this.applySettings();
  }

  /** Draws strokes for everything under `root`. */
  attach(root: pc.Entity, tier: OutlineTier, options: AttachOptions = {}): OutlineHandle {
    const exclude = new Set(options.exclude ?? []);
    const renders = collectRenders(root, exclude);
    const made: Stroke[] = [];
    if (options.merge) {
      const mesh = this.mergedStrokes(root, renders);
      if (mesh) made.push(this.add({ mi: new pc.MeshInstance(mesh, this.materials[tier], root), tier, render: null, source: null, node: root, owned: mesh }));
    } else {
      for (const render of renders) {
        for (const source of render.meshInstances) {
          const mesh = source.mesh ? this.strokesFor(source.mesh) : null;
          if (!mesh) continue;
          made.push(this.add({ mi: new pc.MeshInstance(mesh, this.materials[tier], source.node), tier, render, source, node: source.node, owned: null }));
        }
      }
    }
    const detach = () => made.forEach((s) => this.remove(s));
    root.once('destroy', detach);
    return { detach };
  }

  /**
   * Strokes for meshes rebuilt in place every frame they change (folding, crumpling): one per
   * part, with the part's positions as a triangle soup, drawn with `entity`'s transform.
   */
  attachDynamic(entity: pc.Entity, tier: OutlineTier, parts: ReadonlyArray<{ positions: ArrayLike<number>; doubleSided?: boolean }>): DynamicOutline {
    const made = parts.map((part) => {
      const topology = buildEdgeTopology({ positions: part.positions, doubleSided: part.doubleSided });
      const mesh = this.createStrokeMesh(topology.edgeCount, true);
      const stroke = this.add({ mi: new pc.MeshInstance(mesh, this.materials[tier], entity), tier, render: null, source: null, node: entity, owned: mesh });
      const scratch = new Float32Array(topology.triangles.length);
      const write = (positions: ArrayLike<number>) => {
        const data = lockFloats(mesh);
        writeStrokes(topology, positions, data, 0, null, null, scratch);
        mesh.vertexBuffer.unlock();
        mesh.aabb = boundsOf(positions);
      };
      write(part.positions);
      return { stroke, write };
    });
    const detach = () => made.forEach((m) => this.remove(m.stroke));
    entity.once('destroy', detach);
    return {
      update: (index, positions) => made[index]?.write(positions),
      detach,
    };
  }

  /** Keeps strokes in step with what they outline; call once a frame before rendering. */
  update(): void {
    const ratio = this.device.width / Math.max(1, this.device.canvas.clientWidth || this.device.width);
    if (Math.abs(ratio - this.pixelRatio) > 0.01) {
      this.pixelRatio = ratio;
      this.applySettings();
    }
    const on = this.settings.enabled;
    const tiers = QUALITY[this.settings.quality].tiers;
    for (const s of this.strokes) {
      let visible = on && tiers.includes(s.tier);
      if (visible) {
        if (s.render) {
          visible = s.render.enabled && s.render.entity.enabled && !!s.source && s.source.visible && opaque(s.source.material);
        } else {
          visible = (s.node as pc.Entity).enabled;
        }
      }
      s.mi.visible = visible;
    }
  }

  /** Strokes attached and quads drawn at most, for the performance overlay. */
  stats(): { objects: number; edges: number } {
    let edges = 0;
    for (const s of this.strokes) if (s.mi.visible && s.mi.mesh) edges += s.mi.mesh.primitive[0].count / STROKE_INDICES;
    return { objects: this.strokes.size, edges };
  }

  // ---- Internals ------------------------------------------------------------------------------

  private add(stroke: Stroke): Stroke {
    stroke.mi.castShadow = false;
    stroke.mi.receiveShadow = false;
    stroke.mi.pick = false;
    this.layer.addMeshInstances([stroke.mi]);
    this.strokes.add(stroke);
    return stroke;
  }

  private remove(stroke: Stroke): void {
    if (!this.strokes.delete(stroke)) return;
    this.layer.removeMeshInstances([stroke.mi]);
    // Releases the stroke mesh: an owned one is destroyed with it, shared ones are pinned by the cache.
    stroke.mi.destroy();
  }

  private applySettings(): void {
    const q = QUALITY[this.settings.quality];
    const [r, g, b] = OUTLINE.color;
    for (const tier of OUTLINE_TIERS) {
      const style: StrokeStyle = OUTLINE.tiers[tier];
      const m = this.materials[tier];
      const crease = Math.min(89, Math.max(1, style.creaseAngle + q.creaseExtra));
      m.setParameter('outline_stroke', [style.width * q.width, style.opacity * this.settings.intensity, Math.cos((crease * Math.PI) / 180), style.overshoot * q.overshoot]);
      m.setParameter('outline_fade', [style.fullWidthDistance, style.minWidthScale, style.fadeStart * q.fade, style.fadeEnd * q.fade]);
      m.setParameter('outline_global', [this.pixelRatio, OUTLINE.wobble * q.wobble, OUTLINE.minLength, OUTLINE.depthBias]);
      m.setParameter('outline_color', [r, g, b]);
      m.update();
    }
  }

  /** The (shared) strokes of a mesh used as is, e.g. the engine's box. */
  private strokesFor(mesh: pc.Mesh): pc.Mesh | null {
    const edges = this.edgesOf(mesh);
    if (!edges || edges.topology.edgeCount === 0) return null;
    if (!edges.strokes) {
      edges.strokes = this.createStrokeMesh(edges.topology.edgeCount, false);
      // Shared by every instance of the source mesh: kept for as long as the cache holds it.
      edges.strokes.incRefCount();
      const data = lockFloats(edges.strokes);
      writeStrokes(edges.topology, edges.positions, data);
      edges.strokes.vertexBuffer.unlock();
      edges.strokes.aabb = boundsOf(edges.positions);
    }
    return edges.strokes;
  }

  private edgesOf(mesh: pc.Mesh): CachedEdges | null {
    let edges = this.edgeCache.get(mesh);
    if (edges) return edges;
    const positions: number[] = [];
    const indices: number[] = [];
    if (!mesh.getPositions(positions)) return null;
    const indexed = mesh.indexBuffer?.[0] ? mesh.getIndices(indices) > 0 : false;
    const doubleSided = false;
    const topology = buildEdgeTopology({ positions, indices: indexed ? indices : null, doubleSided }, { dropCoplanar: COPLANAR });
    edges = { topology, positions: Float32Array.from(positions), strokes: null };
    this.edgeCache.set(mesh, edges);
    return edges;
  }

  /** One stroke mesh for a rigid group, in the root's space. */
  private mergedStrokes(root: pc.Entity, renders: pc.RenderComponent[]): pc.Mesh | null {
    const parts: Array<{ edges: CachedEdges; node: pc.GraphNode }> = [];
    let total = 0;
    for (const render of renders) {
      for (const mi of render.meshInstances) {
        if (!opaque(mi.material) || !mi.mesh) continue;
        const edges = this.edgesOf(mi.mesh);
        if (!edges || edges.topology.edgeCount === 0) continue;
        parts.push({ edges, node: mi.node });
        total += edges.topology.edgeCount;
      }
    }
    if (total === 0) return null;
    const mesh = this.createStrokeMesh(total, false);
    const data = lockFloats(mesh);
    tmpInverse.copy(root.getWorldTransform()).invert();
    const min = new pc.Vec3(Infinity, Infinity, Infinity);
    const max = new pc.Vec3(-Infinity, -Infinity, -Infinity);
    const corner = new pc.Vec3();
    let offset = 0;
    for (const { edges, node } of parts) {
      tmpRelative.mul2(tmpInverse, node.getWorldTransform());
      tmpNormal.invertMat4(tmpRelative).transpose();
      writeStrokes(edges.topology, edges.positions, data, offset, tmpRelative.data, tmpNormal.data);
      offset += edges.topology.edgeCount * STROKE_VERTICES * STROKE_FLOATS;
      const aabb = boundsOf(edges.positions);
      for (let i = 0; i < 8; i++) {
        corner.set(
          aabb.center.x + (i & 1 ? 1 : -1) * aabb.halfExtents.x,
          aabb.center.y + (i & 2 ? 1 : -1) * aabb.halfExtents.y,
          aabb.center.z + (i & 4 ? 1 : -1) * aabb.halfExtents.z,
        );
        tmpRelative.transformPoint(corner, corner);
        min.min(corner);
        max.max(corner);
      }
    }
    mesh.vertexBuffer.unlock();
    const box = new pc.BoundingBox();
    box.setMinMax(min, max);
    mesh.aabb = box;
    return mesh;
  }

  private createStrokeMesh(edgeCount: number, dynamic: boolean): pc.Mesh {
    const vertexCount = edgeCount * STROKE_VERTICES;
    const vb = new pc.VertexBuffer(this.device, this.format, vertexCount, { usage: dynamic ? pc.BUFFER_DYNAMIC : pc.BUFFER_STATIC });
    const wide = vertexCount > 0xffff;
    const indices = wide ? new Uint32Array(edgeCount * STROKE_INDICES) : new Uint16Array(edgeCount * STROKE_INDICES);
    writeStrokeIndices(edgeCount, indices);
    const ib = new pc.IndexBuffer(this.device, wide ? pc.INDEXFORMAT_UINT32 : pc.INDEXFORMAT_UINT16, indices.length, pc.BUFFER_STATIC, indices);
    const mesh = new pc.Mesh(this.device);
    mesh.vertexBuffer = vb;
    mesh.indexBuffer[0] = ib;
    mesh.primitive[0] = { type: pc.PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: indices.length, indexed: true };
    return mesh;
  }
}

function collectRenders(root: pc.Entity, exclude: ReadonlySet<pc.GraphNode>): pc.RenderComponent[] {
  const out: pc.RenderComponent[] = [];
  const walk = (node: pc.GraphNode) => {
    if (exclude.has(node)) return;
    const render = (node as pc.Entity).render;
    if (render && render.meshInstances.length > 0) out.push(render);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/** The vertex buffer's data as floats, to fill in before `unlock()` uploads it. */
function lockFloats(mesh: pc.Mesh): Float32Array {
  const data = mesh.vertexBuffer.lock();
  return data instanceof ArrayBuffer ? new Float32Array(data) : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

function opaque(material: pc.Material | null | undefined): boolean {
  return !!material && material.blendType === pc.BLEND_NONE;
}

function boundsOf(p: ArrayLike<number>): pc.BoundingBox {
  const min = new pc.Vec3(Infinity, Infinity, Infinity);
  const max = new pc.Vec3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i + 2 < p.length; i += 3) {
    min.x = Math.min(min.x, p[i]); min.y = Math.min(min.y, p[i + 1]); min.z = Math.min(min.z, p[i + 2]);
    max.x = Math.max(max.x, p[i]); max.y = Math.max(max.y, p[i + 1]); max.z = Math.max(max.z, p[i + 2]);
  }
  const box = new pc.BoundingBox();
  if (Number.isFinite(min.x)) box.setMinMax(min, max);
  return box;
}

// ---- The game's outline renderer ----------------------------------------------------------------

let active: OutlineRenderer | null = null;

/** Starts the outline renderer for this app. Until then (and in tests), `outline()` does nothing. */
export function installOutlines(app: pc.AppBase): OutlineRenderer {
  active = new OutlineRenderer(app);
  return active;
}

export function outlineRenderer(): OutlineRenderer | null {
  return active;
}

/** Draws pencil strokes around `root` and everything under it. */
export function outline(root: pc.Entity, tier: OutlineTier, options?: AttachOptions): OutlineHandle | null {
  return active ? active.attach(root, tier, options) : null;
}

/** Strokes for meshes that change shape (see OutlineRenderer.attachDynamic). */
export function outlineDynamic(entity: pc.Entity, tier: OutlineTier, parts: ReadonlyArray<{ positions: ArrayLike<number>; doubleSided?: boolean }>): DynamicOutline | null {
  return active ? active.attachDynamic(entity, tier, parts) : null;
}

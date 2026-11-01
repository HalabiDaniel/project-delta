import * as pc from 'playcanvas';

/**
 * Static batching for scenery that never moves (v0.0.11): the classroom's walls, trim, chairs,
 * backpacks and teacher's desk arrive as a hundred-odd small meshes in nearly as many colours,
 * each its own draw call. This merges every mesh used only once under a root into a few meshes,
 * one per *kind* of material (same texture, shine and glow), with each part's colour baked into
 * its vertices, so a dozen draws replace well over a hundred.
 *
 * Meshes used more than once (the sixteen desks) are left alone: the {@link Instancer} draws
 * them. Transparent parts (glass) are left alone too, so they still sort.
 */

export interface MergeResult {
  /** Mesh instances merged away, and the merged meshes that replace them. */
  merged: number;
  meshes: number;
}

interface Part {
  mi: pc.MeshInstance;
  colour: [number, number, number];
}

/** Material properties that must match to share one merged mesh (the colour goes into the vertices). */
export function materialSignature(m: pc.StandardMaterial): string {
  const e = m.emissive;
  return [
    texId(m.diffuseMap),
    m.diffuseMapChannel,
    m.diffuseMapTiling?.toString(),
    m.diffuseMapOffset?.toString(),
    `${e.r.toFixed(2)},${e.g.toFixed(2)},${e.b.toFixed(2)}`,
    m.emissiveIntensity.toFixed(2),
    texId(m.emissiveMap),
    m.useMetalness ? 1 : 0,
    m.metalness.toFixed(1),
    m.gloss.toFixed(1),
    m.cull,
    m.useLighting ? 1 : 0,
    m.diffuseVertexColorChannel,
    JSON.stringify(m.defines ? [...m.defines] : []),
  ].join('|');
}

export function mergeStatic(root: pc.Entity, device: pc.GraphicsDevice): MergeResult {
  root.syncHierarchy();
  const all: pc.MeshInstance[] = [];
  root.forEach((node) => {
    if (!(node instanceof pc.Entity) || !node.enabled) return;
    const r = node.render;
    if (!r || !r.enabled) return;
    for (const mi of r.meshInstances) all.push(mi);
  });
  const uses = new Map<number, number>();
  for (const mi of all) if (mi.mesh) uses.set(mi.mesh.id, (uses.get(mi.mesh.id) ?? 0) + 1);

  const buckets = new Map<string, Part[]>();
  for (const mi of all) {
    const m = mi.material;
    const mesh = mi.mesh;
    if (!mesh || !mi.visible || uses.get(mesh.id) !== 1) continue;
    if (!(m instanceof pc.StandardMaterial) || m.blendType !== pc.BLEND_NONE || m.alphaTest > 0) continue;
    if (mi.skinInstance || mi.morphInstance || mi.instancingData) continue;
    const prim = mesh.primitive[0];
    if (!prim || prim.type !== pc.PRIMITIVE_TRIANGLES) continue;
    const key = `${materialSignature(m)}|${mi.castShadow ? 1 : 0}${mi.receiveShadow ? 1 : 0}|${(mi.node as pc.Entity).render?.layers.join(',')}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    // Vertex colours are linear; material colours are sRGB.
    list.push({ mi, colour: [srgbToLinear(m.diffuse.r), srgbToLinear(m.diffuse.g), srgbToLinear(m.diffuse.b)] });
  }

  const inverse = root.getWorldTransform().clone().invert();
  const local = new pc.Mat4();
  const normalMat = new pc.Mat3();
  const v = new pc.Vec3();
  let merged = 0;
  let meshes = 0;
  for (const parts of buckets.values()) {
    if (parts.length < 2) continue;
    const first = parts[0].mi;
    const textured = !!(first.material as pc.StandardMaterial).diffuseMap;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colours: number[] = [];
    const indices: number[] = [];
    for (const { mi, colour } of parts) {
      const mesh = mi.mesh!;
      const p: number[] = [];
      const n: number[] = [];
      const count = mesh.getPositions(p);
      if (mesh.getNormals(n) !== count) continue;
      const uv: number[] = [];
      if (textured && mesh.getUvs(0, uv) !== count) continue;
      // Parts that already multiply by their own vertex colours keep them, tinted by the material's colour.
      const own: number[] = [];
      const material = mi.material as pc.StandardMaterial;
      const hasOwn = material.diffuseVertexColor && material.diffuseVertexColorChannel === 'rgb' && mesh.getColors(own) === count;
      const stride = hasOwn ? own.length / count : 0;
      const idx: number[] = [];
      const indexed = mesh.primitive[0].indexed;
      if (indexed) mesh.getIndices(idx);
      const base = positions.length / 3;
      local.mul2(inverse, mi.node.getWorldTransform());
      normalMat.invertMat4(local).transpose();
      for (let i = 0; i < count; i++) {
        v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        local.transformPoint(v, v);
        positions.push(v.x, v.y, v.z);
        v.set(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
        normalMat.transformVector(v, v).normalize();
        normals.push(v.x, v.y, v.z);
        if (textured) uvs.push(uv[i * 2], uv[i * 2 + 1]);
        if (hasOwn) colours.push(colour[0] * own[i * stride], colour[1] * own[i * stride + 1], colour[2] * own[i * stride + 2], 1);
        else colours.push(colour[0], colour[1], colour[2], 1);
      }
      // A mirrored part (negative scale) would turn its faces inside out: flip their winding.
      const flip = determinant(local) < 0;
      const tri = (a: number, b: number, c: number) => (flip ? indices.push(base + a, base + c, base + b) : indices.push(base + a, base + b, base + c));
      if (indexed) for (let i = 0; i + 2 < idx.length; i += 3) tri(idx[i], idx[i + 1], idx[i + 2]);
      else for (let i = 0; i + 2 < count; i += 3) tri(i, i + 1, i + 2);
      mi.visible = false;
      merged++;
    }
    if (positions.length === 0) continue;
    const mesh = new pc.Mesh(device);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    if (textured) mesh.setUvs(0, uvs);
    mesh.setColors(colours, 4);
    mesh.setIndices(positions.length / 3 > 65535 ? new Uint32Array(indices) : indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const material = (first.material as pc.StandardMaterial).clone();
    material.name = `${first.material!.name}+merged`;
    material.diffuse = new pc.Color(1, 1, 1);
    material.diffuseVertexColor = true;
    material.diffuseVertexColorChannel = 'rgb';
    material.update();
    const mi = new pc.MeshInstance(mesh, material);
    mi.castShadow = first.castShadow;
    mi.receiveShadow = first.receiveShadow;
    const e = new pc.Entity(`merged:${material.name}`);
    e.addComponent('render', {
      meshInstances: [mi],
      castShadows: first.castShadow,
      receiveShadows: first.receiveShadow,
      layers: [...((first.node as pc.Entity).render?.layers ?? [pc.LAYERID_WORLD])],
    });
    root.addChild(e);
    meshes++;
  }
  return { merged, meshes };
}

function determinant(m: pc.Mat4): number {
  const d = m.data;
  return d[0] * (d[5] * d[10] - d[6] * d[9]) - d[1] * (d[4] * d[10] - d[6] * d[8]) + d[2] * (d[4] * d[9] - d[5] * d[8]);
}

const textureIds = new WeakMap<pc.Texture, number>();
let nextTextureId = 1;
function texId(t: pc.Texture | null): string {
  if (!t) return '-';
  let id = textureIds.get(t);
  if (!id) textureIds.set(t, (id = nextTextureId++));
  return String(id);
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Checks model files before they go into the game (v0.0.11 section 1B): a licensed model for one
 * of the manifest's slots, or any .glb.
 *
 *   npm run validate-glb -- assets/licensed/synty/globe.glb
 *   npm run validate-glb -- assets/licensed            (every .glb under a folder)
 *   npm run validate-glb -- --json path …               (machine-readable, also written to tools/out/)
 *
 * For each file it reports the size, triangles, meshes, materials, textures (and their pixel
 * sizes), extensions, skins and animations, and the model's bounds; for a file that fills a
 * manifest slot, how it will be fitted (scale to the slot's height and the resulting footprint)
 * and whether it is within the slot category's budget. It exits with code 1 if any file has an
 * error (not a GLB, compression the game can't decode, over twice its triangle budget).
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPS, type PropDef, type PropId } from '../src/assets/manifest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Triangle budgets per slot category (and for anything else). */
export const TRIANGLE_BUDGET: Record<string, number> = { furniture: 8000, architecture: 4000, prop: 3000, obstacle: 3000, other: 5000 };
/** Largest texture side the game wants (the classroom is seen from afar; palettes are small). */
export const MAX_TEXTURE = 1024;
/** Extensions the game's loader can't decode without extra decoders. */
const UNSUPPORTED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];

interface Accessor {
  count: number;
  componentType: number;
  type: string;
  min?: number[];
  max?: number[];
  bufferView?: number;
}

interface Gltf {
  asset?: { version?: string; generator?: string };
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  nodes?: Array<{ mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; skin?: number }>;
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number; material?: number }> }>;
  accessors?: Accessor[];
  materials?: Array<{ name?: string }>;
  textures?: Array<{ source?: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string; name?: string }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
  skins?: unknown[];
  animations?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface GlbReport {
  file: string;
  bytes: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  triangles: number;
  meshes: number;
  drawables: number;
  materials: string[];
  textures: Array<{ name: string; mime: string; width: number | null; height: number | null }>;
  extensions: string[];
  bounds: { min: number[]; max: number[]; size: number[] } | null;
  slot: { id: PropId; category: string; fitHeight: number; scale: number; footprint: [number, number]; budget: number } | null;
}

/** Parses a GLB and reports on it. `slotFor` finds the manifest slot the file fills, if any. */
export function inspectGlb(file: string, data: Buffer, slotFor: (file: string) => [PropId, PropDef] | null = findSlot): GlbReport {
  const report: GlbReport = { file, bytes: data.length, ok: true, errors: [], warnings: [], triangles: 0, meshes: 0, drawables: 0, materials: [], textures: [], extensions: [], bounds: null, slot: null };
  const fail = (m: string) => {
    report.errors.push(m);
    report.ok = false;
  };
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) {
    fail('not a binary glTF (.glb) file');
    return report;
  }
  if (data.readUInt32LE(4) !== 2) fail(`glTF version ${data.readUInt32LE(4)}, the game reads version 2`);
  const jsonLength = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4e4f534a) {
    fail('the first chunk is not JSON');
    return report;
  }
  let gltf: Gltf;
  try {
    gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  } catch {
    fail('the JSON chunk does not parse');
    return report;
  }
  const binStart = 20 + jsonLength + 8;
  const bin = data.length > binStart ? data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength)) : Buffer.alloc(0);

  report.extensions = gltf.extensionsUsed ?? [];
  for (const ext of gltf.extensionsRequired ?? []) if (UNSUPPORTED.includes(ext)) fail(`requires ${ext}: re-export without compression`);
  for (const ext of report.extensions) if (UNSUPPORTED.includes(ext) && !(gltf.extensionsRequired ?? []).includes(ext)) report.warnings.push(`uses ${ext}`);
  if (gltf.skins?.length) report.warnings.push(`${gltf.skins.length} skin(s): skinned meshes are not batched or instanced`);
  if (gltf.animations?.length) report.warnings.push(`${gltf.animations.length} animation(s): ignored, the game poses models itself`);

  report.materials = (gltf.materials ?? []).map((m, i) => m.name ?? `material ${i}`);
  if (report.materials.length > 4) report.warnings.push(`${report.materials.length} materials: each costs a draw call (Synty packs usually need one palette material)`);

  for (const [i, img] of (gltf.images ?? []).entries()) {
    const name = img.name ?? img.uri ?? `image ${i}`;
    if (img.uri && !img.uri.startsWith('data:')) report.warnings.push(`${name} is an external file: embed textures in the .glb`);
    let size: { width: number; height: number } | null = null;
    if (img.bufferView !== undefined && gltf.bufferViews?.[img.bufferView]) {
      const bv = gltf.bufferViews[img.bufferView];
      size = imageSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    }
    report.textures.push({ name, mime: img.mimeType ?? '?', width: size?.width ?? null, height: size?.height ?? null });
    if (size && Math.max(size.width, size.height) > MAX_TEXTURE) report.warnings.push(`${name} is ${size.width}×${size.height}: scale it to ${MAX_TEXTURE} or less`);
  }

  // Triangles and bounds, walking the scene's node hierarchy with its transforms.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const meshesSeen = new Set<number>();
  const visit = (index: number, parent: number[]) => {
    const node = gltf.nodes?.[index];
    if (!node) return;
    const m = mul(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      meshesSeen.add(node.mesh);
      for (const p of mesh?.primitives ?? []) {
        const mode = p.mode ?? 4;
        const pos = gltf.accessors?.[p.attributes.POSITION];
        const count = p.indices !== undefined ? (gltf.accessors?.[p.indices]?.count ?? 0) : (pos?.count ?? 0);
        if (mode === 4) report.triangles += Math.floor(count / 3);
        else if (mode === 5 || mode === 6) report.triangles += Math.max(0, count - 2);
        report.drawables++;
        if (pos?.min && pos.max) {
          for (const c of corners(pos.min, pos.max)) {
            const w = transform(m, c);
            for (let k = 0; k < 3; k++) {
              min[k] = Math.min(min[k], w[k]);
              max[k] = Math.max(max[k], w[k]);
            }
          }
        } else if (pos) report.warnings.push('a POSITION accessor has no min/max: bounds are incomplete');
      }
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? (gltf.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENTITY);
  report.meshes = meshesSeen.size;
  if (report.triangles === 0) fail('no triangles in the scene');
  if (Number.isFinite(min[0])) report.bounds = { min: min.map(round), max: max.map(round), size: max.map((v, k) => round(v - min[k])) };

  const found = slotFor(file);
  if (found) {
    const [id, def] = found;
    const category = def.category ?? 'other';
    const budget = TRIANGLE_BUDGET[category] ?? TRIANGLE_BUDGET.other;
    const height = report.bounds ? report.bounds.size[1] : 0;
    const scale = height > 1e-6 && def.fitHeight ? def.fitHeight / height : 1;
    report.slot = {
      id,
      category,
      fitHeight: def.fitHeight ?? 0,
      scale: round(scale),
      footprint: report.bounds ? [round(report.bounds.size[0] * scale), round(report.bounds.size[2] * scale)] : [0, 0],
      budget,
    };
    if (report.triangles > budget * 2) fail(`${report.triangles} triangles: more than twice the ${category} budget (${budget})`);
    else if (report.triangles > budget) report.warnings.push(`${report.triangles} triangles: over the ${category} budget (${budget})`);
    if (height <= 1e-6) report.warnings.push('the model is flat: it cannot be fitted to a height');
    // A footprint far wider than tall usually means the model is lying on its side.
    if (report.bounds && def.fitHeight && Math.max(report.slot.footprint[0], report.slot.footprint[1]) > def.fitHeight * 8)
      report.warnings.push('very wide for its height after fitting: is it lying down (Z-up export)?');
  } else {
    if (report.triangles > TRIANGLE_BUDGET.other) report.warnings.push(`${report.triangles} triangles: heavy for a prop`);
  }
  return report;
}

/** The manifest slot whose licensed file name matches this path (case-insensitive). */
export function findSlot(file: string): [PropId, PropDef] | null {
  const norm = file.replace(/\\/g, '/').toLowerCase();
  for (const [id, def] of Object.entries(PROPS) as Array<[PropId, PropDef]>) {
    for (const f of def.licensed ?? []) if (norm.endsWith(f.toLowerCase())) return [id, def];
  }
  return null;
}

function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4×4, as glTF stores it. */
function localMatrix(n: NonNullable<Gltf['nodes']>[number]): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function transform(m: number[], p: number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

function corners(a: number[], b: number[]): number[][] {
  const out: number[][] = [];
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) out.push([x, y, z]);
  return out;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function listGlbs(path: string): string[] {
  const s = statSync(path);
  if (s.isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const p = join(path, name);
    if (statSync(p).isDirectory()) return listGlbs(p);
    return /\.glb$/i.test(name) ? [p] : [];
  });
}

function print(r: GlbReport): void {
  const kb = (r.bytes / 1024).toFixed(0);
  console.log(`\n${r.ok ? 'OK  ' : 'FAIL'} ${r.file}  (${kb} KB)`);
  console.log(`     ${r.triangles} triangles in ${r.drawables} draw(s), ${r.meshes} mesh(es), ${r.materials.length} material(s)${r.materials.length ? `: ${r.materials.slice(0, 8).join(', ')}${r.materials.length > 8 ? ', …' : ''}` : ''}`);
  if (r.textures.length) console.log(`     textures: ${r.textures.map((t) => `${t.name} ${t.width ?? '?'}×${t.height ?? '?'} ${t.mime}`).join('; ')}`);
  if (r.bounds) console.log(`     size ${r.bounds.size.join(' × ')} (x × y × z, model units)`);
  if (r.slot) console.log(`     slot ${r.slot.id} (${r.slot.category}): fitted to ${r.slot.fitHeight} high, scale ${r.slot.scale}, footprint ${r.slot.footprint.join(' × ')}, budget ${r.slot.budget} triangles`);
  else console.log('     not one of the manifest\'s licensed files (see assets/licensed/README.md for the names)');
  for (const e of r.errors) console.log(`     error: ${e}`);
  for (const w of r.warnings) console.log(`     warning: ${w}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.log('Usage: npm run validate-glb -- <file.glb | folder> … [--json]');
    process.exit(2);
  }
  const reports = paths.flatMap(listGlbs).map((f) => inspectGlb(relative(ROOT, resolve(f)), readFileSync(f)));
  if (json) {
    mkdirSync(join(ROOT, 'tools/out'), { recursive: true });
    writeFileSync(join(ROOT, 'tools/out/validate-glb.json'), JSON.stringify(reports, null, 1) + '\n');
    console.log(JSON.stringify(reports, null, 1));
  } else {
    for (const r of reports) print(r);
    console.log(`\n${reports.length} file(s), ${reports.filter((r) => !r.ok).length} with errors, ${reports.reduce((n, r) => n + r.warnings.length, 0)} warning(s)`);
  }
  process.exit(reports.some((r) => !r.ok) ? 1 : 0);
}

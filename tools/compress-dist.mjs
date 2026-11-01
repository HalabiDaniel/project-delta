/**
 * Pre-compresses the production build (v0.0.11 section 6C): writes `.gz` and `.br` next to every
 * compressible file in dist/ (models, scripts, styles, JSON, HTML), so a static host or reverse
 * proxy that serves pre-compressed files (nginx `gzip_static` / `brotli_static`, Caddy
 * `precompressed`, Netlify, Cloudflare Pages, Vercel do it automatically) sends the small ones.
 * The building models shrink to about a seventh, the classroom to about a sixth.
 *
 *   npm run compress            (after npm run build; part of npm run build:deploy)
 *
 * Prints a table of raw and compressed sizes. Files that don't shrink by at least 10% are skipped.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.argv[2] ?? join(ROOT, 'dist'));
const TYPES = new Set(['.glb', '.gltf', '.bin', '.js', '.mjs', '.css', '.json', '.html', '.svg', '.wasm', '.txt']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let raw = 0;
let gz = 0;
let br = 0;
const rows = [];
for (const file of walk(DIST)) {
  if (!TYPES.has(extname(file).toLowerCase())) continue;
  const data = readFileSync(file);
  const g = gzipSync(data, { level: 9 });
  if (g.length > data.length * 0.9) continue;
  const b = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  writeFileSync(`${file}.gz`, g);
  writeFileSync(`${file}.br`, b);
  raw += data.length;
  gz += g.length;
  br += b.length;
  rows.push([relative(DIST, file), data.length, g.length, b.length]);
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(9);
rows.sort((a, b) => b[1] - a[1]);
for (const [f, r, g, b] of rows.slice(0, 15)) console.log(`${kb(r)} ${kb(g)} gz ${kb(b)} br  ${f}`);
if (rows.length > 15) console.log(`… and ${rows.length - 15} more`);
console.log(`${rows.length} files: ${kb(raw)} raw → ${kb(gz)} gzip, ${kb(br)} brotli`);

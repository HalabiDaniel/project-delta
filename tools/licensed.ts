/**
 * Licensed models (Synty and others) for builds and deployment (v0.0.11 section 1C).
 *
 * Purchased models never enter the public repository: assets/licensed/ is git-ignored. A build
 * still has to include them, so this script brings them in from a private place before
 * `vite build` runs (vite only bundles what is in assets/licensed/ at build time):
 *
 *   npm run licensed:check    which files the manifest wants, which are present, which are missing
 *   npm run licensed:fetch    copy or download them into assets/licensed/
 *
 * Where from (the first one set wins):
 *
 *   PAPERWARS_LICENSED_DIR=/path/to/private/folder
 *       a folder on the build machine laid out like assets/licensed/ (synty/globe.glb, …), e.g. a
 *       clone of a private repository or a mounted drive.
 *   PAPERWARS_LICENSED_URL=https://…/licensed.tar.gz   (+ optional PAPERWARS_LICENSED_TOKEN)
 *       a .tar.gz (or .tgz) of that folder in private storage: a signed bucket URL, or a private
 *       release asset fetched with a token (sent as `Authorization: Bearer …`).
 *
 * With neither set, fetch does nothing and the build uses the placeholders (and says so). It
 * never deletes files already in assets/licensed/, and it validates every model it brought in
 * (tools/validate-glb.ts).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { expectedLicensedFiles } from '../src/assets/manifest';
import { inspectGlb } from './validate-glb';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'assets/licensed');

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** Which of the manifest's licensed files are present in assets/licensed/ (case-insensitive). */
export function licensedStatus(present: readonly string[]): Array<{ prop: string; file: string; present: boolean }> {
  const have = new Set(present.map((f) => f.replace(/\\/g, '/').toLowerCase()));
  return expectedLicensedFiles().map(({ prop, files }) => {
    const found = files.find((f) => have.has(f.toLowerCase()));
    return { prop, file: found ?? files[0], present: !!found };
  });
}

function check(): number {
  const present = filesUnder(TARGET).map((f) => relative(TARGET, f).replace(/\\/g, '/')).filter((f) => f !== 'README.md');
  const status = licensedStatus(present);
  const have = status.filter((s) => s.present);
  console.log(`Licensed models: ${have.length} of ${status.length} slots supplied.`);
  for (const s of status) console.log(`  ${s.present ? '✓' : '·'} ${s.prop.padEnd(20)} ${s.file}`);
  if (have.length < status.length) console.log('Slots marked · use their built-in placeholders.');
  return have.length;
}

async function fetchLicensed(): Promise<void> {
  const dir = process.env.PAPERWARS_LICENSED_DIR;
  const url = process.env.PAPERWARS_LICENSED_URL;
  mkdirSync(TARGET, { recursive: true });
  if (dir) {
    const from = resolve(dir);
    if (!existsSync(from)) throw new Error(`PAPERWARS_LICENSED_DIR does not exist: ${from}`);
    console.log(`Copying licensed models from ${from}`);
    cpSync(from, TARGET, { recursive: true, force: true, filter: (src) => !/(^|[\\/])\.git([\\/]|$)/.test(src) });
  } else if (url) {
    console.log(`Downloading licensed models from ${new URL(url).host}`);
    const headers: Record<string, string> = {};
    if (process.env.PAPERWARS_LICENSED_TOKEN) headers.Authorization = `Bearer ${process.env.PAPERWARS_LICENSED_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const tmp = join(tmpdir(), `paperwars-licensed-${process.pid}`);
    mkdirSync(tmp, { recursive: true });
    const archive = join(tmp, 'licensed.tar.gz');
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['-xzf', archive, '-C', TARGET], { stdio: 'inherit' });
    rmSync(tmp, { recursive: true, force: true });
  } else {
    console.log('No PAPERWARS_LICENSED_DIR or PAPERWARS_LICENSED_URL set: building with the placeholders.');
  }
  // Every model brought in must be readable by the game.
  let bad = 0;
  for (const f of filesUnder(TARGET).filter((p) => /\.glb$/i.test(p))) {
    const r = inspectGlb(relative(ROOT, f), readFileSync(f));
    if (!r.ok) {
      bad++;
      console.error(`  ${r.file}: ${r.errors.join('; ')}`);
    }
  }
  check();
  if (bad > 0) throw new Error(`${bad} licensed model(s) the game can't read (see above): npm run validate-glb -- assets/licensed`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv[2] ?? 'check';
  if (command === 'fetch') {
    fetchLicensed().catch((e) => {
      console.error(`licensed:fetch: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
  } else if (command === 'check') {
    check();
  } else {
    console.log('Usage: tsx tools/licensed.ts check | fetch');
    process.exit(2);
  }
}

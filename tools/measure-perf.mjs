/**
 * Measures the game in headless Chromium: load time, draw calls, triangles and frame times in a
 * few views, per graphics preset. Software rendering (SwiftShader) makes the frame times
 * meaningless as absolute numbers, but draw calls, triangles and load counts are exact.
 *
 *   npm run measure                 (dev server on a free port, all presets)
 *   npm run measure -- http://localhost:5173/   (an already-running server or a deployed build)
 *
 * Writes a table to stdout and JSON to tools/out/perf.json.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let url = process.argv[2];
let server = null;
if (!url) {
  const port = 5199;
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('vite did not start')), 60000);
    server.on('exit', (code) => fail(new Error(`vite exited (${code})`)));
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.stdout.on('data', (d) => {
      if (/Local|ready in/.test(String(d))) {
        clearTimeout(t);
        ok();
      }
    });
  });
  url = `http://localhost:${port}/`;
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const results = [];
try {
  for (const preset of ['low', 'medium', 'high']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.warn('  [page error]', e.message));
    await page.addInitScript((p) => {
      localStorage.setItem('paperwars.graphics.v2', JSON.stringify({ preset: p }));
    }, preset);
    console.log(`${preset}: loading…`);
    const started = Date.now();
    await page.goto(`${url}?perf`);
    await page.waitForFunction(() => !!window.paperwars, null, { timeout: 180000 });
    const loadMs = Date.now() - started;
    const views = {};
    const sample = async (name) => {
      await page.waitForTimeout(2500);
      views[name] = await page.evaluate(() => {
        const s = window.paperwars.perf();
        const budget = window.paperwars.budget?.() ?? null;
        return { drawCalls: s.drawCalls, triangles: s.triangles, frameMs: +s.frameMs.toFixed(1), budget };
      });
    };
    await sample('desk');
    // Base management: the camera above T1.
    await page.evaluate(() => window.paperwars.toggleBase(true));
    await sample('base');
    await page.evaluate(() => window.paperwars.toggleBase(false));
    const assets = await page.evaluate(() => window.paperwars.assets.report?.() ?? null);
    results.push({ preset, loadMs, views, assets });
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

for (const r of results) {
  console.log(`${r.preset.padEnd(7)} load ${(r.loadMs / 1000).toFixed(1)} s`);
  for (const [name, v] of Object.entries(r.views)) console.log(`  ${name.padEnd(6)} ${String(v.drawCalls).padStart(5)} draws  ${(v.triangles / 1000).toFixed(0).padStart(5)}k tris  ${v.frameMs} ms${v.budget ? `  budget ${v.budget.ok ? 'ok' : 'OVER: ' + v.budget.over.join(', ')}` : ''}`);
}
mkdirSync(join(ROOT, 'tools/out'), { recursive: true });
writeFileSync(join(ROOT, 'tools/out/perf.json'), JSON.stringify(results, null, 1) + '\n');

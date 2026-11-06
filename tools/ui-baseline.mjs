/**
 * Screenshots of every single-player screen in headless Chromium, for the v0.0.15 UI revamp:
 * the phase 1 baseline (before) and, re-run later, the comparison (after).
 *
 *   npm run ui:shots                      (dev server on a free port, all views and sizes)
 *   npm run ui:shots -- --out docs/checkpoints/0.0.15-ui-baseline
 *   npm run ui:shots -- --url http://localhost:5173/ --only screens,4k-m,1080p-s
 *
 * `--only` takes a list: `screens` (every screen at 1080p) and `<size>-<hud size>` entries.
 *
 * Every screen at the 1080p reference size and HUD size M; the desk and flight at every target
 * resolution of plan §7 and at HUD sizes S and L. Software rendering (SwiftShader), so it is slow
 * (a few minutes) but the layout is exact.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, flag('out', 'tools/out/ui-shots'));
const ONLY = flag('only', null)?.split(',') ?? null;
const wanted = (key) => !ONLY || ONLY.includes(key);
const failed = [];
let url = flag('url', null);

const SIZES = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '16x10': [1920, 1200],
  '21x9': [2560, 1080],
  '21x9-1440': [3440, 1440],
};

let server = null;
if (!url) {
  const port = 5198;
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('vite did not start')), 60000);
    server.on('exit', (code) => fail(new Error(`vite exited (${code})`)));
    server.stdout.on('data', (d) => {
      if (/Local|ready in/.test(String(d))) {
        clearTimeout(t);
        ok();
      }
    });
  });
  url = `http://localhost:${port}/`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const shots = [];

/** A fresh page at one size, a new career on the Medium preset, the game loaded and settled. */
async function open(size, uiScale = 1) {
  const [width, height] = SIZES[size];
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.warn('  [page error]', e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('paperwars.graphics.v2', JSON.stringify({ preset: 'medium' }));
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.paperwars, null, { timeout: 240000 });
  await page.evaluate((s) => window.paperwars.setUiScale(s), uiScale);
  await page.waitForTimeout(2500);
  return page;
}

async function shot(page, name) {
  await page.waitForTimeout(900);
  const file = join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85, timeout: 240000 });
  shots.push(name);
  console.log(`  ${name}`);
}

const game = (page, fn, arg) => page.evaluate(fn, arg);

/** Fold the selected plane and launch it; a few seconds in the air. */
async function fly(page) {
  await game(page, () => {
    window.paperwars.dismissWelcome();
    window.paperwars.build();
  });
  await page.waitForFunction(() => window.paperwars.state.phase === 'ready', null, { timeout: 300000 });
  await game(page, () => window.paperwars.launch());
  await page.waitForTimeout(3500);
}

try {
  // Every screen at the reference size.
  if (wanted('screens')) {
    console.log('1080p, HUD M: every screen');
    const page = await open('1080p');
    await shot(page, '1080p-01-desk-welcome');
    await game(page, () => window.paperwars.dismissWelcome());
    await shot(page, '1080p-02-desk-garage-missions');
    await game(page, () => window.paperwars.cycleAircraft(1));
    await shot(page, '1080p-03-garage-next-plane');
    await game(page, () => window.paperwars.cycleAircraft(-1));
    await game(page, () => window.paperwars.toggleLogbook(true));
    await shot(page, '1080p-04-logbook');
    await game(page, () => window.paperwars.toggleLogbook(false));
    await game(page, () => window.paperwars.toggleBase(true));
    await page.waitForTimeout(1500);
    await shot(page, '1080p-05-base-management');
    await game(page, () => window.paperwars.toggleBase(false));
    await page.waitForTimeout(800);
    await game(page, () => window.paperwars.pause());
    await shot(page, '1080p-06-pause-menu');
    await game(page, () => window.paperwars.resume());
    await game(page, () => window.paperwars.build());
    await page.waitForTimeout(600);
    await shot(page, '1080p-07-folding');
    await page.waitForFunction(() => window.paperwars.state.phase === 'ready', null, { timeout: 300000 });
    await shot(page, '1080p-08-ready');
    await game(page, () => window.paperwars.launch());
    await page.waitForTimeout(3500);
    await shot(page, '1080p-09-flight-hud');
    await game(page, () => window.paperwars.pause());
    await shot(page, '1080p-10-pause-in-flight');
    await game(page, () => window.paperwars.resume());
    await game(page, () => window.paperwars.state.crash('impact'));
    await page.waitForTimeout(6000);
    await shot(page, '1080p-11-crash-report');
    await game(page, () => window.paperwars.continueToDesk());
    await page.waitForTimeout(1500);
    await shot(page, '1080p-12-desk-after-sortie');
    await game(page, () => window.paperwars.dev?.toggle(true));
    await shot(page, '1080p-13-dev-panel');
    await page.close();
  }

  // The desk and flight at every target resolution (HUD M), and HUD S / L at 1080p.
  const matrix = [
    ...Object.keys(SIZES).filter((s) => s !== '1080p').map((s) => [s, 1, 'm']),
    ['1080p', 0.9, 's'],
    ['1080p', 1.15, 'l'],
  ];
  for (const [size, scale, label] of matrix) {
    if (!wanted(`${size}-${label}`)) continue;
    console.log(`${size}, HUD ${label.toUpperCase()}`);
    // One size failing (a slow fold under software rendering) doesn't stop the others.
    const page = await open(size, scale);
    try {
      await game(page, () => window.paperwars.dismissWelcome());
      await shot(page, `${size}-hud-${label}-desk`);
      await fly(page);
      await shot(page, `${size}-hud-${label}-flight`);
    } catch (e) {
      console.warn(`  FAILED ${size}-${label}: ${e.message.split('\n')[0]}`);
      failed.push(`${size}-${label}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server?.kill();
}
console.log(`${shots.length} screenshots in ${OUT}`);
if (failed.length) {
  console.log(`failed: ${failed.join(',')} (re-run with --only ${failed.join(',')})`);
  process.exitCode = 1;
}

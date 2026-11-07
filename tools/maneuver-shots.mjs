/**
 * v0.0.16: screenshots of the maneuvers in the real game (headless Chromium, software rendering):
 * the maneuver picker at the pad, then a flight that presses the Maneuver key (Left Alt) and
 * captures frames through the move, a refusal, and a manual loop.
 *
 *   node tools/maneuver-shots.mjs [--out docs/checkpoints/0.0.16-maneuvers] [--url http://localhost:5173/]
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
const OUT = resolve(ROOT, flag('out', 'tools/out/maneuver-shots'));
let url = flag('url', null);
let server = null;
if (!url) {
  const port = 5199;
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('paperwars.graphics.v2', JSON.stringify({ preset: 'low' }));
});
await page.goto(url);
await page.waitForFunction(() => !!window.paperwars?.state, null, { timeout: 240000 });
await page.waitForTimeout(2000);
const game = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 85, timeout: 240000 });
  console.log(`  ${name}`);
};
const info = () => game(() => {
  const m = window.paperwars.plane.motion;
  return { u: +m.maneuverProgress.toFixed(2), phase: window.paperwars.state.phase, mode: m.mode, active: m.activeManeuver, slot: m.maneuverSlot, refusal: m.lastRefusal, pitch: +m.pitch.toFixed(2), roll: +m.roll.toFixed(2), yaw: +m.yaw.toFixed(2), speed: +m.speed.toFixed(1), y: +m.position.y.toFixed(1) };
});

try {
  await game(() => window.paperwars.dismissWelcome());
  // The Falcon, on a card it can fly.
  await game(() => {
    const g = window.paperwars;
    g.selectAircraft('falcon');
    const i = g.state.offers.findIndex((m) => g.state.suitability('falcon', m).level !== 'unsuitable');
    g.select(Math.max(0, i));
  });
  await page.waitForTimeout(800);
  // T changes the maneuver in the slot at home.
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(400);
  console.log('slot after T:', await game(() => window.paperwars.state.maneuverSlot));
  await game(() => window.paperwars.state.chooseManeuver('craneFlip'));
  await page.waitForTimeout(600);
  await shot('01-desk-maneuver-picker');
  await game(() => window.paperwars.build());
  await page.waitForFunction(() => window.paperwars.state.phase === 'ready', null, { timeout: 300000 });
  await page.waitForTimeout(600);
  await shot('02-pad-maneuver-picker');
  await game(() => window.paperwars.launch());
  await page.waitForTimeout(4000);
  // Speed up, then the Crane Flip while boosting (it needs speed).
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  console.log('before:', await info());
  await shot('03-flight-slot-ready');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('AltLeft');
  await page.keyboard.up('ShiftLeft');
  // Freeze the game at points through the move (game time, not the slow software renderer's).
  let n = 0;
  for (const at of [0.12, 0.3, 0.45, 0.6, 0.75, 0.92]) {
    await game(() => (window.paperwars.timeScale = 0.15));
    await page.waitForFunction((u) => { const m = window.paperwars.plane.motion; return !m.activeManeuver || m.maneuverProgress >= u; }, at, { timeout: 240000 });
    await game(() => (window.paperwars.timeScale = 0));
    const i = await info();
    console.log(`at ${at}:`, i);
    if (!i.active) break;
    await shot(`04-crane-flip-${++n}`);
  }
  await game(() => (window.paperwars.timeScale = 1));
  await page.waitForTimeout(400);
  // Straight away again: not ready yet.
  await page.keyboard.press('AltLeft');
  await page.waitForTimeout(150);
  console.log('refused:', await info());
  await shot('05-refused-not-ready');
  // The air brake.
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(3500);
  console.log('air brake:', await info());
  await shot('06-air-brake');
  await page.keyboard.up('KeyS');
  // T in the air: locked.
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(300);
  await shot('07-locked-in-the-air');
  console.log('page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
  // npx starts vite as a child: stop the whole group.
  if (server) process.kill(-server.pid, 'SIGTERM');
  process.exit(0);
}

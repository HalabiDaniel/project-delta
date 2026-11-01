/**
 * Exports the game's own models from the three asset labs (tools/labs/) to GLB files under
 * assets/models/custom/, plus a catalog (assets/models/custom/catalog.json) the game reads for the
 * things a GLB can't carry: joints, smoke points, beacon timings, flight-effect anchors.
 *
 *   npm run export-models            (everything)
 *   npm run export-models aircraft   (one lab: aircraft | buildings | classroom)
 *
 * The labs are the source of truth for the designs. Each one is opened in headless Chromium
 * (three.js served from node_modules, so no network is needed), its builders are called with the
 * looks the game uses, and the result goes through the lab's own GLB export (pencil strokes,
 * sockets markers and viewer-only effects stripped, joints at rest, lights off):
 *
 *   aircraft  – Aircraft Lab, every plane in the Paper skin, one file per plane.
 *   buildings – Model Lab, cardboard, every level (1–3) × damage state (0 none, 1 minor,
 *               2 medium, 3 critical) of each building in one file, as children named L<l>_D<d>.
 *   classroom – Environment Lab, Plain design with Painted (real) colours: desk, chair, teacher's
 *               desk, walls, blackboard, backpacks and the classroom layout.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright comes from the environment (or `npm i -D playwright`); it isn't a project dependency.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABS = join(ROOT, 'tools/labs');
const OUT = join(ROOT, 'assets/models/custom');
const THREE_DIR = join(ROOT, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';

const only = process.argv[2];

/** Lab HTML with three.js redirected to the local copy and a hook exposing the module's internals. */
function prepare(file, expose) {
  let html = readFileSync(file, 'utf8');
  html = html.replace(/<link[^>]*fonts\.g[^>]*>/g, '');
  const end = html.lastIndexOf('</script>');
  return html.slice(0, end) + `\n;window.__LAB = { ${expose} };\n` + html.slice(end);
}

async function openLab(browser, file, expose, assets = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.warn('  [lab error]', e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(CDN)) {
      const path = join(THREE_DIR, url.slice(CDN.length));
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path) });
    }
    if (url === 'http://lab.local/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: prepare(file, expose) });
    const name = url.replace('http://lab.local/', '');
    if (assets[name]) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(assets[name]) });
    return route.abort();
  });
  await page.goto('http://lab.local/index.html');
  await page.waitForFunction(() => !!window.__LAB, null, { timeout: 60000 });
  // Shared page helpers: GLB export of a group of variants, and the data the game needs.
  await page.evaluate(() => {
    const L = window.__LAB;
    const T = L.THREE;
    window.__collect = (obj) => {
      obj.updateMatrixWorld(true);
      const joints = [], smoke = [], damageSmoke = [], sockets = [], inkLevels = [], points = {};
      const box = new T.Box3(), tmp = new T.Box3();
      let tris = 0;
      obj.traverse((o) => {
        if (o.userData.helper) return;
        if (o.isMesh) {
          let hidden = false;
          for (let p = o; p; p = p.parent) if (p.userData.helper || !p.visible) hidden = true;
          if (hidden) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          box.union(tmp);
          tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        }
        if (o.userData.joint) joints.push({ node: o.name, ...o.userData.joint });
        if (o.name.startsWith('smoke_point')) smoke.push(o.name);
        if (o.name.startsWith('damage_smoke')) damageSmoke.push(o.name);
        if (o.name.startsWith('socket_')) sockets.push(o.name);
        if (o.userData.joint?.label === 'Ink') inkLevels.push(o.name);
        if (/_point$/.test(o.name)) points[o.name] = o.getWorldPosition(new T.Vector3()).toArray().map((v) => +v.toFixed(3));
      });
      const ud = obj.userData;
      return {
        tris: Math.round(tris),
        min: box.min.toArray().map((v) => +v.toFixed(3)),
        max: box.max.toArray().map((v) => +v.toFixed(3)),
        joints, smoke, damageSmoke, sockets, inkLevels, points,
        glass: ud.glass?.name ?? null,
        interior: ud.interior?.name ?? null,
        beacons: (ud.beacons || []).map((b) => ({ material: b.mat.name, period: b.period, phase: b.phase, width: b.width ?? 0.12, peak: b.peak ?? 3, idle: b.idle ?? 0.15, prop: b.prop ?? 'beacons' })),
      };
    };
    // Every texture goes into the GLB as JPEG: the procedural paper and card noise is ~5× smaller.
    window.__jpeg = (obj) => obj.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) for (const k of ['map', 'alphaMap', 'emissiveMap']) if (m[k]) m[k].userData.mimeType = 'image/jpeg';
    });
    // Fewer, bigger meshes: identical materials become one, and every rigid group of meshes
    // (everything between two nodes the game animates or looks up) is merged per material.
    const matCache = new Map();
    const matKey = (m) => JSON.stringify([m.type, m.name, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.map?.uuid, m.alphaMap?.uuid,
      m.roughness, m.metalness, m.side, m.transparent, m.opacity, m.flatShading, m.vertexColors, m.depthWrite, m.polygonOffset && m.polygonOffsetFactor]);
    const KEEP = /^(socket_|smoke_point|damage_smoke|Door|Rocket|Bag_Flap)|_point$|_Pitch$|_Recoil$|_Spin$|_Flight$/;
    const keep = (o) => !o.parent || o.userData.joint || o.userData.doorPivot || o.userData.leakStream || KEEP.test(o.name) || o.userData.keep;
    window.__merge = async (root) => {
      const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const k = matKey(o.material);
        if (!matCache.has(k)) matCache.set(k, o.material);
        o.material = matCache.get(k);
      });
      const groups = new Map();   // keep-node → material → meshes
      root.traverse((o) => {
        if (!o.isMesh || o.userData.helper || !o.visible || Array.isArray(o.material)) return;
        let hidden = false, k = o.parent;
        for (let p = o.parent; p; p = p.parent) if (!p.visible || p.userData.helper) hidden = true;
        if (hidden || keep(o)) return;
        while (!keep(k)) k = k.parent;
        if (!groups.has(k)) groups.set(k, new Map());
        const g = groups.get(k);
        if (!g.has(o.material)) g.set(o.material, []);
        g.get(o.material).push(o);
      });
      // Anything hanging off a mesh about to be merged (scorch marks, smoke points) moves up first.
      for (const byMat of groups.values()) for (const meshes of byMat.values()) {
        if (meshes.length < 2) continue;
        for (const o of meshes) for (const c of [...o.children]) o.parent.attach(c);
      }
      root.updateMatrixWorld(true);
      const inv = new T.Matrix4(), m = new T.Matrix4();
      for (const [k, byMat] of groups) {
        inv.copy(k.matrixWorld).invert();
        for (const [mat, meshes] of byMat) {
          if (meshes.length < 2) continue;
          const geos = meshes.map((o) => {
            let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
            for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
            if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
            if (!g.attributes.normal) g.computeVertexNormals();
            g.morphAttributes = {};
            g.clearGroups();
            return g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
          });
          const merged = mergeGeometries(geos, false);
          if (!merged) continue;
          const mesh = new T.Mesh(merged, mat);
          mesh.name = `${k.name || 'Part'}_${mat.name || 'Mat'}`;
          k.add(mesh);
          for (const o of meshes) o.parent.remove(o);
        }
      }
      // Empty groups left behind are dropped.
      const empty = [];
      root.traverse((o) => { if (!o.isMesh && !keep(o) && o.children.length === 0 && o.type === 'Group') empty.push(o); });
      empty.forEach((o) => o.parent?.remove(o));
    };
    window.__export = async (variants, name) => {
      const group = new T.Group();
      group.name = name;
      for (const [vname, obj] of variants) {
        const holder = new T.Group();
        holder.name = vname;
        holder.add(obj);
        group.add(holder);
        holder.userData.keep = obj.userData.keep = true;
        await window.__merge(obj);
      }
      window.__jpeg(group);
      // Cloning copies userData through JSON: drop what only the viewer needs (nodes, materials, effects).
      group.traverse((o) => {
        for (const k of Object.keys(o.userData)) {
          const val = o.userData[k];
          let ok = typeof val !== 'function';
          if (ok && val && typeof val === 'object') { try { JSON.stringify(val); ok = !val.isMaterial && !val.isObject3D; } catch { ok = false; } }
          if (!ok) delete o.userData[k];
        }
      });
      const glb = await L.exportGLB(group);
      const bytes = new Uint8Array(glb);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
  });
  return page;
}

function save(rel, b64) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(path, buf);
  return buf.length;
}

async function exportAircraft(browser, catalog) {
  console.log('Aircraft Lab → assets/models/custom/aircraft/');
  // Record what each plane asks the viewer-only flight effects for: nozzles and wingtip trails.
  const expose = `THREE, MODELS, exportGLB, fxLog: (window.__fxLog = []), setFx: (f) => { buildFlightFx = f; }, origFx: buildFlightFx`;
  const page = await openLab(browser, join(LABS, 'aircraft-lab.html'), expose);
  await page.evaluate(() => {
    const L = window.__LAB;
    L.setFx((parent, opts) => {
      const host = (o) => (o && o.name) || null;
      const nozzles = (opts.nozzles || [{ x: 0, y: 0, z: opts.nozzleZ, r: opts.nozzleR }]).map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, z: n.z, r: n.r, host: host(n.parent) }));
      const trail = (p) => ({ at: [p[0], p[1], p[2]], host: host(p[3]) });
      window.__fxLog.push({ nozzles, tips: opts.tips.map(trail), streaks: (opts.streaks || []).map(trail) });
      return L.origFx(parent, opts);
    });
  });
  const ids = await page.evaluate(() => window.__LAB.MODELS.filter((m) => m.kind === 'plane').map((m) => m.id));
  for (const id of ids) {
    const info = await page.evaluate(async (id) => {
      const L = window.__LAB;
      const def = L.MODELS.find((m) => m.id === id);
      window.__fxLog.length = 0;
      const obj = def.build('paper');
      const fx = window.__fxLog[0] ?? null;
      const data = window.__collect(obj);
      const extra = {
        vtol: (obj.userData.vtol || []).map((n) => n.name),
        sweep: (obj.userData.sweep || []).map(([n, s]) => ({ node: n.name, sign: s })),
        burner: obj.userData.burner?.name ?? null,
      };
      const glb = await window.__export([['Model', obj]], id);
      return { glb, data: { ...data, ...extra, fx, name: def.name, kicker: def.kicker, specs: def.specs } };
    }, id);
    const size = save(`aircraft/${id}.glb`, info.glb);
    catalog.aircraft[id] = { file: `models/custom/aircraft/${id}.glb`, ...info.data };
    console.log(`  ${id.padEnd(10)} ${(size / 1024).toFixed(0).padStart(5)} KB  ${info.data.tris} tris`);
  }
  await page.close();
}

const BUILDINGS = {
  turret: 'turret-assembly',
  launcher: 'rocket-launcher',
  radar: 'radar',
  workshop: 'workshop',
  storage: 'storage',
  command: 'command-center',
  hangar: 'hangar',
  runway: 'runway',
  helipad: 'helipad',
  ink: 'ink-depot',
};

async function exportBuildings(browser, catalog) {
  console.log('Model Lab → assets/models/custom/buildings/');
  const page = await openLab(browser, join(LABS, 'model-lab.html'), 'THREE, MODELS, exportGLB');
  for (const [id, labId] of Object.entries(BUILDINGS)) {
    const info = await page.evaluate(async (labId) => {
      const L = window.__LAB;
      const def = L.MODELS.find((m) => m.id === labId);
      const levels = def.variants?.length ? def.variants.map((v) => v.id) : [1];
      const variants = [], data = {};
      for (const lv of levels) for (const dmg of [0, 1, 2, 3]) {
        const obj = def.build(lv, dmg);
        const key = `L${lv}_D${dmg}`;
        data[key] = window.__collect(obj);
        variants.push([key, obj]);
      }
      const glb = await window.__export(variants, labId);
      return { glb, levels, variants: data, name: def.name, properties: Object.keys(def.properties || {}) };
    }, labId);
    const size = save(`buildings/${id}.glb`, info.glb);
    const { glb, ...rest } = info;
    catalog.buildings[id] = { file: `models/custom/buildings/${id}.glb`, lab: labId, ...rest };
    const tris = Object.values(info.variants).map((v) => v.tris);
    console.log(`  ${id.padEnd(10)} ${(size / 1024).toFixed(0).padStart(5)} KB  ${Math.min(...tris)}–${Math.max(...tris)} tris, ${Object.keys(info.variants).length} variants`);
  }
  await page.close();
}

async function exportClassroom(browser, catalog) {
  console.log('Environment Lab → assets/models/custom/classroom/');
  const expose = 'THREE, MODELS, exportGLB, classroomLayout, buildDesk, buildChair, buildTeacherDesk, buildBlackboard, buildWall, buildBag, placeBagOnChair, BAG_PLAN, DESK, CHAIR, WALL, CLASSROOM, BOARD, c, M, mergedMesh, bx, envMat';
  const page = await openLab(browser, join(LABS, 'environment-lab/index.html'), expose, { 'blackboard.jpg': join(LABS, 'environment-lab/blackboard.jpg') });
  // The blackboard image loads asynchronously; build one board and wait for its texture.
  await page.evaluate(() => new Promise((done) => {
    const b = window.__LAB.buildBlackboard({ design: 'plain', tex: 'painted' });
    const start = performance.now();
    const check = () => {
      let ok = false;
      b.traverse((o) => { if (o.material?.map?.image?.complete && o.material.map.image.naturalWidth) ok = true; });
      if (ok || performance.now() - start > 10000) done(); else setTimeout(check, 50);
    };
    check();
  }));
  const info = await page.evaluate(async () => {
    const L = window.__LAB;
    const T = L.THREE;
    const v = { design: 'plain', tex: 'painted', state: 'closed' };
    const hideSockets = (o) => { o.traverse((n) => { if (n.userData.socketMarker) n.visible = false; }); return o; };
    const layout = L.classroomLayout();
    // Static room: walls (with the board on the front wall) and the teacher's desk.
    const room = new T.Group();
    room.name = 'Room';
    const byId = {};
    for (const it of layout) {
      if (it.model.startsWith('wall')) {
        const w = L.buildWall(v, { len: it.length, door: it.door, windows: it.windows, name: it.id });
        w.position.fromArray(it.position); w.rotation.y = it.rotationY;
        room.add(hideSockets(w)); byId[it.id] = w;
      }
    }
    for (const it of layout) {
      if (it.model === 'blackboard' || it.model === 'teacherdesk') {
        const m = it.model === 'blackboard' ? L.buildBlackboard(v) : L.buildTeacherDesk(v);
        m.name = it.id; m.position.fromArray(it.position); m.rotation.y = it.rotationY;
        (it.parent ? byId[it.parent] : room).add(hideSockets(m));
      }
    }
    // The lino floor, as the level lays it.
    const [FW, FD] = L.CLASSROOM.floor;
    const floor = L.mergedMesh('Floor', [L.bx(FW, 2, FD, 0, -1, 0)], L.envMat('painted', 'floor'), 1 / (1.2 * L.M));
    const desk = hideSockets(L.buildDesk(v));
    const chair = hideSockets(L.buildChair(v));
    // Chairs with their backpacks, as the level places them (each chair at its own origin).
    const chairs = [];
    const chairItems = layout.filter((it) => it.model === 'chair');
    const bagItems = layout.filter((it) => it.model.startsWith('backpack'));
    const seats = new T.Group();
    seats.name = 'Seats';
    chairItems.forEach((it, i) => {
      const ch = hideSockets(L.buildChair(v));
      ch.name = it.id;
      const bag = bagItems.find((b) => b.chair === it.id);
      if (bag) ch.add(hideSockets(L.placeBagOnChair(ch, bag, v, i)));
      const holder = new T.Group();
      holder.name = it.id;
      holder.position.fromArray(it.position); holder.rotation.y = it.rotationY;
      holder.add(ch);
      seats.add(holder);
      chairs.push({ id: it.id, position: it.position, rotationY: it.rotationY });
    });
    const out = {};
    const parts = { room, floor, desk, chair, seats };
    for (const [k, obj] of Object.entries(parts)) out[k] = { data: window.__collect(obj), glb: await window.__export([['Model', obj]], k) };
    const desks = layout.filter((it) => it.model === 'desk').map((it) => ({ id: it.id, position: it.position, rotationY: it.rotationY }));
    const doorNodes = [];
    room.traverse((o) => { if (o.userData.doorPivot) doorNodes.push(o.name); });
    return {
      out,
      layout: {
        unitsPerCm: L.c(1), floor: L.CLASSROOM.floor, wallHeight: L.WALL.H, deskTop: L.DESK.H, desk: { w: L.DESK.W, d: L.DESK.D },
        desks, chairs, doors: doorNodes, cols: L.CLASSROOM.cols, rows: L.CLASSROOM.rows,
      },
    };
  });
  catalog.classroom = { layout: info.layout, parts: {} };
  for (const [k, { data, glb }] of Object.entries(info.out)) {
    const size = save(`classroom/${k}.glb`, glb);
    catalog.classroom.parts[k] = { file: `models/custom/classroom/${k}.glb`, ...data };
    console.log(`  ${k.padEnd(10)} ${(size / 1024).toFixed(0).padStart(5)} KB  ${data.tris} tris`);
  }
  await page.close();
}

const catalogPath = join(OUT, 'catalog.json');
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : {};
catalog.aircraft ??= {};
catalog.buildings ??= {};
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  if (!only || only === 'aircraft') await exportAircraft(browser, catalog);
  if (!only || only === 'buildings') await exportBuildings(browser, catalog);
  if (!only || only === 'classroom') await exportClassroom(browser, catalog);
} finally {
  await browser.close();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
console.log('Catalog → assets/models/custom/catalog.json');

# The game's own models

Original models made for paperwars.io in Blender (or any glTF exporter) go here and **are**
committed. Use them where building a shape in code (`src/world/props/`) would be unnecessarily
complicated; simple stationery, buildings and landmarks are built in code.

Give a prop its file with the `model` field of its entry in `src/assets/manifest.ts` (path
relative to this folder). A licensed file for the same prop takes precedence; if the file is
missing, the prop's code-built version is used.

Export as glTF binary (`.glb`), one prop per file, Y up, metres, low-poly flat-shaded, a few
simple materials. Colours come through as they are and are shaded like paper; outlines are added
by the game. See docs/ART_DIRECTION.md for the look to aim for.

## custom/: models from the asset labs (v0.0.11)

`custom/` holds the models designed in the three asset labs (`tools/labs/`): the Aircraft Lab
(planes), the Model Lab (buildings and defenses) and the Environment Lab (the classroom). The labs
are the source of truth; the GLBs are generated from them and committed:

```bash
npm run export-models            # everything
npm run export-models aircraft   # or buildings, or classroom
```

The script (`tools/export-models.mjs`) opens each lab in headless Chromium with three.js served
from `node_modules` (no network), calls the lab's builders with the looks the game uses and runs
the lab's own GLB export: pencil strokes, socket markers and viewer-only effects are stripped,
joints are at rest and lights off. Then it merges the meshes of every rigid group per material
(the nodes the game animates or looks up stay separate), stores textures as JPEG, and records in
`custom/catalog.json` what a GLB can't carry.

| Folder | What | Look | Variants |
|---|---|---|---|
| `aircraft/<id>.glb` | Swift, Lightning, Raptor, Falcon, Thug, Dart, Widewing, Jumper, Ghost, Specter, Lancer | Paper skin | one per file |
| `buildings/<id>.glb` | turret, launcher, radar, workshop, storage, command (paper store), ink (depot), hangar, runway, helipad | Cardboard | children `L<level>_D<damage>`: levels 1–3 × damage 0 none, 1 minor, 2 medium, 3 critical (helipad: one level) |
| `classroom/*.glb` | room (walls, windows, door, blackboard, teacher's desk), floor, desk, chair, seats (16 chairs with backpacks) | Painted (real colours), plain | — |

The catalog lists, per model (and per building variant): bounds and triangles, joints (node,
type, axis, limits: Swivel, `*_Pitch`, `Gun_Recoil`, doors, spinners, ink gauges), smoke points
(`smoke_point*` for chimneys, `damage_smoke_*` for damage), named points (`muzzle_point`,
`exhaust_point`, `beam_point`), the window and interior materials and the beacon timings; for
planes, the afterburner nozzles and wingtip anchors of the lab's flight effects. The game reads it
through `src/assets/CustomModels.ts`.

Conventions: Y up, +Z forward (the game turns models to face −Z), lab units = game metres for
planes and buildings; the classroom is placed at 4/3 scale (`src/world/Classroom.ts`).

## Loading, drawing and delivery (v0.0.11)

- **Loading.** `AssetLibrary.preload` fetches every file the game will place once, with a
  progress bar on the loading screen (`src/ui/LoadingScreen.ts`); copies share the loaded meshes
  and materials. A file that fails or times out leaves its model on the built-in stand-in, and the
  loading screen says how many did. `paperwars.assets.report()` lists every file's state.
- **Instancing.** Repeated meshes in the same material (the 16 desks, the AI installations'
  building variants on 15 desks, the practice targets' crates and stands) are drawn as one
  instanced draw per mesh and material (`src/render/Instancer.ts`), frustum-culled per copy;
  small parts beyond the preset's detail distance are dropped (`DETAIL_DISTANCE` in
  `src/render/GraphicsSettings.ts`). Per-building materials that animate (window light, beacons)
  stay individual.
- **Static batching.** The classroom and backdrop never move: every mesh used once is merged with
  the others of the same *kind* of material (texture, shine, glow), the colours baked into the
  vertices (`src/render/StaticMerge.ts`). That turns the room's ~130 draws into about 15.
- **Budgets.** Per graphics preset (`BUDGETS` in `src/render/GraphicsSettings.ts`): draw calls,
  triangles, pencil strokes, texture memory, load time. `?perf` shows the frame against its
  budget, `paperwars.budget()` and `paperwars.assets.report().budget` report it, and
  `npm run measure` (headless Chromium) prints draws and triangles per preset and view. `?nobatch`
  turns instancing and merging off for comparison.
- **Compression.** Geometry stays uncompressed in the GLBs (no Draco or meshopt decoder to ship);
  `npm run compress` writes gzip and brotli copies of every file in `dist/` instead, which takes
  the building models to about a seventh. Textures are small JPEGs; KTX2/Basis would need the
  Basis transcoder (about 500 KB) and isn't worth it at this texture budget: revisit if a licensed
  pack brings large textures (`npm run validate-glb` warns above 1,024 px).
- **Caching.** Built file names carry content hashes; production builds register
  `public/model-cache.js`, a service worker that keeps model files in the browser's cache between
  visits (one cache per game version).

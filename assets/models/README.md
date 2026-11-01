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

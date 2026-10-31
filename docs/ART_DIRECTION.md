# paperwars.io: art direction and visual system

From v0.0.8 paperwars.io looks like a **playable three-dimensional sketchbook**: low-poly models
under soft cartoon light, outlined in graphite, made of paper, cardboard and school supplies, in a
miniature classroom. This document is the reference for that look and for the code that makes it,
so future aircraft, buildings, territories and props can reuse it instead of replacing it.

> **Status: vertical slice, awaiting art-direction review.** Home Desk (T1) shows the complete look;
> the other eight territories keep their plain platforms until the direction is approved (plan
> phase 2). Outlines and shading already apply to every object in the game.

## Contents

1. [The look](#1-the-look)
2. [Where the code is](#2-where-the-code-is)
3. [Pencil outlines](#3-pencil-outlines)
4. [Paper shading and light](#4-paper-shading-and-light)
5. [The material library](#5-the-material-library)
6. [Graphics settings and performance](#6-graphics-settings-and-performance)
7. [Licensed assets (Synty)](#7-licensed-assets-synty)
8. [Making models](#8-making-models)
9. [Territory themes, landmarks and props](#9-territory-themes-landmarks-and-props)
10. [Reproducing the style](#10-reproducing-the-style)
11. [Known limitations](#11-known-limitations)

## 1. The look

- **Low-poly, flat-shaded geometry.** Every facet is a flat plane, like folded paper. Silhouettes
  are simple and a little exaggerated (giant pencils, chunky erasers) so they read at speed.
- **Pencil outlines.** Graphite lines (dark blue-grey, never pure black) along silhouettes, folds
  and paper edges. Aircraft and threats are drawn boldest, buildings and targets firmly, props
  lighter, background faintest; lines thin and fade with distance.
- **Soft cartoon light.** The sun lights surfaces in two or three flat tones with a soft edge;
  shadows are light and tinted by a cool sky / warm bounce ambient, never grey.
- **Paper everywhere.** A faint fibre grain on every lit surface; ruled notebook paper, graph
  paper, corrugated cardboard, masking tape, ink, pencil wood and rubber in the material library.
- **Classroom miniature.** Territories are desks and sheets of paper taped down; landmarks are
  oversized stationery; buildings are cardboard boxes and paper.
- **Readable first.** Ownership colours stay strong (blue player, red hostile, grey neutral,
  orange objective) and are paired with symbols (tape, flags, trim). Decoration never sits on the
  runway, the take-off path or construction slots, and anything tall enough to fly into has a
  simple, predictable collision shape.

| | |
|---|---|
| ![Home Desk from the launch card](checkpoints/0.0.8-visual-slice/01-desk.jpg) | ![Home Desk from above](checkpoints/0.0.8-visual-slice/03-base.jpg) |
| ![Pencil-cup landmark](checkpoints/0.0.8-visual-slice/05-landmark.jpg) | ![Cardboard paper store](checkpoints/0.0.8-visual-slice/06-store.jpg) |

## 2. Where the code is

```
src/render/                     Rendering only: no gameplay rules
  style.ts                      Art direction in numbers: outline tiers, shading, light, the material list
  outline/EdgeTopology.ts       Edge extraction (pure, tested): welding, adjacency, stroke vertices
  outline/strokeShader.ts       The stroke shader (GLSL)
  outline/OutlineRenderer.ts    Attaching strokes to entities, merging, dynamic meshes, settings
  shading/PaperShading.ts       The lighting model (engine shader-chunk overrides)
  shading/textures.ts           Procedural textures, painted on canvases at start-up
  materials/MaterialLibrary.ts  Library materials from style.ts
  lighting.ts                   Sun, shadows, haze
  GraphicsSettings.ts           Presets and the device-local settings store (pure, tested)
src/assets/
  manifest.ts                   Every prop: code build, licensed slot, own model, size, colliders (tested)
  AssetLibrary.ts               Loads licensed/own .glb files, adapts them to the look
assets/licensed/                Licensed models: git-ignored except its README
assets/models/                  The game's own Blender models (committed)
src/world/props/
  MeshBuilder.ts                Low-poly geometry in code, UVs in metres (pure, tested)
  Model.ts                      Geometry per library material → merged meshes → entities
  stationery.ts                 Pencils, eraser, ruler, books, sticky notes, tape, paper balls, flags
  buildings.ts                  Cardboard buildings (T1's paper store)
  landmarks.ts                  Landmarks and their colliders (pencil cup)
src/world/territories/
  themes.ts                     Territory themes and layouts as data (Home Desk) (tested)
  Dressing.ts                   Builds a dressed territory: surface, runway, landmark, props, colliders
```

Gameplay code never depends on any of it: the rules see the same platforms, positions and
collision shapes as before, plus the landmark's and tall props' shapes.

## 3. Pencil outlines

### How it works

The outlines are **geometry, not a full-screen filter**. For every mesh, `EdgeTopology` welds
corners that share a position (flat shading and UV seams split them), lists every edge with the
one or two triangles beside it, and turns each edge into a *stroke*: a quad whose four vertices
all sit on the edge. Each vertex carries both ends, both faces' normals and
`(side, end, kind, seed)`.

Every frame the stroke shader decides per edge whether it shows:

| Edge | Drawn when |
|---|---|
| Boundary (one face, e.g. the rim of a paper sheet) | always |
| Crease (fold sharper than the tier's crease angle) | its front face is towards the camera (sheets: always) |
| Smooth edge | on the silhouette: one face towards the camera, the other away |

Visible strokes are widened on screen to a few pixels, pulled a fraction of their distance
towards the camera so they win against their own faces, and clipped at the near plane. Hand-drawn
character comes from stable per-edge noise (the edge's `seed`): uneven width end to end, a little
sideways wobble, short runs past the corners, lighter ends and graphite grain along the line.
Because all of it is keyed to the edge, nothing crawls when the camera moves.

The renderer was chosen over the alternatives the plan asked to investigate:

- **Depth/normal edge detection** (a full-screen pass) needs a depth and normal pre-pass, can't
  tell an aircraft from scenery (no per-object strength), shimmers on thin geometry at a distance,
  and costs every pixel every frame whatever is on screen.
- **Inverted hulls** (a back-face copy pushed out along normals) break apart on flat-shaded
  low-poly meshes and can't outline single-sided paper sheets, which is what the aircraft are.
- **Edge strokes** (chosen) cost a little vertex work per edge, nothing per pixel beyond the lines
  themselves, never flicker, work on paper sheets, and give every object its own strength.

### Using it

```ts
import { outline, outlineDynamic } from '../render/outline/OutlineRenderer';

outline(entity, 'structure', { merge: true });            // a rigid model: one stroke mesh, one draw call
outline(turretBody, 'structure', { merge: true, exclude: [gunHouse] }); // moving parts outlined separately
outline(carriedBomb, 'hero');                             // per mesh: follows each part's visibility
const strokes = outlineDynamic(entity, 'hero', parts);    // meshes that change shape (folding planes)
strokes?.update(i, positions);                            // …after each change
```

Strokes follow the entity's transform, hide when it (or its render component) is disabled or its
material is see-through, and go away when it is destroyed. `merge` bakes a rigid group into one
mesh in the root's space: use it whenever parts never move or hide on their own. Strokes for
engine primitives (`box`, `cylinder`…) are built once and shared.

### Tiers and tuning

Tiers and their styles are in `OUTLINE.tiers` in `src/render/style.ts`:

| Tier | Used for | Width (px) | Opacity | Fades out |
|---|---|---|---|---|
| `hero` | Aircraft (player, AI, practice), rockets, carried bombs | 3.2 | 0.95 | 170–320 m |
| `structure` | Buildings, defenses, targets, landmarks, flags, platform edges | 2.7 | 0.9 | 150–300 m |
| `prop` | Decorations | 2.1 | 0.78 | 80–190 m |
| `background` | Trims and far scenery | 1.5 | 0.5 | 140–280 m |

Width is in CSS pixels (scaled for high-DPI screens) up close, thinning with distance down to
`minWidthScale`. `OUTLINE.color`, `depthBias`, `wobble` and `minLength` apply to all tiers.

## 4. Paper shading and light

`PaperShading` replaces three of the engine's shader chunks for every lit material (so older code
and imported models share the look without changes):

- `lightDiffuseLambertPS`: a soft cel ramp (`SHADING.rampLow` → `rampHigh` of N·L, with
  `lambertMix` of plain Lambert so big flat areas still show their tilt).
- `ambientPS`: sky and ground ambient by surface direction (`SHADING.skyAmbient`, `groundAmbient`).
- `diffusePS`: the standard albedo times a paper grain projected in world space
  (`SHADING.grainScale` repeats per metre, `grainStrength`). Materials opt out with the
  `PAPER_NO_GRAIN` define (ink, plastic, graphite).

`lighting.ts` sets one warm sun (`LIGHTING`), light PCF shadows (`shadowIntensity` keeps them
from going dark) and a pale haze; the engine's constant ambient is unused.

## 5. The material library

`MATERIALS` in `src/render/style.ts` lists every library material as `category/variant`:

| Category | Variants | Texture |
|---|---|---|
| Paper | white, notebook, graph, sticky, blue, red, green, yellow, pink | fibres; ruled lines; grid |
| Cardboard | side, edge (corrugation), dark (kraft) | flutes and specks |
| Tape | masking, blue (player), grey (runway) | fibres |
| Ink | blue, black, red | brush streaks, slight sheen, no grain |
| Pencil | graphite, marking (hatching), yellow, wood, metal | |
| Rubber | pink, blue | speckle |
| Wood | desk, ruler | grain |
| Plastic | clear, red, blue, green | smooth, glossier, no grain |

```ts
import { materials } from '../render/materials/MaterialLibrary';
materials().get('cardboard/side');                       // shared: don't modify
materials().create(MATERIALS['cardboard/side']);         // its own copy, e.g. to darken with damage
materials().tinted('paper/white', [0.9, 0.8, 0.7]);      // shared per colour
```

**Adding a material:** add an entry to `MATERIALS` (`color`, optional `texture`, `tiling` in
repeats per metre, `grain`, `gloss`, `doubleSided`). **Adding a texture:** add its id to
`TextureId` and a painter to `PAINTERS` in `shading/textures.ts`; painters draw a tileable
pattern on a canvas, near-white unless the pattern has its own colour, and every random choice
comes from the seeded generator so textures never change between visits.

Textures assume UVs in metres (what `MeshBuilder` produces). The engine's primitives have 0–1 UVs
per face, so keep them to untextured materials: the world-space paper grain still applies.

## 6. Graphics settings and performance

Pause menu → **Graphics** (preset), **Outlines** (off / low / medium / high) and **Lines**
(faint / normal / bold). Settings belong to the computer: they are stored apart from the save
(`paperwars.graphics` in local storage), survive a progress reset and never travel with a save.

| | Low | Medium | High (default) |
|---|---|---|---|
| Outline quality | low: no background strokes, shorter fade, straight lines, fewer creases | medium | high: longer fade, livelier strokes |
| Shadows | off | 1024 | 2048 |
| Decoration | detail 1 | detail 2 | all |
| Resolution | 1× | up to 1.5× | up to 2× |

Hidden props also lose their collision shapes, so nothing invisible can be flown into.

**Measuring:** add `?perf` to the address for a live readout (fps, mean and 95th-percentile frame
time, frames over 33 ms, draw calls, triangles, strokes, heap, load time), or call
`paperwars.perf()` in the console. See the README's checkpoint section for the numbers measured so
far.

**Keeping it cheap:** merge static decoration (`Model.add` into one model per territory, then
`outline(…, { merge: true })`); reuse library materials (one draw call per material per merged
model); keep strokes off see-through effects; give moving parts their own stroke groups only when
they really move or hide.

## 7. Licensed assets (Synty)

Licensed models give the environment geometry; they never define the look. The pipeline:

1. `src/assets/manifest.ts` lists every prop by logical id (`bookStack`, `globe`, …). A prop with a
   `licensed` list is a slot for a bought model; it always has an original `build` placeholder.
2. The developer exports the model as `.glb` into `assets/licensed/` under the listed name (see
   [assets/licensed/README.md](../assets/licensed/README.md)). That folder is git-ignored.
3. At start-up `AssetLibrary` finds the files present (`import.meta.glob`, so a missing file costs
   nothing), loads them, and **adapts** each instance: non-metallic matte surfaces under the paper
   shading (palette textures kept) or one library material throughout (`materials`), scaled to
   `fitHeight`, stood on its base and centred, and outlined in the prop's tier.
4. A file that fails to load falls back to its placeholder with a console warning;
   `paperwars.assets.report()` in the browser console lists what each prop is using.

Never download, extract, redistribute or commit purchased source assets. The production build
includes the files supplied locally (a compiled game may; check the licence).

## 8. Making models

### In code (preferred for simple shapes)

```ts
const m = new Model();
m.part('cardboard/side').box([3, 2, 2], { at: [0, 1, 0] });
m.part('pencil/yellow').cylinder(0.2, 3, { sides: 6, twist: 30 }, { at: [1.6, 0, 0] });
m.part('tape/masking').tube(1, 0.66, 0.7);
m.add(pencil(4.4), { at: [0, 0, 2], rot: [0, 30, -90] });  // reuse other models
const entity = m.toEntity(device, 'my-model');               // one child per material
outline(entity, 'prop', { merge: true });
```

`MeshBuilder` offers `face` (convex polygon), `box`, `cylinder` (prisms, frustums, cones, smooth
or faceted), `tube`, `wedge`, `extrude` (flat cut-outs) and `crumpled` (paper balls), all
flat-shaded with UVs in metres. Rotations are degrees, X then Y then Z.

### In Blender

For shapes too fiddly to build in code: model low-poly and flat-shaded, Y up, metres, a few simple
materials (colours carry over and are shaded like paper; outlines are added by the game), export
**glTF binary** into `assets/models/`, and point a prop's `model` field at it.

### Aircraft

Aircraft are folded paper and stay code-built so they can fold up on the launch card and crumple
with damage: add a shape to `PLANE_SHAPES` in `src/aircraft/PlaneShapes.ts` (triangles of the
left half, the accent strips, the centre keel). `FoldablePlane` folds, crumples and outlines it
(hero tier) automatically. Keep silhouettes different enough to tell the roles apart from behind.

## 9. Territory themes, landmarks and props

Territories are dressed from data in `src/world/territories/themes.ts`:

- **Theme** (`THEMES`): the slab (desk, cardboard…), the sheet on top and its inset. Themes are
  cosmetic only. The owner's colour is the tape border (blue for the player).
- **Layout** (`HOME_DESK`): the theme, the landmark and its place, and the props with their
  `(u, v)` position (u along the territory's facing, v to its right), yaw and `detail` level.

**Adding a theme:** add an id to `ThemeId` and an entry to `THEMES` (add library materials first if
needed), then a layout using it. **Adding a landmark:** add a builder to `LANDMARKS` in
`landmarks.ts` returning its model, flat decals, collision shapes (spheres and yaw-only boxes) and
height; keep it below the AI pilots' clearance (a test checks). **Adding a prop:** write a
builder (in `stationery.ts` or a new file), add a `PROPS` entry with its tier (and colliders if it
is taller than 2 m: a test checks), then place it in a layout. The layout tests check every prop
stays on the platform and clear of the runway corridor, the construction slots and the paper
store.

`Dressing` builds a territory from its layout: the surface (slab, sheet, tape, margin and binder
holes, and on T1 the taped runway and index-card launch pad) merged into a few meshes, the
landmark, and the props allowed at the current detail level merged per material, with one stroke
mesh per tier. Imported props are placed as entities. Its `colliders` are added to the world's
solids, so the player and AI planes hit them like any barrier.

## 10. Reproducing the style

For any new content:

1. Start from the silhouette: one strong, simple shape that reads from 100 m.
2. Use library materials only; add a library entry rather than a one-off colour.
3. Build flat-shaded geometry (code or Blender) with UVs in metres; no smooth normals except
   round things.
4. Outline it in the right tier; merge what doesn't move.
5. Keep gameplay readable: ownership colours plus a symbol, nothing on paths the player needs,
   simple colliders for anything tall.
6. Check it on Low (no shadows, fewer props, simpler strokes) as well as High.

## 11. Known limitations

- **Only Home Desk is themed.** The other territories, enemy installations and T1's turret,
  launcher, radar, workshop and storage keep their v0.0.7 models (now outlined and shaded); themes,
  names and landmarks for the rest come with world expansion.
- **No classroom backdrop yet:** the sky is still a flat colour (phase 2).
- **Draw calls** rose about 20% at the desk view, mostly strokes for the moving parts of
  installations (turret heads, barrels, rockets each need their own group). Phase 2 should batch
  static fills and consider one skinned stroke mesh per installation.
- **Antialiasing** is still always on; changing it needs a new graphics device, so it isn't a
  setting yet.
- **Measured in software rendering only** (headless Chromium, SwiftShader): GPU frame times on real
  hardware in Chrome, Edge and Firefox still need measuring with `?perf`.
- Effects (wreckage, puffs, ink splats) and mission markers other than bullseyes aren't outlined
  yet; that belongs with the effects pass (phase 5).

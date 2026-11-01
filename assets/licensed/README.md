# Licensed models (not in the repository)

Put **purchased or licensed** 3D models here (Synty POLYGON packs and the like). Everything in this
folder except this README is ignored by git: licensed source files must never be committed to the
public repository unless their licence explicitly allows it.

The game builds and runs without any of them. Each licensed slot has an original low-poly
placeholder built in code at the size the real model will be fitted to; when the file below
exists, the game uses it instead, adapted to the art direction (paper shading, matte surfaces) and
scaled to fit. `npm run licensed:check` lists which slots are filled.

## Licence confirmation (the developer fills this in)

Section 1C of the [v0.0.11 plan](../../docs/roadmap/v0.0.11.md) asks for written confirmation that
the licence allows the models in a game delivered to players' browsers (the built game contains
the model files, which a player could save from the browser).

| | |
|---|---|
| Packs bought | _(e.g. POLYGON School, POLYGON Office: fill in)_ |
| Licence | _(e.g. Synty Standard / Single Seat EULA, version and date: fill in)_ |
| Browser (WebGL) distribution allowed? | _(yes / no, with the clause or a link to Synty's answer: fill in)_ |
| Confirmed by, on | _(name, date: fill in)_ |

Until this table is filled in, treat the licensed models as **local only**: don't run
`npm run build:deploy` with them for a public deployment.

## Files the game looks for

Room furniture and fittings are placed by the classroom backdrop (`src/world/Backdrop.ts`);
desk-top props and obstacles are available to the territory themes. Heights are in world units
(1 cm = 0.8 units; a desk top is 52 × 40).

| Prop | Slot | Category | File (relative to this folder) | Fitted height | Colliders |
|---|---|---|---|---|---|
| Stack of books | `bookStack` | prop | `synty/books_stack.glb` | 2.2 | yes |
| Classroom globe | `globe` | prop | `synty/globe.glb` | 5.2 | yes |
| Bookshelf | `room.bookshelf` | furniture | `synty/bookshelf.glb` | 144 | – |
| Low cupboard | `room.cupboard` | furniture | `synty/cupboard.glb` | 72 | – |
| Storage trays | `room.storageTrays` | furniture | `synty/storage_trays.glb` | 60 | – |
| Waste-paper bin | `room.trashBin` | furniture | `synty/trash_bin.glb` | 32 | – |
| Radiator | `room.radiator` | architecture | `synty/radiator.glb` | 48 | – |
| Wall clock | `room.wallClock` | architecture | `synty/wall_clock.glb` | 24 | – |
| Notice board | `room.noticeBoard` | architecture | `synty/notice_board.glb` | 72 | – |
| Ceiling light | `room.ceilingLight` | architecture | `synty/ceiling_light.glb` | 8 | – |
| Potted plant | `room.plant` | prop | `synty/plant_pot.glb` | 72 | – |
| Cardboard boxes | `room.boxes` | prop | `synty/cardboard_boxes.glb` | 44 | – |
| Stapler | `desk.stapler` | prop | `synty/stapler.glb` | 4.8 | yes |
| Scissors | `desk.scissors` | prop | `synty/scissors.glb` | 1.2 | – |
| Glue stick | `desk.glueStick` | prop | `synty/glue_stick.glb` | 8 | yes |
| Calculator | `desk.calculator` | prop | `synty/calculator.glb` | 1.6 | – |
| Paint pots | `desk.paintPots` | prop | `synty/paint_pots.glb` | 3.2 | yes |
| Water bottle | `desk.waterBottle` | obstacle | `synty/water_bottle.glb` | 17.6 | yes |
| Lunchbox | `desk.lunchbox` | obstacle | `synty/lunchbox.glb` | 6.4 | yes |
| Desk lamp | `desk.lamp` | obstacle | `synty/desk_lamp.glb` | 32 | yes |

The list lives in `src/assets/manifest.ts` and `src/assets/synty.ts` (the `licensed` field of
each entry); the first file found wins, and names are matched without regard to case. Colliders
come from the slot, not the file, so a replacement model must be about the placeholder's shape.

## Adding a model, step by step

1. **Export** the model from the pack as **glTF binary (`.glb`)**, one prop per file, Y up, with
   embedded textures (Synty's palette texture is fine and is kept). Its origin can be anywhere:
   the game re-centres it and stands it on its base.
2. **Name and place** it as in the table, e.g. `assets/licensed/synty/bookshelf.glb`. For a prop
   that has no slot yet, add one to `src/assets/synty.ts` (a `licensed` path, a height, a
   category and a placeholder) and, for room furniture, a place in `src/world/Backdrop.ts`.
3. **Validate** it: `npm run validate-glb -- assets/licensed`. It reports triangles, materials,
   textures and how the model will be fitted, warns about anything over budget (furniture 8,000
   triangles, architecture 4,000, props and obstacles 3,000; textures 1,024 px; at most 4
   materials) and fails on files the game can't read (Draco or meshopt compression, not a GLB).
4. **Look** at it: restart `npm run dev`. `paperwars.assets.report()` in the browser console lists
   every prop's source (licensed, placeholder, own model) and any file that failed to load (which
   falls back to its placeholder).

## Delivering them to the deployed game

`vite build` bundles whatever is in this folder when it runs, so a deployment build has to put the
files here first, from somewhere private. Never commit them, and never put them in a public bucket.

1. **Keep the originals privately**, in one of:
   - a **private git repository** (or any folder) laid out like this one (`synty/globe.glb`, …);
   - a **`.tar.gz` of this folder** in private storage: a private bucket with a signed URL, or a
     private release asset reachable with a token.
2. **Tell the build where they are** with one environment variable on the build machine (or in the
   hosting provider's build settings, as a secret):
   - `PAPERWARS_LICENSED_DIR=/path/to/private/folder`, or
   - `PAPERWARS_LICENSED_URL=https://…/licensed.tar.gz` and, if it needs one,
     `PAPERWARS_LICENSED_TOKEN=…` (sent as `Authorization: Bearer …`).
3. **Build with them**: `npm run build:deploy`. It runs `npm run licensed:fetch` (copies or
   downloads the files here, validates each one, lists the slots filled), then `npm run build`, then
   `npm run compress` (writes `.gz` and `.br` beside each file in `dist/`). Without either variable
   the build simply uses the placeholders, and says so.
4. **Upload `dist/`** to the static host. Serve the pre-compressed files if the host can (nginx
   `gzip_static on; brotli_static on;`, Caddy `file_server { precompressed br gzip }`; most static
   hosts do it on their own), and let files under `assets/` be cached for a year
   (`Cache-Control: public, max-age=31536000, immutable`): their names carry a content hash.
5. **Check** the deployed game: `paperwars.assets.report()` in the console shows the slots on
   their licensed models, and nothing in `failures`.

Production builds also register a small service worker (`public/model-cache.js`) that keeps the
model files in the browser's cache between visits, so a returning player doesn't download them
again; each game version uses its own cache and clears the older ones.

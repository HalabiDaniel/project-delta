# Licensed models (not in the repository)

Put **purchased or licensed** 3D models here (Synty POLYGON packs and the like). Everything in this
folder except this README is ignored by git: licensed source files must never be committed to the
public repository unless their licence explicitly allows it.

The game builds and runs without any of them. Each licensed slot has an original low-poly
placeholder built in code; when the file below exists, the game uses it instead, adapted to the
art direction (paper shading, matte surfaces, pencil outlines) and scaled to fit.

## Files the game looks for

| Prop | File (relative to this folder) | Fitted height | Notes |
|---|---|---|---|
| Stack of books | `synty/books_stack.glb` | 2.2 m | A pile of 3–4 books. Simple box collider. |
| Classroom globe | `synty/globe.glb` | 5.2 m | Globe on a stand. Sphere + box colliders. |

The list lives in `src/assets/manifest.ts` (`PROPS`, the `licensed` field of each entry); the
first file found wins, and names are matched without regard to case.

## How to add one

1. Export the model from your pack as **glTF binary (`.glb`)**, one prop per file, with its
   origin anywhere (the game re-centres it and stands it on its base). Embedded textures are
   fine; Synty's palette textures are kept and shaded like paper.
2. Save it under the name in the table (or add a new slot to `PROPS` in `src/assets/manifest.ts`:
   a `licensed` path, a `fitHeight`, a `tier` for its outline, colliders if it is taller than 2 m,
   and a placeholder `build`).
3. Restart `npm run dev` (or rebuild). The browser console warns if a file fails to load, and the
   prop falls back to its placeholder.

A production build (`npm run build`) copies the files you supplied into `dist/`: a compiled game
may include them, the source repository may not. Check your licence for the distribution terms.

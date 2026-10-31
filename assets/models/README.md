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

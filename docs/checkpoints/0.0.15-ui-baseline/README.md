# v0.0.15 UI baseline (before the revamp)

Captured on 2026-11-06 with `npm run ui:shots` (`tools/ui-baseline.mjs`) in headless Chromium
with software rendering, on the Medium preset, from a new career. Phase 9 captures the same views
after the revamp for comparison.

| Files | What |
|---|---|
| `1080p-01` … `1080p-13` | Every single-player screen at 1920 x 1080, HUD size M: welcome, desk with garage and missions, another plane, logbook, base management, pause, folding, ready, flight, pause in flight, crash, desk after a sortie, developer panel |
| `<size>-hud-m-desk`, `-flight` | The desk and flight at 1280 x 720, 2560 x 1440, 1920 x 1200 (16:10), 2560 x 1080 (21:9) |
| `1080p-hud-s-*`, `1080p-hud-l-*` | HUD sizes S and L at 1080p |
| `4k-hud-m-desk`, `21x9-1440-hud-m-desk` | 3840 x 2160 and 3440 x 1440: the HUD alone (software rendering can't draw the world at these sizes in time) |

Gaps: no flight view at 4K or 3440 x 1440 (the headless page runs out of memory), and the crash
shot shows the moment after the crash rather than the report card.

What the baseline shows (see also [the audit](../../UI_AUDIT.md)): at 4K the HUD is small, because
the resolution scaling stops at 1.4x; at 21:9 the panels sit at the far corners.

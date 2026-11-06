# UI Audit (v0.0.15, phase 1)

**Date:** 2026-11-06
**Plan:** [v0.0.15](roadmap/v0.0.15.md), phase 1: "Audit the current UI: every screen, component, token and string".
**Scope:** `src/ui/`, `src/mp/`, `src/input/`, `src/render/` (outlines, graphics settings) as of this commit.
The screenshot baseline is captured separately (`npm run ui:shots`, `tools/ui-baseline.mjs`).

This is an inventory, not a design. Phases 2 to 9 build from it. Counts come from the code and are
approximate where noted ("~").

---

## 0. How the UI is built today

- `index.html` has `<canvas id="game">` and `<div id="hud">`. `src/main.ts` passes both to `Game`
  (single-player) or `MultiplayerGame` (`?mp` / `?invite`).
- `HUD` (`src/ui/HUD.ts`) adds the class `hud` to `#hud` and builds seven fixed zones (`zone-tl`,
  `-tc`, `-tr`, `-bl`, `-bc`, `-br`, `-centre`) plus a `world-layer` for screen-space markers.
- Each module writes its own markup as HTML template strings (`innerHTML`) or `createElement`, and
  updates it each frame from one view object (`HudView`, `src/ui/views.ts`) built by `Game.view()`
  or `MpViews.hud()`. No framework.
- Opening and closing is almost always render-driven: a module shows when its part of the view is
  non-null (`toggle(el, v !== null)`). Only the logbook, the lobby, the feedback form and the dev
  panel keep their own `open` state.
- Two stylesheets: `src/ui/hud.css` (1061 lines, imported by `HUD.ts`) and `src/mp/mp.css`
  (309 lines, imported by `MultiplayerGame.ts`). Tokens are declared on `.hud`, not `:root`.

---

## 1. Screens

### A. Single-player HUD and screens (`src/ui/`)

| Screen / panel | Source | What it shows | Plan section / phase | Opened / closed |
|---|---|---|---|---|
| Economy strip | `EconomyStrip.ts` | Paper and capacity, paper/min chip, streak chip, storage bar, protected paper (hover), paper delta pop; icon buttons Base / Logbook / Menu at home | §3A top left, §4A; phase 3/4 | Always; buttons only at home, not paused, no result |
| Home dashboard | `Dashboard.ts`, `dashboardView.ts` | Base condition, hangar, chosen mission and plane, next steps, quick Rebuild / Repair all / Base | §4 (not listed by name); phase 4 | At the desk; hidden in flight, paused, base mode, result, welcome |
| Mission cards | `MissionPanel.ts` | Card per offer: type icon, title, reward, slot tag, stars, threat pips, kit, plane-fit letters, expiry, operation dots, Swap | §4A mission board; phase 4 | At the desk (zone-tr) |
| Objective strip | `MissionPanel.ts` | Current step, distance, progress bar, step dots, clock, reward | §3B; phase 3 | In flight (zone-tc) |
| Garage row + inspector | `Garage.ts` | Plane cards (accent stripe, price, health, fit badge); inspector with ratings as pips, loadout | §4A, §10D; phase 4 and 8 | At the desk, not paused, not base mode |
| Plane HUD | `PlaneHud.ts` | Condition (health, range), instruments (speed, throttle mark, altitude, boost), weapons (ink bar, bomb pips), desk action (Fold / Refit / Roll out / Launch), landing checks, ground crew (Rearm, Take off, End sortie), building progress, boundary warning | §3A/B; phase 3 (desk action: phase 4) | Per phase |
| Threat HUD | `ThreatHud.ts` | Threat panel (territory, level pips, defense icons, status), threat ring round the centre, rocket lock warning, threat notes, hit arcs | §3B; phase 3 | In flight only (`threat` null otherwise) |
| Air HUD | `AirHud.ts` | Brackets and tag on AI aircraft, health bar, edge chevrons, lead sight | §3B; phase 3 | When not paused |
| World labels | `WorldLabels.ts` | Reticles, objective diamond / edge arrow, territory tags, target tags with health, hit X, pop words, damage numbers | §3B; phase 3 | Per frame from view |
| Mini-map | `MiniMap.ts` | Canvas: territories by role, defenses and reach arcs, zones, rings, practice targets, AI aircraft, raid lines, T1 radar sweep, boundary, plane | §3A; phase 3 (desk states: "Also in this version"; larger maps v0.0.20) | Always (zone-tr); 128 px at home, bigger in flight |
| Alerts | `Alerts.ts` (`Alerts`) | Pill: icon, title, one value, ×count; max 3 | §3B; phase 3 | `hud.alert(...)`, times out (default 2.6 s) |
| Tips | `Alerts.ts` (`Tips`) | Dark first-time tip with keys | §6B; phase 6 | `hud.tip(...)`; click to dismiss, times out |
| Tutorial panel | `TutorialPanel.ts` | "3 / 10", title, text, key chips, progress, Skip | §6B; phase 6 | While a step is active; hidden paused / result / welcome |
| Base management | `BaseHud.ts` (`BaseHud`) | Slot markers in the world, base overview (top centre), build tray (bl), slot inspector (bc), Repair all / Done (br) | §4A base management + repair; phase 4 | `B` / Base button / pad Y; `Esc`/B closes |
| Raid alert | `BaseHud.ts` (`RaidHud`) | Inbound raid: from, ETA, target, guns ready, what to do | §3A top centre; phase 3 | While a raid is inbound |
| Defense report | `BaseHud.ts` (`RaidHud`) | Raid outcome card | §4A results ("defense report"); phase 4 | `hud.raidReport()`, click or timeout |
| Sortie report | `ReportCard.ts`, `reportText.ts` | Result and medal, 4 big tiles, chips, why it failed, advice, paper breakdown, Details list, Continue | §4A results; phase 4 | `v.result` non-null; Continue (Enter / A) |
| Pause menu | `Menus.ts` | Resume, Logbook, Sound, mode link; settings (Hints, Size, Graphics, Outlines, Lines, pad Invert Y / Stick / Camera); session stats; controls grid (keyboard or pad); transfer code; Feedback, Another computer (MP), Tutorial, Reset / Leave | §4A pause; phase 4. Settings screens: v0.0.17 | `Esc` / pad Menu / Menu button; Resume, backdrop click |
| Welcome card | `Menus.ts` | "Welcome (back)", paper, last session, Continue, Multiplayer link | §4A (pause family); phase 4 | On arrival (SP); any key or click |
| Logbook | `Logbook.ts` | Tabs: Records, Base, Aircraft, Paper, Session; tables, ledger, achievements | §4A; phase 4 | `L` / pad View / button; `Esc`, Close, backdrop. SP only (MP shows "Not in multiplayer") |
| Mouse-capture hint | `HUD.ts` | "`Esc` → click" pill | §3; phase 3 | In flight without pointer lock |
| Damage flash | `HUD.ts` | Red inset vignette | §3; phase 3 (§8C) | On hit |
| Loading screen | `LoadingScreen.ts` | Sheet with progress bar, "Folding the paper…" | Out of scope: v0.0.17 (loading screens) | Startup; fades after load |
| Developer panel | `DevPanel.ts` | Director, performance, events, history, sim tools | Not player UI; no plan section. Keep as is | `` ` `` key or `?dev` |
| Perf overlay | `PerfOverlay.ts` | fps, frame ms, draws, tris, strokes, memory | Not player UI; used for §11D | `?perf`; console `paperwars.perf()` |

### B. Multiplayer screens (`src/mp/`)

| Screen / panel | Source | What it shows | Plan section / phase | Opened / closed |
|---|---|---|---|---|
| Lobby: sessions | `Lobby.ts` | Username, code inputs, Quick join, session list (Join), Refresh, Single-player | Lobby redesign: v0.0.17. Must move to shared tokens when `mp.css` retires (phase 5) | Before a desk; `showRooms()` |
| Lobby: claim / username | `Lobby.ts` | Classroom map (3-column grid of desk cells, display-only, buttons disabled), players, "Choose a username" | v0.0.17 (lobby); tokens phase 5 | After joining; hidden once placed |
| Session results card | `Lobby.ts` (`showResults`) | Placings table, Join next session, Back to the list | "Also in this version" (results card); phase 5 | At session end |
| Connection line | `MpHud.ts` (`mp-net`) | Status dot, ping, players, room, session timer, protection, emote keys | §5A; phase 5 ("Also": session timer) | Always in game |
| Kill feed / news | `MpHud.ts` (`mp-feed`) | Up to 6 lines, killer + assists + weapon icon + victim, owner colours | §5A; phase 5 | Lines fade at 6 s |
| Scoreboard | `MpHud.ts` (`mp-board`) | Table: players, territory, kills, assists, score, status, ping | §5A; phase 5 | Held `Tab` / pad View (hold) |
| Raid banner | `MpHud.ts` (`mp-banner`) | Incoming raid by a player (attacker, distance) or outgoing | §5A; phase 5 | While a raid is on |
| Reconnecting banner | `MpHud.ts` (`mp-connection`) | "Connection lost · reconnecting…" | §5B (standard alert/dialog); phase 5 | While `status === 'reconnecting'` |
| Name / owner tags | `MpHud.ts` (`mp-tag`, `mp-terr`) | Player name in tape colour, health bar, emote bubble; territory owner tag | §5A presence; "Also": "{username}'s desk"; phase 5 | Per frame |
| "You landed on…" | `MpHud.ts` (`mp-landed`) | Mini grid of desks, desk label | "Also in this version"; phase 5 | 4.5 s after placement |
| Feedback form (F8) | `FeedbackForm.ts` | Category toggles, two textareas, Enjoyment 1–5, Cancel / Send | "Also in this version"; phase 5 | `F8` (window listener) or menu button; `Esc`, Cancel, backdrop. Pauses the game |
| MP HUD view | `MpViews.ts` | Builds `HudView` and `MpHudView` from server state; rival cards ("Rival · name") reuse the SP mission card | §5A; phase 5 | — |

Shared with single-player: the whole `HUD` (all of table A except Logbook, Welcome, DevPanel,
PerfOverlay) is reused by `MultiplayerGame` with views from `MpViews`.

### C. Controller and keyboard focus today (v0.0.11)

The mechanism is `FocusNav` (`src/input/FocusNav.ts`), driven by `Controls` (`src/input/Controls.ts`).

| Aspect | Today |
|---|---|
| Who owns it | `Controls.nav = new FocusNav(document)`. Root is the whole document, not `#hud`. |
| When it is on | Only while the last device is the gamepad, the context is not `flight`, and `Controls.navigable` (always `true`). Keyboard never drives it. |
| Highlight | A CSS class `pad-focus` (amber outline, hard-coded `#f59e0b`), not browser focus. Enter / Space keep their game meanings. |
| Candidates | `button, a[href], [data-nav], input[type="text"], input:not([type])`. Not `textarea`, `select`, `input[type=number]`. |
| Reachable | Connected, not disabled, not inside `[hidden]`, `.dev-panel` or `.pad-skip`, at least 2×2 px, and topmost (`elementFromPoint`) at its centre or one of 4 nearby points. Off-screen items in a scroller count as reachable. An open overlay therefore confines the highlight by geometry, not by a modal trap. |
| Moving | D-pad or left stick (`stickDirection`), auto-repeat by `NavRepeater` (`STICK.navDelay`, `navRepeat`). `pickInDirection`: nearest in the half-plane, score = distance along + 2 × sideways offset (+40 when overlapping). No explicit overrides. |
| Default | On `reset()` (when `Controls.screen` changes): the largest `.primary` button, else the top-left control. `Controls.screen` is a string built in `Game`/`MultiplayerGame` from phase, base mode, paused, logbook / lobby, welcome / room. |
| Keeping place | After a re-render, finds the same control by `KEY_ATTRS` (`data-u`, `data-p`, `data-b`, `data-m`, `data-r`, `data-act`, `data-tab`, `data-v`, `data-room`, `data-t`, `data-id`, `data-slot`, `data-kind`, `data-nav`), else by its first 40 characters of text. |
| Confirm | Pad A (`south`) → `confirm`; if the highlight is active it clicks the element (inputs get `.focus()`). |
| Back | Pad B → `back`. Game closes the logbook, then base mode; B never pauses (Menu does). |
| Tabs / pages | No tab or page switching. LB/RB and LT/RT cycle aircraft and mission cards at home. Logbook tabs are reached with the highlight. |
| Tooltip | `placeTip()` shows the control's `title` (or nearest `[title]` ancestor) in a `.pad-tip` box appended to `document.body`. |
| Focus restore | None. A closed panel does not return the highlight to its opener; `reset()` picks the screen default. |
| Keyboard | No focus model. Every screen uses direct hotkeys (`KEYMAP`: W/S/A/D, Shift, Enter, Space, Esc, F, R, X, Delete, U, Q/E, B, L, M, `` ` ``, H, Tab, Z/C/V, 0–7). `bindButton` (`dom.ts`) cancels `mousedown` so buttons never take browser focus; `Tab` is the scoreboard. |
| Exceptions | Lobby and FeedbackForm bind with `addEventListener('click')` (not `bindButton`), so their buttons and inputs do take browser focus; both stop `keydown` propagation so typing never reaches the game. |
| Contexts | `InputContext = 'flight' | 'home' | 'menu'` (`Game.inputContext()`: menu when paused, logbook open or welcome; MP: no room, lobby open, paused or no state). `PAD_PRESS` / `PAD_HOLD` map buttons per context. |
| Device switch | `Controls.use()` toggles `body.pad-mode`; `refreshGlyphs()` sets `body[data-pad]`, calls `setControlLabels(padControlLabels(family))` and `applyGlyphs(document, family)` when the HUD DOM changed (MutationObserver). |

---

## 2. Tokens

### A. Custom properties in `src/ui/hud.css` (declared on `.hud`, 37 in all)

| Plan group | Token | Value |
|---|---|---|
| Colour: surfaces | `--paper` (card stock) | `rgba(251, 248, 241, 0.93)` |
| | `--paper-solid` (card stock solid) | `#fbf8f1` |
| | `--paper-2` (recessed paper) | `#efe8d9` |
| | `--edge` | `#ddd2bb` |
| | shadow | see Elevation |
| Colour: ink | `--ink`, `--ink-2`, `--ink-3` | `#1d2747`, `#4a5373`, `#8a90a6` |
| Colour: meaning | `--friend` | `#2f6fe4` |
| | `--hostile` | `#d6372e` |
| | `--warn` | `#df8f14` |
| | `--good` | `#1f9d55` |
| | `--off` | `#a3a6b1` |
| | objective (orange) | **missing**: code uses `--threat-2` (`#e8761a`) |
| | neutral (grey) | **missing**: code uses `--off` |
| Colour: status | `--threat-1`, `--threat-2`, `--threat-3` | `#d7a40b`, `#e8761a`, `#d6372e` |
| | `--tracking`, `--locking`, `--firing` | `#f59e0b`, `#a855f7`, `#d6372e` |
| | `--gold`, `--silver`, `--bronze` (medal tiers) | `#c9940f`, `#8a93a6`, `#b4703c` |
| Spacing | `--s1`..`--s4` | `4px`, `8px`, `12px`, `16px` |
| Radius | `--r` (card), `--r-s` (small) | `10px`, `7px`; pill: **missing** (`999px` / `99px` literal, 12×) |
| Type | `--t-xl`, `--t-l`, `--t-m`, `--t-s` | `30px`, `21px`, `15px`, `12px` |
| | `--font` | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` |
| | `--num` | `ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif` (no web font loaded) |
| Elevation | `--shadow` (raised) | `0 1px 0 rgba(29,39,71,.05), 0 6px 18px rgba(29,39,71,.16)` |
| | `--shadow-lift` (floating) | `0 2px 0 rgba(29,39,71,.06), 0 10px 26px rgba(29,39,71,.22)` |
| | flat | **missing** |
| Motion | `--fast` | `160ms cubic-bezier(0.2, 0.9, 0.3, 1.2)` (the only one) |
| Focus | — | **missing**: `.pad-focus` hard-codes `3px solid #f59e0b`, offset 2px, glow `rgba(245,158,11,.25)` |
| Scale (runtime) | `--ui-scale` | `1` (set by `HUD.setScale`: 0.9 / 1 / 1.15) |
| | `--fit-scale` (not declared) | set by `HUD.ts`: `clamp(innerHeight / 740, 0.9, 1.4)` |

Per-element runtime properties: `--strength` (damage flash, hit arc), `--accent` (plane card, from
`AIRCRAFT[id].accent`), `--owner` (mp.css, player tape colour).

### B. `src/mp/mp.css`

- Declares **no tokens** of its own except `--owner` (default `var(--off)` or `var(--hostile)`).
  It relies on the `.hud` tokens because its elements sit inside `#hud`.
- Uses tokens more consistently than hud.css for spacing (42 `var(--s*)` vs 10 in hud.css).

Divergences from hud.css:

| Item | mp.css | hud.css |
|---|---|---|
| Fallbacks with other values | `var(--warn, #c98a12)`, `var(--hostile, #c0392b)` | `--warn #df8f14`, `--hostile #d6372e` |
| Undefined token | `var(--t-xs, 11px)` (`.fb-note`) | no `--t-xs` |
| Key caps | `.mp-keys kbd`: 10px, radius 3px, paper-2 | `.hud kbd`: 11px mono, radius 5px, white, 2px bottom border |
| Pulse | `mp-pulse` (box-shadow) | `pulse` (opacity) |
| Toggle buttons | `.fb-cats button` + `.on` | `.seg button` + `.on` (same look, separate rules) |
| Tables | `.mp-results-table`, `.mp-board table` | `.lb-table`, `.ledger`, `.rp-details` |
| Status tone | both `.mp-status[data-tone='bad']` and `.mp-status.bad` | `[data-tone]` only |
| Layout | Absolute px positions outside the zones: `.mp-net` top 120px, `.mp-banner` top 156px, `.mp-feed` top `max(210px,34%)` then overridden to `max(330px,46%)`; `.hud .dashboard { margin-top: 30px }` | zones with `--ui-scale` |
| Hard-coded colours | `#e9f1ff` (free desk hover), `rgba(47,111,228,.08)` (own row), `#fff` | — |
| Card override | `.mp-net`, `.mp-board`: `animation: none` | `.card` folds in |

### C. Hard-coded values that bypass tokens

| File | Hex colours | `rgb(a)()` | Literal px font sizes | Literal radius | gap/padding/margin with px |
|---|---|---|---|---|---|
| `src/ui/hud.css` | 108 outside the token block (~20 in dev panel / perf / pad) | 45 | 34 | 33 | ~193 |
| `src/mp/mp.css` | 5 | 6 | 5 | 6 | ~20 |

Notable hud.css examples:

- `#fff` 37×: text on coloured pills, button hover, `kbd` background.
- Tinted chip pairs with no token: `#d9f2e3/#167a41` (good), `#dbe7fd/#1f4fae` (friend),
  `#fbdcd9/#a3241c` (hostile), `#fcebcc/#96600a` (warn), `#fcefc7/#8a6406` (gold), `#fde7d4/#b4501a` (streak).
  Used by `.tag[data-slot]`, `.rp-chips`, `.db-fit`, `.db-next`, `.desk-tag`, `.mod`, `.econ-*`.
- Button shades: `#1f4fae` (primary shadow), `#3a7cf0` (primary hover), `#9b241d` (confirm shadow), `#ffd6d2`.
- Ink-navy with alpha `rgba(29, 39, 71, x)`: 16× with 10 different alphas (bar tracks, dividers, backdrops `0.35`).
- World-marker text: `rgba(0,0,0,.3–.8)` shadows, `#fde047` / `#fca5a5` pop words, `#fde68a` tip icon.
- Off-scale spacing: 5px (24×), 6px (45×), 7px (15×), 3px (21×), 9px, 10px, 14px, 18px.
- Logbook card uses its own radius `14px` and fonts 12–22px, not tokens.
- `.pad-tip` and `.pad-key` (controller) use Tailwind greys `#1f2937`, `rgba(31,41,55,.92)`.

Inline styles in TypeScript: `LoadingScreen.ts` (5, own palette: `#bcdbf5`, `#1f2937`, `#fffdf6`,
`#3a7cf0`, `#4b5563`), `MpHud.ts` (6: owner colours via `colourCss`, landed grid), `Lobby.ts` (3),
`Garage.ts`, `BaseHud.ts`, `TutorialPanel.ts`, `DevPanel.ts` (1 each, widths / accents).

### D. Colours duplicated in TypeScript

| Where | What | Matches tokens? |
|---|---|---|
| `src/ui/MiniMap.ts` `COLORS` (28 entries) + 4 inline | Canvas colours, font `700 9px system-ui` | `home`/`friend` `#2f6fe4`, `enemy` `#d6372e`, `plane` `#1d2747`, `bg` = `--paper` match. Others are Tailwind values that do **not**: `warning`/`zone`/`engaged` `#dc2626`, `objective` `#ea580c`, `ring` `#f97316`, `done` `#4ade80`, `neutral`/`wreck` `#9ca3af`, `threat` `#eab308/#f97316/#dc2626`, `precision` `#3730a3`, `defense` `#4d5530`, launcher reach purple `rgba(147,51,234,.5)` |
| `src/config.ts` `PALETTE` (sRGB 0–1) | 3D world: `home` [0.23,0.48,0.93], `target` [0.98,0.56,0.16], `neutral`, `threat1..3`, `friendlyAccent`, `enemyAccent`, `bullseyeRed`, `rangeTurret`, `rangeLauncher`, … | Close to but not equal to `--friend`, `--threat-*` |
| `src/net/protocol.ts` `PLAYER_COLOURS` (16) + `colourCss()` | Player tape colours (border, flag, trim, name tag, kill feed) | Separate palette; slot 0 blue, slot 8 red |
| `src/config.ts` `AIRCRAFT[id].accent` | Plane-card stripe (`--accent`) | Converted by duplicate `css()` helpers in `Game.ts:3266` and `MpViews.ts:1055` |
| `src/render/style.ts` | `OUTLINE.color`, `SHADING`, `LIGHTING.sky`, material colours | World only; outline part goes away (§6 below) |
| `src/world/BuildingRig.ts` | `#ffffff/#e4e4e4/#cfcfcf` shades | World only |
| `src/ui/WorldLabels.ts`, `AirHud.ts`, `ThreatHud.ts` | No colours in TS: all through CSS classes / data attributes | Good |

---

## 3. Components

### A. Helpers

| File | Provides |
|---|---|
| `dom.ts` | `text`, `attr`, `toggle`, `place` (translate), `width` (bar fill %), `esc` (HTML escape), `bindButton` (click with `stopPropagation`, cancels `mousedown` focus, adds `data-nav` to non-buttons). `ScreenPoint` type. |
| `icons.ts` | `PATHS` (16×16 stroke icons), `IconName`, `ICON_NAMES`, `icon(name, className = 'icon', label?)` → SVG string; with `label`: `role="img"`, `aria-label`, `<title>`; without: `aria-hidden`. Only 2 call sites pass a label (`MpHud.ts`). |
| `controlLabels.ts` | `ControlAction` (21 actions), `KEYBOARD_LABELS`, `controlLabel(action)`, `setControlLabels(map | fn | null)`, `controlLabelsVersion()`. Used by tutorial, dashboard, reports. |
| `src/input/glyphs.ts` | `LABELS` per pad family (xbox, playstation, generic), `buttonLabel`, `KEY_TO_PAD` (keyboard hint → pad template), `padHint`, `applyGlyphs` (rewrites every `<kbd>` text, original in `data-key`, `data-pad` override, `.pad-hidden`), `padControlLabels`. |
| `views.ts` | Plain view types for every module (`HudView`, `MissionCardView`, `GarageView`, `BaseView`, `ResultView`, `MenuView`, `SettingsView`, `DashboardView`, …) and `HudActions` (~40 callbacks incl. `setOutlines`, `setOutlineIntensity`, `setUiScale`). |

`ICON_NAMES` (68): bomb, turret, launcher, radar, supply, recon, survive, escape, land, ring,
practice, reach, rocket, fighter, scout, bomber, escort, patrol, paper, rate, capacity, lock,
refund, store, workshop, storage, speed, altitude, boost, health, range, ink, bombload, rearm,
plane, heading, base, repair, upgrade, build, remove, slot, level, shield, raid, ok, warn, wrecked,
offline, clock, distance, home, kills, crumple, damage, medal, streak, swap, book, sound, mute,
menu, pencil, graphics, info, tip, close, more. (`pencil` is named "Pencil outlines".)

### B. De facto patterns

| Pattern | Implementations (CSS classes) | Count | Notes |
|---|---|---|---|
| Card | `.card` (folded corner, `fold-in`) on ~27 panels; `.mcard`, `.plane-card` (own gradient/shadow); `.logbook-card` (not `.card`, radius 14px); `.raid-alert` (overrides background); `.mp-card` | 5 | `.card` is the closest to the plan's Card |
| Button | `.btn` (+ `primary`, `ghost`, `big`, `small`, `tiny`, `danger`, `confirm`), `.link-btn`, `.icon-btn` (+ `.badge`, corner `kbd`), `.tab`, `.seg button`, `.fb-cats button`, `.tray-item`, `.slot-marker`, `.mp-cell`, `.dev-btn` | 10 | Card-like buttons (`.mcard`, `.plane-card`) are clickable `div`/`button` |
| Bar | `.bar > i` (+ `thin`, `mini`, `speed`, `data-level`), `.pc-health`, `.tl-health`, `.am-health`, `.sm-health`, `.mp-tag-bar`, `.lw-bar`, `.tu-progress`, `.obj-bar`, dev `.bar-cell` | 9 | Thresholds via `format.level()`: >0.6 ok, >0.3 worn, else critical |
| Pips / steps | `.pips` (threat), `.pips5` (ratings), `.stars` (tier), `.lv` (building level), `.bomb-pips`, `.op-dots`, `.obj-steps` | 7 | `format.pips()` ("●●○") is unused |
| Chip / tag | `.chip`, `.tag`, `.pill` (one rule), `.tag[data-slot]`, `.rp-chips li`, `.db-fit`, `.desk-tag`, `.medal`, `.mod`, `.fit`, `.fit-badge`, `.mp-player`, dev `.dev-chip` | ~10 | |
| Stat | `.stat` / `.stats` (icon + `<b>` + `em`), `.gauge`, `.meter`, `.weapon`, `.ov`, `.rp-tile`, `.econ-paper` | ~6 | |
| Delta pop | `.delta` (paper), `.threat-note`, `.pop-word`, `.damage-number` | 4 | |
| Tooltip | Native `title` (~100 in templates, ~25 set in code); `.pad-tip` for controller | 2 | No keyboard or focus tooltip |
| Alert | `.alert` (pill, max 3), `.tip`, `.threat-note`, `.lock-warning`, `.boundary`, `.raid-alert`, `.mp-banner`, `.mp-connection`, `.mp-line.news` | 9 | `Alerts` keeps the newest 3; no priority order |
| Key cap / glyph | `.hud kbd`, `.icon-btn kbd`, `.mp-keys kbd`, `.pad-key` (menu pad grid), `.hint-key` / `.hint-keys` (shown with `.hud.hints`) | 4 | 39 `<kbd>` across 15 files. `PAD_CONTROLS` in `Menus.ts` hard-codes Xbox names (RT, LB, A, B…) even on PlayStation |
| Dialog / overlay | `.overlay` (pause), `.welcome`, `.logbook`, `.mp-lobby`, `.mp-feedback` (only one with `role="dialog"`) | 5 | Same backdrop `rgba(29,39,71,.35)` written 4× |
| Confirm | Two-press buttons: Reset → Confirm reset, Remove → Confirm, Abandon → Confirm (`.btn.confirm`, `confirming` + timeout in Game) | 3 | No confirm dialog; End sortie and Leave classroom have none |
| Tabs | Logbook `.tab` / `.active`; segmented `.seg` (settings, feedback rating) | 2 | No shoulder-button tab switching |
| List / table | `.ledger` (dl), `.lb-table`, `.achievements`, `.mp-results-table`, `.mp-board table`, `.rp-details`, `.ratings`, `.db-next`, `.mp-list/.mp-room`, `.dev-table` | 10 | |
| Swatch | `.swatch` (Garage, PlaneHud) | 1 | |

Time formatters are duplicated: `format.clock`, `Progress.clock` (Logbook), `Lobby.clockText`,
`MpHud.fmtTime`.

---

## 4. Strings

### A. Dictionary today

| Source | Provides |
|---|---|
| `src/ui/strings.ts` | `SAY` (40 short labels: Launch, Take off, Rearm, End sortie, Continue, Repair all, Confirm, Resume, Details, Raid inbound, Storage full, …), `MISSION_TYPE_LABELS` (23), `MISSION_ICONS`, `SLOT_KIND_ICONS`, `SLOT_KIND_LABELS` (4), `STATE_LABELS` (4) |
| `src/ui/icons.ts` | `ICON_NAMES` (68, tooltips and screen readers) |
| `src/ui/controlLabels.ts` | `KEYBOARD_LABELS` (21); controller labels in `glyphs.ts` |
| `src/ui/reportText.ts` | Report sentences: failure reasons and advice, paper lines, next step (22) |
| `src/ui/format.ts` | `fmt` (1.2k), `signed` (+12 / −8), `clock` (1:05, 45s), `pct`, `metres` (m / km), `pips`, `compass` (N…NW), `level` |

Not keyed: everything is English constants. No string ids, no plural rules, no locale-aware
number formatting (`toFixed`, hand-built "k").

### B. Literal user-facing text outside the dictionary

Distinct literals found by a scan of quoted strings and template text (approximate; excludes the
dictionary files above).

| File | ~Literals | Sample |
|---|---|---|
| `src/Game.ts` | 150 | alerts and tips ("Rearm at T1", "Sound off", "A raid is coming for T1…", "Abandon?") |
| `src/config.ts` | 130 | aircraft names / role labels / descriptions, threat labels, desk names |
| `src/ui/Menus.ts` | 80 | "Paused", "Hints", "Size", "Outlines", "Lines", "Faint/Normal/Bold", controls grid labels, "Leave classroom", "Another computer", transfer sentence |
| `src/ui/Logbook.ts` | 70 | tab names, row labels ("Longest mission streak", "Favourite plane"), "Nothing built yet", emoji medals 🥇🥈🥉 |
| `src/mp/MpViews.ts` | 45 | "Rival · name", "A player who shoots back", "Attacking you!", objective labels |
| `src/missions/MissionGenerator.ts` | 40 | briefing fragments ("A second Falcon flies with it.") |
| `src/progress/Progress.ts` | 38 | achievements, best labels, medal names |
| `src/mp/Lobby.ts` | 38 | "Quick join", "Choose a username", placeholders, "Empty · opens soon", "Join next session" |
| `src/ui/DevPanel.ts` | 37 | developer only (can stay English) |
| `src/mp/MultiplayerGame.ts` | 36 | "BOOM!", "Confetti!", "Controller connected", "Not in multiplayer" |
| `src/director/WorldEvents.ts` | 30 | "Convoy bounty", "Convoy destroyed!" |
| `src/mp/FeedbackForm.ts` | 28 | category names and hints, "What happened?", "Enjoyment", "Send" |
| `src/ui/BaseHud.ts` | 22 | "Base condition", "Coming from", "Distance from you" |
| `src/ui/PlaneHud.ts` | 21 | "Autopilot", "Descent (under … m/s)", titles |
| `src/ui/ReportCard.ts` | 21 | "Aircraft shot down", "Bombs on target", "Damage taken" |
| `src/mp/MpHud.ts` | 21 | "Connection lost · reconnecting…", "is raiding your base", "Time left in this session" |
| `src/director/Performance.ts`, `progress/Tutorial.ts`, `base/BaseMode.ts` | 16, 12, 12 | rating bands, tutorial steps, building stats |
| `src/ui/Dashboard.ts`, `dashboardView.ts` | 13, 8 | "Home desk", "Hangar", next-step sentences |
| `src/ui/MissionPanel.ts`, `EconomyStrip.ts`, `ThreatHud.ts` | 9, 8, 4 | "Event ends in", "Base (B)", "Not spotted" |
| `src/ui/LoadingScreen.ts`, `NetClient.ts`, `HUD.ts`, `Garage.ts`, `TutorialPanel.ts` | 5, 5, 2, 1, 1 | "Folding the paper…", join errors, lock hint, " · in the hangar", "Skip tutorial" |

Total ~1,050 candidate literals outside the dictionary (~480 in `src/ui` + `src/mp`, the rest in game, config, director, missions and progress code).

Localisation hazards found:

- Sentences built by concatenation and English plurals: `${n} radars`, `"is raiding your base"`,
  `"${name}'s desk"` (`net/Username.ts`), `"Rival · ${name}"`, transfer-code sentence split around a `<b>`.
- Keys embedded in titles: "Base (B)", "Logbook (L)", "Menu (Esc)" (`EconomyStrip.ts`); not relabelled for a controller.
- Logic keyed on English text: `MultiplayerGame.ts:1241` plays the lock sound when `e.title === 'Locked on'`.
  `FocusNav.keyOf` falls back to button text. `glyphs.ts` maps `<kbd>` text ("Esc", "Q / E", "1 – 4").
- Emoji and symbols as text: medals 🥇🥈🥉 (Logbook), emote glyphs `〰 ✶ ♥` (MpHud).
- Fixed widths that will clip longer text: `.cards` 300px, `.dashboard` 300px, `.tray-item` 58px,
  `.mp-room-name` 160px, `white-space: nowrap` on titles, buttons, chips, controls grid.

---

## 5. Accessibility and responsive status

| Topic | Today |
|---|---|
| HUD size | Pause menu Size S / M / L = `0.9 / 1 / 1.15` (`UI_SCALES`, `SaveGame.ts`). `HUD.setScale` sets `--ui-scale`; `.zone` uses `scale(var(--ui-scale) * var(--fit-scale))` from its corner. Saved in SP settings. In MP `setUiScale` calls `hud.setScale` but is not saved, and `MpViews` reports `uiScale: 1` (the menu always shows M). |
| Resolution scaling | `--fit-scale = clamp(innerHeight / 740, 0.9, 1.4)`. Capped at 1.4, so at 2160p (DPR 1) panels are about 1.4× their 740 px size. |
| Not scaled | Everything outside `.zone`: pause / welcome overlays, logbook, world-layer markers, threat ring, `mp-layer` (connection, feed, board, banner, tags), lobby, feedback form, `.pad-tip`. |
| Media queries | One: `@media (max-height: 760px)` (smaller cards and flight mini-map). None for width, aspect, `prefers-reduced-motion`, `prefers-contrast`. |
| Ultrawide | No 16:9 safe area. Zones pin to the screen corners; `zone-tc` is `min(560px, 44vw)`, `zone-bc` `max-width: 70vw`. |
| DPR | Canvas `maxPixelRatio = min(DPR, 2)`, graphics `resolution` setting; MiniMap canvas uses `min(DPR, 2)`. Icons are SVG. |
| Text scaling | None separate from HUD size. Root font is `var(--t-m)` = 15px on `.hud`; most sizes are px. |
| Reduced motion | None. Animations: `fold-in` on every card, `alert-in/out/bump`, `delta`, `pop`, `hit`, `damage`, `flash`, `hit-arc`, `mp-emote`; looping `pulse` 10× (urgent timer, engaged icons, lock, boundary, under-attack tag, attacking marker, raid alert…) and `mp-pulse` 1×. |
| Colour-blind | None. Colour-only states: AI marker brackets (red vs blue), mini-map dots, mission slot stripe (tag text helps), bar levels, threat panel underline (pips help), `.fit` letters on coloured squares (letter helps, colour carries level), mp owner tape colours. |
| Contrast | White text on `--warn` `#df8f14` and `--good` pills; `--ink-3` `#8a90a6` small text on paper. Not measured. |
| ARIA | 10 uses total: `icon()` (`role="img"` + `aria-label` with a label, else `aria-hidden`), `Alerts` `aria-live="polite"`, FeedbackForm `role="dialog"` + `aria-label`, LoadingScreen `role="progressbar"` + `aria-value*`, PerfOverlay `aria-hidden`. No roles on overlays, tabs (`aria-selected`), segmented buttons (`aria-pressed`), or tables' captions. Most icon-only meaning relies on a parent `title`. |
| Fixed px sizes | See §2C: 34 literal font sizes, 33 literal radii, ~193 px spacing values in hud.css. |
| Hover-only | `.econ:hover .econ-safe` (also shown in pad mode / focus-within); ~125 native `title` tooltips (controller sees them via `.pad-tip`, keyboard does not); hover lifts on cards. |
| Subtitles / sound cues | None (see §7). |

---

## 6. "Also in this version": outline renderer and default preset

### A. Files that touch the pencil outlines

| File | What |
|---|---|
| `src/render/outline/OutlineRenderer.ts` (399) | `installOutlines(app)`, `outline(root, tier, opts)`, `outlineDynamic(...)`, `outlineRenderer()`, `OutlineQuality`, stats |
| `src/render/outline/EdgeTopology.ts` (265), `strokeShader.ts` (133) | Edge extraction and stroke shader |
| `src/render/outline/outline.test.ts` (125) | Tests (delete with the renderer) |
| `src/render/style.ts` | `OutlineTier`, `OUTLINE_TIERS`, `StrokeStyle`, `OUTLINE` (colour, tiers) |
| `src/render/GraphicsSettings.ts` | `outlines`, `outlineQuality`, `outlineIntensity` fields, `OUTLINE_INTENSITIES`, `OutlineChoice`, `withOutlines`, `outlineChoice`, `withIntensity`; imports `OutlineQuality`; `normalizeGraphics` reads them; storage key `paperwars.graphics.v2` |
| `src/render/graphics.test.ts` | Outline tests (lines 35–72) |
| `src/Game.ts` | import (82), `outlines` field (195), `installOutlines` (282), `setOutlines` / `setOutlineIntensity` actions (395–396), `outlines.update()` (484), perf stats (467), `configure` in `setGraphics` (739), menu view (2280–2281) |
| `src/mp/MultiplayerGame.ts` | import (56, 59), field (215), install (277), actions (311–312), update (405), configure (705) |
| `src/mp/MpViews.ts` | `outlineChoice` in the menu view (37, 196) |
| `src/ui/Menus.ts` | Outlines and Lines settings rows (91–94, 143–144, 170–172); `OutlineChoice` import |
| `src/ui/views.ts` | `SettingsView.graphics.outlines`, `intensity`; `HudActions.setOutlines`, `setOutlineIntensity` |
| `src/ui/icons.ts` | `pencil` icon, named "Pencil outlines" (also used by Feedback and Username; rename only) |
| `src/ui/PerfOverlay.ts` | `strokes`, `outlined` readings |
| Mission markers: `src/world/MissionMarkers.ts` | `outline(...)` at 175 (rings), 295, 336 (comment 335) |
| Other world callers of `outline()` | `assets/AssetLibrary.ts:213`, `world/territories/Dressing.ts` (167, 240, 271), `world/OrdnanceView.ts:163`, `world/Effects.ts:127`, `world/TargetRange.ts:112–113`, `world/DefenseModels.ts` (178–179, 364–367), `aircraft/PlaneController.ts:61` |
| `outlineDynamic` | `aircraft/PlaneModel.ts:3, 74, 87, 100` (constructor parameter `outlineTier`) |
| `OutlineTier` as data | `assets/manifest.ts` (`tier` on every entry), `assets/synty.ts` (52, 98) |
| Docs | `docs/ART_DIRECTION.md` (~23 lines mention outlines) |

Outlines already default to off on every preset (`PRESETS.*.outlines = false` since v0.0.11).
`tier` on asset entries may still be wanted for other uses; decide before removing it.

### B. Default graphics preset

- `src/render/GraphicsSettings.ts:41`: `DEFAULT_GRAPHICS = { preset: 'high', ...PRESETS.high, outlineIntensity: 1 }`.
  `normalizeGraphics` and `loadGraphics` fall back to it.
- `src/render/graphics.test.ts:30–31` asserts `'high'`; it must change with the default.
- Saved settings under `paperwars.graphics.v2` keep their preset; only new or unreadable storage gets the default.

---

## 7. Sounds (`src/ui/Sounds.ts`, for §8D)

All synthesised with Web Audio. `SoundName` = 12 one-shots, plus two continuous layers.

| Sound | Meaning | Played from | Subtitle needed (§8D) |
|---|---|---|---|
| `spotted` | Defenses noticed the plane | `Game.ts` 821, 829, 1223, 1550; `MultiplayerGame.ts` 527 | Yes (defenses spotting you) |
| `lock` | One beep of the rocket lock tone | `MultiplayerGame.ts` 1241 (on `'Locked on'` alert) | Yes (rocket lock) |
| `launch` | A rocket left the rails | `Game.ts` 1567; MP 954, 1169 | Yes (part of lock / launch) |
| `hit` | Enemy fire struck the plane | `Game.ts` 1591; MP 1263 | Yes (being hit) |
| `collapse` | An installation was destroyed | `Game.ts` 1620, 1633; MP 1249 | Optional |
| `pop` | A rocket was shot down | `Game.ts` 1749; MP 1181 | Optional |
| `bandit` | An enemy fighter turned on the plane | `Game.ts` 1223, 1310 | Yes (bandit) |
| `raid` | An enemy bomber is heading to T1 | `Game.ts` 1389; MP 876, 1240 | Yes (raid incoming) |
| `crumple` | A paper plane was destroyed | `Game.ts` 1421; MP 1209 | Optional |
| `kill` | The player shot one down | `Game.ts` 949 (achievement), 1430; MP 1220 | Optional |
| `whoosh` | An aircraft flashing past | `Game.ts` 1204 | No |
| `ink` | A burst of ink fire nearby | `Game.ts` 1292; MP 1414 | Optional |
| `lockTone(dt, progress)` | Continuous lock tone while a launcher locks | `Game.ts` 1555; MP 1551 | Yes (rocket lock) |
| `combat(dt, level)` | Combat music layer | `Game.ts` 1212; MP 1549 | No |

Mute: `M` / menu Sound button; saved in SP settings (`settings.muted`), not saved in MP.
Several of these events already have a visual (lock warning, raid alert, threat notes, hit arc,
damage flash), but none is labelled as a sound cue.

---

## 8. Existing UI tests

Vitest runs in `environment: 'node'` (no jsdom / happy-dom installed), so no test renders DOM.

| Test file | UI coverage |
|---|---|
| `src/ui/loop.test.ts` | `reportText.ts` (failure text, paper breakdown, next step) and `dashboardView.ts` (summary, rebuild offer, priorities) |
| `src/input/input.test.ts` | "menu navigation and hints": `pickInDirection`, `stickDirection` / `NavRepeater`, `padHint`, control labels switching with the device; plus mapping and context tests for `Controls` |
| `src/progress/tutorial.test.ts` | Tutorial steps and their control labels (`setControlLabels`) |
| `src/render/graphics.test.ts` | Presets, default preset (`'high'`), outline choice and intensity, normalisation |
| `src/render/outline/outline.test.ts` | Outline renderer (removed with it) |
| `tools/ui-baseline.mjs` (`npm run ui:shots`) | Headless Chromium screenshots of single-player screens at plan §7 sizes and HUD S/M/L. Uses the Playwright installed on the machine, like `npm run measure` (not in `devDependencies`). |

No tests for: any DOM module, `FocusNav` beyond `pickInDirection`, `applyGlyphs`, `format.ts`,
`MiniMap`, MP HUD, Lobby, FeedbackForm.

---

## Risks and notes for phase 2

1. **Token scope.** Tokens live on `.hud`; elements on `document.body` (`.pad-tip`, LoadingScreen)
   cannot use them. Move the token source to `:root` (or a TS module that writes them) first.
2. **Canvas colours.** MiniMap uses Tailwind colours that disagree with the CSS tokens; `PALETTE`
   and `PLAYER_COLOURS` are separate again. The TS token module should be the one source for
   MiniMap, owner colours and markers.
3. **Missing tokens** the plan needs: objective orange, neutral grey, pill radius, flat elevation,
   motion set, focus ring, a type face (no web font is loaded), the tinted chip pairs.
4. **Focus is a class, not focus.** `FocusNav` works on the whole document by geometry. A new focus
   manager must keep "Enter / Space keep game meanings", the `KEY_ATTRS` re-identification after
   re-renders, and the pad tooltip, while adding keyboard arrows, focus restore and modal trapping.
   `textarea` (feedback form) is not navigable by pad today.
5. **Render-by-innerHTML.** Many modules rebuild markup by string compare (`dataset.html`). New
   components must survive that (or replace it) without losing focus or causing layout thrash.
6. **mp.css positions.** MP panels use absolute px offsets outside the zones and override SP rules
   (`.hud .dashboard`, `.mp-feed` twice); they ignore HUD size. Retiring mp.css (phase 5) means
   moving these into zones.
7. **Two-press confirms** stand in for dialogs; End sortie and Leave have no confirm. A Dialog
   component changes behaviour the tests and players rely on: keep the keyboard shortcuts.
8. **String coupling.** `'Locked on'` drives a sound; `<kbd>` text drives glyphs; button text is
   a FocusNav fallback key. Key these before moving text into a dictionary.
9. **Pad glyph gaps.** `PAD_CONTROLS` in the menu is Xbox-only text; titles like "Base (B)" never
   relabel; `KEY_TO_PAD` has no entry for U, X, Delete, digits.
10. **MP settings.** HUD size and hints are not saved or reflected in MP (`uiScale: 1`,
    `hints: 'auto'` hard-coded in `MpViews`). Fix while wiring the shared settings.
11. **Default preset test.** Switching the default to Medium breaks `graphics.test.ts:31`; removing
    outlines touches `GraphicsSettings` shape and its storage normalisation (keep old saves loading).
12. **No DOM test environment.** Component and focus tests (§11A) need `happy-dom` or `jsdom` added
    to `devDependencies`. `ui:shots` and `measure` use the Playwright installed on the machine.
13. **Out of scope screens.** LoadingScreen, Lobby redesign and settings screens are v0.0.17; still,
    they must not break when the token source moves. DevPanel and PerfOverlay can stay as they are.

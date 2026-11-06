# paperwars.io

Fold. Fly. Defend your desk.

paperwars.io is a browser game where you fly a paper plane over a giant classroom. Every desk is someone's territory, the pencils tower like trees, and rival bases are built out of cardboard. This system is the look and voice of everything around the flying: the HUD, the build menus, mission screens, lobbies and the marketing site.

The one idea behind all of it: **everything is made from things you'd find in a classroom.** Paper for surfaces, notebook rules for structure, pencil yellow for action, cardboard for anything you build, marker outlines for edges. When in doubt, ask "what would a kid make this out of?"

## Voice

Goofy, quick and a little bit cheeky, like a note passed across the room. Never grim, never military-serious, even though it's a war.

- **Short and active.** "Fold a scout", not "Construct a reconnaissance unit".
- **Classroom words over war words.** Paper (the currency), desks (territory), folding (building), raids, recess. "Base" and "bomber" are fine; "casualties" and "kill" are not. A plane is *shot down* or *crumpled*.
- **Name the risk plainly.** Every flight costs paper, so tell players what they stand to lose: "Crash and you lose 120 paper."
- **Numbers first in the HUD.** `1,240 paper`, `3 raiders`, `0:42`. Save jokes for loading screens and the `doodle` notes.
- **Sentence case** everywhere except `label` text (uppercase) and the name, which is always lowercase: **paperwars.io**.

| Do | Don't |
| --- | --- |
| Raid incoming! 3 bombers from Desk 4 | WARNING: HOSTILE AIRCRAFT DETECTED |
| Mission done. +300 paper | Objective accomplished. Reward: 300 units |
| Your Turret crumpled a fighter | Enemy unit destroyed |

## Visual foundations

### Colour

Two themes: **Daylight** (notebook paper on a wooden desk) and **Lights out** (chalkboard green for late-night sessions). Components use tokens only, so both themes come free.

- **Surfaces:** `paper-100` for the page, `paper-50` for raised cards, `desk-200` for sunken wells and the HUD tray.
- **Text:** `ink-900` for primary, `ink-600` for secondary. On any yellow, cardboard or pink fill use `graphite`, which stays dark in both themes.
- **Brand:** `pencil-400` is the action colour: primary buttons, the paper counter, selection. It always gets `graphite` text and a `shadow-press` edge in `pencil-600`.
- **Building:** `cardboard-400` fills bases, buildings and build slots; `cardboard-700` is for cardboard-coloured text and outlines on paper.
- **Signals:** `sky-500` means friendly or info (your planes, radar, focus), `raid-500` means danger (incoming raids, enemies, losses), `win-500` means success. Text on these fills uses `on-signal`.
- **Accent:** `eraser-300` sparingly, for rewards, "new" badges and the crumple flash.
- **Teams:** `team-1` to `team-8`, one for each of the up to eight players in a room. Some of them sit close in lightness, so a team is always shown with its desk number or crest pattern too, never colour alone.
- **Decoration:** `rule-300` and `margin-red` draw the notebook lines and margin on ruled panels. They're never used for text.

### Type

| Family | Face | Used for |
| --- | --- | --- |
| `display` | Lilita One | Titles, plane names, HUD numbers. Chunky, rounded, poster-like. |
| `body` | Nunito, 600 and 800 | Everything you read: briefs, stats, settings, labels. |
| `note` | Kalam | Hand-written hints and margin notes only. |

All three are free Google Fonts. Load them with:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@600;800&family=Kalam&display=swap">
```

The styles are `display-xl` (64px, one per screen), `display` (40px), `title` (24px), `counter` (28px, HUD numbers), `body` (16/24), `body-sm` (14/20), `label` (12px, 800, uppercase, 0.06em tracking) and `doodle` (18px Kalam). Never put numbers or controls in `doodle`.

### Shape and depth

The look is **neobrutalist**: flat colour, thick dark outlines and hard offset shadows with no blur, softened by rounded corners and the classroom palette.


- **Marker outlines.** Buttons and chips get a `stroke-line` (2px) border; cards, slots and panels get a 3px border in `ink-900` with a 5px hard shadow in the same colour.
- **Text never sits on cardboard or pencil-yellow fills** except inside small buttons and badges. Put names and stats on paper.
- **Hard shadows, no blur.** `shadow-press` under buttons, `shadow-card` under cards, `shadow-lift` for anything picked up or open. Things look like stacked paper, never glass. No gradients, no glow.
- **Soft corners.** `radius-md` (12px) for buttons and cards, `radius-lg` (20px) for dialogs and the HUD tray, `radius-pill` for counters and chips.
- **Notebook pages.** Mission briefs and patch notes are plain paper with one `margin-red` line on the left. Don't run notebook rules behind text: they hurt legibility.
- **Spacing** runs on a 4px base: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48.

### Motion

The game is meant to feel springy and rubbery, and the UI matches it.

- Buttons drop 2px on press (the shadow shrinks from 3px to 1px).
- Panels and cards come in with a quick overshoot, like paper flopping onto a desk: about 220ms, with a spring ease.
- Hits *crumple*: a short squash plus an `eraser-300` flash. Bombs *bounce*.
- Respect `prefers-reduced-motion`: swap springs for 120ms fades and drop the shakes.

### Accessibility

- Text pairs hold 4.5:1 in both themes (the token notes list the ratios). Focus rings are `stroke-focus` (3px) in `sky-500` with a 2px offset, and work the same for keyboard and controller.
- `raid-500` and `win-500` differ in lightness as well as hue, and every alert carries an icon and words, so status never relies on red versus green.
- Players use mouse and keyboard or a controller, so every control has a visible focus state and a tap target of at least 44px.

## Logo and iconography

- **Mark:** a folded white paper plane flying out of a pencil-yellow tile (`assets/Logos/mark.svg`), with cardboard and single-colour versions. The wordmark is live text: **paperwars.io** in Lilita One, all lowercase, in `ink-900`. The rules are in the Logos group's README.
- **Small UI icons: Lucide.** Every icon inside a control, label or HUD readout is a [Lucide](https://lucide.dev) icon, pinned to `lucide@0.460.0`, at 16 to 28px with a 2.5px stroke in the text colour (`currentColor`). In a web page: `<i data-lucide="plane"></i>` plus `lucide.createIcons()`; in React, `lucide-react` at the same version. The ones in use: `files` (paper), `plane`, `bomb`, `eye`, `swords`, `shield`, `factory`, `map`, `trophy`, `send`, `check`, `check-circle`, `arrow-up-circle`, `wrench`, `lock`, `plus`, `minus`.
- **Large icons:** the drawn set in `assets/Icons/` is a placeholder. It will be replaced by the Synty Military HUD pack for big icons (building, mission and event art).
- **Rank insignia:** soldier ranks (stripes, chevrons, stars) are planned for player levels and achievements; they'll get their own asset group.
- **Renders:** buildings and planes are shown as PNG renders from the Model Lab and Aircraft Lab, on a transparent background: every building at levels 1–3 (`assets/Buildings/`) and all eleven planes in paper, cardboard and grey (`assets/Aircraft/`). The flat plane silhouettes in `assets/Planes/` are for small top-down uses such as the minimap.
- **Patterns:** ruled paper, chalkboard, graph paper, corrugated cardboard and desk wood tiles (`assets/Patterns/`). Text goes on plain or ruled paper only.

## Components

The components here are CSS only (`components/bundle.css`, classes prefixed `pw-`), so they work in the game's HUD, a React menu or a plain web page. Icons and plane art come from the asset groups.

| Area | Components |
| --- | --- |
| Actions | **Button**: primary (pencil), secondary (paper), danger (raid) |
| HUD | **PaperCounter** (paper balance), **Meter** (health and folding timers), **RaidAlert** (radar warnings and results), **Minimap** (the classroom from above) |
| Build | **PlaneCard** (one of the eleven planes, with role, cost and stats), **BuildSlot** (a defence or building on your desk, levels 1 to 3) |
| Missions | **MissionCard** (a ruled brief with reward and risk), **ResultDialog** (home safe or crumpled) |
| Multiplayer | **TeamChip** (team colour, name, desk), **Scoreboard** (room standings) |
| Navigation and settings | **Tabs** (build menu sections), **Toggle** (on/off settings) |
| Status and onboarding | **Badge** (new, level, locked, enemy), **CoachMark** (a taped-on hint) |

A typical in-flight HUD: PaperCounter top-left, RaidAlert top-centre, Meter for your hull bottom-left, Minimap bottom-right. On your desk: Tabs over a grid of BuildSlots and PlaneCards.

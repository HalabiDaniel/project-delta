# UI rebuild (v0.0.16 UI layer)

The approved design canvas "paperwars.io screens" is the source of truth for layout. This page
lists what each old UI element became, what is new, and what could not be matched yet.

The rebuild changes the UI layer only. The changes outside it are small and listed at the end of
this page. Game logic, balance, the mission director, saving and networking behave as they did.

## Where things moved

| Old element | Where it is now | Code |
|---|---|---|
| Loading card on flat blue (system font) | Loading: the wooden desk, then the living scene; logo top left; a 420px panel with a segmented meter and one line | `Frontend` (`boot`), `LoadingScreen` (multiplayer page) |
| Boot straight into the desk | Boot → Login (or straight to the Main menu with a profile) → Main menu → Play solo setup → match | `src/ui/flow.ts`, `Frontend` |
| Welcome card on arrival | Main menu (nothing extra) | `Frontend` (`menu`) |
| "Home desk" dashboard panel | Top bar chips (paper, income, storage, defence status, active mission). Defences, radar and condition went to the Build-state chip, and the hangar contents to the Hangar drawer | `DeskHud` |
| Economy strip with Base / Logbook / Menu buttons | Top bar plus the dock (Build, Hangar, Missions). The 52px Menu button is on the far right | `DeskHud` |
| Floating FOLD SWIFT / LAUNCH button top right; the instruction box | One context button on the dock: Fold X · cost / Refit X / Launch / Take off | `DeskHud.mainButton` |
| Mission cards on the right, SWAP 3/3 | Missions drawer (Tab, 1–3). The reroll button is in the head, and each card shows one fit badge, the risk pips and the reward. The 12-letter compatibility strip and "Crash and you lose…" moved to the tooltip and Details | `DeskHud.renderMissions` |
| 11-plane strip at the bottom and the plane stat card bottom left | Hangar drawer (H, Q / E): a hero image, Speed / Hull / Ink / Bombs meters, Agility / Vision / Range chips and a 3-column plane grid. The plane on the runway gets a sky-blue outline | `DeskHud.renderHangar` |
| Base mode: overview pill, tray bottom left, inspector, Repair all and DONE buttons | Build state: the base chip in the top bar, a tray above the dock (Defence / Support / Economy), a 320px inspector at top right (Upgrade · cost, Repair, Sell) and 12px name tags on buildings. B or Esc leaves | `DeskHud` (build) |
| Objective card under the counter ("Fighter T5 +40 135 m") | Mission card (330px): the title, an icon checklist and the reward. The distance is on the world marker ("Target · 64 m") | `FlightHud.renderMission`, `WorldLabels` |
| Condition card (hull, range) + bottom-centre instruments (speed, altitude, boost, throttle) | Plane card (360px): name, role badge, Hull and Boost meters, and speed and altitude as big numbers with a throttle bar. A range warning chip appears only when range is low | `FlightHud` |
| Weapons card bottom right (ink, bomb pips) | Four 104px action tiles bottom centre: Ink · LMB, Bomb · RMB, Boost · Shift, Home · R | `FlightHud` |
| Pause chip top right; multiplayer net chips (players, clock, ping, room) | StatusBar (players, clock, Pause) in a 300px column with the kill feed under it | `FlightHud`, `MpHud` (feed restyled, max 4 rows) |
| Threat panel top centre | Hidden. Its facts are on the world markers and the mini-map, and the top-centre slot is kept for raids and the boundary | `hud2.css` |
| Raid alert | The alert slot (480px, top centre) | `RaidHud` |
| Small alerts ("Need paper", "Swapped") | Toasts: one line, an icon, 2.5 s. Critical alerts keep the priority queue | `HUD.alert`, `Toasts` |
| "Failed" / "Crumpled" strip | Toast | `FlightHud.watchStatus` |
| Sortie report | Result card (640px): a 56px icon, the status, a title of at most 4 words, one meta line, 4 tiles and one tip. The why, advice, paper lines, refit line and plane line are in Details | `ResultPanel` |
| Pause menu (settings columns, controls grid, sound, logbook, multiplayer buttons) | Pause (440px): Resume, Settings, Controls, and Leave match or Quit to main menu, plus one stats row | `PauseMenu` |
| Pause → settings rows | The Settings screen: tabs for Game, Sound, Accessibility, Controls and Account, plus Quick settings. It opens from the Main menu, or over the match from Pause | `SettingsScreen` |
| Pause → controls grid | Settings › Controls: a 2-column key map (Mouse & keyboard or Controller) and the controller tuning | `keymap.ts`, `SettingsScreen` |
| Logbook: records, achievements | Achievements screen (filters, progress, cards). Personal bests and career numbers are in Records | `Frontend` (`achievements`) |
| Logbook: session tab | Session drawer (L), with "View all achievements" | `PauseMenu.renderSession` |
| Logbook: base tab | The Build state (inspector stats) and the top-bar base chip | `DeskHud` |
| Logbook: paper ledger and per-plane mastery | Session drawer (paper earned and spent). The per-plane mastery table and the transaction list have no screen yet (see Gaps) | |
| Tutorial sticky note at the centre | CoachMarks: Kalam, ≤ 320px, anchored with an arrow, one sentence per step, Skip tutorial. The element each step explains gets a 3px focus ring | `CoachMarks`, `Tutorial.ts` texts |
| Developer "Mission director" panel (`` ` ``) | Unchanged | `DevPanel.ts` |

## New

- **Living desk scene** (`src/world/Showcase.ts`). It is a sample base that is not the player's: a
  Command Center, Workshop, Hangar, Storage, Turret, Radar, rocket launcher and a runway on a
  notebook sheet, with a rival's corner at the edge of the frame. Three planes fly slow loops, and
  a fourth waits on the runway, then rolls, lifts off and leaves on a 36 s loop.
  - The radar sweeps and the turrets scan. Doors, beacons and smoke come from the building rigs.
  - There are two camera presets: Login / Create account (desk in the left half) and Main menu
    (closer, from the other side, desk in the right half). The camera drifts slowly.
  - Reduced motion gives a still camera and slower planes. Shadows follow the Graphics setting.
- **Thumbnails.** While loading, the same rig photographs each plane and building once, for the
  card art. If a model is missing, the card shows its line icon instead.
- **Accounts** (`src/net/services.ts`).
  - Login, Create account and the guest profile are a local stub behind `AccountService`. A
    session or guest profile skips Login on the next visit.
- **Multiplayer screen.**
  - **Quick play.** This calls the real matchmaking route (`POST /sessions/quick` plus
    `GET /sessions`). It shows "Joining <classroom> · n/16" for 3 s, then opens the multiplayer
    client on that session (`?mp&session=<id>`).
  - **Host.** The room code is a local preview. Start match goes through matchmaking.
  - **Join.** "Join room" sends the code as the server's invite code.
- **Leaderboard and Credits screens.**
- **Settings additions.** Master volume (this computer's) and a Button prompts setting (Auto,
  Keyboard, Xbox, PlayStation or Generic). Text size now has 90%.
- **Keys.** H is the Hangar and Tab is Missions. Q / E and 1–3 open their drawers. L opens the
  session drawer. M is still Sound. Key hints are in Settings only. In multiplayer, holding Tab in
  flight still shows the scoreboard.

## Global rules (Part 2), where they live

| Rule | Where |
|---|---|
| 2px borders; 3px only for the primary CTA, the selected item and focus | `--stroke-card` is 2px and `--stroke-strong` is 3px (`tokens.ts`). `kit.css` |
| 4px shadows on panels, 3px on chips and buttons, none nested | `--shadow-hard`, `--shadow-chip`, `.pw-panel .pw-panel` |
| 12px radius on buttons, chips, cards and fields; 20px on panels and drawers; pills only for badges, segmented controls and toggles | `kit.css` |
| One safe margin, `clamp(16px, 2vw, 32px)`, from the window or the 16:9 box | `--m` in `hud2.css` (`--safe-w`, `--safe-x` from `layout.ts`) |
| Sizes from the 1440 × 900 frame, scaled by window × HUD size, never under 1 (text ≥ 12px) | `layout.ts` (`REFERENCE` 1440 × 900, `MIN_FIT` 1), `--k` |
| Type: Lilita for titles and numbers, Nunito 16 / 14 / 13 / 12, Kalam only in coach marks | `--f12` … `--f48` in `kit.css` |
| Motion: 150–200ms ease-out, 16px slide and fade; reduced motion is opacity only | `pw-in`, `pw-in-right`, `:root[data-motion='reduced']` in `kit.css` |

## Gaps: what could not be matched, and why

- **The Play solo setup is partly cosmetic.** Classroom, AI rivals, difficulty and team colour are
  remembered and shown in the summary. The solo world is generated as before, so these choices do
  not change it yet; that is game logic, and this task excluded it. The starting plane is applied.
- **Accounts and the leaderboard have no server yet.** Accounts stay in this browser and the
  password is stored scrambled, not secured; nothing is sent. Settings › Account says
  "This browser". Forgot password says resets arrive with online accounts. The leaderboard shows
  only the player's own row, with "Live rankings arrive with the next server update."
- **Private rooms, friends and regions are not on the server.** The server opens every session
  itself (`server/sessions/directory.ts`), so Host is a preview (badged), Friends is empty, and
  Region is a choice the server does not read yet.
- **There are no Move building, unlock levels or a "Home" autopilot in the game.** The build
  inspector offers Upgrade, Repair and Sell. Tray cards are disabled with a reason (no slot, not
  enough paper) instead of locked. The Home tile shows R, which still says "Rearm at T1" in flight.
- **Sound and music volume are one master volume.** The game has no separate music bus.
- **Language is not in Settings.** There is only English (the canvas shows a Language tab).
- **Some credits rows are missing.** The canvas has placeholder rows ([STUDIO NAME], composer,
  playtesters). Those are left out rather than shipped as placeholders. "three.js" is shown as
  PlayCanvas, which is what the game uses.
- **The per-plane mastery table and the paper ledger have no screen yet.** They were Logbook tabs.
  The data is still saved.
- **The threat panel is hidden in flight**, so that the top centre is only for raids and major
  events.

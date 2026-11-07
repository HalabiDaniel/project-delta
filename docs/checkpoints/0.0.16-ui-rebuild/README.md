# Screenshots for the v0.0.16 UI rebuild

These were taken in headless Chromium with SwiftShader, using a production build, on the Medium
graphics preset. See [../../UI_REBUILD.md](../../UI_REBUILD.md) for what moved where.

## Sets

| Prefix | What it covers |
|---|---|
| `1440x900-` | Every screen and state, at the design canvas frame |
| `1280x720-` | Every screen and state |
| `1920x1080-` | Every screen and state |
| `2560x1080-` | Ultrawide with the 16:9 HUD on |
| `modes-` | Lights out, colour-blind palette, high contrast, 130% text and reduced motion, all at once |

## Screens in each set

- **Menus:** `login`, `signup`, `menu`, `solo`, `mp-quick`, `mp-host`, `mp-join`, `leaderboard`,
  `achievements`, `credits`, `settings`, `settings-access`
- **Desk:** `desk-idle`, `desk-missions`, `desk-hangar`, `desk-build`, `desk-build-insp`,
  `desk-ready`, `pause-desk`
- **Flight:** `flight`, `flight-raid`, `result`, `result-details`, `pause-flight`

Not every set has every screen. The ultrawide set skips some menus and desk states, and the
`modes-` set covers a subset of each group.

## Automated checks

The walkthrough ran three checks on every shot:

- **Borders:** no panel border is wider than 2px, except on the primary call to action, the
  selected item and focus.
- **Flight centre:** no HUD element is inside the centre 40% of the screen in flight.
- **Margins:** every edge widget sits the same distance from the screen edge. That is 29px at
  1440 wide, 26px at 1280 and 32px at 1920 and above. On ultrawide it is measured from the
  centred 16:9 box.

The last run flagged two things. Both were fixed after these shots were taken:

- key caps (a 4px bottom edge and 11px text)
- the target diamond (3px)

The flight aim reticle keeps its 3px ring. It is a gameplay reticle, not a UI panel.

## Known artefacts of the setup

- The result card shows only after the crash timer is advanced by the script, because the crash
  effects make software rendering very slow.
- Some 2560x1080 and `modes-` shots show a dock or drawer frame caught mid-render.

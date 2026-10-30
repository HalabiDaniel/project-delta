# paperwars.io: v0.0.2, Flight and Mission Polish

v0.0.1 answered whether folding a plane, bombing T5 and getting paid could be fun. v0.0.2 turns that
prototype into a loop with choices in it. You pick one of three missions, fold or refit your plane,
fly it with livelier handling, and then **land it back home** to keep it for the next sortie. The
plan is in the [game design document](docs/GDD.md#17-development-roadmap).

It is still single-player and runs entirely in the browser (PlayCanvas + TypeScript, no backend).
There is no multiplayer, no AI and no territory management yet, on purpose.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests for the rules (missions, economy, state machine, landing, boost, boundary)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

The game needs a desktop browser with WebGL 2.

## What's new in v0.0.2

**Flight**
- **Bank-to-turn handling.** The plane rolls into a bank and its heading follows the bank, so turns
  have a little inertia and the wings level out by themselves when the turn is done.
- **Automatic levelling.** Leave the mouse alone for 1.5 s and a climb or dive eases back to level flight.
  This is switched off on the landing approach, so a steady descent holds.
- **Speed that responds to the air.** W and S set the throttle and the speed settles on it.
  Climbing costs a little speed and diving adds some.
- **Shift boost.** A short burst of +14 speed (up to 1.2 s), then a 3.5 s recharge. It works on top of W/S.
- **Dynamic chase camera.** It trails on a soft spring, leans gently into turns, and pulls back
  and widens as you speed up. There is no camera shake.
- **Trails.** Paper streamers stream off both wingtips, and faint wind streaks rush past at high
  speed and while boosting.
- **Landing.** The R recall is gone. To bring a plane home you land it on T1. A landing
  checklist appears on approach.

**Missions**
- **Three mission cards** at home, each a different type, one per difficulty (Easy ×1, Medium ×1.5, Hard ×2).
  Choose with the mouse or **1 / 2 / 3**. Your choice can change until you launch.
- **Seven mission types**, targeting any of T2 to T9 (see below).
- **Mission tracker** in the corner: objectives, distance to the current one, progress, and a timer when there is one.

**Planes and paper**
- **Folding animation.** A flat sheet folds in half along the centre crease, then its wings fold
  down. It takes about 2 seconds.
- **Plane preview.** A ghost of the plane turns above the launch pad before you fold it.
- **Home income.** T1 makes +1 paper every 2 s while you hold less than 150, so you can never get stuck.
- **Recovery.** A plane that lands safely waits in the hangar. Refitting it costs **5** instead of
  folding a new one for **20**.
- **Clear refusals.** When you can't afford a plane, the button is disabled and says why, and how
  long until home income covers it.

**World and feedback**
- **Wider gaps** between territories (30 m, up from 15). The world is 180 m across.
- **Bomb impacts.** A hit makes a paper burst, cartoon smoke puffs, a shock ring, an ink splat on the
  platform and a "BOOM!". A miss makes a smaller grey splat and a "SPLAT!".
- **Mission markers.** Target territories turn orange. Open objectives get a light beacon.
  Reconnaissance and delivery zones are shown as see-through volumes, and ring courses as paper hoops
  with the next one lit orange.
- **Mini-map.** A fixed top-down diagram in the bottom right with the boundary, the objectives, the
  rings, your plane and a guide line to the current objective.
- **World boundary.** Fly 190 m from the centre and a 5-second countdown starts. Turn back in time,
  or the autopilot turns you around and hands back control once you're well inside.
- **Gauges.** Speed (with a throttle mark), altitude, the boost meter and the bomb rack, showing how
  many bombs are left and whether one can be dropped now or is reloading.
- **Sortie report** after every landing or crash.

## How to play

1. At home on **T1** you have **100 paper** and three mission cards. Pick one.
2. Press **F** (or click **Fold Falcon**) to fold a plane for **20 paper**. Wait for the fold to finish.
3. Press **Space** to launch. The plane climbs out on its own, then it's yours. The mouse is captured while you fly.
4. Do the mission. The orange marker and the mini-map's dotted line point at the current objective.
5. **Land on T1** to keep the plane: come in **slower than 19**, **descending less than 5 m/s**,
   **wings level**. Hold S to slow down and line up with the runway (anywhere on top of T1 counts).
6. Press **R** (or **Continue**) on the sortie report. New mission cards are dealt. **Refit** your
   recovered plane for 5, or fold a new one for 20 if you lost it.

A mission pays as soon as its last objective is done. Landing is only required by Strike & return
missions, but it's how you avoid paying for a new plane.

### Missions

| Type | Objective | Notes |
|---|---|---|
| Bombing | Hit the bullseye on one of T2 to T9 | Easy and Medium carry a spare bomb |
| Precision bombing | Hit a small ink-blue spot placed off-centre on a territory | Radius 3 / 2.4 / 1.8 m by difficulty |
| Reconnaissance | Spend 3 / 4.5 / 6 s inside a territory's airspace, below 30 / 22 / 15 m | Time inside adds up; leaving doesn't reset it |
| Timed delivery | Reach a territory's airspace before the clock runs out | Less slack on harder difficulties; boost helps |
| Strike & return | Bomb a target, **then land on T1** | Paid on landing |
| Multi-target | Hit two bullseyes in one flight, in any order | 2 bombs, +1 spare unless Hard |
| Flight challenge | Fly through 4 / 5 / 6 paper rings in order, over the gaps | Hard has a time limit |

Reward = (type base + 0.15 paper per metre of distance) × difficulty multiplier, rounded to 5.

A mission **fails** when every bomb is gone with a target still standing, when the clock runs out,
when the plane is lost, or when you land before finishing. You can always land afterwards to
keep the plane.

### Controls

| Input | Action |
|---|---|
| Mouse | Steer: the ring shows where you're aiming; the plane banks and turns toward it |
| W / S | Throttle up / down |
| A / D | Assisted banking (turn without the mouse) |
| Shift | Boost (short burst, then recharge) |
| Left click | Drop a bomb |
| 1 / 2 / 3 | Choose a mission card (at home, until launch) |
| F | Fold a plane, or refit a recovered one |
| Space | Launch from T1 |
| R / Enter | Continue after landing or a crash |
| Esc | Pause / show controls |

### Economy

| Event | Paper |
|---|---|
| Starting resources | +100 |
| Fold a new plane | −20 |
| Refit a plane that landed safely | −5 |
| Home income (while below 150) | +1 every 2 s |
| Mission success | +reward on the card (about 35 to 200) |
| Failed mission, crash | +0 |

Building is refused when you can't afford it, so paper never goes negative. For playtesting,
`paperwars.state.resetPaper()` in the browser console restores the starting balance.

## Project structure

```
src/
  main.ts                 Boots the game; exposes `window.paperwars` for console debugging
  Game.ts                 Wires rules ↔ scene ↔ input ↔ HUD; runs the frame loop; builds the HUD view
  config.ts               Every tuning number (world, flight, boost, landing, missions, economy, camera, colours)

  world/
    Territory.ts          ID, position, owner, and box/sphere geometry queries
    WorldGenerator.ts     Lays out the 3×3 grid with gaps; builds platforms, runway, launch pad, lighting
    MissionMarkers.ts     Bullseyes, beacons, airspace volumes, ring hoops and target tints for a mission
    Effects.ts            Paper-scrap bursts, shock rings, cartoon puffs and ink splats

  aircraft/
    PlaneController.ts    Flight (bank-to-turn, auto-level, throttle and boost), touchdown and rollout, autopilot, crash
    Boost.ts              Boost timing: ready → active → cooldown
    Landing.ts            Whether a touchdown is a landing or a crash, and why
    Bomb.ts               Bomb pool; release, gravity, and swept collision against target zones and platforms
    ChaseCamera.ts        Desk view, dynamic follow view (lean, speed zoom, FOV), bomb cam, crash view
    FlightTrails.ts       Wingtip ribbons and wind streaks
    FalconModel.ts        Procedural paper fighter with the folding animation; paper-ball mesh
    HangarPreview.ts      The ghost plane turning above the launch pad

  missions/
    Mission.ts            Objectives (bomb, recon, reach, ring, land), progress, timer, success/failure
    MissionGenerator.ts   Mission cards: types, targets, ring courses, difficulty and rewards

  systems/
    GameState.ts          The rules: desk → building → ready → flying → landed | crashed, costs, bombs, rewards
    ResourceManager.ts    Paper balance; all costs and rewards go through it
    HomeIncome.ts         T1's paper trickle
    Boundary.ts           Airspace edge: warning countdown and autopilot hand-over
    Random.ts             Seeded random numbers (for repeatable tests)
    Input.ts              Keyboard (physical keys), mouse deltas, pointer lock

  ui/
    HUD.ts, hud.css       Paper, mission cards and tracker, gauges, landing checklist, banners, report, menus
    MiniMap.ts            The top-down navigation diagram
```

The rules (`GameState`, `Mission`, `MissionGenerator`, `ResourceManager`, `HomeIncome`, `Boost`,
`Landing`, `Boundary`) contain no rendering or input code, and all of them have unit tests. Mission
state is kept separate from aircraft state. A mission only learns facts like "a bomb hit
objective 2" or "the plane flew from A to B", which should make it straightforward to drive the
missions from a server later.

### Tuning

All provisional numbers are in [`src/config.ts`](src/config.ts). The ones most worth playtesting first:

- **Handling:** `PLANE.rollResponse` (turn inertia), `aimGain`, `maxTurnRate`, `autoLevelDelay` / `autoLevelRate`.
- **Landing difficulty:** `LANDING.maxSpeed`, `maxSink`, `maxRoll`.
- **Boost:** `BOOST.speed`, `duration`, `cooldown`.
- **Economy:** `ECONOMY.refitCost`, `incomeInterval`, `incomeCap`, and `MISSIONS.baseReward` / `difficulty` multipliers.
- **Mission difficulty:** bullseye and precision radii, recon times and ceilings, delivery slack, ring count and size.
- **Camera feel:** `CAMERA.rollFollow`, `speedDistance`, `speedFov`, `boostFov`.

## Decisions worth knowing

These are judgment calls where the plan left room:

- **No recall at all in flight.** R in the air only reminds you to land. A plane that is lost (crash,
  void, hard landing) is gone. After a crash or landing, R continues to the next sortie.
- **Landing is generous about where.** Anywhere on top of T1 counts. The runway is guidance. During
  the rollout the plane brakes hard at the platform's rim instead of rolling off. Coming down on any
  other territory is a crash.
- **Landing ends the sortie.** Landing before the mission is done counts as abandoning it (+0), but
  the plane is still recovered. Rewards for other mission types don't depend on getting home.
- **Recovered planes are refitted, not reused for free.** The refit (5) re-arms and re-creases the
  plane. Unused bombs aren't carried over, because each mission sets its own load.
- **Bombs come with the mission.** Missions without bombing objectives carry none. Easy and Medium
  bombing missions carry one spare. A miss only fails the mission once no bombs are left.
- **Boundary: autopilot, not destruction.** Running out the countdown never costs the plane. The
  autopilot cruises home at 22 m until the plane is 35 m back inside, then hands back control.
- **Income has a cap.** It pauses at 150 paper so idling isn't a strategy. It exists to stop the
  player getting stuck.
- **Three cards, one per difficulty, different types.** There is always a safe option and a
  lucrative one. New cards are dealt after every sortie, whether it succeeded or not.
- **Ring courses follow the gaps.** Rings sit over the gaps and gap crossings, 35 m apart, and the
  course never turns twice in a row, so every ring can be reached with a comfortable turn.
- **Mini-map orientation.** It is fixed rather than rotating: home bottom left, launch heading up
  right. It is a rotation of the world, not a mirror image, so left and right match the 3D view.
- **The bomb rack is hidden on the ground.** Bombs are loaded at take-off, so they don't clutter the folding animation.

## Definition of done (v0.0.2)

| Requirement | Status |
|---|---|
| Smooth banking, turning inertia, automatic levelling | ✅ |
| Chase camera that leans into turns and pulls back at speed, without shake | ✅ |
| Land at T1 to recover the plane; auto-return removed | ✅ |
| Wingtip trails and wind streaks | ✅ |
| Shift boost with a cooldown, on top of W/S | ✅ |
| Random targets T2 to T9 | ✅ |
| Three mission cards at home | ✅ |
| Reconnaissance, precision bombing, timed delivery, strike & return, multi-target, ring challenge | ✅ |
| Folding animation (~2 s), plane preview above home | ✅ |
| Home paper income | ✅ |
| Difficulty multipliers on rewards | ✅ |
| Plane recovery (refit instead of a new plane) | ✅ |
| Disabled Build button with a reason | ✅ |
| Impact effects (paper burst, ink splash, cartoon explosion) | ✅ |
| Mini-map | ✅ |
| World boundary with a warning and countdown | ✅ |
| Wider gaps between territories | ✅ |
| Mission tracker, distance to objective, bomb availability indicator | ✅ |

The rules are covered by unit tests (`npm test`). Full sorties were flown in headless Chromium by
a scripted pilot that uses the game's own controls (the aim, real key events, the drop action). It
flew a bombing run with boost, a hit and a landing, then a refit at the desk. It also flew a ring
course, reconnaissance, strike & return, a timed delivery, a boundary warning with an autopilot
recovery, a crash into the void, a hard landing, and a broke player waiting on income.

**Still unproven: how it *feels*.** Headless Chromium can't judge handling. Playtest these first:
the turn inertia (`rollResponse`), how forgiving landing is, and whether the boost and the camera
pull-back sell speed.

## Next milestone

Per the [roadmap](docs/GDD.md#17-development-roadmap): **v0.0.3, aircraft variety.** Fighter,
bomber and reconnaissance patterns with different costs and handling. The mission cards and the
fold animation are built to take more than one plane.

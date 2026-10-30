# paperwars.io: v0.0.1, First Bombing Run

The first playable prototype from the [game design document](docs/GDD.md). It exists to answer one
question: **is folding a paper plane, flying it to an enemy territory, dropping a bomb and getting
paid for it fun?**

It is single-player and runs entirely in the browser (PlayCanvas + TypeScript, no backend). It has
one plane, one bomb, one mission and one resource. There are no accounts, saving, AI, aircraft
selection or mission director.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests for the rules (economy, mission, state machine, collisions)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

The game needs a desktop browser with WebGL 2.

## How to play

1. You start at home on **T1** (blue) with **100 paper**. The mission card offers
   **Bomb Territory T5** for **+50 paper**.
2. Click **Fold Plane** (or press **F**) to spend **20 paper**. A paper plane folds itself on the launch pad.
3. Press **Space** to launch. The plane climbs out on its own, then it's yours. The mouse is captured
   while you fly.
4. Fly across the gaps to the orange square, **T5**. Line up on the red-and-white bullseye in its centre.
5. **Left-click** to drop your single paper-ball bomb. The ball keeps the plane's forward speed, so
   release it before you are over the target. Your plane's shadow helps you judge the drop.
6. Only a hit on the bullseye counts: **Bombing Successful! +50 Paper**. Landing anywhere else is a miss.
7. Press **R** to return to T1, or keep flying. Each fold is good for one sortie, so fold a new plane
   to go again.

Fall into the void or fly into a platform and the plane is lost: no reward, press **R** to go home.

### Controls

| Input | Action |
|---|---|
| Mouse | Steer: the ring shows where you're aiming; the plane turns toward it |
| W / S | Speed up / slow down |
| A / D | Assisted banking (turn without the mouse) |
| Space | Launch from your territory |
| Left click | Drop the bomb |
| R | Return to T1, or restart after a crash |
| F | Fold a plane (at home) |
| Esc | Pause / show controls |

### Economy

| Event | Paper |
|---|---|
| Starting resources | +100 |
| Fold a plane | −20 |
| Successful bombing mission | +50 |
| Failed mission, crash, or return without success | +0 |

A successful sortie nets +30. Folding is refused when you can't afford it, so paper never goes
negative. **Reset paper to 100 (dev)** on the home screen restores the starting balance for
playtesting.

## Project structure

```
src/
  main.ts                 Boots the game; exposes `window.paperwars` for console debugging
  Game.ts                 Wires rules ↔ scene ↔ input ↔ HUD; runs the frame loop
  config.ts               Every tuning number (world scale, flight feel, economy, camera, colours)

  world/
    Territory.ts          ID, position, owner, target flag, and box/sphere geometry queries
    WorldGenerator.ts     Lays out the 3×3 grid with gaps; builds platforms, bullseye, launch pad, lighting
    Effects.ts            Paper-scrap bursts and shock rings for hits, misses, crashes and folding

  aircraft/
    PlaneController.ts    Flight (mouse-aim steering, throttle, banking), launch, crash detection
    Bomb.ts               Release, gravity, and swept collision against the bullseye and platforms
    ChaseCamera.ts        Desk view, smooth chase view, and the camera lift that follows a falling bomb
    FalconModel.ts        Procedural low-poly paper fighter (stand-in for falcon.glb) and paper-ball mesh

  missions/
    BombingMission.ts     Mission state: available → active → succeeded | failed

  systems/
    ResourceManager.ts    Paper balance; all costs and rewards go through it
    GameState.ts          The rules: desk → ready → flying → crashed, what each step costs and pays
    Input.ts              Keyboard (physical keys), mouse deltas, pointer lock

  ui/
    HUD.ts, hud.css       Paper, mission card, flight readout, target marker, banners, pause menu
```

The rules (`GameState`, `BombingMission`, `ResourceManager`) have no rendering or input code, and
mission state is kept separate from aircraft state, as the brief asks. That separation is what
should make multiplayer and more mission types easier to add later.

### Tuning

All provisional numbers are in [`src/config.ts`](src/config.ts). The world uses the suggested
**40 × 40 territories with 15-unit gaps**, so T1 to T5 is about 84 m, roughly a 5-second flight at
cruise speed. Flight feel is mostly `PLANE.aimGain`, `maxTurnRate` and `mouseSensitivity`. Drop
difficulty is mostly `WORLD.targetRadius` and `BOMB.gravity`.

### The plane model

The brief lists `public/models/falcon.glb`. Until that model exists, `FalconModel.ts` builds a
temporary one in code: two dozen flat-shaded triangles with a raised central fold, swept wings, a
keel and two canted blue tails. To switch to the Blender model later, load the GLB as a container
asset and swap it in for the entity returned by `createFalcon()`.

## Decisions worth knowing

These are judgment calls where the brief left room:

- **Mouse-aim steering.** The mouse moves an aim ring and the plane turns toward it at a limited
  rate, banking as it goes. Moving the mouse right turns right, moving it up climbs, and leaving it
  still flies straight. The aim can't lead the nose by more than 50°.
- **One sortie per fold.** Returning home (R) uses up the plane, so another run costs another 20
  paper, matching the "fold a replacement plane" step. Returning before a hit counts as a failure
  with +0.
- **Crash rules.** A crash fails the mission if it is still unresolved, even when a bomb is already
  falling ("crashing loses the aircraft without rewarding the player"). A crash *after* a
  successful hit keeps the reward.
- **R while the bomb is falling** waits for the bomb to land before going home, so the hit still counts.
- **Artificial lift.** The plane doesn't sink on its own; it only goes where it is pointed. A soft
  ceiling at 70 m keeps it near the world.
- **Pausing.** If the mouse capture is lost mid-flight (Esc, alt-tab), the game pauses. Click to
  resume. If the browser refuses mouse capture (e.g. inside some iframes), steering still works
  while the cursor stays in the window.

## Definition of done (v0.0.1)

| Requirement | Status |
|---|---|
| Opening the game in a desktop browser loads the 3D world | ✅ |
| Nine square territories are visible, separated by gaps | ✅ |
| The player starts on T1 with 100 paper | ✅ |
| Folding the plane costs 20 paper | ✅ |
| The plane launches and is controlled from a third-person perspective | ✅ |
| The player can fly across the gaps to T5 | ✅ |
| Clicking drops one bomb | ✅ |
| Hitting the designated target on T5 completes the mission | ✅ (bullseye only, not the whole platform) |
| Successful completion awards 50 paper, exactly once | ✅ |
| Crashing loses the aircraft without rewarding the player | ✅ |
| The player can restart and repeat the loop without reloading the browser | ✅ |
| The paper total never becomes negative | ✅ |

The rules are covered by unit tests (`npm test`). The full loop was played end to end in headless
Chromium: fold, launch, steer, drop with a real click, hit, return, crash into the void and into a
platform, miss, run out of paper, reset and pause.

**What's still unproven: whether it *feels* good.** That needs real hands on a mouse. Playtest
the turn rate, speed range and bullseye size first.

## Next milestone

Per the brief: once this loop is fun, add a second player who can launch a fighter to intercept the
bombing run. See the roadmap in [docs/GDD.md](docs/GDD.md#17-development-roadmap).

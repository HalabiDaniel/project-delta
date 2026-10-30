# paperwars.io: v0.0.3, Aircraft Variety and Combat Foundations

v0.0.2 gave the loop choices: three missions, livelier flight, landing to keep your plane. But every
sortie was flown in the same plane. v0.0.3 makes **the plane a decision**. There are four paper
aircraft with their own handling, health, range, guns and bomb racks, a garage at home that says
how well each one suits the mission you picked, and the first combat systems: ink guns, health,
collision damage, destructible practice targets and props. The plan is in the
[game design document](docs/GDD.md#17-development-roadmap).

It is still single-player and runs entirely in the browser (PlayCanvas + TypeScript, no backend).
There is no multiplayer and nothing shoots back yet, on purpose: the practice targets are static
objects with health, built to test aiming and damage before other players arrive.

## Run it

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests for the rules (aircraft, combat, missions, economy, state machine, career stats)
```

```bash
npm run build      # typecheck + production build into dist/
```

```bash
npm run preview    # serve the production build
```

The game needs a desktop browser with WebGL 2.

## What's new in v0.0.3

**Four aircraft** (stats and costs are first balancing guesses, all in [`src/config.ts`](src/config.ts))

| Aircraft | Role | Cost | Refit | Health | Range | Guns | Bombs | Feel |
|---|---|---|---|---|---|---|---|---|
| Dart | Recon | 10 | 3 | 45 | 2.6 km | 1 light, 40 ink | 1 mini | Quick to accelerate, fast, fragile |
| Falcon | Fighter | 25 | 6 | 100 | 1.6 km | 2, 120 ink | 1 | The tightest turns and the heaviest guns |
| Swift | Multipurpose | 30 | 7 | 110 | 1.9 km | 2, 80 ink | 2 | Balanced; flies like the 0.0.2 Falcon |
| Widewing | Bomber | 40 | 10 | 150 | 1.3 km | 1, 50 ink | 4 | Slow, heavy, rolls into turns lazily |

- **Each one flies differently.** Every flight number (speed range, acceleration, turn and roll
  response, pitch rate, boost, collision size) comes from the design's `FlightProfile`. The flight
  controller has no plane-specific code, so a new plane is a new data entry plus a shape.
- **Own models.** Four folded-paper shapes (a schoolroom dart, the Falcon fighter, a canard delta
  and a broad glider with wingtip plates), each in its own accent colour, all with the fold animation.
- **Garage at home.** Four plane cards along the bottom: cost (or refit price, or "free" for a
  stowed plane), what waits in the hangar and its condition, and a suitability badge for the chosen
  mission. Choose with **Q / E** or a click.
- **Inspector.** The chosen design's 1–5 ratings (speed, agility, durability, range, payload,
  firepower), its loadout, and why it suits (or doesn't suit) the chosen mission. The blueprint
  ghost above the launch pad shows the same plane; **drag it with the mouse to turn it**.
- **Suitability on every mission card.** A chip per plane: *Recommended*, *Good fit*, *Possible* or
  *Can't fly it*. Only a missing capability rules a plane out: a rack with fewer bombs than the
  mission has targets. Everything else is advice, so a Dart bombing run or a Widewing ring course
  stays open.
- **Bomb racks.** A mission offers bombs (one per target plus spares on Easy and Medium); a plane
  carries as many as its rack holds. A Falcon on an Easy bombing run gets 1 of 3, a Widewing all 3.
- **Range.** Flying uses it up. At zero the plane can only glide: no climbing, no boost, throttle
  capped at cruise. From normal heights that is enough to glide home and land.

**Weapons and damage**
- **Ink guns.** Hold **left-click** to fire ink rounds along the nose. Wing guns converge 45 m
  ahead; rounds have a speed, a range and a small splat where they land.
- **Bombs moved to right-click.** R now rearms (see below); Enter continues.
- **Health.** Planes take damage from collisions and rough landings (and from ink and blasts, which
  nothing aims at the player yet). At zero the plane crumples into a ball and bursts into paper.
- **Damage you can see.** Ink blots spread over the paper, the folds crumple, and below 60% health
  the plane trails a smudge of ink. Below 40% it rolls more lazily and its wings wobble.
- **Collisions hurt by how hard you hit.** Damage depends on the speed straight into the surface:
  scraping a platform top or brushing a prop is free, a glancing hit costs some, and head-on into a
  platform at cruise wrecks any plane. The plane is pushed clear and deflected, so a survivable hit
  doesn't end the sortie. Paper and cardboard give way: flying into a practice plane costs 40% of
  that, a crate stack 75%, and the obstacle takes a beating too.
- **Landings are graded.** Inside the limits it's a landing. Slightly outside, the plane bounces
  back up with some damage and can go around. Steep, fast or banked touchdowns can wreck it.
- **Target range.** Every unclaimed territory has three practice planes on pencil stands (one of
  each other design, labelled *Practice Falcon · Fighter dummy* and so on), a stack of cardboard
  crates and a standing target board. Guns, bombs (with blast damage) and ramming all damage them.
  Destroyed ones fold themselves back up after 45 s, and everything is restored between sorties.
- **Feedback.** An X flashes on the nose reticle for each hit (bigger for a kill), damage numbers
  jump off the target, labels show name, role and a health bar, and the screen edges flash red when
  your plane is hurt.

**Missions, ground crew and reports**
- **Target practice** missions: shoot down 2 or 3 practice planes on one territory (Hard is timed).
  The goal marker points at the nearest one and orange rings mark the ones still to hit.
- **Landing no longer ends the sortie.** On the ground at T1: **R** rearms ink and range for free
  (bombs come with the mission), **Space** takes off again, **Enter** ends the sortie. An unfinished
  mission keeps running (and its clock ticks) until you end the sortie.
- **Stowing.** Switching planes while one waits on the pad stows it in the hangar, ready to roll out
  later for free. Recovered planes wait there for a (cheaper) refit, which also repairs them.
- **Sortie report:** aircraft used and its fate, mission result, time taken, damage dealt (and
  targets destroyed), bombing accuracy, ink accuracy, paper spent, paper earned and the net change.
- **Career stats** in the top-left panel, kept in this browser's local storage: missions
  completed, planes lost, targets destroyed and favourite plane (most sorties). The last chosen plane
  is remembered too.

## How to play

1. At home on **T1** you have **100 paper**, three mission cards and the garage. Pick a mission
   (**1 / 2 / 3**) and a plane (**Q / E**); the chips on each card and the badges on each plane say
   what fits.
2. Press **F** to fold it (or refit a recovered one, or roll out a stowed one).
3. Press **Space** to launch. The mouse is captured while you fly.
4. Do the mission: **right-click** drops a bomb, **hold left-click** fires ink. The orange marker
   and the mini-map's dotted line point at the current objective.
5. **Land on T1**: slower than 19, descending less than 5 m/s, wings level. Then **R** to rearm,
   **Space** to take off again, or **Enter** to end the sortie and read the report.
6. **Enter** (or **Continue**) on the report deals new mission cards.

A mission pays as soon as its last objective is done. Landing is only required by Strike & return
missions, but it's how you avoid paying for a new plane.

### Missions

| Type | Objective | Best fit |
|---|---|---|
| Bombing | Hit the bullseye on one of T2 to T9 | Widewing |
| Precision bombing | Hit a small ink-blue spot placed off-centre (kept clear of props) | Widewing, Swift |
| Reconnaissance | Spend 3 / 4.5 / 6 s inside a territory's airspace, below 30 / 22 / 15 m | Dart |
| Timed delivery | Reach a territory's airspace before the clock runs out | Dart |
| Strike & return | Bomb a target, **then land on T1** | Widewing |
| Multi-target | Hit two bullseyes in one flight, in any order (needs a 2-bomb rack) | Widewing |
| Flight challenge | Fly through 4 / 5 / 6 paper rings in order, over the gaps | Falcon, Dart |
| Target practice | Shoot down 2 / 3 / 3 practice planes on one territory (Hard is timed) | Falcon |

Reward = (type base + 0.15 paper per metre of distance) × difficulty multiplier, rounded to 5.
Bombs offered = one per target, plus 2 spares on Easy and 1 on Medium.

A mission **fails** when every bomb is gone with a target still standing, when the clock runs out,
when the plane is lost, or when you end the sortie before finishing.

### Controls

| Input | Action |
|---|---|
| Mouse | Steer: the ring shows where you're aiming; the plane banks and turns toward it |
| Left click (hold) | Fire ink guns |
| Right click | Drop a bomb |
| W / S | Throttle up / down |
| A / D | Assisted banking (turn without the mouse) |
| Shift | Boost (short burst, then recharge) |
| R | Rearm ink and range (landed at home only) |
| 1 / 2 / 3 | Choose a mission card (at home, until launch) |
| Q / E | Choose a plane (at home); with a plane on the pad, stows it first |
| Drag (at home) | Turn the plane preview |
| F | Fold, refit or roll out the chosen plane |
| Space | Launch from the pad, or take off again after landing |
| Enter | End the sortie after landing / continue from the report |
| Esc | Pause / show controls |

### Economy

| Event | Paper |
|---|---|
| Starting resources | +100 |
| Fold a new plane | −10 / −25 / −30 / −40 |
| Refit a recovered plane (and repair it) | −3 / −6 / −7 / −10 |
| Roll out a stowed plane | 0 |
| Rearm ink and range after landing | 0 |
| Home income (while below 150) | +1 every 2 s |
| Mission success | +reward on the card (about 35 to 200) |
| Failed mission, crash | +0 |

Paper is still the only resource; ink is not a currency. For playtesting,
`paperwars.state.resetPaper()` in the browser console restores the starting balance.

## Project structure

```
src/
  main.ts                 Boots the game; exposes `window.paperwars` for console debugging
  Game.ts                 Wires rules ↔ scene ↔ input ↔ HUD; runs the frame loop; builds the HUD view
  config.ts               Every tuning number, including the aircraft catalog (AIRCRAFT)

  aircraft/
    Aircraft.ts           1–5 ratings from the specs; mission suitability and bomb loads
    PlaneShapes.ts        The four folded-paper shapes, bomb slots and gun muzzles (data only)
    PlaneModel.ts         Foldable paper plane mesh: fold animation, crumpling and ink blots
    PlaneController.ts    Flight from the chosen FlightProfile, collisions that deflect, touchdown and rollout
    Boost.ts              Boost timing: ready → active → cooldown
    Landing.ts            Whether a touchdown is within the landing limits, and why not
    Bomb.ts               Bomb pool; release, gravity, and swept collision against props, target zones and platforms
    ChaseCamera.ts        Desk view, dynamic follow view (lean, speed zoom, FOV), bomb cam, crash view
    FlightTrails.ts       Wingtip ribbons, wind streaks and the damaged plane's ink smudge
    HangarPreview.ts      The blueprint ghost of the chosen plane above the launch pad, draggable

  combat/
    Collision.ts          Spheres and turned boxes: contacts, swept segments, distances
    Damage.ts             Health; impact, rough-landing and blast damage; damaged handling
    Gun.ts                Ammunition, rate of fire, alternating barrels
    Projectiles.ts        Ink rounds: swept hits on targets and platforms, and their pool
    Destructibles.ts      Practice targets and props: layout per territory, health, respawning

  missions/
    Mission.ts            Objectives (bomb, recon, reach, ring, land, destroy), progress, timer, success/failure
    MissionGenerator.ts   Mission cards: types, targets, ring courses, difficulty and rewards

  systems/
    GameState.ts          The rules: garage and hangar, fold/refit/roll-out, launch, weapons, health,
                          range, land → rearm → take off → end sortie, rewards, the sortie log
    LocalStats.ts         Career numbers in local storage (survives missing or blocked storage)
    ResourceManager.ts    Paper balance; all costs and rewards go through it
    HomeIncome.ts         T1's paper trickle
    Boundary.ts           Airspace edge: warning countdown and autopilot hand-over
    Random.ts             Seeded random numbers (for repeatable tests)
    Input.ts              Keyboard (physical keys), mouse buttons and deltas, pointer lock

  world/
    Territory.ts          ID, position, owner, and box/sphere geometry queries
    WorldGenerator.ts     Lays out the 3×3 grid with gaps; builds platforms, runway, launch pad, lighting
    TargetRange.ts        Draws the practice planes, crates and boards, with hits, wear and rebuilding
    MissionMarkers.ts     Bullseyes, beacons, airspace volumes, ring hoops, practice target rings, target tints
    Effects.ts            Paper bursts, shock rings, cartoon puffs, ink splats and specks, tumbling wrecks

  ui/
    HUD.ts, hud.css       Paper and career, mission cards and tracker, gauges, aircraft status, ground crew,
                          report, target labels, hit markers, damage numbers, banners, menus
    Garage.ts             Plane cards and the inspector
    MiniMap.ts            The top-down navigation diagram
    dom.ts                Small DOM helpers
```

The rules (`GameState`, `Mission`, `MissionGenerator`, `Aircraft`, everything in `combat/` except
the projectile pool, `ResourceManager`, `HomeIncome`, `LocalStats`, `Boost`, `Landing`, `Boundary`)
contain no rendering or input code, and all of them have unit tests. The game reports facts to the
rules ("this round hit target T4-d2 for 7", "the plane flew from A to B", "it hit T5 at 9 m/s") and
the rules decide what they mean, which should make it straightforward to move them to a server later.

### Adding a plane

1. Add an entry to `AIRCRAFT` in `src/config.ts` (and its id to `AircraftId` and `AIRCRAFT_ORDER`).
2. Add a shape to `PLANE_SHAPES` in `src/aircraft/PlaneShapes.ts` with at least as many muzzles as
   barrels and bomb slots as its rack holds.

The flight controller, garage, ratings, suitability, HUD and practice range pick it up from there.

### Tuning

All provisional numbers are in [`src/config.ts`](src/config.ts). The ones most worth playtesting first:

- **How different the planes feel:** each `AIRCRAFT[id].flight` (`rollResponse`, `maxTurnRate`,
  `speedResponse` are the big three), plus `maxHealth`, `range`, `gun` and `bombs`.
- **Collision and landing damage:** `DAMAGE.safeImpactSpeed`, `impactDamage`, `roughLanding`, `bounce`.
- **Damaged handling:** `DAMAGE.handlingThreshold`, `handlingFloor`, `wobble`.
- **Practice targets:** `TARGETS.dummyHealth`, `dummyRadius` (how forgiving aiming is), `dummySolidRadius`
  and `hardness` (how much flying into them hurts), `respawnTime`.
- **Suitability badges:** `SUITABILITY.weights` per mission type, and the `recommended` / `good` cut-offs.
- **Economy:** plane `cost` / `refitCost`, `MISSIONS.spareBombs`, rewards.

## Decisions worth knowing

These are judgment calls where the plan left room:

- **Landing pauses the sortie instead of ending it.** That is what makes "R: rearm, only when
  landed at home" meaningful, and it is how a fighter will work in multiplayer: land, rearm, go
  back. Ending the sortie is a separate step (Enter), and it abandons an unfinished mission.
- **Rearming refills ink and range, not bombs.** Bombs still come with the mission, so the
  out-of-bombs failure and the difficulty spares keep their meaning. Rearming is free and doesn't
  repair the plane; repairs come with the refit at the desk.
- **Range exists so the "range" rating tells the truth.** It is deliberately soft: an exhausted
  plane glides (about 5° down), which from normal heights reaches home.
- **Only impossibility blocks a combination.** Folding (and launching) is refused only when the rack
  can't hold a bomb per target; the badges advise on everything else. If you switch the card to an
  impossible mission after folding, the launch is refused until you switch back or pick another plane.
- **A sixth rating, firepower,** sits next to the five requested, because guns are what the Falcon
  is for. All ratings are computed from the specs over fixed ranges, never typed in by hand.
- **One new mission type.** Target practice gives the guns and the fighter a mission to be
  recommended for; the other mission types are unchanged apart from bomb spares (Easy now offers 2)
  so a big rack matters.
- **Collisions deflect.** Instead of instantly destroying the plane, a hit pushes it clear and turns
  it away from the surface, with damage by closing speed. Very hard hits still destroy it outright.
- **Targets are easy to hit and fair to fly past.** Ink and bombs use a generous sphere around each
  practice plane, but a plane only collides with a shape about the size of the visible model.
- **Nothing shoots at the player yet.** Projectile and blast damage to aircraft go through the same
  health model and are unit-tested, but there are no AI gunners, as planned. The practice range is
  for aiming.
- **Targets come back.** Destroyed practice planes and props fold back up after 45 s and everything
  resets between sorties, so the range is always usable. A target practice objective counts each
  practice plane once.
- **Stowed planes keep their price.** Switching planes on the pad stows the folded one for free; the
  paper spent is charged to whichever sortie eventually flies it, so the report's net change stays honest.
- **Bombs moved to the right button.** Left fires guns, right drops bombs, as asked, and consistent
  with the controls planned for multiplayer. Continue moved from R to Enter.

## Definition of done (v0.0.3)

| Requirement | Status |
|---|---|
| Dart, Falcon, Widewing, Swift with own models, costs, performance and capacity | ✅ |
| Aircraft-specific flight characteristics, data kept separate from the flight controller | ✅ |
| Selection screen: browse, rotate the model, stats, costs, select | ✅ |
| Suitability shown per mission, without blocking possible combinations | ✅ |
| Aircraft-specific payload; incompatible missions need a compatible plane | ✅ |
| Simple 1–5 ratings for speed, maneuverability, durability, range, payload (+ firepower) | ✅ |
| Ink guns on left-click: limited range, speed, impact effect | ✅ |
| Left-click primary, right-click bomb, Shift boost, R rearm only when landed at home | ✅ |
| Ammunition per aircraft on the HUD, rearmed at home, no ink economy | ✅ |
| Aircraft health from projectiles, collisions and rough landings | ✅ |
| Visual damage: ink marks, crumpling, a trail, harder handling | ✅ |
| Playful destruction: crumples into a ball, bursts into paper | ✅ |
| Destructible practice targets on unclaimed territories | ✅ |
| Collision damage by impact speed; slow contacts and proper landings forgiving | ✅ |
| Labels with names and roles over target aircraft | ✅ |
| Damage numbers, hit markers, target health indicators | ✅ |
| Destructible cardboard props damaged by guns and bombs | ✅ |
| Garage at home, as part of the existing construction UI | ✅ |
| HUD: health, ammunition, equipped weapon, bomb inventory, with resources and mission tracking | ✅ |
| Mission report: aircraft, result, time, damage dealt, bombing accuracy, paper spent/earned/net | ✅ |
| Local stats: missions, planes lost, targets destroyed, favourite aircraft | ✅ |

The rules are covered by unit tests (`npm test`). Full sorties were flown in headless Chromium by a
scripted pilot that steers through the aim (as the mouse does) and presses real key and mouse-button
events: target practice in a Falcon with two practice planes shot down, a landing, a rearm, a
take-off and a second landing, then the report; and the other scenarios listed in the pull request.

**Still unproven: how it *feels*.** Headless Chromium can't judge handling. Playtest these first:
whether the four planes feel distinct enough (especially the Widewing's inertia), how forgiving
collision damage is, and whether practice planes are too easy or too hard to hit.

## Next milestone

Per the [roadmap](docs/GDD.md#17-development-roadmap): **v0.0.4, core multiplayer.** Two or more
players sharing a world. The practice planes, labels, health and ink rounds are built so other
players' planes can take their place.

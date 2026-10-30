# paperwars.io: v0.0.4, Automated Territory Defenses

Through v0.0.3 the world never fought back: you picked a plane, flew to a territory, dropped a bomb
and collected the reward. v0.0.4 makes **the world react**. Territories now have threat levels and
the defenses to match: ink turrets, paper rocket launchers and radar stations that notice you,
turn towards you, lead their shots and fire. You approach carefully, deal with the defenses or slip
past them, do the job, and get out. Six new mission types are built around them, rewards follow the
danger, and warnings make every hit readable. The plan is in the
[game design document](docs/GDD.md#17-development-roadmap).

It is still single-player and runs entirely in the browser (PlayCanvas + TypeScript, no backend).
There is no multiplayer and no AI aircraft yet, on purpose: automated defenses are simpler, and they
are the foundation for the SAM systems players will build later.

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
npm test           # unit tests for the rules (defenses, aircraft, combat, missions, economy, state machine, career stats)
```

```bash
npm run build      # typecheck + production build into dist/
```

```bash
npm run preview    # serve the production build
```

The game needs a desktop browser with WebGL 2.

## What's new in v0.0.4

**Threat levels.** Every territory except home has one, fixed in [`src/config.ts`](src/config.ts)
(`THREAT.map`). The danger grows towards the far side of the map, where the east column and T8 are
enemy country:

| Level | Territories | What stands there | Card difficulty |
|---|---|---|---|
| 0 Unprotected | T2, T4 | Nothing | Easy |
| 1 Light | T5, T7 | 1 ink turret | Easy or Medium |
| 2 Guarded | T3, T6 | 2 ink turrets, a radar station, a supply depot | Medium or Hard |
| 3 Fortified | T8, T9 | 2 ink turrets, a rocket launcher, a radar station, a supply depot | Hard |

T1 stays safe: nothing fires over it (or within 12 m of it), rockets lose track of a plane that gets
there, and no weapon is placed where its reach covers home or the first stretch after take-off. The
easy card always goes to unprotected or lightly defended ground, so a player who has lost a few
planes can always earn their way back.

**The defenses** (all numbers are first balancing guesses, in `DEFENSES`)

| Defense | Health | Reach | How it behaves | How to beat it |
|---|---|---|---|---|
| Ink turret | 80 | 45 m | A round every 0.34 s (4 damage, flies at 44 m/s). Needs 0.7 s to get a fix on a plane it has just noticed. | It turns 130° either way of where it faces (the middle of its territory) and no further: the space behind it is a **blind spot**. It turns at 1.7 rad/s, so a fast plane crossing close by outruns it. Its aim scatters more the faster you fly, and it leads you with a smoothed guess of your velocity, so **turning throws it off**. |
| Paper rocket launcher | 100 | 75 m | Holds a plane in its sights for 1.6 s (**ROCKET LOCK**), then fires a homing paper rocket (28 damage) and reloads for 7 s. | It can't aim below 6° above its horizon: **fly low** far out. Rockets fly at 31 m/s and turn at 1.8 rad/s: a Falcon at full throttle outruns them, and a hard turn across the rocket's path makes it overshoot. A Widewing can do neither. Rockets can also be **shot down**. |
| Radar station | 70 | 85 m | While it stands and sees you, every weapon on its territory knows where you are: they turn towards you early and fire the moment you are in reach, with no delay to get a fix. | Destroy it and that territory's weapons only notice planes from 30% closer, and need their fix time again. |
| Supply depot | 70 | | The marked target of fortified and multi-stage strikes (a target is painted on its roof). | Ink only does a quarter of its damage: **bomb it**. A bomb on or right beside it finishes it. |

- **Detection depends on the plane.** Each aircraft has a detection signature: a weapon notices a
  plane at its reach times the signature. The Dart (0.65) slips 16 m deeper into a turret's reach
  before anything reacts; the Widewing (1.25) is spotted early and is also the biggest target.
  The garage shows it as a seventh rating, **Stealth**.
- **Nothing is instant.** Rounds and rockets travel through the world and are checked against the
  plane's own movement each step, so you can change course after a shot is fired.
- **Destructible, with wrecks.** Ink and bombs damage everything; installations shudder and darken
  when hit, then tip over into a scorched, collapsed wreck with a burst of paper, a comic-book word
  ("TURRET DOWN!"), a crunch and a banner. Wrecks stay down for the whole sortie (land, rearm and go
  back: what you destroyed is still gone) and everything is rebuilt when the sortie ends.
- **Territories look the part.** Low cardboard walls ring each turret's back, a paper flag and a
  trim in the threat colour mark defended platforms, and each territory places its structures in its
  own style (corners, middle or edges) and rotation.

**New missions** (each deal has at least one)

| Type | Objective | Threat | Best fit |
|---|---|---|---|
| Suppression | Destroy one turret (Easy), every turret (Medium) or every weapon (Hard) on a territory, with ink or bombs | Light and up | Falcon, Swift |
| Dangerous recon | Spend 3 / 4 / 5 s over a defended territory, then escape beyond the reach of all its weapons | Light and up | Dart, Falcon |
| Fortified bombing | Destroy the marked supply depot inside guarded or fortified ground | Guarded and up | Widewing (Falcon, Swift good) |
| Multi-stage strike | Destroy the radar, then the supply depot, then land on T1 | Guarded and up | Swift |
| Survival challenge | Stay in a defended territory's airspace (below 32 m) for 12 / 16 / 20 s in total | Light and up | Falcon |
| Low-altitude attack | Hit the bullseye, staying below 16 / 13 / 10 m within 60 m of it; climb above that and the run is blown until you leave the zone and come in again | Light and up | Falcon, Swift, Widewing |

The classic missions still exist and now also go into defended ground: a Hard bombing run is on a
guarded or fortified territory. A target destroyed before its stage opens (bombing the depot before
the radar on a multi-stage strike) still counts as soon as the stage opens.

**Risk-based rewards.** Reward = (type base + 0.15 paper per metre + threat bonus) × difficulty
multiplier, rounded to 5. The threat bonus adds 8 / 16 / 26 paper for each light / guarded / fortified
territory the mission goes into, scaled by how long that mission type keeps you under fire (a
survival challenge ×1.6, a delivery that only touches the airspace ×0.5). Distance and the job
itself still count, so danger is part of the reward, not all of it.

**Mission cards** now show an operation codename ("Operation Paper Storm"), the threat level of the
target and its known defenses ("Fortified · T8: 2 ink turrets + 1 rocket launcher · radar"), or for a
ring course, the defended territories whose weapons reach it. The suitability chips per plane are
the recommendations.

**Warnings: you always know why you are taking damage**
- **Threat panel** (top centre): the defended territory you are over or about to enter, its threat
  level, an icon per installation (struck through once destroyed, red while shooting) and whether it
  has noticed you: *Not spotted*, *Spotted!*, *Under fire!*, *Defenses down*. A short alert sounds
  when it notices you.
- **Threat ring** (around the middle of the screen, ahead is up): a marker for every weapon shooting
  at you, locking on, or tracking you as you come into reach, and for every incoming rocket with its
  distance.
- **Rocket lock warning**: *ROCKET LOCK* with the lock building up (and a beep that speeds up), then
  *ROCKET INCOMING · 42 m* with a launch alarm. Rockets trail paper smoke. *Lock broken* when you
  break it.
- **Damage direction**: a red arc on the ring towards whatever just hit you, and the screen edges
  flash.
- **Labels and health bars** over every installation in range, saying what it is doing:
  *Tracking you*, *Locking on!*, *Firing at you!*, or *Mission target*.
- **Range rings**: as you approach a defended territory, each weapon's reach is drawn on the
  ground; a turret's ring leaves its blind spot open. The mini-map shows the same arcs, every
  installation, and a threat-coloured outline round each defended territory.
- **Objective symbols**: the goal marker and labels show what you are after: a bullseye, a turret,
  a launcher, a radar, a depot, an eye for reconnaissance, a shield for survival, an arrow for the
  escape. Low-level strikes show the height limit as a sheet in the air that turns red when the run
  is blown; escapes show the line to cross.
- **M** toggles the sounds.

**Sortie report** additions: aircraft survival (*Survived · 64/100 health*, or *Shot down by the
ink turret on T9*), defenses destroyed, damage taken, enemy fire dodged (rounds and rockets that
missed, out of those fired at you), and ink shots fired and hits. Career stats count defenses
destroyed.

## How to play

1. At home on **T1** you have **100 paper**, three mission cards and the garage. Pick a mission
   (**1 / 2 / 3**) and a plane (**Q / E**); the chips on each card and the badges on each plane say
   what fits, and each card says how heavily the target is defended.
2. Press **F** to fold it (or refit a recovered one, or roll out a stowed one).
3. Press **Space** to launch. The mouse is captured while you fly.
4. Do the mission: **right-click** drops a bomb, **hold left-click** fires ink. The marker and the
   mini-map's dotted line point at the current objective. Near defended ground, watch the threat
   panel and the ring, keep turning, use blind spots and low approaches, and take out the radar or
   the guns if the job will take a while.
5. **Land on T1**: slower than 19, descending less than 5 m/s, wings level. Then **R** to rearm,
   **Space** to take off again, or **Enter** to end the sortie and read the report.
6. **Enter** (or **Continue**) on the report deals new mission cards and rebuilds the defenses.

A mission pays as soon as its last objective is done. Landing is only required by Strike & return
and Multi-stage strike missions, but it's how you avoid paying for a new plane.

### Aircraft

| Aircraft | Role | Cost | Refit | Health | Range | Guns | Bombs | Signature | Against defenses |
|---|---|---|---|---|---|---|---|---|---|
| Dart | Recon | 10 | 3 | 45 | 2.6 km | 1 light, 40 ink | 1 mini | 0.65 | Cheap and hard to spot, but two bursts bring it down |
| Falcon | Fighter | 25 | 6 | 100 | 1.6 km | 2, 120 ink | 1 | 0.9 | Out-turns and outruns rockets, kills turrets fast; one bomb |
| Swift | Multipurpose | 30 | 7 | 110 | 1.9 km | 2, 80 ink | 2 | 1.0 | Good at everything a multi-stage strike asks |
| Widewing | Bomber | 40 | 10 | 150 | 1.3 km | 1, 50 ink | 4 | 1.25 | Several targets in one run, but rockets catch it and it is easy to hit |

### Missions

| Type | Objective | Best fit |
|---|---|---|
| Bombing | Hit the bullseye on one of T2 to T9 | Widewing |
| Precision bombing | Hit a small ink-blue spot placed off-centre (kept clear of props and defenses) | Widewing, Swift |
| Reconnaissance | Spend 3 / 4.5 / 6 s inside a territory's airspace, below 30 / 22 / 15 m | Dart |
| Timed delivery | Reach a territory's airspace before the clock runs out | Dart |
| Strike & return | Bomb a target, **then land on T1** | Widewing |
| Multi-target | Hit two bullseyes in one flight, in any order (needs a 2-bomb rack) | Widewing |
| Flight challenge | Fly through 4 / 5 / 6 paper rings in order, over the gaps | Falcon, Dart |
| Target practice | Shoot down 2 / 3 / 3 practice planes on one territory (Hard is timed) | Falcon |
| Suppression | Destroy the defenses on a territory | Falcon, Swift |
| Dangerous recon | Reconnoitre a defended territory, then escape | Dart, Falcon |
| Fortified bombing | Destroy the supply depot inside guarded or fortified ground | Widewing |
| Multi-stage strike | Radar, then supply depot, then land on T1 | Swift |
| Survival challenge | Hold out in a defended territory's airspace | Falcon |
| Low-altitude attack | Bomb a bullseye while staying low near it | Falcon, Swift, Widewing |

Bombs offered = one per target (one for a structure to knock down), plus 2 spares on Easy and 1 on
Medium. Easy cards go to threat 0–1, Medium to 1–2, Hard to 2–3.

A mission **fails** when every bomb is gone with a bullseye still to hit, when the clock runs out,
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
| M | Sound on / off |
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
| Mission success | +reward on the card: about 35 to 100 on Easy, 70 to 190 on Medium, 110 to 275 on Hard |
| Failed mission, crash | +0 |

Paper is still the only resource; ink is not a currency. For playtesting,
`paperwars.state.resetPaper()` in the browser console restores the starting balance.

## Project structure

```
src/
  main.ts                 Boots the game; exposes `window.paperwars` for console debugging
  Game.ts                 Wires rules ↔ scene ↔ input ↔ HUD; runs the frame loop; builds the HUD view
  config.ts               Every tuning number: aircraft catalog (AIRCRAFT), threat levels (THREAT), defenses (DEFENSES)

  aircraft/
    Aircraft.ts           1–5 ratings from the specs (now with stealth); mission suitability and bomb loads
    PlaneShapes.ts        The four folded-paper shapes, bomb slots and gun muzzles (data only)
    PlaneModel.ts         Foldable paper plane mesh: fold animation, crumpling and ink blots
    PlaneController.ts    Flight from the chosen FlightProfile, collisions that deflect, touchdown and rollout
    Boost.ts              Boost timing: ready → active → cooldown
    Landing.ts            Whether a touchdown is within the landing limits, and why not
    Bomb.ts               Bomb pool; release, gravity, and swept collision against props, target zones and platforms
    ChaseCamera.ts        Desk view, dynamic follow view (lean, speed zoom, FOV), bomb cam, crash view
    FlightTrails.ts       Wingtip ribbons, wind streaks, the damaged plane's ink smudge (and the ribbon rockets use)
    HangarPreview.ts      The blueprint ghost of the chosen plane above the launch pad, draggable

  combat/
    Collision.ts          Spheres and turned boxes: contacts, swept segments, distances
    Damage.ts             Health; impact, rough-landing and blast damage; damaged handling
    Gun.ts                Ammunition, rate of fire, alternating barrels
    Projectiles.ts        The player's ink rounds: swept hits on targets and platforms, and their pool
    Destructibles.ts      Practice targets and props: layout per territory, health, respawning

  defenses/
    Layout.ts             Where each territory's turrets, launchers, radar, depot, walls and flag go; home safety
    Installation.ts       How each installation notices, turns, leads, scatters, locks on and fires; the
                          per-territory network with radar alerts
    EnemyFire.ts          Enemy ink and homing rockets in flight, swept against the moving plane; shooting rockets down

  missions/
    Mission.ts            Objectives (bomb, low approach, recon, reach, ring, land, destroy, survive, escape), progress
    MissionGenerator.ts   Mission cards: types, threat windows, targets, known defenses, codenames, rewards

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
    Territory.ts          ID, position, owner, threat level, and box/sphere geometry queries
    WorldGenerator.ts     Lays out the 3×3 grid with gaps; builds platforms, runway, launch pad, lighting
    TargetRange.ts        Draws the practice planes, crates and boards, with hits, wear and rebuilding
    DefenseModels.ts      Draws the installations, walls, flags, trims and range rings; aiming, damage, collapse
    EnemyFireView.ts      Draws enemy ink and paper rockets with smoke trails
    MissionMarkers.ts     Bullseyes, beacons, airspace volumes, ring hoops, target rings, escape lines, low-level sheets
    Effects.ts            Paper bursts, shock rings, cartoon puffs and explosions, ink splats, tumbling wrecks

  ui/
    HUD.ts, hud.css       Paper and career, mission cards and tracker, gauges, aircraft status, ground crew,
                          report, target labels, hit markers, damage numbers, banners, menus
    ThreatHud.ts          Threat panel, threat ring, rocket lock warning, damage direction
    Sounds.ts             Synthesised warning sounds (Web Audio, no files)
    icons.ts              The line icons for objectives and defenses
    Garage.ts             Plane cards and the inspector
    MiniMap.ts            The top-down navigation diagram
    dom.ts                Small DOM helpers
```

The rules (`GameState`, `Mission`, `MissionGenerator`, `Aircraft`, everything in `combat/` except
the projectile pool, everything in `defenses/`, `ResourceManager`, `HomeIncome`, `LocalStats`,
`Boost`, `Landing`, `Boundary`) contain no rendering or input code, and all of them have unit tests.
The game reports facts to the rules ("this round hit T8-turret1 for 7", "the plane flew from A to
B", "a rocket from T8-launcher hit the plane") and the rules decide what they mean, which should
make it straightforward to move them to a server later. The defense network only ever sees the
plane as a position, a velocity and a signature, so another player's plane can take its place.

### Adding a plane

1. Add an entry to `AIRCRAFT` in `src/config.ts` (and its id to `AircraftId` and `AIRCRAFT_ORDER`),
   including its detection `signature` and `hitRadius`.
2. Add a shape to `PLANE_SHAPES` in `src/aircraft/PlaneShapes.ts` with at least as many muzzles as
   barrels and bomb slots as its rack holds.

The flight controller, garage, ratings, suitability, defenses, HUD and practice range pick it up from there.

### Tuning

All provisional numbers are in [`src/config.ts`](src/config.ts). The ones most worth playtesting first:

- **How dangerous defenses are:** `DEFENSES.turret` (`spread`, `speedSpread`, `lead`, `trackingLag`,
  `interval`, `shot.damage`, `arc`, `turnRate`) and `DEFENSES.launcher` (`lockTime`, `reload`,
  `rocket.speed`, `rocket.turnRate`, `rocket.damage`, `minPitch`), plus each plane's `signature` and `hitRadius`.
- **Which territories are defended:** `THREAT.map`, `THREAT.levels`, and `THREAT.byDifficulty` for
  which cards go where.
- **Rewards for danger:** `THREAT.rewardBonus` and `MISSIONS.exposure`.
- **How different the planes feel:** each `AIRCRAFT[id].flight` (`rollResponse`, `maxTurnRate`,
  `speedResponse` are the big three), plus `maxHealth`, `range`, `gun` and `bombs`.
- **Collision and landing damage:** `DAMAGE.safeImpactSpeed`, `impactDamage`, `roughLanding`, `bounce`.
- **Suitability badges:** `SUITABILITY.weights` per mission type, and the `recommended` / `good` cut-offs.

## Decisions worth knowing

These are judgment calls where the plan left room:

- **A fixed threat map, not a random one.** The plan let "the world assign threat levels"; a fixed
  map (danger growing away from home) lets players learn the ground, and the two neighbours of home
  stay unprotected. It is one line in the config to change.
- **Radar on guarded and fortified territories.** The plan's table lists weapons only; a radar is a
  sensor, so it goes with the two heavier profiles, which also gives multi-stage strikes their radar.
  Guarded and fortified territories also get a **supply depot**: the "marked cardboard target" of
  fortified bombing and the "supply structure" of multi-stage strikes. Bombs are what kills it.
- **Weapons face the middle of their territory.** So the target is always covered, and the blind
  spot behind each turret faces outwards: coming in over a turret's back is the way in. The walls
  round each turret mark its back.
- **Speed decides accuracy, as asked.** A turret's scatter grows with the plane's speed, and it
  leads with a lagging guess of the plane's velocity, so speed and turning both beat it. Measured
  over straight passes through T8's turrets (unit tests): a Widewing at cruise loses about a third of
  its health, at full throttle about a seventh; a boosting Falcon is almost never hit.
- **Rockets are plain pursuit with a turn limit**, no interception logic, as asked. The numbers sit
  between the planes: faster than a Widewing, slower than a Falcon at full throttle, unable to follow
  a Falcon's turn but able to follow a Widewing's.
- **Low flying is a mission rule, not a radar trick.** Low-altitude attacks check the plane's height
  against the mission's ceiling inside the approach zone. Separately, launchers can't aim very low on
  the horizon, so a low approach does keep you out of rocket range for longer (but not out of the
  turrets', and the pencil stands and radar masts are right there).
- **Stealth is a seventh rating.** The Dart's "small detection profile" is a real number (its
  signature), so the garage shows it like the others, and it drives the dangerous-recon suitability.
- **Multi-stage strikes rate planes by their weakest stat.** A weighted average can never put the
  all-rounder Swift on top; for a mission that needs a bit of everything, the plane's weakest
  relevant rating (plus one) decides, which makes the Swift the recommended plane, as planned.
- **Ring courses carry the threat of what they pass.** Rings aren't aimed at a territory, so their
  card lists the defended territories whose weapons reach a ring, and the reward includes it.
- **Defenses stay down until the sortie ends.** Within a sortie (land, rearm, take off again) what
  you destroyed stays destroyed, so softening a territory first pays off; ending the sortie rebuilds
  everything, as the plan asked. Practice targets still respawn after 45 s.
- **The practice range stays on every territory**, defended or not: target practice on guarded
  ground is now target practice under fire.
- **The threat ring only shows real threats.** A radar can alert weapons from far away, but the ring
  only lists weapons shooting at you, locking on, or tracking you within about 10 m of their reach,
  and the "spotted" sound only plays for the territory you are approaching.
- **Pulling up after a clean low-level release is fine.** The bomb was released clean and counts;
  the "run blown" banner waits until no bomb is falling.

## Definition of done (v0.0.4)

| Requirement | Status |
|---|---|
| Ink turrets and paper rocket launchers (simplified SAM, basic homing) on selected territories | ✅ |
| Detect within a radius, rotate towards the plane, fire at intervals, limited accuracy, damage, stop when it leaves or is destroyed | ✅ |
| Accuracy depends on the plane's speed; boosting makes hits rare | ✅ |
| Visible engagement ranges; estimated defenses on mission selection; warning indicators in flight | ✅ |
| Destructible defenses (ink or bombs), respawning when the scenario resets | ✅ |
| Evadable projectiles with travel time; rockets with limited turning; visible rocket trails | ✅ |
| Visual and audio warnings: turret icons, threat direction, launch alert | ✅ |
| Threat levels 0–3 with the four profiles on T2–T9; T1 safe; at least two safe or light territories | ✅ |
| Threat level, known defenses, recommended aircraft and reward on mission cards | ✅ |
| Risk-based rewards that also weigh distance, the job and exposure | ✅ |
| Suppression, dangerous recon, fortified bombing, multi-stage strike, survival, low-altitude attack | ✅ |
| Radar that alerts weapons early; losing it shortens detection | ✅ |
| Restricted firing arcs and rotation speeds (blind spots) | ✅ |
| Aircraft role advantages (Dart signature, Falcon agility, Widewing payload and vulnerability, Swift flexibility) | ✅ |
| Turrets, launchers, radar stations, supply boxes, flags and barriers placed by threat level, with varied layouts | ✅ |
| Damaged and collapsed states that last until the scenario resets | ✅ |
| Distinct objective symbols for bombing targets, turrets, radars and reconnaissance | ✅ |
| Incoming fire indicators, damage direction, health bars, rocket lock warning, territory threat indicator | ✅ |
| Destruction feedback: impact effect, collapse animation, sound, confirmation | ✅ |
| Report: defenses destroyed, damage taken, shots fired and hits, survival, paper earned or lost | ✅ |

The rules are covered by unit tests (`npm test`, 149 tests), including statistical checks on
turret accuracy against speed and weaving, and rockets against fleeing and turning planes. Full
sorties were flown in headless Chromium by a scripted pilot that steers through the aim (as the
mouse does), with no page errors:

- Widewing fortified strikes on T8: depot bombed, out again with about half its health.
- Falcon suppression on T3, T5 and T6: a turret destroyed from its blind spot with few or no hits taken.
- A Dart circling slowly over fortified T9: shot down, and the report credits the T9 ink turret.
- Low-level strikes on T5 and T7: one blown approach, then a clean run that scores. On a Hard run
  over fortified T9, the same straight, non-evasive pilot was shot down after a clean release.
- Multi-stage strikes on T3 and T6: radar, depot, then a real landing on T1.
- Dangerous recon on T5, T6 and T7, each followed by the escape.

The desk and pause screen were also checked at 1280×720.

**Fixed along the way:** PlayCanvas destroys a mesh when the last mesh instance using it is
destroyed. The cached splat and paper-ball meshes in `Effects` and the ring meshes in
`MissionMarkers` are reused by short-lived entities, so once every user of one had gone, the next
splat, wreck or marker drew a destroyed mesh ("Cannot read properties of undefined (reading
'impl')"). This was already possible in v0.0.3 (a second wreck after the first had faded) and became
frequent with enemy ink splats; the caches now hold their own reference.

**Still unproven: how it *feels*.** Headless Chromium can't judge that. Playtest these first: whether
turrets are too accurate or too forgiving (`spread`, `speedSpread`), whether rocket locks are
escapable often enough, whether the threat ring and range rings read at a glance in a busy fight,
and whether the sounds are helpful or nagging.

## Next milestone

Per the [roadmap](docs/GDD.md#17-development-roadmap): **v0.0.5, core multiplayer.** Two or more
players sharing a world. The defense network already treats the plane as a position, a velocity and
a signature, so other players' planes can be targets too.

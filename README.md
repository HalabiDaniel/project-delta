# paperwars.io: v0.0.5, Enemy Aircraft and Interception

Through v0.0.4 every threat came from the ground. v0.0.5 puts **other aircraft in the sky**:
enemy paper planes patrol enemy country, fighters chase and shoot at you, scouts run, and every few
minutes a bomber sets out to hit the paper store on your home territory. You dogfight, intercept,
escort a friendly bomber and patrol airspace, and T1 finally has guns of its own. The plan is in the
[game design document](docs/GDD.md#17-development-roadmap).

It is still single-player and runs entirely in the browser (PlayCanvas + TypeScript, no backend).
The AI pilots fly the same flight model, health and guns as the player's planes, and the defenses,
rounds and pilots only ever see an aircraft as a position, a velocity and a side, so the same
systems can take human opponents when multiplayer arrives.

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
npm test           # unit tests for the rules (AI pilots, defenses, aircraft, flight, combat, missions, economy, state machine, career stats)
```

```bash
npm run build      # typecheck + production build into dist/
```

```bash
npm run preview    # serve the production build
```

The game needs a desktop browser with WebGL 2.

## What's new in v0.0.5

### Enemy aircraft

AI pilots fly paper planes around the world: the **same designs, flight model, health and ink
guns** as yours. A pilot only decides where to point (an aim direction, exactly like the mouse
sets one), how fast to go, when to boost, shoot and drop; the flight model you fly does the rest
(`src/aircraft/FlightModel.ts`, extracted from the player's controller for this).

| Role | Aircraft | Behaviour | Typical difficulty |
|---|---|---|---|
| Scout | Dart | Flies its route, circling what it scouts. Once it spots you it runs for the edge of the map, boosting and jinking. Never shoots. | Easy |
| Fighter | Falcon | Turns on aircraft it notices, works its way behind them, holds gun distance and fires in bursts when lined up. Breaks off when you get too far, it gets too hurt or runs out of ink, then comes back. | Medium |
| Bomber | Widewing | Flies to its target, lines up and makes a steady, predictable run at bombing height, then heads home. Jinks when attacked on the way in, takes potshots with its nose gun, turns back when badly hurt. | Medium |

Each pilot is a small **finite-state machine**: patrol → noticed something (a reaction delay) →
attack, run or carry on (by role) → reposition after overshooting → evade → disengage → leave.
Routes are waypoints at safe heights; a look-ahead along the flight path climbs away from platforms,
and a predictive separation check keeps aircraft from flying into each other.

**Skill changes behaviour, not health.**

| | Rookie (easy) | Regular (medium) | Veteran (hard) |
|---|---|---|---|
| Reaction time | 1 s | 0.6 s | 0.3 s |
| Base scatter (either way) | 6.5° | 4.5° | 3.5° |
| Trigger discipline | 0.35 s bursts, 1.5 s pauses | 0.45 s / 1 s | 0.6 s / 0.8 s |
| Leads its shots by / anticipates turns | 50% | 80% | 95% |
| Speed it pushes to (cruise → top) | 45% | 75% | 100%, with boost |
| Evasive turns with someone on its tail | never | sometimes | often |
| Breaks off when hurt | never | below 25% | below 35%, boosting and weaving away |
| Works behind you before attacking | never | half the time | always |
| Follows you down to | 10 m | 7 m | 4.5 m |
| A bomber's release error | ±10 m | ±6 m | ±2.5 m |

**No perfect aim.** A pilot's rounds scatter by its skill, and more the further you are, the more
your speeds differ, the harder you turn, and the less time it has been tracking you; its idea of
your velocity also lags behind your real one, so a change of course throws its lead off.
Measured against a Falcon circling at cruise: a rookie does about 0.7 damage a second, a regular
about 4, a veteran about 11, and flying unpredictably cuts that by a third or much more. Flying
straight with a veteran on your tail is the fastest way to lose a plane.

### Dogfighting

- **Your ink hits aircraft** through the same swept projectile collisions as everything else,
  against each plane's movement every step.
- **Aim assistance:** a round counts as a hit if it passes within a small cone (1.6°) of an
  aircraft, at most 1 m beyond its size. Close in you still have to hit it. Nothing aims for you.
- **Markers:** corner brackets, name, distance and what it is doing ("Attacking you!", "Running!",
  "Bombing run!", "Breaking off"). Far ones fade; crowded ones shrink to brackets. A health bar
  shows while you aim at one, just hit it, or it matters to the mission. Off screen, a subtle chevron
  at the edge points to it.
- **Lead sight:** a small red circle where to shoot at the enemy nearest your nose.
- **Kill confirmation:** the plane crumples into a tumbling paper ball, "SHOT DOWN!", a banner and
  a chime; mission progress and career stats update.
- **Escape:** fighters chase at most 140 m from where they started, and no further than 110 m from
  what they guard; outrun or outturn them and they break off. They never follow you over home.

### Raids on T1 and interception

Every three to five minutes (once you have flown a sortie), a Widewing sets out from beyond a far
enemy territory for the **paper store on T1**. You get the alert straight away, with an ETA:

> **INCOMING BOMBER** · Enemy Widewing approaching T1 from T9 · ETA 31 s
> Target: home territory · paper store. Objective: intercept before bomb release. Defense reward +60 paper.

It circles over its territory to form up, crosses the map and makes a straight run at the store,
about half a minute after the alert, enough to fold a fighter at the desk and take off. Shoot it
down (or make it turn back) and you earn **+60 paper**, but only if you took part: T1's own guns
help, but they don't earn you anything by themselves. If its bomb hits the store you lose **20
paper**, never below a **protected 50**, enough to fold a fighter. After the first two raids, some
come with a fighter escort.

**T1 has its own defenses now:** two ink turrets either side of the runway, painted home blue and
facing out towards the world centre, and the paper store. They are predefined (player-built
defenses come later) and only shoot at hostile aircraft. Nothing hostile fires at you over home, or
in the first six seconds after take-off.

### Mission types in the air

| Type | Objective | Fails if | Recommended |
|---|---|---|---|
| Dogfight | Shoot down an enemy fighter patrolling a territory. It fights back. | | Falcon |
| Scout interception | Shoot down a Dart scouting two or three territories before it slips away | It escapes | Falcon (Dart, Swift good) |
| Bomber interception | Stop a raid on T1: shoot the bomber down before it releases. Hard raids are escorted. | It releases its bomb | Falcon (Swift good) |
| Bomber escort | Keep your own Widewing flying until its bomb hits a bullseye. Enemy fighters come for it. | Your bomber is shot down | Falcon (Swift good) |
| Airspace patrol | Spend 20/25/30 s over a territory and shoot down every intruder that turns up | An intruder escapes | Falcon |
| Combined attack | Hit a bullseye on defended ground while a fighter patrols overhead | | Swift |

Every deal of three cards now has one mission against the defenses and one in the air. Easy cards
only meet rookie pilots, over unprotected or lightly defended ground. Enemy aircraft add to the
reward by skill (+10/+18/+28 before the difficulty multiplier), and cards say who is up there:
"Air threat · No ground defenses · Air: 1 fighter + 1 bomber (veteran)".

### A world with traffic

Up to two **ambient patrols** (scouts, fighters, or a bomber crossing) fly over enemy country (T3,
T6, T8, T9) even when no mission needs them. They come and go out of sight, stay in their zone, and
fighters among them will go for you if you trespass. They **pay nothing** when shot down, so there
is nothing to farm. At most **four** AI aircraft fly at once; missions and raids come first and
patrols head home to make room. Aircraft only appear and disappear out of view, beyond the edge of
the map.

### Sound

Warning chirps when a fighter turns on you, an air-raid wail when a bomber sets out, a whoosh as
planes flash past, a tick of ink fire, a paper crunch when a plane goes down and a chime when you
got it. A low combat track swells while fighters are on you and fades when you get away (M mutes
everything).

### Sortie report

New rows: enemy aircraft destroyed, bombers intercepted, friendly objectives protected (raids beaten
off with your help, escorts seen home), and paper lost to raids, which the net change now includes.
Damage dealt and taken, shots fired and accuracy were already there. The career panel counts
aircraft shot down.

## Territory defenses (since v0.0.4)

T2–T9 have threat levels and the defenses to match (T1's own guns are described above).

**Threat levels.** Every territory except home has one, fixed in [`src/config.ts`](src/config.ts)
(`THREAT.map`). The danger grows towards the far side of the map, where the east column and T8 are
enemy country:

| Level | Territories | What stands there | Card difficulty |
|---|---|---|---|
| 0 Unprotected | T2, T4 | Nothing | Easy |
| 1 Light | T5, T7 | 1 ink turret | Easy or Medium |
| 2 Guarded | T3, T6 | 2 ink turrets, a radar station, a supply depot | Medium or Hard |
| 3 Fortified | T8, T9 | 2 ink turrets, a rocket launcher, a radar station, a supply depot | Hard |

T1 stays safe for you: nothing hostile fires at you over it (or within 12 m of it), rockets lose
track of a plane that gets there, and no enemy weapon is placed where its reach covers home or the
first stretch after take-off. (T1's own guns do fire over it, at raiders.) The
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
   the guns if the job will take a while. Against aircraft, aim at the small red lead circle, keep
   turning when one is on your tail (it shows on the threat ring), and boost away to make it give up.
5. **When the raid alert comes up**, go and meet the bomber: from the desk, fold a fighter and take
   off; in the air, the marker and the mini-map show where it is and its line to T1.
6. **Land on T1**: slower than 19, descending less than 5 m/s, wings level. Then **R** to rearm,
   **Space** to take off again, or **Enter** to end the sortie and read the report.
7. **Enter** (or **Continue**) on the report deals new mission cards and rebuilds the defenses.

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
| Dogfight | Shoot down an enemy fighter patrolling a territory | Falcon |
| Scout interception | Shoot down a scout before it escapes the map | Falcon, Dart, Swift |
| Bomber interception | Shoot down the raider before it releases (escorted on Hard) | Falcon, Swift |
| Bomber escort | Keep your Widewing flying until its bomb hits | Falcon, Swift |
| Airspace patrol | Patrol a territory for 20 / 25 / 30 s and shoot down every intruder | Falcon |
| Combined attack | Bomb a defended bullseye with a fighter patrolling overhead | Swift |

Bombs offered = one per target (one for a structure to knock down), plus 2 spares on Easy and 1 on
Medium. Easy cards go to threat 0–1, Medium to 1–2, Hard to 2–3.

A mission **fails** when every bomb is gone with a bullseye still to hit, when the clock runs out,
when the plane is lost, when you end the sortie before finishing, when an aircraft you had to stop
escapes or releases its bomb, or when the bomber you escort is shot down. An aircraft you had to
shoot down counts whoever finishes it (T1's guns included).

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
| Mission success | +reward on the card: about 35 to 95 on Easy, 65 to 200 on Medium, 105 to 305 on Hard |
| Failed mission, crash | +0 |
| Raid on T1 beaten off, with your help | +60 (missions that send the raider pay through the mission instead) |
| Raid on T1 beaten off by T1's guns alone | 0 |
| A raider's bomb hits the paper store | −20, never below 50 |
| Shooting down an ambient patrol | 0 |

Paper is still the only resource; ink is not a currency. For playtesting,
`paperwars.state.resetPaper()` in the browser console restores the starting balance.

## Project structure

```
src/
  main.ts                 Boots the game; exposes `window.paperwars` for console debugging
  Game.ts                 Wires rules ↔ scene ↔ input ↔ HUD; runs the frame loop; builds the HUD view
  config.ts               Every tuning number: aircraft catalog (AIRCRAFT), threat levels (THREAT), defenses (DEFENSES),
                          AI pilots (AI), raids (RAIDS)

  ai/
    AiAircraft.ts         One AI plane: flight model, health, guns, bombs, and its pilot (the state machine)
    AirTraffic.ts         Everything else in the air: mission spawns, raids on T1, ambient patrols, spawn
                          limits, despawning out of sight; raid outcomes
    FlightPlans.ts        Routes for raids, patrols, scouts, interceptors and the friendly escort bomber
    Navigation.ts         Safe heights, terrain look-ahead, waypoints, entry and exit points
    Gunnery.ts            Lagging target tracking, lead, and the accuracy model
    harness.ts            Test support: the real world, scripted "players" and fire resolution

  aircraft/
    Aircraft.ts           1–5 ratings from the specs (now with stealth); mission suitability and bomb loads
    PlaneShapes.ts        The four folded-paper shapes, bomb slots and gun muzzles (data only)
    PlaneModel.ts         Foldable paper plane mesh: fold animation, crumpling and ink blots
    FlightModel.ts        The flight physics for every plane, player's or AI's: steering, speed, boost, collisions
                          that deflect, touchdown and rollout (no rendering)
    PlaneController.ts    The player's plane in the scene: its models and bomb rack, posed from the flight model
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
    Projectiles.ts        The player's ink rounds: swept hits on targets, aircraft (with aim assistance) and platforms
    Ordnance.ts           Every other round and rocket: the defenses' and AI aircraft's, by side, swept against
                          every aircraft of the other side; homing rockets; shooting rockets down
    Destructibles.ts      Practice targets and props: layout per territory, health, respawning

  defenses/
    Layout.ts             Where each territory's turrets, launchers, radar, depot, walls and flag go; T1's own
                          guns and paper store; home safety
    Installation.ts       How each installation notices, turns, leads, scatters, locks on and fires; the
                          network that picks a hostile aircraft for each weapon, with radar alerts

  missions/
    Mission.ts            Objectives (bomb, low approach, recon, reach, ring, land, destroy, survive, escape,
                          intercept, escort, patrol), progress and failure
    MissionGenerator.ts   Mission cards: types, threat windows, targets, known defenses, the aircraft each one
                          sends up, codenames, rewards

  systems/
    GameState.ts          The rules: garage and hangar, fold/refit/roll-out, launch, weapons, health,
                          range, land → rearm → take off → end sortie, rewards, raids won and lost, the sortie log
    LocalStats.ts         Career numbers in local storage (survives missing or blocked storage)
    ResourceManager.ts    Paper balance; all costs, rewards and raid losses go through it (with a protected floor)
    HomeIncome.ts         T1's paper trickle
    Boundary.ts           Airspace edge: warning countdown and autopilot hand-over
    Random.ts             Seeded random numbers (for repeatable tests)
    Input.ts              Keyboard (physical keys), mouse buttons and deltas, pointer lock

  world/
    Territory.ts          ID, position, owner, threat level, and box/sphere geometry queries
    WorldGenerator.ts     Lays out the 3×3 grid with gaps; builds platforms, runway, launch pad, lighting
    TargetRange.ts        Draws the practice planes, crates and boards, with hits, wear and rebuilding
    DefenseModels.ts      Draws the installations, walls, flags, trims and range rings; aiming, damage, collapse
    OrdnanceView.ts       Draws enemy (magenta) and friendly (blue) ink and paper rockets with smoke trails
    AircraftModels.ts     Draws the AI aircraft: enemy newsprint and red, friendly blue; damage, streamers, smudge
    MissionMarkers.ts     Bullseyes, beacons, airspace volumes, ring hoops, target rings, escape lines, low-level sheets
    Effects.ts            Paper bursts, shock rings, cartoon puffs and explosions, ink splats, tumbling wrecks

  ui/
    HUD.ts, hud.css       Paper and career, mission cards and tracker, gauges, aircraft status, ground crew,
                          report, target labels, hit markers, damage numbers, banners, menus
    ThreatHud.ts          Threat panel, threat ring, rocket lock warning, damage direction
    AirHud.ts             Aircraft markers and edge chevrons, health bars, the lead sight, the raid alert
    Sounds.ts             Synthesised warning sounds and the combat track (Web Audio, no files)
    icons.ts              The line icons for objectives and defenses
    Garage.ts             Plane cards and the inspector
    MiniMap.ts            The top-down navigation diagram
    dom.ts                Small DOM helpers
```

The rules (`GameState`, `Mission`, `MissionGenerator`, `Aircraft`, `FlightModel`, everything in
`ai/`, everything in `combat/` except the projectile pool, everything in `defenses/`,
`ResourceManager`, `HomeIncome`, `LocalStats`, `Boost`, `Landing`, `Boundary`) contain no rendering
or input code, and all of them have unit tests. The game reports facts to the rules ("this round
hit T8-turret1 for 7", "the plane flew from A to B", "the raider's bomb hit the store") and the
rules decide what they mean, which should make it straightforward to move them to a server later.
The defense network, the ordnance and the AI pilots only ever see an aircraft as an id, a side, a
position, a velocity and a signature, so another player's plane can take the AI's place.

### Adding a plane

1. Add an entry to `AIRCRAFT` in `src/config.ts` (and its id to `AircraftId` and `AIRCRAFT_ORDER`),
   including its detection `signature` and `hitRadius`.
2. Add a shape to `PLANE_SHAPES` in `src/aircraft/PlaneShapes.ts` with at least as many muzzles as
   barrels and bomb slots as its rack holds.

The flight controller, garage, ratings, suitability, defenses, HUD and practice range pick it up from there.

### Tuning

All provisional numbers are in [`src/config.ts`](src/config.ts). The ones most worth playtesting first:

- **How dangerous enemy pilots are:** `AI.skill` per level (`aimError`, `burst`/`pause`, `lead`,
  `reaction`, `throttle`, `evasive`, `positioning`) and `AI.accuracy` (how much distance, speed
  difference, manoeuvring and tracking time matter). The AI unit tests measure damage per second by
  skill, so a change shows up there first.
- **How far they chase:** `AI.maxPursuit`, `AI.leash`, `AI.disengageTime`, `AI.launchShield`.
- **How busy the sky is:** `AI.maxActive`, `AI.ambient` (count, respawn, lifetime, role mix),
  `RAIDS.first` / `RAIDS.interval`, `RAIDS.escortAfter` / `escortChance`.
- **What raids are worth:** `RAIDS.reward`, `RAIDS.penalty`, `ECONOMY.protectedPaper`, and the
  raiders' speeds in `ai/FlightPlans.ts` (which set how much warning you get).
- **Aim assistance:** `WEAPONS.aimAssist`.

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

These are judgment calls where the plan left room.

### v0.0.5: aircraft

- **One flight model for everyone.** The plan asked AI aircraft to use the existing flight model,
  so the physics moved out of `PlaneController` into `FlightModel`, which has no rendering and is
  steered by an aim direction (as the mouse sets one), a throttle and a boost. The player's plane is
  now a view of a `FlightModel`; nothing about how it flies changed.
- **Pilots lead the turn, like a player leads the mouse.** The flight model's nose lags a moving aim
  point, so a pilot that simply aimed at its target would trail it in every turn and never fire. Good
  pilots aim ahead by the turn they see coming; how much is part of their skill.
- **Accuracy is a scatter, not a dice roll.** Every AI round flies through the world like the
  player's; the five factors the plan lists (distance, relative speed, manoeuvring, skill, time
  tracking) set how far it scatters, and the pilot's lagging idea of your velocity makes turning
  doubly effective. The numbers were tuned against measured damage per second (see the AI tests).
- **Sides, not special cases.** Everything that shoots or flies now belongs to the player or the
  enemy. Each defense weapon picks a hostile aircraft (sticking with the one it follows while it can
  see it), rounds only hit the other side, rockets home on what they were fired at. That is what lets
  T1's guns shoot raiders, enemy guns shoot your escorted bomber, and (later) players shoot each other.
- **T1's guns face out, with the same blind spot.** Raids always come from the world centre side,
  so T1's turrets face that way; the blind spot behind them faces the empty corner of the map.
- **The bomber's target is a paper store**, a cardboard depot with a target on its roof on T1,
  because "a designated target within the player's home territory" needs to be something you can
  see from the desk. A hit is a bomb within 5 m of it. It takes damage and collapses like any
  installation, and is rebuilt when the sortie ends.
- **Raid rewards need you.** "Distinguish player participation from completely automated defense":
  the +60 is paid only if you damaged the raider. T1's guns alone can still save your paper, but pay
  nothing. A raid that a bomber-interception mission sends pays through the mission instead (no double
  pay). Mission targets count whoever finishes them, so a bomber your guns finish off still completes
  the interception.
- **Raids start after your first sortie, a minute or two later.** New players aren't bombed before
  they have flown, and never more often than every three minutes or so. The raider circles its
  territory before setting out, which is what gives about half a minute of warning.
- **The grace period is both.** Hostile aircraft don't fire at you over home or in the first six
  seconds after take-off, and patrols and their fighters keep out of the airspace around T1 (raiders
  and their escorts excepted).
- **Ambient fighters guard enemy country.** They will go for you if you trespass in their zone, so
  the east of the map got more dangerous; easy cards stay on the west and centre, where the air is
  clear unless a mission puts a rookie there.
- **Patrol scouts are a step easier than the card.** A scout crossing a patrol runs once it spots
  you; at the card's own skill, a regular scout with boost outran a Falcon often enough to make
  medium patrols a coin toss. Scout interception missions keep the full skill: catching it is the job.
- **Patrols reach above the turrets.** The patrol area goes up to 60 m, out of turret reach, and
  patrols never go to fortified ground: patrolling is about the fight in the air, and patrolling high
  is the smart way to do it.
- **Markers do the pointing for aircraft.** When the objective is an aircraft, its marker (and edge
  chevron) replaces the objective arrow, so there is never a second label on it. Crowded markers
  collapse to brackets, the most important (attacking you, mission targets) first.
- **The raid alert sits under your paper**, not across the middle of the screen: it stays up for
  half a minute, so it must not cover the view ahead. The career numbers make way for it.
- **Mid-air collisions are avoided, not simulated.** Pilots keep clear of each other and of you;
  aircraft don't physically collide.

### v0.0.4: defenses

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

## Definition of done (v0.0.5)

| Requirement | Status |
|---|---|
| AI aircraft spawn at territories (or beyond them), begin at a safe altitude, follow routes, detect, turn on targets, fire ink, take damage, are destroyed, and leave when done | ✅ |
| Scout (Dart), fighter (Falcon) and bomber (Widewing) roles, using the player's aircraft health, damage and weapons | ✅ |
| AI flies the existing flight model: the pilot supplies steering, throttle and boost | ✅ |
| Waypoint navigation at safe altitudes | ✅ |
| Finite-state machine: patrol, target detected, attack, evade, disengage/return (plus reposition, bomb run, egress) | ✅ |
| Collision avoidance: forward obstacle detection with altitude correction, and separation from other aircraft | ✅ |
| Accuracy from distance, relative speed, player manoeuvring, skill and tracking time; never perfect | ✅ |
| Aircraft targetable with the existing projectile and collision systems; modest aim assistance, no auto-targeting | ✅ |
| Health indicators that fade with distance; markers with off-screen indicators | ✅ |
| Fighters get behind you, fire when aligned, disengage beyond a maximum pursuit distance, reposition | ✅ |
| Destruction: crumpling, kill confirmation, mission progress, removal, local combat stats | ✅ |
| Bombers raid T1: warning, interception, release when aligned, escape; −20 on a hit with a protected minimum, +60 for a defense you took part in | ✅ |
| Interception missions; sufficient warning to launch from the desk | ✅ |
| T1's guns attack hostile aircraft; friend and foe are told apart | ✅ |
| Escorted bombers (Hard interceptions, later raids) | ✅ |
| Dogfight, scout interception, bomber interception, bomber escort, airspace patrol, combined attack | ✅ |
| Ambient patrols, mission spawns, a spawn limit of 4, activity zones, despawning out of view | ✅ |
| Rookie, regular and veteran pilots that differ in behaviour; difficulty scaling by pilots, escorts, distance and ground threat | ✅ |
| No farming ambient enemies; grace period after take-off; easy missions always available | ✅ |
| Markers, off-screen indicators, health bars, raid alerts, kill confirmations | ✅ |
| Sounds: passing aircraft, ink fire, hits, plane destruction; optional combat music | ✅ |
| Report: aircraft destroyed, damage dealt and received, shots and accuracy, bombers intercepted, objectives protected, paper earned and lost | ✅ |

The rules are covered by unit tests (`npm test`, 199 tests). The AI tests fly real pilots against
scripted players in the real world: damage per second by skill, unpredictable flying against
steady circling, getting behind the target, holding fire at a shielded player, giving up a chase,
staying out of home, scouts escaping, bombers hitting the store (veterans at least 7 times in 8,
rookies less often), raid outcomes, escorts holding formation and turning on attackers, ambient
traffic within the limit and out of sight, and low routes without crashes or near misses.

The game was also played in headless Chromium by a scripted pilot that steers through the aim (as
the mouse does) and fires when lined up, with no page errors:

- **Dogfight** (Medium, T6): the regular fighter turned on the pilot, hit it for 12, broke off and
  repositioned, and was shot down in about 12 s; an ambient scout ran and was caught too.
- **Bomber interception** (Hard): a pilot that ignored the veteran escort and flew straight at the
  bomber was shot down by the escort in about ten seconds, as intended.
- **Raid at the desk:** with nobody flying, T1's guns hit the raider (150 → 78) but it got through:
  −20 paper, store damaged, about 27 s after the alert. Intercepted by the pilot, an easy raider went
  down in about 6 s and paid +60.
- **Bomber escort** (Medium, T7): the friendly Widewing flew in over T1 and hit on its first run.
- **Scout interception, airspace patrol, combined attack** (Medium): all completed.
- The air war costs about 0.7 ms per frame with three AI aircraft up.

The desk, flight HUD, raid alert and report were checked at 1280×720.

**Still unproven: how it *feels*.** Headless Chromium can't judge that. Playtest these first: whether
regular fighters are fair (`AI.skill.medium`), whether the aim assistance is enough with a real
mouse, whether raids come too often or give too much warning, and whether the markers and combat
music help or clutter.

## Next milestone

Per the [roadmap](docs/GDD.md#17-development-roadmap): **v0.0.6, core multiplayer.** Two or more
players sharing a world. The defenses, the ordnance and the AI pilots already treat every aircraft
as an id, a side, a position and a velocity, and the AI's raids rehearse the player-versus-player
bombing loop of v0.0.7.

# PAPERWARS.IO
## Game Design Document (GDD)
**Version:** Concept 1.0  
**Platform:** Desktop web browsers  
**Genre:** 3D arcade flight combat, persistent multiplayer sandbox, territory warfare  
**Visual direction:** Stylized, goofy, low-poly, paper-aircraft aesthetic  
**Camera:** Third-person chase camera  
**Monetization:** Free-to-play with cosmetic-only purchases planned for a later release

---

## 1. Game Overview

### 1.1 Core Concept

paperwars.io is a browser-based multiplayer game in which players control paper airplanes, build and defend territories, complete missions, and compete for resources in an ongoing shared world.

Players can join an existing session at any time. Each player claims an unoccupied territory and establishes a home base that produces resources.

Players spend those resources to construct paper aircraft suited to different roles, including fighters, bombers, and reconnaissance aircraft.

The game generates missions involving reconnaissance, bombing, combat, defense, exploration, and playful interactions with other players.

Successful missions generate rewards, while unsuccessful missions may result in the loss of the aircraft and its construction cost.

Enemy players can launch bombing missions against territories, causing the defender to lose some resources if the attack succeeds. The defender can manually intercept the bomber or rely on automated air defenses.

As players accumulate resources, their available strategic options increase. A dynamic mission director ensures newer players receive accessible missions, established players encounter suitable challenges, and powerful players become targets of increasingly valuable bounties.

### 1.2 Design Pillars

**Immediate accessibility:** Players should be able to select an aircraft and begin flying with minimal preparation.

**Meaningful risk and reward:** Every aircraft costs resources, and every mission has a potential gain or loss.

**Emergent multiplayer conflict:** Missions bring players into contact, creating rivalries, alliances, interceptions, retaliations, and unexpected encounters.

**Asymmetric warfare:** Different aircraft and defensive equipment serve different roles. An expensive bomber is not automatically superior to an inexpensive fighter.

**Goofy, approachable gameplay:** Flying, combat, and destruction should be playful and visually satisfying.

**Continuous participation:** Players can join ongoing sessions, complete short missions, and leave without requiring everyone to begin or finish together.

**Fair progression:** Success provides more strategic options without permanently excluding newcomers.

---

## 2. Setting and Visual Identity

The game takes place in a miniature world inspired by school supplies, paper airplanes, and classroom objects.

The initial playable environments may use abstract floating square territories, but later environments can feature classrooms, bedrooms, desks, bookshelves, pencil cases, and other oversized everyday objects.

Aircraft resemble folded paper creations rather than conventional metal airplanes.

Visual elements include:

- Visible paper folds and creases.
- Colorful sheets of paper.
- Hand-drawn symbols and decorations.
- Ink-based weapons and marks.
- Rubber-ball bombs and projectiles.
- Crumpling and tearing effects when aircraft are destroyed.
- Exaggerated, cartoon-like impacts.
- Simple, highly readable environmental geometry.

The visual design should remain lightweight enough to run smoothly in standard desktop browsers.

The aesthetic is intentionally not realistic military simulation. The goal is playful aerial warfare in a recognizable miniature world.

### 2.1 Art Direction (from v0.0.8)

paperwars.io looks like a **playable three-dimensional sketchbook**: low-poly geometry under soft, flat cartoon shading, hand-drawn graphite outlines, paper grain, folds and cardboard, in colourful miniature classroom scenes. It should look as if a student built the world from paper, cardboard and school supplies, then brought it to life.

- **Pencil outlines** on everything that matters, boldest on aircraft, lighter on scenery, fading with distance; configurable and optional.
- **One material library** (paper, notebook and graph paper, cardboard, ink, pencil markings, rubber, wood, plastic) and one lighting model, shared by the game's own models and imported ones.
- **Custom models where identity matters** (aircraft, cardboard buildings, defenses, landmarks, mission targets); licensed asset packs such as Synty only as environment geometry, always adapted to the shared materials and outlines.
- **Readable first:** ownership colours (blue player, red hostile, grey neutral, orange objective) with symbols, recognisable landmarks, silhouettes that hold up at speed.

The technical side (outline renderer, materials, asset import, adding content) is documented in [ART_DIRECTION.md](ART_DIRECTION.md).

---

## 3. Multiplayer Sessions

### 3.1 Session Structure

Each multiplayer session represents a shared world with a fixed number of territorial slots.

Players join an available ongoing session rather than waiting for a match to begin.

Suggested initial multiplayer parameters:

- 8 to 12 concurrent players.
- 12 to 16 territories.
- One primary territory per player.
- Unclaimed territories available to new players.
- Session-wide resource balances and player activities.
- Mission generation based on the current world state.

These values are provisional and should be adjusted through playtesting.

### 3.2 Joining a Session

When joining:

1. The player enters an available session.
2. The game displays unoccupied territories.
3. The player selects a territory.
4. The territory becomes their home base.
5. They receive starting resources.
6. They can choose an introductory mission and affordable aircraft.
7. They enter the active world.

The session does not restart when a new player joins.

### 3.3 Session Lifecycle

Sessions are continuous during an active campaign.

A proposed future campaign duration is approximately seven days, but this should be tested rather than treated as final.

At campaign completion, the world may reset its territories, local resources, and active conflicts.

Persistent account records can preserve cosmetic ownership, achievements, statistics, and preferred aircraft designs.

Campaign resets prevent unlimited resource accumulation and give latecomers an opportunity to compete.

### 3.4 Disconnections and Inactivity

A disconnected player should not permanently occupy a valuable territorial slot.

During the campaign, their territory may be reserved for a limited reconnect period. After prolonged inactivity, it can become available again under clearly communicated rules.

Offline territory protection must be implemented to prevent repeated attacks against players who cannot respond.

The exact rules require balance testing.

---

## 4. Territories

### 4.1 Ownership

Every player controls one primary territory.

The primary territory functions as:

- Their aircraft construction area.
- Their mission selection point.
- Their resource production center.
- Their defensive position.
- Their return and respawn location.

Territories have clearly defined boundaries and occupy recognizable positions in the 3D world.

### 4.2 Territory Resources

Each territory produces or stores resources.

Initially, the planned resource types are:

**Paper:** Used to construct aircraft and basic defensive structures.

**Ink:** Used for ammunition, special weapons, markings, and certain equipment.

**Rubber balls:** Used as heavier projectiles, bombs, and specialized payloads.

Additional resource types may be introduced only if they improve strategic decisions without creating excessive complexity.

### 4.3 Resource Production

Territories generate a limited amount of resources automatically.

Mission rewards provide a faster way to earn resources.

A player should never be required to perform repetitive manual collection actions just to launch a basic plane.

Resource production should have storage limits to discourage unlimited unattended accumulation.

### 4.4 Territory Damage

Enemy attacks can damage territory infrastructure and destroy a limited amount of stored resources.

Bombing does not automatically transfer all destroyed resources to the attacker.

The attacker earns a mission reward from the game, while the defender loses a calculated portion of their vulnerable resources.

This distinction allows the game to balance attacking rewards separately from defender losses.

### 4.5 Anti-Ruin Rules

To avoid permanently eliminating players:

- A minimum paper reserve remains protected.
- The basic aircraft must always be obtainable.
- Primary territories cannot be permanently destroyed.
- Resource losses are capped per attack.
- Repeated successful raids on the same player are subject to decreasing rewards or temporary protection.
- Offline players receive additional safeguards.

Players must be able to recover from losses through accessible missions.

---

## 5. Aircraft System

### 5.1 Aircraft Construction

Aircraft are selected from predefined paper-folding patterns.

The player does not individually connect fuselage, wing, engine, and cockpit modules.

Instead, the player selects an aircraft pattern and pays its construction cost.

The game displays a short folding or assembly animation before launch.

This simplifies the construction interface while preserving the fantasy of creating paper airplanes.

### 5.2 Aircraft Roles

**Reconnaissance aircraft:** Lightweight, fast, inexpensive, and suited to exploration or intelligence missions.

**Fighters:** Designed for dogfighting, interception, escorting, and defending territories.

**Bombers:** Slower, more expensive aircraft capable of attacking territory targets with larger payloads.

**Multipurpose aircraft:** Balanced designs capable of completing several types of missions.

### 5.3 Example Aircraft

| Aircraft | Role | Strength | Weakness |
|---|---|---|---|
| Dart | Basic scout | Cheap and fast | Limited offensive capability |
| Falcon | Fighter | Agile in combat | Limited bombing capacity |
| Widewing | Bomber | Heavy payload | Slow and vulnerable |
| Shadow | Advanced fighter | High combat performance | Expensive construction |
| Courier | Recon/support | Endurance and efficiency | Weak combat capability |

All aircraft names and statistics are provisional.

The F-35-inspired folded-paper Falcon can be a prominent visual design, without attempting to reproduce actual fighter flight characteristics.

### 5.4 Aircraft Costs

Every aircraft costs resources to manufacture.

More expensive planes generally provide specialized advantages, but cheaper planes must remain useful.

The player should always have at least one affordable or guaranteed starter option.

### 5.5 Aircraft Loss

A destroyed aircraft is removed from active play.

Its construction cost is not automatically refunded.

The player returns to their territory and may construct another aircraft.

Saved plane selections and quick-rebuild functionality minimize repetitive setup.

### 5.6 Aircraft Customization

Later versions can support:

- Paper colors.
- Printed patterns.
- Stickers and symbols.
- Trails and visual effects.
- Cosmetic folding variations.
- Limited functional equipment choices.

Cosmetic customizations must not affect competitive performance.

---

## 6. Flying

### 6.1 Camera

The default camera follows the aircraft from behind and slightly above.

It uses smooth movement, subtle banking, and a sufficiently wide field of view to show nearby obstacles and targets.

The game does not use an isometric flight perspective.

### 6.2 Controls

The initial control model is arcade-oriented.

- Mouse: Steering.
- W: Accelerate.
- S: Decelerate.
- A/D: Assisted roll or turning.
- Left mouse button: Primary weapon.
- Right mouse button: Secondary weapon or bomb release.
- Space: Contextual boost, where supported.
- R: Return or recall when eligible.
- Escape: Menu.

Controls may evolve through playtesting.

### 6.3 Physics

Aircraft use simplified flight physics rather than a full aerodynamic simulation.

Aircraft properties may include:

- Speed.
- Acceleration.
- Turn rate.
- Stability.
- Drag.
- Lift or glide behavior.
- Durability.
- Payload capacity.

The plane should be easy to control, with automatic stabilization and forgiving behavior at low speeds.

### 6.4 Returning Home

Players can return to their territory by landing or using an out-of-combat recall feature.

Landing may provide a modest repair or resource-efficiency benefit.

Basic earned mission rewards should not depend on completing a long return journey unless returning is part of the mission objective.

---

## 7. Missions

### 7.1 Mission System

Missions provide structured activities with clear objectives, rewards, and risks.

Players receive a selection of missions based on their current situation.

Missions are optional. Players can also fly freely without selecting one.

### 7.2 Mission Categories

**Reconnaissance:** Fly into an area, identify a target, photograph or mark a location, and escape.

**Bombing:** Attack a designated target, including another player's territory.

**Dogfighting:** Destroy or damage hostile aircraft.

**Interception:** Prevent an incoming aircraft from completing its mission.

**Defense:** Protect a territory, aircraft, or strategic objective.

**Delivery:** Transport an object or message between locations.

**Stunts and exploration:** Fly through obstacles, perform maneuvers, discover locations, or complete timed challenges.

**Mischief:** Perform playful non-destructive actions, such as marking an opponent's banner with ink, flying through their territory, or completing a teasing challenge.

Mischief missions should remain playful and should not encourage targeted harassment.

### 7.3 Mission Difficulty

Missions become more challenging as players demonstrate ability and accumulate useful equipment.

Difficulty should consider:

- Recent mission performance.
- Current resources.
- Available aircraft.
- Combat experience.
- Mission history.
- Target strength.
- Current world activity.

Players should also be free to voluntarily accept harder missions.

### 7.4 Mission Rewards

Success may award:

- Paper.
- Ink.
- Rubber balls.
- Reputation.
- Achievements or cosmetic progress.

Rewards should reflect risk, mission duration, and difficulty.

### 7.5 Mission Failure

Failure can result from:

- Aircraft destruction.
- Missing the objective.
- Running out of mission time.
- Target becoming unavailable.
- Abandoning the mission.

On failure, the player loses any destroyed aircraft and does not receive the normal completion reward.

Partial participation rewards may be offered for meaningful contributions, but should never make intentionally failing missions profitable.

---

## 8. Bombing Missions Against Player Territories

### 8.1 Core Mechanic

Bombing missions can target another player's territory.

The attacker selects an available bombing mission and constructs a compatible bomber.

The designated defender is notified when the attack becomes active or is detected, according to the mission rules.

The attacker flies to the target territory and attempts to strike designated objectives.

### 8.2 Attacker Objectives

The attacker must satisfy the mission's bombing requirements.

For example:

- Deliver a specified number of successful bomb hits.
- Destroy a designated exposed structure.
- Cause enough damage to reach the mission threshold.

If successful, the attacker receives the mission reward.

### 8.3 Defender Response

The defender can respond by launching a fighter from their territory.

They attempt to intercept and destroy the bomber before it completes its objective.

The defender may also rely on automatic defensive installations, including SAMs.

### 8.4 Successful Bombing

When the attack succeeds:

1. The attack mission ends successfully.
2. The attacker earns the mission reward.
3. The defender loses a capped quantity of vulnerable resources.
4. Any applicable infrastructure damage is recorded.
5. The defender receives a battle report.
6. The game records the event for reputation, retaliation, and future mission generation.

### 8.5 Successful Defense

If the defender prevents completion:

1. The bombing mission fails or expires.
2. The defender receives a defensive reward when there was meaningful enemy participation.
3. The attacker loses their aircraft if it was destroyed.
4. Territory resources remain protected from the unsuccessful attack.
5. The result may influence future missions or rivalries.

### 8.6 Example Balance

A defender holds 500 paper, of which 100 paper is protected.

A successful bombing mission could remove 50 paper, subject to limits.

The attacker might independently receive 80 paper as a mission reward.

These numbers are illustrative and should be balanced against aircraft costs and resource production.

### 8.7 Attack Fairness

Important restrictions include:

- New-player territory protection.
- Minimum protected resources.
- Maximum loss per mission.
- Cooldowns after repeated attacks.
- Clear warnings about active attacks.
- No obligation for offline players to defend immediately.
- No reward farming through coordinated intentional losses.

---

## 9. Automated Territory Defenses

### 9.1 SAM Installations

Players can eventually construct automatic surface-to-air missile systems, or SAMs, using resources.

These installations attack hostile aircraft within their detection and engagement range.

Although visually inspired by military equipment, their projectiles can be stylized as folded-paper rockets, ink missiles, or other classroom-themed objects.

### 9.2 Defensive Roles

Different systems may be effective against different threats.

**Light defenses:** Cheap, short-range weapons effective against small or slow aircraft.

**Anti-bomber defenses:** Larger installations effective against heavy bombers but less capable of tracking nimble fighters.

**Advanced SAMs:** Expensive installations with increased range and improved interception capability.

### 9.3 Defensive Limitations

Automated defenses should not make player-controlled attacks impossible.

Balance mechanisms include:

- Limited range.
- Reload time.
- Ammunition consumption.
- Detection delay.
- Restricted firing angles.
- Vulnerability to bombing.
- Different tracking performance against aircraft types.

A player-controlled fighter should remain a valuable defensive tool.

### 9.4 Defense Rewards

Automated defenses protect resources and may destroy attacking aircraft.

However, rewards should distinguish player participation from completely automated defense to avoid passive resource farming.

### 9.5 Implementation Priority

SAMs are a later development feature, not part of version 0.0.1.

Version 0.0.4 lays the groundwork with automated defenses the world owns: ink turrets, paper rocket launchers (an early, simplified SAM with basic homing) and radar stations on the unclaimed territories, placed by threat level. Version 0.0.5 gives the player's home territory two predefined ink turrets that shoot at hostile aircraft. Version 0.0.7 makes them player-built: the player spends paper on turrets (magazine and reload), rocket launchers (bombers first) and a radar in fixed construction slots, upgrades and repairs them, and the defense reward still only goes to a player who took part.

---

## 10. AI-Controlled Escort Aircraft

**Planned for a later version.** Version 0.0.5 builds the foundations: AI pilots (scouts, fighters and bombers at three skill levels) that fly the same flight model, health and weapons as player aircraft, enemy patrols and raids, and a friendly AI bomber to escort on missions.

Players can purchase smaller AI-controlled aircraft that accompany their main plane during missions.

These aircraft are weaker than player-controlled planes and are intended to support, not replace, human piloting.

### 10.1 Roles

AI escorts may:

- Follow the player's aircraft.
- Attack nearby enemy aircraft.
- Protect bombers.
- Distract automated defenses.
- Conduct limited reconnaissance.
- Defend the player during retreat.

### 10.2 Economic Rules

AI aircraft consume resources when deployed.

They are single-use assets for the mission or sortie.

After the mission, they are removed, even if they survived.

This prevents players from indefinitely accumulating fleets.

### 10.3 Balance

Potential limitations include:

- Maximum two escorts initially.
- Lower durability than human aircraft.
- Inferior aiming and maneuvering.
- Limited weapon effectiveness.
- No independent mission completion.
- High resource cost for stronger variants.

### 10.4 Multiplayer Fairness

AI escorts must not allow wealthy players to overwhelm less wealthy opponents through sheer numbers.

A small fixed squad limit is preferable to unrestricted deployment.

---

## 11. Dynamic Mission Director

### 11.1 Purpose

The mission director is responsible for generating interesting activities, balancing participation opportunities, and creating encounters between players.

It should not predetermine the outcome of battles.

### 11.2 Player Situation

The system tracks:

- Current resources.
- Available aircraft.
- Recent success and failure.
- Preferred mission categories.
- Aggressive activity.
- Territory condition.
- Relative strength.
- Current online status.
- Previous rivalries and interactions.

### 11.3 Newcomer Missions

New players receive simple missions with low risk and suitable rewards.

Examples include reconnaissance, beginner combat against AI targets, and simple deliveries.

Newcomers are initially protected from disproportionate attacks by veteran players.

### 11.4 Intermediate Missions

Players with sufficient resources and experience receive missions involving more difficult targets.

The director can offer coordinated attacks against stronger opponents.

Intermediate players may receive bonuses for taking on dangerous targets.

### 11.5 Advanced Player Missions

Powerful players receive challenging missions that require greater skill and resource investment.

They may become eligible for public bounties based on aggressive actions, demonstrated combat strength, or their threat to other players.

High resource ownership alone should not automatically justify punishment.

### 11.6 Bounties

The game can place a bounty on a threatening player or valuable active aircraft.

Other players receive mission offers to attack or intercept that target.

The bounty should be tied to a specific, fair objective.

Possible objectives include:

- Destroy a hostile bomber.
- Prevent a raid.
- Damage an exposed military installation.
- Successfully intercept a high-threat player.

Rewards may be shared among contributors to a successful objective.

### 11.7 Dynamic Cooperation

The mission director can encourage temporary cooperation without requiring formal teams.

For example, two intermediate players may both be offered an attack against a powerful player's bomber.

The defender may receive a defense mission.

This creates an emergent battle.

### 11.8 Mission Generation Method

The initial mission director should use explicit rules, predefined mission templates, eligibility checks, and weighted selection.

It does not require generative AI.

The system should prioritize suitable missions, activity variety, and meaningful world interactions.

---

## 12. Player Interaction

### 12.1 Conflict

Players can attack each other during missions and, subject to world rules, during free flight.

### 12.2 Cooperation

Players may assist each other during combat, escort missions, or defense.

Formal alliances may be introduced later.

### 12.3 Rivalries

The game records notable interactions, including successful attacks, interceptions, and repeated encounters.

These interactions can influence future missions and create personal stories.

### 12.4 Communication and Mischief

Goofy interactions can include:

- Predefined aircraft emotes.
- Playful sound effects.
- Temporary ink markings.
- Rival banners.
- Non-destructive taunting objectives.

Any communication system should provide appropriate muting and reporting tools.

---

## 13. Economy and Balance

### 13.1 Main Economic Principle

An unsuccessful mission should be costly enough to matter, but never prevent a player from continuing to enjoy the game.

### 13.2 Starter Safety Net

Every player must be able to access a basic aircraft.

Possible implementations include a free emergency plane or protected resource regeneration.

### 13.3 Resource Sinks

Resources leave the economy through:

- Aircraft construction.
- Ammunition expenditure.
- Defensive installations.
- Repairs.
- AI escorts.
- Failed missions.
- Vulnerable resource losses from bombing.

### 13.4 Resource Sources

Resources enter the economy through:

- Territory production.
- Mission rewards.
- Defensive rewards.
- Objective participation.
- Special events.

### 13.5 Preventing Snowballing

The game should avoid giving wealthy players endlessly compounding advantages.

Controls may include resource caps, increasing maintenance costs, diminishing raid rewards, limited defense slots, and stronger challenge opportunities.

### 13.6 Preventing Exploits

Repeated attacks between cooperating accounts should not allow unlimited resource farming.

Mission rewards must be validated by the authoritative game server.

---

## 14. Cosmetic Monetization

**Planned for a later version, after the core game is established.**

The game can offer purchasable cosmetic aircraft skins and decorations.

Examples include:

- Colored paper designs.
- Patterned origami aircraft.
- Notebook-paper and newspaper textures.
- Stickers, symbols, and drawings.
- Special folding animations.
- Custom visual trails.
- Unique crumpling effects.
- Decorative territory themes.

Purchases must not increase aircraft performance, damage, ammunition, resource production, or defensive effectiveness.

The intended model is cosmetic-only monetization rather than pay-to-win progression.

---

## 15. User Interface

The UI is read at a glance, not read like a document (redesigned in version 0.0.7).

### 15.1 Principles

- **Icon + number.** A value with an icon shows only the icon and the number; the icon's name is its tooltip.
- **One to three words** for titles, buttons and alerts, from one short-phrase dictionary. No sentences on the HUD: sentences live in tooltips, first-time tips and the logbook.
- **Show what matters now.** Each state shows only its panels; in a fight the less urgent ones step back.
- **Details on demand.** Hover for a tooltip, click to inspect, hold H for key hints, the logbook for history.
- **Colour and shape carry state**, never colour alone: blue friendly, red hostile, amber warning, green good, grey off, with pips, icons and dots alongside.

### 15.2 Style

Panels are cut card stock with a folded corner and a soft shadow, semi-opaque over the world. One line-icon family, one bold tabular face for numbers and one plain face for the few words left, three sizes. Motion is short: panels fold in, deltas pop and fade. Everything is built from design tokens and a few shared components (card, chip, tag, button with key cap, bar, stat, pips, tooltip, alert).

### 15.3 Layout

Fixed zones, the same in every state:

| Zone | Flying | At the desk | Base management |
|---|---|---|---|
| Top left | Paper, production, storage | Paper, production, storage; Base, Logbook, Menu buttons | Paper / capacity, production, protected paper |
| Top centre | Objective, threat panel, raid alert, alerts, tips | Alerts, tips | Weapons ready, radar, base condition; alerts |
| Top right | Mini-map with T1's radar | Mini-map; mission cards below | Mini-map |
| Bottom left | Health, range | Aircraft inspector | Build tray |
| Bottom centre | Speed, altitude, boost; landing checks | Garage | Slot inspector |
| Bottom right | Ink, bombs | Fold / launch | Repair all, Done |

The centre stays clear for flying and aiming. A HUD size setting (S / M / L) scales every zone from its own corner.

### 15.4 Territory Interface

Base management (B) at home: the camera rises above the home territory, every construction slot gets a marker (what stands there, its level and health, whether the chosen building fits), a see-through preview shows where a building would go, and the inspector shows health, stats, upgrade, repair and removal with their costs (and the paper still missing).

### 15.5 Aircraft Selection

Plane cards show the price as an icon and a number, the fit for the chosen mission as an icon; the inspector shows ratings as icons and pips and the loadout as numbers.

### 15.6 Flight Interface

Health and range bars, speed, altitude and boost, ink as a number and bombs as pips, the current objective with its distance, progress and clock, the threat panel and ring, rocket lock, aircraft markers with an icon for what each is doing, and at most three alerts.

### 15.7 Mission Results

A headline and medal, four big numbers (net paper, destroyed, damage, time), bonuses and records as chips, and the full breakdown behind Details. Raids on the home territory end with a defense report: raiders downed, paper lost or saved, structures hit, repair cost and one line on what decided it.

### 15.8 Learning Without Text

First-time tips appear once per save, next to what they explain; key hints show for the first sorties, then on H or by setting; every icon has a tooltip.

---

## 16. Technical Architecture

### 16.1 Intended Technology

A possible browser-native architecture:

- PlayCanvas and TypeScript for the 3D game.
- Blender for 3D assets.
- React for larger menus when necessary.
- Node.js and Colyseus for multiplayer.
- PostgreSQL for persistent state.
- WebSockets for real-time communication.

### 16.2 Multiplayer Authority

The multiplayer server is authoritative for:

- Aircraft movement validation.
- Weapon hits.
- Damage.
- Mission completion.
- Resource transactions.
- Territory ownership.
- Defense behavior.
- AI escort behavior.

### 16.3 Persistence

Persist:

- Player accounts.
- Territory ownership.
- Resource balances.
- Mission records.
- Campaign progress.
- Cosmetics and achievements.

### 16.4 Performance

Optimize for:

- Desktop browsers.
- Low-poly geometry.
- Small numbers of simultaneous aircraft.
- Predictable network bandwidth.
- Lightweight world environments.
- Interest-based network updates as the game expands.

---

## 17. Development Roadmap

### Version 0.0.1: Bombing Prototype

Single-player world with square territories, one paper plane, one resource, and one bombing mission.

### Version 0.0.2: Flight and Mission Polish

Better controls, feedback, landing, crashes, and improved target indicators.

### Version 0.0.3: Aircraft Variety

Fighter, bomber, and reconnaissance plane patterns with different costs and flight characteristics.

### Version 0.0.4: Automated Territory Defenses

Single-player still. Territories have threat levels (unprotected, light, guarded, fortified) and the defenses to match: ink turrets, paper rocket launchers and radar stations that detect, track and shoot at the player, with blind spots, limited accuracy and travel time. New mission types built around them (suppression, dangerous reconnaissance, fortified bombing, multi-stage strikes, survival, low-altitude attacks), risk-based rewards, and warnings that make every hit readable.

### Version 0.0.5: AI Aircraft and Interception

Single-player still. AI-controlled paper planes fly the same flight model as the player's: scouts that run, fighters that dogfight and bombers that make steady runs, at rookie, regular and veteran skill. Enemy bombers raid the player's home territory, whose own turrets fight back; intercepting them pays, and a hit costs a capped amount of paper above a protected minimum. New mission types (dogfight, scout and bomber interception, bomber escort, airspace patrol, combined attack), ambient patrols over enemy territory, aim assistance, aircraft markers and combat feedback.

### Version 0.0.6: Dynamic Missions, Progression and Game Balance

Single-player still. A mission director deals a safe, a balanced and a high-risk card from templates and explicit rules, adapting tiers (easy to very hard) to a rolling performance rating, with recovery missions, variety memory, eligibility checks and limited swaps. Rewards follow R = B × D × M, balanced against plane costs, with a free emergency Dart and capped home production. World events (raids, high-value shipments, convoys, supply runs) and territory states, short multi-sortie operations, medals, records, streaks, aircraft mastery, achievements, a local save, and developer tools for the director and the economy.

### Version 0.0.7: Territory Management, Base Building and a New HUD

Single-player still. The home territory becomes a base the player builds in fixed slots (defense, radar, economy, utility): ink turrets and paper rocket launchers built on the 0.0.4 defense systems (magazines, bomber-first targeting, three levels each), a radar station for early warning, paper workshops for production and storage boxes for capacity and protected paper. Buildings are damaged by raids and stay damaged until repaired with paper; they can be upgraded, or removed for a partial refund. Raids target buildings, are announced only once detected, destroy a share of vulnerable paper and end with a defense report; the mission director paces them. The HUD is redesigned: fixed zones, icon-and-number values, short alerts, first-time tips instead of rules to read, key hints that fade after the first sorties, and a HUD size setting.

### Version 0.0.8: World Expansion, Visual Identity and Player Experience

Single-player still. The game gets its permanent look: a playable sketchbook with pencil outlines, paper materials and soft cartoon light (see §2.1). The abstract grid becomes a classroom: territories become themed desks and cardboard platforms (Notebook, Cardboard, Graph Paper, Colored Paper, Art Desk) with names (Home Desk, Pencil Point, Notebook Ridge, Eraser Fields, Ink Valley, Cardboard Fort, Ruler Crossing, Paper Citadel, Scrap Corner), landmarks, props and a few obstacles. Licensed environment assets can be dropped in without being committed. New players get an interactive tutorial, the home base a unified dashboard, and the mission loop quick rebuild, repair and rearm, clearer rewards and failure reasons. Paper-themed audio, effects and animation, graphics presets and accessibility settings.

Built in reviewable phases with developer checkpoints: (1) visual vertical slice on one territory, (2) world expansion, (3) territory identity and navigation, (4) home dashboard and onboarding, (5) gameplay flow and polish, (6) testing and refinement. Phase 1 shipped; phases 2 to 6 are completed in version 0.0.11 alongside the full asset integration.

### Version 0.0.9: Core Multiplayer

Up to eight players share a classroom on an authoritative Node + Colyseus server: they join an ongoing session, claim one of eight territories as their base (the centre stays the AI's), and fly together. The server runs single-player's rule classes for every player (economy, base, mission board, sortie) and decides every position, hit, kill, balance and reward; clients send input frames and commands, predict their own plane and interpolate everyone else's. Player-versus-player combat with kill and assist credit and bounties that can't be farmed; raid missions against eligible player bases with capped losses above the protected reserve, new-player protection, shields, cooldowns and decaying rewards; defenders warned, given an interception card and backed by their guns; rival missions (raid, scout, shoot down, intercept) alongside each player's own board; names, tags, a scoreboard, a kill feed and emotes (no chat); reconnection with a grace period. Sessions live in memory. Built in eight reviewable phases with bots and a load test; see [MULTIPLAYER.md](MULTIPLAYER.md).

### Versions 0.0.10 to 0.0.20: towards the first public release

Each version has a detailed plan in [docs/roadmap/](roadmap/README.md). Version 0.0.9's multiplayer becomes a persistent private alpha first, so two real players test every version that follows.

### Version 0.0.10: Persistent Multiplayer and Private Alpha

Lightweight secure player identity, PostgreSQL persistence for territories, buildings, resources, aircraft and progression, duplicate-proof server-authoritative transactions, defined rules for interrupted sorties, one persistent world that survives everyone leaving and a server restart, offline protection, a hardened server, and an externally reachable invite-only deployment (HTTPS, secure WebSockets) for the developer and one friend, with a feedback log and deployment and restore docs. See [v0.0.10](roadmap/v0.0.10.md).

### Version 0.0.11: Art Integration and Controller Support

Synty environment models adapted to the sketchbook look, the five custom aircraft (Dart, Falcon, Widewing, Shadow, Courier), custom buildings with construction, damage and repair states, all nine territories completed (the remaining v0.0.8 phases), browser delivery and performance work, and full gamepad support through one input-action layer shared with keyboard and mouse. See [v0.0.11](roadmap/v0.0.11.md).

### Version 0.0.12: HUD and UI Revamp

A paper-and-pencil UI design system, a rebuilt flight HUD and management screens, a multiplayer HUD, focus-first controller navigation, device-aware hints, responsive layout and accessibility. See [v0.0.12](roadmap/v0.0.12.md).

### Version 0.0.13: Audio and Music Revamp

Audio buses and mixing, positional audio, adaptive music, a paper-themed sound library, territory ambience and multiplayer cues. See [v0.0.13](roadmap/v0.0.13.md).

### Version 0.0.14: Menus, Settings and Branding

Logo and branding, main menu, lobby, full settings with rebinding, loading screens, transitions, a first-launch flow and clear error screens. See [v0.0.14](roadmap/v0.0.14.md).

### Version 0.0.15: Economy and Content Depth

Ink and rubber balls as real resources (§4.2), upkeep and caps against snowballing (§13.5), stunt, exploration and timed missions, multiplayer world events, server-side medals and achievements, and an economy simulator. See [v0.0.15](roadmap/v0.0.15.md).

### Version 0.0.16: Advanced Multiplayer

AI escort aircraft (§10), mission director bounties and rivalries (§11), cooperation offers between players, deeper raids, reputation, social features with mute and report (§12), and anti-farming rules. See [v0.0.16](roadmap/v0.0.16.md).

### Version 0.0.17: World Scale and Environments

12 to 16 territories per world, new environments (bedroom, library, art room), interest-based network updates (§16.4), regional servers and level of detail. See [v0.0.17](roadmap/v0.0.17.md).

### Version 0.0.18: Customization and Social

Cosmetic-only aircraft and territory customization (§5.6), earned cosmetics, an inventory, friends and small alliances. See [v0.0.18](roadmap/v0.0.18.md).

### Version 0.0.19: Public Readiness

Public accounts, matchmaking, the campaign lifecycle and resets (§3.3), inactivity rules (§3.4), moderation and abuse prevention, privacy-light analytics, legal compliance and scalable infrastructure. See [v0.0.19](roadmap/v0.0.19.md).

### Version 0.0.20: Release Candidate

LiveOps tools, cosmetic shop infrastructure behind a disabled flag, a tutorial retuned from playtests, a browser matrix, support channels and a feature freeze. See [v0.0.20](roadmap/v0.0.20.md).

### Version 0.1.0: First Public Release (Public Alpha)

After 0.0.20, staged testing rounds (developer and friend, a small invited group, a larger closed test); only their fixes and balance changes ship as 0.1.0. See [v0.1.0](roadmap/v0.1.0.md).

Version numbering from here: 0.1.x are small improvements, 0.x.0 are major versions, and 1.0.0 is the first full version. Cosmetic monetization (§14) is enabled in a later major version, only after the core gameplay and retention have been validated.

---

## 18. Core Success Criteria

The design succeeds when:

1. A newcomer can join and begin flying within approximately one minute.
2. The player understands how to earn and spend paper without extensive instructions.
3. Different aircraft lead to meaningful mission decisions.
4. A bombing mission creates a fair, understandable opportunity for the defender to respond.
5. Mission rewards create interesting choices rather than repetitive grinding.
6. Defeat does not prevent further play.
7. Players can find engaging activities even when server population is low.
8. Veterans remain challenged without dominating newcomers.
9. Players voluntarily return to the game because of enjoyable flight, meaningful choices, and ongoing rivalries.
10. The game remains understandable, accessible, and fun without requiring complex strategic knowledge.

**Central design principle:** The mission director creates opportunities for conflict; the players create the stories.

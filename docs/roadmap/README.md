# paperwars.io roadmap: v0.0.10 to v0.1.0

This folder holds the detailed development plan for every version between the core multiplayer
release (v0.0.9) and the first public release (v0.1.0). The summary lives in
[GDD §17](../GDD.md#17-development-roadmap); each version below has its own plan with goals,
requirements, testing, scope boundaries, developer responsibilities, implementation phases and a
definition of done.

The current order was set on 2026-11-07 (see [the decisions](#decisions-of-2026-11-07)): the
gameplay and world versions come first, then one pass that finalises the HUD, UI and pages, then
audio, and the public launch versions last. Earlier reorganisations are recorded in the decision
tables below; version numbers in them are the current ones.

## Version numbering

| Version | Meaning |
|---|---|
| 0.0.x | Pre-release development versions. 0.0.10 to 0.0.28 complete the game for its first public release. |
| 0.1.0 | First public release (public alpha): the fixes from the testing period after 0.0.28, and no new features. |
| 0.1.x | Small improvements and fixes after a major version. |
| 0.x.0 | Major versions (for example 0.2.0). |
| 1.0.0 | The first full version of the game. |

Every version is built in reviewable phases with developer checkpoints. A phase is complete when
its behaviour is verified through automated tests, browser testing and real play where possible,
not because the code compiles. Working features from earlier versions are preserved.

## The versions

| Version | Theme | Summary |
|---|---|---|
| [v0.0.10](v0.0.10.md) | Player identity and the database | **Done after phase 3** (closed): device tokens, invites, transfer codes, one connection per player, PostgreSQL with migrations and an idempotent ledger. Its later phases moved to v0.0.12 to v0.0.14. |
| [v0.0.11](v0.0.11.md) | Art integration and controller support | **Coding done:** the 16-desk classroom, 11 aircraft, custom buildings, themed desks, controller support, tutorial, performance. Its hardware checks and playtest move to v0.0.14. |
| [v0.0.12](v0.0.12.md) | Persistent, portable bases | **Done (all six phases, 2026-11-05)**; the developer plays the retune at the checkpoint. A base belongs to the player and is placed on any desk; every paper change through the ledger; production only while online; dearer planes and slower paper; saved planes, missions and progress; fairness timers that survive restarts; usernames and "{username}'s desk". |
| [v0.0.13](v0.0.13.md) | Sessions | **Done (all seven phases, 2026-11-05)**; the developer confirms the provisional timers. Timed sessions with a capacity, several at once; random desk placement; the territory lifecycle (draining, empty, open, AI-held); raids that finish even if the defender leaves; flight across disconnects; no practice targets; saving, shutdown, restore and crash recovery; hardening and logs. |
| [v0.0.14](v0.0.14.md) | **Going live** | **Live since 2026-11-06** (Railway and Vercel, nightly backups with the drill, uptime check, load test on the deployment); the online playtest with the friend is next. **The whole multiplayer system on the internet:** the server and database on Railway, the game on Vercel, invite-only access, a minimal admin endpoint, daily backups with a tested restore, logs and an uptime check, the F8 feedback log, tests at scale, the first online playtest, and a **step-by-step setup guide for the developer**. |
| [v0.0.15](v0.0.15.md) | HUD and UI revamp | **Coded (all nine phases, 2026-11-06)**; the developer does the hardware walkthroughs and the two-player playtest. One design system after the developer's style guide (two themes, Lilita One / Nunito / Kalam, Lucide icons), rebuilt HUD, management and multiplayer screens, focus-first controller navigation, device-aware hints, responsive layout, accessibility, localisation-ready text. Pencil outlines removed; Medium as the default preset. Raptor finalised. |
| [v0.0.16](v0.0.16.md) | **Flight maneuvers** | **Coded (2026-11-07)**, redesigned from the developer's brief; the developer flies every move and approves the tuning. **Automatic** maneuvers (eight, on Left Alt / A): the **Crane Flip**, Fold Back, Dive Fold, Slip Roll, Updraft Roll, Paper Hang, Spiral Drill and Paper Pivot, a set per design and **one slot per plane chosen before each take-off**; **manual** maneuvers through the flight model (air brake, slower turns tighter, loops). Bombers have none. Maneuver camera, HUD slot and pad picker, server-validated and predicted, used by AI pilots by skill. |
| [v0.0.17](v0.0.17.md) | **Player ranks** | Cosmetic-only ranks from **Blank Page** to **Head of the Class** (15 ranks, 48 levels, then Honor Roll stars), earned as Merit on the server through an idempotent ledger; insignia, profile cards, titles, pennants, trails and auras; promotions that never interrupt a fight. |
| [v0.0.18](v0.0.18.md) | Economy and content depth | Ink and rubber balls as real resources, upkeep and caps, more missions, **world events in sessions**, **medals, records and the logbook in multiplayer**, stealth. Lightning and Thug finalised. |
| [v0.0.19](v0.0.19.md) | Advanced multiplayer | AI escorts, bounties and rivalries, **three kinds of raid (bombing, strike, challenge)**, **alliances for a session**, **escorting real players**, reputation, social features with mute and report, anti-farming. Ghost and Specter finalised. |
| [v0.0.20](v0.0.20.md) | **Maps** | Nine maps, each one room or area with 16 territories: indoor (classroom, science lab, library, cafeteria, gym, bedroom) and outdoor (playground, backyard, rooftop). A data-driven map framework, furniture to fly through, cover from defenses, sessions on any map. |
| [v0.0.21](v0.0.21.md) | **World conditions** | Ceiling and small fans whose blades destroy planes instantly, one airflow system (downdrafts, sweeping fan wind, updrafts, gusts), rain showers that come and go and soak planes, rare indoor sprinklers, day and night, lights out with lit bases and night vision, bursting beakers, burners, birds, fog; a conditions director that announces everything. |
| [v0.0.22](v0.0.22.md) | World scale | **Sessions of up to 32 players** on larger layouts of every map, interest-based network updates, regional servers, level of detail, the hover mode; Jumper hover, **Wasp and Hawk** helicopters. |
| [v0.0.23](v0.0.23.md) | Customization and social | Cosmetic-only aircraft and desk customization, earned cosmetics, inventory, friends, optional persistent squads. |
| [v0.0.24](v0.0.24.md) | HUD, UI and pages finalization | One pass over everything a player sees once every feature exists: the final HUD and screens for the features of v0.0.18 to v0.0.23, logo and branding, the main menu, the session lobby, full settings with rebinding, loading screens, transitions, error screens, credits and a first-launch flow. |
| [v0.0.25](v0.0.25.md) | Audio and music revamp | Audio buses and mixing, positional audio, adaptive music and a paper-themed sound library. Lancer finalised. |
| [v0.0.26](v0.0.26.md) | Public readiness | Accounts alongside guests, matchmaking across servers and regions, sessions at scale, moderation as server APIs, abuse prevention, analytics, legal compliance, production infrastructure. |
| [v0.0.27](v0.0.27.md) | **Admin dashboard** | A secure admin web app: live sessions and server health, player support with paper history, moderation queue, feedback, economy, LiveOps (events, news, patch notes, maintenance), backups, an audit log. |
| [v0.0.28](v0.0.28.md) | Release candidate | Shop infrastructure behind a disabled flag, tutorial retune (and a possible tutorial mode), browser matrix, support channels, feature freeze. |
| [v0.1.0](v0.1.0.md) | First public release | Staged testing rounds after 0.0.28; only fixes and balance changes ship. |

## Aircraft roster

Thirteen aircraft, each a folded-paper interpretation of a real aircraft (full table in
[GDD §5.3](../GDD.md#53-aircraft-roster)). Eleven arrived together in v0.0.11 with provisional
stats; later versions finalise their roles and stats, and the two helicopters arrive with the hover
mode:

| Version | Aircraft |
|---|---|
| v0.0.11 | In the game: Swift (starter and emergency plane), Falcon, Dart, Widewing, Raptor, Lancer, Lightning, Thug, Ghost, Specter, Jumper |
| v0.0.12 | Every aircraft dearer to fold (the developer tunes stats later) |
| v0.0.15 | Raptor finalised |
| v0.0.18 | Lightning (with the stealth system) and Thug finalised |
| v0.0.19 | Ghost and Specter finalised |
| v0.0.22 | Jumper gets its hover mode; Wasp and Hawk (helicopters) added: 13 in all |
| v0.0.25 | Lancer finalised (the showcase for the new audio) |

## Why this order

1. **Online first.** v0.0.12 to v0.0.14 finish the multiplayer server for the new design and put
   it on the internet, so the developer and a friend play from their homes and every later
   version is tested online.
2. **The HUD revamp first** (v0.0.15): every later screen and HUD element, including
   the maneuver HUD and the rank cards, is built from its design system.
3. **Maneuvers and ranks straight after it** (v0.0.16, v0.0.17): maneuvers change how every fight
   plays, so they are tested online early and the stunt missions, medals and AI of later versions
   are built with them in place; ranks use the design system for their cards.
4. **Gameplay before presentation.** The economy (v0.0.18) comes before advanced multiplayer
   (v0.0.19) because bounties, escorts, challenges and raid losses depend on the final resource set.
5. **Maps and world conditions (v0.0.20, v0.0.21)** are built once the game's systems are complete
   (missions, events, raids and AI all have to work on every map), and the conditions need the maps.
6. **Scale (v0.0.22) after the systems it scales:** 32-player sessions on every map, regions and
   helicopters.
7. **Customization and social (v0.0.23)** once the aircraft roster, the maps and the ranks are
   final, so cosmetics are made for what actually ships.
8. **One finalization pass for the HUD, UI and pages (v0.0.24)** after every feature that needs a
   screen exists, so the menus, lobby, settings and rebinding are designed once for the whole game
   instead of being redone each time a feature lands. Until then, new screens use the v0.0.15
   design system as they are built.
9. **Audio (v0.0.25) after that:** every plane, map, condition and screen is in place, so the sound
   library, ambience and music are made once. Until then, new features use short placeholder cues
   in the existing synthesised sound code.
10. **Public-facing systems come late** (v0.0.26), so accounts, matchmaking and moderation are built
    for the finished game, followed by **the admin dashboard (v0.0.27)** to run them, before
    strangers arrive.
11. **The cosmetic shop is built in v0.0.28 but stays disabled** until retention is proven after the
    public release (GDD §14).

## What the developer supplies

| Version | Developer input |
|---|---|
| v0.0.12 | Approval of the price and production retune, the username rules and the goofy desk names (all approved 2026-11-05; the retune is confirmed by playing it at the phase 3 checkpoint) |
| v0.0.13 | Approval of the session length and capacity, the lifecycle timers, the arrival grace and the combat window (all provisional in `src/config.ts`) |
| v0.0.14 | Railway, Cloudflare and UptimeRobot accounts (following the setup guide), the invited friend, the online playtest, a real controller and two test computers |
| v0.0.15 | Approval of the UI style and icon set |
| v0.0.16 | Approval of the maneuver names, inputs and per-aircraft sets; flying every move on keyboard and a real controller; an online dogfight with the friend |
| v0.0.17 | Approval of the rank names, rewards, titles and Merit curve; insignia and card designs (or art) |
| v0.0.18, v0.0.19 | Balance and design approval, aircraft stats, playtesting |
| v0.0.20 | Approval of the maps, layouts and names at the greybox checkpoint; models for each map (or owned assets) |
| v0.0.21 | Approval of the conditions per map, soak, shower and lights-out values, night vision and navigation lights; models and effects for fans, sprinklers, beakers and birds |
| v0.0.22, v0.0.23 | Balance and design approval, aircraft stats, playtesting |
| v0.0.24 | Logo, branding approval, main menu approval, credits list |
| v0.0.25 | Commissioned or licensed music and sound effects, with licences |
| v0.0.26 | Legal texts (privacy policy, terms), OAuth app registrations, production infrastructure budget |
| v0.0.27 | Admin roles, two-factor setup, a week of using the dashboard |
| v0.0.28 | Payment provider choice (kept disabled), support channel setup |
| v0.1.0 | Tester recruitment, go/no-go decision |

## Decisions of 2026-11-02

The developer's answers at v0.0.10's checkpoint and after v0.0.11, and where each one is built:

| Topic | Decision | Built in |
|---|---|---|
| Bases | A base belongs to the player and travels with them; each session places it on a random free desk, exactly as it was left | v0.0.12, v0.0.13 |
| Production | Only while the player is online in a session; slower overall | v0.0.12 |
| Prices | All aircraft dearer to fold; the developer tunes stats later | v0.0.12 |
| Names | Players choose a username; desks are "{username}'s desk"; AI desks get goofy names ("Billy's desk") | v0.0.12 |
| Public ids | Kept (random, reveal nothing); usernames are what players see | v0.0.12 |
| Transfer codes | Using one adds a device; the old one keeps working; the developer can log out every device | v0.0.10 (done) |
| Sessions | Timed sessions holding 16 to 32 players, several at once; players come and go | v0.0.13, v0.0.22 |
| Empty desks | Empty for a gap after a player leaves, then open to players, then the AI after a longer wait; a player replaces an AI desk at once | v0.0.13 |
| AI desks | No fixed AI desk: the AI holds whichever desks players don't | v0.0.13 |
| Practice targets | Removed from sessions; maybe a tutorial mode later | v0.0.13, v0.0.28 |
| Flight across disconnects | The proposed rules; no fuel, a player can always land, rearm and carry on | v0.0.13 |
| Raid when the defender leaves | It continues normally with normal losses; their defenses stay active until it is settled; then the desk's gap starts; no new raids on players who are away | v0.0.13 |
| Damaging bases | Only through a raid card; raids can be bombing, a strike on infrastructure, or a challenge to a dogfight that costs paper if declined | v0.0.19 |
| Teams | Free-for-all for now; alliances that last only for a session; escorting real players | v0.0.19 |
| PvP values | Kept for the alpha, tuned from the playtests and the feedback log | v0.0.14 onward |
| Look | No pencil strokes or borders: the normal 3D look | v0.0.15 |
| Synty | Not bought; the developer's own models cover the main assets | v0.0.11 |
| Hosting | The game on Vercel, the server and database on Railway (cheap, reliable, WebSockets), movable later | v0.0.14 |
| Accounts | Guests and signed-in players play together | v0.0.26 |
| Admin | A complete admin dashboard before the public launch | v0.0.27 |
| World events, medals, records, logbook in multiplayer | Yes | v0.0.18 |

## Decisions of 2026-11-06

The developer asked for two new versions, early in the roadmap:

| Topic | Decision | Built in |
|---|---|---|
| Maneuvers | Big, easy dogfight moves for fast planes, not realistic physics: brake hard, flip, end up behind the chaser (the feel of the Su-57 in *Top Gun: Maverick*). Several moves, each easy to know how to do: one Trick button plus a direction | v0.0.16 |
| Player ranks | Ranks that keep going up, like soldier ranks, with creative game-themed names instead of military ones; cosmetic only (effects, profile cards, aura), nothing extra in the game | v0.0.17 |
| Placement | Both right after the HUD revamp (v0.0.15, already in progress, kept its number): maneuvers v0.0.16, ranks v0.0.17; the versions after them moved up by two | 2026-11-06 |

## Decisions of 2026-11-06 (world)

After a brainstorm with the developer, two more versions before world scale:

| Topic | Decision | Built in |
|---|---|---|
| Maps | One room or area per map, never several connected rooms; indoor and outdoor maps are different kinds | v0.0.20 |
| Map list | Classroom, Science Lab, Library, Cafeteria, Gym, Bedroom (indoor); Playground, Backyard, Rooftop (outdoor). The art room planned in world scale is dropped | v0.0.20 |
| Fans | Ceiling fans and small fans destroy a plane instantly on their blades; ceiling fans make a slight constant downdraft; small fans a stronger wind that keeps changing direction | v0.0.21 |
| Rain | Changes handling and gives planes a limited life (soak); always temporary, it comes and goes during a session | v0.0.21 |
| Indoor sprinklers | A rarer rain alternative indoors | v0.0.21 |
| Day and night | Yes, on outdoor maps | v0.0.21 |
| Lights out | Indoors: very dark but slightly visible; a few planes have night vision, most don't; bases keep their building lights and red flashing beacon dots | v0.0.21 |
| Interactive objects | Kept: lab beakers that burst, garden sprinklers (and burners, birds, fog). Dropped: chalk dust, ink bottles, toppling stacks, rubber-band launchers, the school bell | v0.0.21 |
| Placement | Maps v0.0.20 and conditions v0.0.21, before world scale (v0.0.22); world scale's environments section moves to the maps | 2026-11-06 |

## Decisions of 2026-11-07

The developer set the order of every version after player ranks (v0.0.17):

| Topic | Decision | Built in |
|---|---|---|
| Order | Economy and content depth, advanced multiplayer, maps, world conditions, world scale, customization and social, HUD/UI/pages finalization, audio, public readiness, admin dashboard, release candidate, first public release | v0.0.18 to v0.1.0 |
| Menus, settings and branding | Folded into the HUD, UI and pages finalization, which also finishes the screens of every feature added in between | v0.0.24 |
| Audio | Moved after the finalization, so the sound library is made once for the finished game; the Lancer is finalised with it | v0.0.25 |
| Renumbering | Economy v0.0.20 → v0.0.18, advanced multiplayer v0.0.21 → v0.0.19, maps v0.0.22 → v0.0.20, conditions v0.0.23 → v0.0.21, world scale v0.0.24 → v0.0.22, customization v0.0.25 → v0.0.23, menus v0.0.19 → v0.0.24, audio v0.0.18 → v0.0.25; v0.0.26 to v0.1.0 unchanged | 2026-11-07 |

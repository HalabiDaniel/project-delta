# paperwars.io roadmap: v0.0.10 to v0.1.0

This folder holds the detailed development plan for every version between the core multiplayer
release (v0.0.9) and the first public release (v0.1.0). The summary lives in
[GDD §17](../GDD.md#17-development-roadmap); each version below has its own plan with goals,
requirements, testing, scope boundaries, developer responsibilities, implementation phases and a
definition of done.

**Reorganised on 2026-11-02** after v0.0.11: the developer changed the multiplayer design
(portable bases and timed sessions, see [the decisions](#decisions-of-2026-11-02)). Three server
versions now come straight after v0.0.11 so the game goes online early (v0.0.12 to v0.0.14), an
admin dashboard version comes before the release candidate (now v0.0.25), and the earlier plans for
v0.0.12 to v0.0.20 moved to what were then v0.0.15 to v0.0.24.

**Two versions added on 2026-11-06:** flight maneuvers (v0.0.15) and player ranks (v0.0.17), placed
early so every later version builds on them (see [the decisions](#decisions-of-2026-11-06)). The
versions after v0.0.14 moved up: the HUD revamp is now v0.0.16 and the release candidate v0.0.26.

## Version numbering

| Version | Meaning |
|---|---|
| 0.0.x | Pre-release development versions. 0.0.10 to 0.0.26 complete the game for its first public release. |
| 0.1.0 | First public release (public alpha): the fixes from the testing period after 0.0.26, and no new features. |
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
| [v0.0.14](v0.0.14.md) | **Going live** | **Phases 1 to 6 coded (2026-11-05); the developer follows the [setup guide](../SERVER_SETUP.md), then the online playtest.** **The whole multiplayer system on the internet:** the server and database on Railway, the game on Vercel, invite-only access, a minimal admin endpoint, daily backups with a tested restore, logs and an uptime check, the F8 feedback log, tests at scale, the first online playtest, and a **step-by-step setup guide for the developer**. |
| [v0.0.15](v0.0.15.md) | **Flight maneuvers** | *Added 2026-11-06.* Five dogfight moves on one Trick button plus a direction: the **Crane Flip** (brake and flip so the chaser overshoots), Fold Back, Dive Fold, Corkscrew and the Paper Hang. Per-aircraft sets and charges, a maneuver camera, flight-school chapter and prompts, server-validated and predicted, used by AI aces. |
| [v0.0.16](v0.0.16.md) | HUD and UI revamp | A paper-and-pencil UI design system, rebuilt HUD and management screens, focus-first controller navigation, responsive layout and accessibility. Pencil outlines removed from the 3D world; Medium as the default preset. Raptor finalised. |
| [v0.0.17](v0.0.17.md) | **Player ranks** | *Added 2026-11-06.* Cosmetic-only ranks from **Loose Leaf** to **Head of the Class** (12 tiers, 34 ranks, then Honor Roll stars), earned as Merit on the server through an idempotent ledger; insignia, profile cards, titles, pennants, trails and auras; promotions that never interrupt a fight. |
| [v0.0.18](v0.0.18.md) | Audio and music revamp | Audio buses and mixing, positional audio, adaptive music and a paper-themed sound library. Lancer finalised. |
| [v0.0.19](v0.0.19.md) | Menus, settings and branding | Logo and branding, main menu, the session lobby, full settings with rebinding, loading screens and a first-launch flow. |
| [v0.0.20](v0.0.20.md) | Economy and content depth | Ink and rubber balls as real resources, upkeep and caps, more missions, **world events in sessions**, **medals, records and the logbook in multiplayer**, stealth. Lightning and Thug finalised. |
| [v0.0.21](v0.0.21.md) | Advanced multiplayer | AI escorts, bounties and rivalries, **three kinds of raid (bombing, strike, challenge)**, **alliances for a session**, **escorting real players**, reputation, social features with mute and report, anti-farming. Ghost and Specter finalised. |
| [v0.0.22](v0.0.22.md) | World scale and environments | **Sessions of up to 32 players** on larger layouts, new environments, interest-based network updates, regional servers, level of detail, the hover mode; Jumper hover, **Wasp and Hawk** helicopters. |
| [v0.0.23](v0.0.23.md) | Customization and social | Cosmetic-only aircraft and desk customization, earned cosmetics, inventory, friends, optional persistent squads. |
| [v0.0.24](v0.0.24.md) | Public readiness | Accounts alongside guests, matchmaking across servers and regions, sessions at scale, moderation as server APIs, abuse prevention, analytics, legal compliance, production infrastructure. |
| [v0.0.25](v0.0.25.md) | **Admin dashboard** | A secure admin web app: live sessions and server health, player support with paper history, moderation queue, feedback, economy, LiveOps (events, news, patch notes, maintenance), backups, an audit log. |
| [v0.0.26](v0.0.26.md) | Release candidate | Shop infrastructure behind a disabled flag, tutorial retune (and a possible tutorial mode), browser matrix, support channels, feature freeze. |
| [v0.1.0](v0.1.0.md) | First public release | Staged testing rounds after 0.0.26; only fixes and balance changes ship. |

## Aircraft roster

Thirteen aircraft, each a folded-paper interpretation of a real aircraft (full table in
[GDD §5.3](../GDD.md#53-aircraft-roster)). Eleven arrived together in v0.0.11 with provisional
stats; later versions finalise their roles and stats, and the two helicopters arrive with the hover
mode:

| Version | Aircraft |
|---|---|
| v0.0.11 | In the game: Swift (starter and emergency plane), Falcon, Dart, Widewing, Raptor, Lancer, Lightning, Thug, Ghost, Specter, Jumper |
| v0.0.12 | Every aircraft dearer to fold (the developer tunes stats later) |
| v0.0.16 | Raptor finalised |
| v0.0.18 | Lancer finalised |
| v0.0.20 | Lightning (with the stealth system) and Thug finalised |
| v0.0.21 | Ghost and Specter finalised |
| v0.0.22 | Jumper gets its hover mode; Wasp and Hawk (helicopters) added: 13 in all |

## Why this order

1. **Online first.** v0.0.12 to v0.0.14 finish the multiplayer server for the new design and put
   it on the internet, so the developer and a friend play from their homes and every later
   version is tested online.
2. **Maneuvers straight after going live** (v0.0.15): they change how every fight plays, so they
   are tested online first, and the HUD, audio, stunt missions, medals and AI of later versions
   are built with them in place.
3. **Presentation next** (v0.0.16 to v0.0.19): the UI, audio and menus are built around the
   finished input model (v0.0.11), the maneuvers and the session flow (v0.0.13). **Player ranks
   (v0.0.17)** sit inside it: right after the design system they are drawn with, and before the
   audio (the promotion fanfare) and the lobby (profile cards) that show them.
4. **The economy (v0.0.20) comes before advanced multiplayer (v0.0.21)** because bounties, escorts,
   challenges and raid losses depend on the final resource set.
5. **Scale (v0.0.22) after the systems it scales:** 32-player sessions, regions and helicopters.
6. **Public-facing systems come late** (v0.0.24), so accounts, matchmaking and moderation are built
   for the finished game, followed by **the admin dashboard (v0.0.25)** to run them, before
   strangers arrive.
7. **The cosmetic shop is built in v0.0.26 but stays disabled** until retention is proven after the
   public release (GDD §14).

## What the developer supplies

| Version | Developer input |
|---|---|
| v0.0.12 | Approval of the price and production retune, the username rules and the goofy desk names (all approved 2026-11-05; the retune is confirmed by playing it at the phase 3 checkpoint) |
| v0.0.13 | Approval of the session length and capacity, the lifecycle timers, the arrival grace and the combat window (all provisional in `src/config.ts`) |
| v0.0.14 | Railway, Cloudflare and UptimeRobot accounts (following the setup guide), the invited friend, the online playtest, a real controller and two test computers |
| v0.0.15 | Approval of the maneuver names, inputs and per-aircraft sets; flying every move on keyboard and a real controller; an online dogfight with the friend |
| v0.0.16 | Approval of the UI style and icon set |
| v0.0.17 | Approval of the rank names, rewards, titles and Merit curve; insignia and card designs (or art) |
| v0.0.18 | Commissioned or licensed music and sound effects, with licences |
| v0.0.19 | Logo, branding approval, credits list |
| v0.0.20 to v0.0.23 | Balance and design approval, aircraft stats, playtesting |
| v0.0.24 | Legal texts (privacy policy, terms), OAuth app registrations, production infrastructure budget |
| v0.0.25 | Admin roles, two-factor setup, a week of using the dashboard |
| v0.0.26 | Payment provider choice (kept disabled), support channel setup |
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
| Practice targets | Removed from sessions; maybe a tutorial mode later | v0.0.13, v0.0.26 |
| Flight across disconnects | The proposed rules; no fuel, a player can always land, rearm and carry on | v0.0.13 |
| Raid when the defender leaves | It continues normally with normal losses; their defenses stay active until it is settled; then the desk's gap starts; no new raids on players who are away | v0.0.13 |
| Damaging bases | Only through a raid card; raids can be bombing, a strike on infrastructure, or a challenge to a dogfight that costs paper if declined | v0.0.21 |
| Teams | Free-for-all for now; alliances that last only for a session; escorting real players | v0.0.21 |
| PvP values | Kept for the alpha, tuned from the playtests and the feedback log | v0.0.14 onward |
| Look | No pencil strokes or borders: the normal 3D look | v0.0.16 |
| Synty | Not bought; the developer's own models cover the main assets | v0.0.11 |
| Hosting | The game on Vercel, the server and database on Railway (cheap, reliable, WebSockets), movable later | v0.0.14 |
| Accounts | Guests and signed-in players play together | v0.0.24 |
| Admin | A complete admin dashboard before the public launch | v0.0.25 |
| World events, medals, records, logbook in multiplayer | Yes | v0.0.20 |

## Decisions of 2026-11-06

The developer asked for two new versions, early in the roadmap:

| Topic | Decision | Built in |
|---|---|---|
| Maneuvers | Big, easy dogfight moves for fast planes, not realistic physics: brake hard, flip, end up behind the chaser (the feel of the Su-57 in *Top Gun: Maverick*). Several moves, each easy to know how to do: one Trick button plus a direction | v0.0.15 |
| Player ranks | Ranks that keep going up, like soldier ranks, with creative game-themed names instead of military ones; cosmetic only (effects, profile cards, aura), nothing extra in the game | v0.0.17 |
| Placement | Maneuvers right after going live; ranks right after the HUD revamp. The versions after v0.0.14 move up (v0.0.15 → v0.0.16 up to v0.0.24 → v0.0.26) | 2026-11-06 |

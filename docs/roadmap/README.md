# paperwars.io roadmap: v0.0.10 to v0.1.0

This folder holds the detailed development plan for every version between the core multiplayer
release (v0.0.9) and the first public release (v0.1.0). The summary lives in
[GDD §17](../GDD.md#17-development-roadmap); each version below has its own plan with goals,
requirements, testing, scope boundaries, developer responsibilities, implementation phases and a
definition of done.

## Version numbering

| Version | Meaning |
|---|---|
| 0.0.x | Pre-release development versions. 0.0.10 to 0.0.20 complete the game for its first public release. |
| 0.1.0 | First public release (public alpha): the fixes from the testing period after 0.0.20, and no new features. |
| 0.1.x | Small improvements and fixes after a major version. |
| 0.x.0 | Major versions (for example 0.2.0). |
| 1.0.0 | The first full version of the game. |

Every version is built in reviewable phases with developer checkpoints. A phase is complete when
its behaviour is verified through automated tests, browser testing and real play where possible,
not because the code compiles. Working features from earlier versions are preserved.

## The versions

| Version | Theme | Summary |
|---|---|---|
| [v0.0.10](v0.0.10.md) (in progress: [checkpoint 1](../PERSISTENCE.md)) | Persistent multiplayer and private alpha | Player identity, PostgreSQL persistence, restart recovery, offline protection, a hardened server and an externally reachable, invite-only deployment for the developer and one friend. |
| [v0.0.11](v0.0.11.md) | Art integration and controller support | Synty and custom models throughout, the four existing aircraft remodelled for the new roster (Swift, Falcon, Dart, Widewing), custom buildings, all nine territories finished (v0.0.8 phases 2 to 6), and full gamepad support through one input-action layer. |
| [v0.0.12](v0.0.12.md) | HUD and UI revamp | A paper-and-pencil UI design system, rebuilt HUD and management screens, focus-first controller navigation, responsive layout and accessibility. New aircraft: Raptor. |
| [v0.0.13](v0.0.13.md) | Audio and music revamp | Audio buses and mixing, positional audio, adaptive music and a paper-themed sound library. New aircraft: Lancer. |
| [v0.0.14](v0.0.14.md) | Menus, settings and branding | Logo and branding, main menu, lobby, full settings with rebinding, loading screens and a first-launch flow. |
| [v0.0.15](v0.0.15.md) | Economy and content depth | Ink and rubber balls as real resources, anti-snowball upkeep and caps, more missions, multiplayer world events and server-side progression. New aircraft: Lightning, Thug. |
| [v0.0.16](v0.0.16.md) | Advanced multiplayer | AI escorts, mission director bounties and rivalries, cooperation offers, deeper raids, reputation, social features with mute and report, anti-farming. New aircraft: Ghost, Specter. |
| [v0.0.17](v0.0.17.md) | World scale and environments | 12 to 16 territories, new environments, interest-based network updates, regional servers and level of detail. New aircraft: Jumper, Wasp. |
| [v0.0.18](v0.0.18.md) | Customization and social | Cosmetic-only aircraft and territory customization, earned cosmetics, inventory, friends and small alliances. New aircraft: Hawk. |
| [v0.0.19](v0.0.19.md) | Public readiness | Accounts, matchmaking, the campaign lifecycle, moderation, abuse prevention, analytics, legal compliance and scalable infrastructure. |
| [v0.0.20](v0.0.20.md) | Release candidate | LiveOps tools, shop infrastructure behind a disabled flag, tutorial retune, browser matrix, support channels and feature freeze. |
| [v0.1.0](v0.1.0.md) | First public release | Staged testing rounds after 0.0.20; only fixes and balance changes ship. |

## Aircraft roster

Thirteen aircraft, each a folded-paper interpretation of a real aircraft, arrive across the versions
(full table in [GDD §5.3](../GDD.md#53-aircraft-roster)):

| Version | Aircraft | Running total |
|---|---|---|
| v0.0.11 | Swift (F-16, basic fighter and new starter), Falcon (Su-57, agile stealth fighter), Dart (SR-71, high-speed reconnaissance), Widewing (B-52, heavy bomber): the existing four, remodelled and re-roled. Shadow and Courier are dropped. | 4 |
| v0.0.12 | Raptor (F-22, air superiority) | 5 |
| v0.0.13 | Lancer (B-1B, supersonic bomber) | 6 |
| v0.0.15 | Lightning (F-35, stealth multirole), with the radar signature and stealth system; Thug (A-10, ground attack) | 8 |
| v0.0.16 | Ghost (B-2, stealth bomber), Specter (RQ-4, surveillance drone) | 10 |
| v0.0.17 | Jumper (AV-8B, VTOL fighter), with the hover flight mode; Wasp (AH-6, light attack helicopter) | 12 |
| v0.0.18 | Hawk (AH-64, heavy attack helicopter) | 13 |

v0.0.14, v0.0.19 and v0.0.20 add no aircraft (v0.0.20 is the feature freeze).

## Why this order

1. **Persistence and the private alpha come first** so the developer and a friend play on a real
   server from v0.0.10 onward, and every later version is tested by two real players.
2. **Art and controllers come next** because they complete the look and the input model that the
   UI, audio and menu revamps are designed around.
3. **The economy (v0.0.15) comes before advanced multiplayer (v0.0.16)** because bounties, escorts
   and raid losses depend on the final resource set, and rebalancing a live economy after launch
   is costly.
4. **Public-facing systems (v0.0.19) come late** so accounts, moderation and matchmaking are built
   for the finished game, but before strangers arrive.
5. **The cosmetic shop is built in v0.0.20 but stays disabled** until retention is proven after
   the public release (GDD §14).

## What the developer supplies

| Version | Developer input |
|---|---|
| v0.0.10 | Hosting and database accounts, the invited friend, the acceptance playtest |
| v0.0.11 | Licensed Synty packs, approval of aircraft and building designs, a controller for hardware testing |
| v0.0.12 | Approval of the UI style and icon set |
| v0.0.13 | Commissioned or licensed music and sound effects, with licences |
| v0.0.14 | Logo, branding approval, credits list |
| v0.0.15 to v0.0.18 | Balance and design approval, playtesting |
| v0.0.19 | Legal texts (privacy policy, terms), OAuth app registrations, production infrastructure budget |
| v0.0.20 | Payment provider choice (kept disabled), support channel setup |
| v0.1.0 | Tester recruitment, go/no-go decision |

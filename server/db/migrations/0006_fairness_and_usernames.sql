-- paperwars.io v0.0.12: fairness timers on the player, and usernames.
--
-- New-player protection and the raid shield are real clock times on the player (per world), so a
-- restart, a reconnect or a new session never shortens or lengthens them. Raids and kills are
-- already in pvp_records (0001); they are looked up by either side.
--
-- A username is chosen once by each player and shown everywhere: unique ignoring case, changed at
-- most once a week (the server checks the rules; the database keeps it unique).

alter table progress add column protect_until timestamptz;
alter table progress add column shield_until timestamptz;

create index pvp_records_victim on pvp_records (world_id, kind, victim_id, at desc);

alter table players add column username text check (username ~ '^[A-Za-z0-9_]{3,16}$');
alter table players add column username_changed_at timestamptz;
create unique index players_username on players (lower(username)) where username is not null;

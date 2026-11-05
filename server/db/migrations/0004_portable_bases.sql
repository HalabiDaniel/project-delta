-- paperwars.io v0.0.12: portable bases.
--
-- A base belongs to the player, not to a desk (the developer's decision of 2026-11-02): each
-- session places it on a free desk exactly as it was left. The territory-keyed `buildings` table
-- from 0001 was never written to, so it is replaced without losing anything. `territories` stays:
-- from v0.0.13 it records which desk a base stands on during a session, not ownership.

drop table buildings;

create table bases (
  player_id     uuid primary key references players (id) on delete cascade,
  -- The version of the base's data. A server refuses formats newer than its own.
  format        integer not null default 1 check (format > 0),
  -- Null until the first base has been built and saved: a new player starts with the starter base.
  store_health  integer check (store_health >= 0),
  stats         jsonb not null default '{}'::jsonb,
  -- Where the base stands right now: the room holding it ("<server instance>/<room id>"), the desk,
  -- and a lease the holder renews while it saves. A base with a live lease can't be placed anywhere
  -- else; a lease that runs out (a crashed server) lets it be placed again.
  placed_by     text check (char_length(placed_by) between 1 and 200),
  placed_on     text check (placed_on ~ '^T[1-9][0-9]*$'),
  placed_at     timestamptz,
  lease_until   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((placed_by is null) = (placed_on is null) and (placed_by is null) = (lease_until is null))
);

create table base_buildings (
  player_id   uuid not null references bases (player_id) on delete cascade,
  -- A slot id from BASE.slots in src/config.ts ("D1", ...). The paper store is on `bases`.
  slot        text not null check (slot ~ '^[A-Za-z0-9-]{1,32}$'),
  kind        text not null check (kind in ('turret', 'launcher', 'radar', 'workshop', 'storage')),
  level       integer not null check (level between 1 and 10),
  health      integer not null check (health >= 0),
  -- The base rules' own fields (paper invested, kills, ...), so they can change without a migration each.
  data        jsonb not null default '{}'::jsonb,
  primary key (player_id, slot)
);

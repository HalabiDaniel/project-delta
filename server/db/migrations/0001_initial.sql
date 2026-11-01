-- paperwars.io v0.0.10: the initial schema.
--
-- Every row has a clear owner (a player, a world, or both), and every change to a balance can be
-- explained from the transaction log. Times are timestamptz (UTC). The migration runner applies
-- this file inside one transaction and records it in schema_migrations.

-- ---- Players and their devices ------------------------------------------------------------------

create table players (
  id            uuid primary key,
  -- The short id other players' clients see (schema keys, events). Stable, never reused.
  public_id     text not null unique check (public_id ~ '^[a-z0-9]{6,16}$'),
  -- A changeable label: it never decides ownership.
  display_name  text not null check (char_length(display_name) between 1 and 32),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);

-- Invites: needed for a first join when the server runs with ACCESS=invite.
create table invites (
  id          uuid primary key,
  code_hash   text not null unique,
  label       text not null default '',
  max_uses    integer not null default 1 check (max_uses > 0),
  uses        integer not null default 0 check (uses >= 0),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  check (uses <= max_uses)
);

-- Device tokens, stored only as HMAC-SHA256 hashes (keyed with TOKEN_PEPPER).
create table player_tokens (
  token_hash    text primary key,
  player_id     uuid not null references players (id) on delete cascade,
  origin        text not null check (origin in ('open', 'invite', 'transfer')),
  invite_id     uuid references invites (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index player_tokens_player on player_tokens (player_id);

-- One-time codes that add a device to a player (from the pause menu, or reissued by the developer).
create table transfer_codes (
  code_hash   text primary key,
  player_id   uuid not null references players (id) on delete cascade,
  created_by  text not null check (created_by in ('player', 'admin')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index transfer_codes_player on transfer_codes (player_id);

-- ---- Worlds ---------------------------------------------------------------------------------------

create table worlds (
  id          uuid primary key,
  name        text not null unique,
  -- The save format the world was last written in. A server refuses formats newer than its own;
  -- older ones are upgraded by migrations.
  format      integer not null check (format > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  settings    jsonb not null default '{}'::jsonb
);

-- ---- Territories and bases ------------------------------------------------------------------------

create table territories (
  world_id       uuid not null references worlds (id) on delete cascade,
  territory_id   text not null check (territory_id ~ '^T[1-9][0-9]*$'),
  owner_id       uuid references players (id) on delete set null,
  claimed_at     timestamptz,
  -- Wall-clock protections, so a restart can't end them early: new-player protection and the raid shield.
  protect_until  timestamptz,
  shield_until   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (world_id, territory_id)
);
-- A player owns at most one territory per world.
create unique index territories_one_per_owner on territories (world_id, owner_id) where owner_id is not null;

create table buildings (
  world_id      uuid not null,
  territory_id  text not null,
  -- A slot key from src/defenses/Layout.ts ("pad-1", "store", ...).
  slot          text not null,
  kind          text not null check (kind in ('turret', 'launcher', 'radar', 'workshop', 'storage', 'store')),
  level         integer not null default 1 check (level between 1 and 10),
  health        integer not null check (health >= 0),
  -- Whatever else the base rules keep per building (stats, repair state), so the rules can change
  -- without a migration per field.
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (world_id, territory_id, slot),
  foreign key (world_id, territory_id) references territories (world_id, territory_id) on delete cascade
);

-- ---- Economy --------------------------------------------------------------------------------------

create table balances (
  world_id      uuid not null references worlds (id) on delete cascade,
  player_id     uuid not null references players (id) on delete cascade,
  paper         bigint not null default 0 check (paper >= 0),
  capacity      bigint not null default 0 check (capacity >= 0),
  protected     bigint not null default 0 check (protected >= 0),
  -- When production was last credited (offline production is worked out from here).
  produced_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (world_id, player_id)
);

-- Every change to a balance. The same idempotency key in the same world is the same change: the
-- unique constraint makes a second attempt (a repeated message, a refresh, a retry after a restart)
-- a no-op even when two attempts race.
create table transactions (
  id             bigint generated always as identity primary key,
  world_id       uuid not null references worlds (id) on delete cascade,
  player_id      uuid not null references players (id) on delete cascade,
  idem_key       text not null check (char_length(idem_key) between 1 and 200),
  kind           text not null check (char_length(kind) between 1 and 40),
  amount         bigint not null,
  balance_after  bigint not null check (balance_after >= 0),
  reason         text not null default '',
  reference      text,
  created_at     timestamptz not null default now(),
  unique (world_id, idem_key)
);
create index transactions_player on transactions (world_id, player_id, id desc);

-- ---- Aircraft -------------------------------------------------------------------------------------

create table aircraft (
  id             uuid primary key,
  world_id       uuid not null references worlds (id) on delete cascade,
  player_id      uuid not null references players (id) on delete cascade,
  type           text not null,
  status         text not null check (status in ('ready', 'airborne', 'damaged', 'in-repair', 'destroyed')),
  health         integer not null check (health >= 0),
  loadout        jsonb not null default '{}'::jsonb,
  -- Placeholder for v0.0.18's customisation, so it needs no breaking migration.
  customisation  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  destroyed_at   timestamptz,
  -- A destroyed aircraft stays destroyed.
  check ((status = 'destroyed') = (destroyed_at is not null))
);
create index aircraft_owner on aircraft (world_id, player_id) where status <> 'destroyed';

-- Destroyed is final: no update can bring an aircraft back.
create function aircraft_stay_destroyed() returns trigger language plpgsql as $$
begin
  if old.status = 'destroyed' and (new.status <> 'destroyed' or new.destroyed_at is distinct from old.destroyed_at) then
    raise exception 'aircraft % was destroyed and cannot be restored', old.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger aircraft_stay_destroyed before update on aircraft for each row execute function aircraft_stay_destroyed();

-- ---- Missions and progression ---------------------------------------------------------------------

create table missions (
  id           uuid primary key,
  world_id     uuid not null references worlds (id) on delete cascade,
  player_id    uuid not null references players (id) on delete cascade,
  template     text not null,
  state        text not null check (state in ('offered', 'active', 'completed', 'failed', 'cancelled', 'expired')),
  -- The board card as generated (so a refresh doesn't reroll it).
  spec         jsonb not null default '{}'::jsonb,
  offered_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  outcome      text,
  reward       bigint not null default 0
);
create index missions_player on missions (world_id, player_id, state);

create table progress (
  world_id    uuid not null references worlds (id) on delete cascade,
  player_id   uuid not null references players (id) on delete cascade,
  tutorial    jsonb not null default '{}'::jsonb,
  stats       jsonb not null default '{}'::jsonb,
  unlocks     jsonb not null default '{}'::jsonb,
  -- The mission director's state (history, swaps, adaptive difficulty).
  director    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (world_id, player_id)
);

-- The state behind the PVP rules: raids (for cooldowns and the repeat rule), kills (for the
-- kill-farming window). Shields and protections are on territories.
create table pvp_records (
  id           bigint generated always as identity primary key,
  world_id     uuid not null references worlds (id) on delete cascade,
  kind         text not null check (kind in ('raid', 'kill')),
  attacker_id  uuid references players (id) on delete set null,
  victim_id    uuid references players (id) on delete set null,
  success      boolean,
  at           timestamptz not null default now(),
  data         jsonb not null default '{}'::jsonb
);
create index pvp_records_pair on pvp_records (world_id, kind, attacker_id, victim_id, at desc);

-- ---- Playtest feedback ----------------------------------------------------------------------------

create table feedback (
  id          bigint generated always as identity primary key,
  world_id    uuid references worlds (id) on delete set null,
  player_id   uuid references players (id) on delete set null,
  category    text not null check (category in ('bug', 'frustration', 'interface', 'performance', 'balance', 'missing', 'enjoyment')),
  body        text not null check (char_length(body) <= 4000),
  repro       text check (char_length(repro) <= 4000),
  rating      integer check (rating between 1 and 5),
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

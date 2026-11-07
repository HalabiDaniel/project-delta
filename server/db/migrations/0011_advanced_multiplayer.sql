-- paperwars.io v0.0.19: advanced multiplayer.
--
-- 1. Each player's threat, mutes and reputation counts (server/world/SocialData.ts), saved with
--    their progress in the economy world and checked field by field whenever it is read back.
-- 2. pvp_records also keep what rivalries and reputation are made of: assists, defenses,
--    cooperation, bounties paid between two players and challenges (server/world/Rivalry.ts), and
--    the reward flows the anti-farming rules watch.
-- 3. Reports of one player by another (a reason category, no free text), kept for the developer
--    (the moderation queue is v0.0.26).
-- 4. Pairs of players the anti-farming rules flagged, kept for the developer (never an automatic ban).

alter table progress add column social jsonb not null default '{}'::jsonb;

alter table pvp_records drop constraint if exists pvp_records_kind_check;
alter table pvp_records add constraint pvp_records_kind_check
  check (kind in ('raid', 'kill', 'assist', 'defend', 'coop', 'bounty', 'challenge', 'mischief'));

create table player_reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid references players (id) on delete set null,
  reported_id  uuid references players (id) on delete set null,
  reason       text not null,
  session      text,
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index player_reports_reported on player_reports (reported_id, created_at desc);

create table farm_flags (
  id           bigint generated always as identity primary key,
  world_id     uuid not null references worlds (id) on delete cascade,
  a_id         uuid references players (id) on delete set null,
  b_id         uuid references players (id) on delete set null,
  reason       text not null,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index farm_flags_pair on farm_flags (world_id, a_id, b_id, created_at desc);

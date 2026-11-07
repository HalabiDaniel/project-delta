-- paperwars.io v0.0.17: Merit and player ranks.
--
-- Every Merit award is a row with an idempotency key built from its cause ("kill:<id>",
-- "mission:<id>", "daily:<date>", "backfill:v1"): a retry, a reconnect or a restart never awards
-- the same thing twice. A player's total and rank are derived from the ledger, never stored as a
-- number alone. Merit belongs to the player (their identity), not to a world, and only ever counts:
-- it is never spent, traded or transferred.

create table merit_ledger (
  id          bigserial primary key,
  player_id   uuid not null references players (id) on delete cascade,
  idem_key    text not null check (char_length(idem_key) between 1 and 200),
  source      text not null check (char_length(source) between 1 and 32),
  amount      integer not null check (amount > 0),
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  unique (player_id, idem_key)
);

create index merit_ledger_player on merit_ledger (player_id, id desc);

-- What the player has equipped (title, card, effects turned off) and the highest rank held, so a
-- retuned curve never lowers anyone's rank.
alter table players add column rank_prefs jsonb not null default '{}'::jsonb;

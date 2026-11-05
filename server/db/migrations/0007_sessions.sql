-- paperwars.io v0.0.13: sessions.
--
-- There is no permanent world any more: players meet in timed sessions with a capacity, several at
-- once. Each session is recorded here when it opens and whenever its state changes, for restoring
-- the sessions that were running after a restart and for statistics. What players build and earn is
-- theirs (bases, balances, aircraft, progress), never the session's.

create table sessions (
  id            text primary key,
  title         text not null,
  capacity      integer not null check (capacity > 0),
  status        text not null check (status in ('open', 'closing', 'ended', 'interrupted')),
  peak_players  integer not null default 0 check (peak_players >= 0),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ends_at       timestamptz,
  ended_at      timestamptz
);

create index sessions_status on sessions (status, created_at desc);

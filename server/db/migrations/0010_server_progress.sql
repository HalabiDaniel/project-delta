-- paperwars.io v0.0.18: medals, records, achievements, streaks and aircraft mastery in multiplayer.
--
-- Decided by the server and kept per player in the economy world: the same shape as single-player's
-- ProgressData (src/progress/Progress.ts), checked field by field whenever it is read back. Empty for
-- everyone until their first multiplayer sortie after the upgrade. Single-player keeps its own local
-- progress; the two are never merged.

alter table progress add column profile jsonb not null default '{}'::jsonb;

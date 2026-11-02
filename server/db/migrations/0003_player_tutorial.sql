-- paperwars.io v0.0.11: the interactive tutorial's progress, per player.
--
-- The tutorial belongs to the player, not to a world: finishing it once is enough in every
-- classroom and on every computer. The value is the client's versioned TutorialRecord
-- ({ v, step, skipped }, see src/progress/Tutorial.ts); '{}' means never started.

alter table players add column tutorial jsonb not null default '{}'::jsonb;

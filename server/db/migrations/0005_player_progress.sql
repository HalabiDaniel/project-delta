-- paperwars.io v0.0.12: what travels with a player besides their base.
--
-- `progress` (from 0001) gets the garage: the design chosen and the ids of the cards on the mission
-- board, so a refresh or a new session never rerolls the board and a mission's reward is keyed by
-- the same id for good. The player's first-time tips belong to the player, like the tutorial.

alter table progress add column garage jsonb not null default '{}'::jsonb;

alter table players add column tips jsonb not null default '[]'::jsonb;

-- A mission's outcome is written once: the card's id is the key.
alter table missions add constraint missions_outcome check (state in ('offered', 'active') or resolved_at is not null);

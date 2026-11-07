-- paperwars.io v0.0.18: ink and rubber balls as territory resources.
--
-- Paper keeps its column; ink and rubber balls get their own on the same balance row, behind the
-- same lock. They start null for every existing player: the server fills them the first time the
-- player's base is placed (half of what the base holds, never less than a new player's start), and
-- writes that grant to the ledger with a key of its own ("stock:<player>:ink"), so it happens once.
--
-- Every transaction now says which resource it changed. Existing rows are all paper. Idempotency
-- keys stay unique per world: the keys of ink and rubber changes carry the resource's name.
--
-- Rollback (docs/PERSISTENCE.md): drop the new columns and the inkwell rows; nothing older reads them.

alter table balances add column ink bigint check (ink >= 0);
alter table balances add column rubber bigint check (rubber >= 0);

alter table transactions add column resource text not null default 'paper' check (resource in ('paper', 'ink', 'rubber'));
drop index if exists transactions_player;
create index transactions_player on transactions (world_id, player_id, resource, id desc);

-- The ink well, a new building.
alter table base_buildings drop constraint if exists base_buildings_kind_check;
alter table base_buildings add constraint base_buildings_kind_check check (kind in ('turret', 'launcher', 'radar', 'workshop', 'storage', 'inkwell'));

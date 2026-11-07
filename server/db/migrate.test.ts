import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, MigrationError, type Migration } from './migrate';
import { TEST_DATABASE_URL, testDatabase, type TestDatabase } from './testdb';

describe('the migration files', () => {
  it('are numbered without gaps and start with the initial schema', () => {
    const all = loadMigrations();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]).toMatchObject({ version: 1, name: 'initial' });
    all.forEach((m, i) => expect(m.version).toBe(i + 1));
  });
});

describe.skipIf(!TEST_DATABASE_URL)('migrating PostgreSQL', () => {
  let t: TestDatabase | null = null;
  afterEach(async () => {
    await t?.dispose();
    t = null;
  });

  const tables = async (db: TestDatabase['db']) =>
    (await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = current_schema() order by table_name`)).rows.map((r) => r.table_name);

  it('creates every table on an empty database, then has nothing left to do', async () => {
    t = await testDatabase();
    const first = await migrate(t!.db);
    expect(first.applied.map((m) => m.version)).toEqual(loadMigrations().map((m) => m.version));
    expect(await tables(t!.db)).toEqual(
      expect.arrayContaining(['players', 'player_tokens', 'invites', 'transfer_codes', 'worlds', 'territories', 'bases', 'base_buildings', 'balances', 'aircraft', 'transactions', 'missions', 'progress', 'pvp_records', 'feedback', 'schema_migrations']),
    );
    // v0.0.12: bases belong to players; the territory-keyed buildings table is gone.
    expect(await tables(t!.db)).not.toContain('buildings');
    const second = await migrate(t!.db);
    expect(second.applied).toEqual([]);
  });

  it('lets two servers starting at once apply each migration exactly once', async () => {
    t = await testDatabase();
    const [a, b] = await Promise.all([migrate(t!.db), migrate(t!.db)]);
    expect(a.applied.length + b.applied.length).toBe(loadMigrations().length);
    const { rows } = await t!.db.query('select version from schema_migrations');
    expect(rows).toHaveLength(loadMigrations().length);
  });

  it('applies a new migration on top of the old ones', async () => {
    t = await testDatabase();
    const base = loadMigrations();
    await migrate(t!.db, base);
    const next: Migration = { version: base.length + 1, name: 'add_note', sql: 'alter table worlds add column note text', checksum: 'n1' };
    const report = await migrate(t!.db, [...base, next]);
    expect(report.applied.map((m) => m.name)).toEqual(['add_note']);
    await t!.db.query(`insert into worlds (id, name, format, note) values (gen_random_uuid(), 'w', 1, 'hello')`);
  });

  it('0002 moves persisted emergency Darts to the Swift and leaves every other aircraft alone (v0.0.11)', async () => {
    t = await testDatabase();
    const all = loadMigrations();
    await migrate(t!.db, all.slice(0, 1));
    const db = t!.db;
    const world = (await db.query<{ id: string }>(`insert into worlds (id, name, format) values (gen_random_uuid(), 'w', 1) returning id`)).rows[0].id;
    const player = (await db.query<{ id: string }>(`insert into players (id, public_id, display_name) values (gen_random_uuid(), 'pat001', 'Pat') returning id`)).rows[0].id;
    const plane = async (type: string, loadout: object, status = 'ready') =>
      (await db.query<{ id: string }>(
        `insert into aircraft (id, world_id, player_id, type, status, health, loadout, destroyed_at) values (gen_random_uuid(), $1, $2, $3, $4, 40, $5, $6) returning id`,
        [world, player, type, status, JSON.stringify(loadout), status === 'destroyed' ? new Date() : null],
      )).rows[0].id;
    const emergency = await plane('dart', { emergency: true });
    const folded = await plane('dart', {});
    const falcon = await plane('falcon', { emergency: false });
    const wreck = await plane('dart', { emergency: true }, 'destroyed');
    await migrate(t!.db, all);
    const type = async (id: string) => (await db.query<{ type: string }>('select type from aircraft where id = $1', [id])).rows[0].type;
    expect(await type(emergency)).toBe('swift');
    expect(await type(folded)).toBe('dart');
    expect(await type(falcon)).toBe('falcon');
    expect(await type(wreck)).toBe('dart');
  });

  it('0009 keeps every v0.0.17 balance and transaction, adds ink and rubber balls as unset, and accepts the ink well (v0.0.18)', async () => {
    t = await testDatabase();
    const all = loadMigrations();
    await migrate(t!.db, all.slice(0, 8));
    const db = t!.db;
    const world = (await db.query<{ id: string }>(`insert into worlds (id, name, format) values (gen_random_uuid(), 'w', 1) returning id`)).rows[0].id;
    const player = (await db.query<{ id: string }>(`insert into players (id, public_id, display_name) values (gen_random_uuid(), 'old001', 'Old') returning id`)).rows[0].id;
    await db.query(`insert into balances (world_id, player_id, paper, capacity, protected) values ($1, $2, 240, 500, 75)`, [world, player]);
    await db.query(`insert into transactions (world_id, player_id, idem_key, kind, amount, balance_after, reason) values ($1, $2, 'start:x', 'reward', 240, 240, 'Starting paper')`, [world, player]);
    await db.query(`insert into bases (player_id, store_health) values ($1, 120)`, [player]);
    await db.query(`insert into base_buildings (player_id, slot, kind, level, health) values ($1, 'D1', 'turret', 2, 110)`, [player]);
    await expect(db.query(`insert into base_buildings (player_id, slot, kind, level, health) values ($1, 'E1', 'inkwell', 1, 85)`, [player])).rejects.toThrow();
    await migrate(t!.db, all);
    const bal = (await db.query('select paper, capacity, protected, ink, rubber from balances where player_id = $1', [player])).rows[0];
    expect(bal).toMatchObject({ capacity: '500', protected: '75', ink: null, rubber: null });
    expect(Number(bal.paper)).toBe(240);
    const tx = (await db.query('select idem_key, resource, amount from transactions where player_id = $1', [player])).rows;
    expect(tx).toEqual([{ idem_key: 'start:x', resource: 'paper', amount: '240' }]);
    await db.query(`insert into base_buildings (player_id, slot, kind, level, health) values ($1, 'E1', 'inkwell', 1, 85)`, [player]);
    await expect(db.query(`insert into base_buildings (player_id, slot, kind, level, health) values ($1, 'E2', 'goldmine', 1, 85)`, [player])).rejects.toThrow();
    await expect(db.query(`insert into transactions (world_id, player_id, idem_key, kind, amount, balance_after, resource) values ($1, $2, 'k', 'reward', 1, 1, 'gold')`, [world, player])).rejects.toThrow();
  });

  it('rolls a failing migration back completely', async () => {
    t = await testDatabase();
    const base = loadMigrations();
    await migrate(t!.db, base);
    const broken: Migration = { version: base.length + 1, name: 'broken', sql: 'create table half_done (id int); select * from no_such_table', checksum: 'b1' };
    await expect(migrate(t!.db, [...base, broken])).rejects.toThrow(MigrationError);
    expect(await tables(t!.db)).not.toContain('half_done');
    const { rows } = await t!.db.query('select max(version) as v from schema_migrations');
    expect(Number(rows[0].v)).toBe(base.length);
  });

  it('refuses a database written by a newer server', async () => {
    t = await testDatabase();
    const base = loadMigrations();
    await migrate(t!.db, [...base, { version: base.length + 1, name: 'future', sql: 'select 1', checksum: 'f' }]);
    await expect(migrate(t!.db, base)).rejects.toThrow(/newer version/);
  });

  it('refuses a migration that was edited after it was applied', async () => {
    t = await testDatabase();
    const base = loadMigrations();
    await migrate(t!.db, base);
    const edited = base.map((m, i) => (i === 0 ? { ...m, checksum: 'edited' } : m));
    await expect(migrate(t!.db, edited)).rejects.toThrow(/changed after it was applied/);
  });
});

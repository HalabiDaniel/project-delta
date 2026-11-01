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
      expect.arrayContaining(['players', 'player_tokens', 'invites', 'transfer_codes', 'worlds', 'territories', 'buildings', 'balances', 'aircraft', 'transactions', 'missions', 'progress', 'pvp_records', 'feedback', 'schema_migrations']),
    );
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

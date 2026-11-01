import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './Database';

/**
 * Versioned migrations: `server/db/migrations/NNNN_name.sql`, applied in order, each in its own
 * transaction, recorded in `schema_migrations` with a checksum. The server applies them on start;
 * `npm run db:migrate` applies them by hand.
 *
 * - Several servers starting at once take turns (a PostgreSQL advisory lock).
 * - A database that has a migration this build doesn't know (written by a newer build) is refused.
 * - A migration file changed after it was applied is refused: migrations are never edited, only added.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {}

/** An arbitrary constant: the advisory lock migrations hold while they run. */
const LOCK_KEY = 0x70617065; // "pape"

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const out: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    out.push({ version: Number(m[1]), name: m[2], sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  out.forEach((m, i) => {
    if (m.version !== i + 1) throw new MigrationError(`migrations must be numbered 0001, 0002, ... without gaps (found ${String(m.version).padStart(4, '0')} at position ${i + 1})`);
  });
  return out;
}

export interface MigrationReport {
  applied: Migration[];
  current: number;
}

export async function migrate(db: Database, migrations: Migration[] = loadMigrations(), log: (line: string) => void = () => undefined): Promise<MigrationReport> {
  const client = await db.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`create table if not exists schema_migrations (
      version     integer primary key,
      name        text not null,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )`);
    const { rows } = await client.query<{ version: number; name: string; checksum: string }>('select version, name, checksum from schema_migrations order by version');
    const known = new Map(migrations.map((m) => [m.version, m]));
    for (const row of rows) {
      const m = known.get(row.version);
      if (!m) {
        throw new MigrationError(
          `The database has migration ${row.version} (${row.name}), which this server doesn't know: it was written by a newer version. Update the server instead of running an older one against it.`,
        );
      }
      if (m.checksum !== row.checksum) throw new MigrationError(`Migration ${row.version} (${row.name}) was changed after it was applied. Add a new migration instead of editing an old one.`);
    }
    const done = new Set(rows.map((r) => r.version));
    const applied: Migration[] = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into schema_migrations (version, name, checksum) values ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw new MigrationError(`Migration ${m.version} (${m.name}) failed: ${(error as Error).message}`);
      }
      applied.push(m);
      log(`[db] applied migration ${String(m.version).padStart(4, '0')}_${m.name}`);
    }
    return { applied, current: migrations.length };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

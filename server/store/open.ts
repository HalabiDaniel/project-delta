import { Database, redactUrl } from '../db/Database';
import { migrate } from '../db/migrate';
import { MemoryStore } from './MemoryStore';
import { PgStore } from './PgStore';
import type { Store } from './Store';

/**
 * The store the server runs on: PostgreSQL (migrated to this build's schema first) when there is a
 * database url, else memory.
 */
export async function openStore(databaseUrl: string | null, log: (line: string) => void = console.log): Promise<Store> {
  if (!databaseUrl) return new MemoryStore();
  const db = new Database(databaseUrl, { onError: (e) => log(`[db] connection error: ${e.message}`) });
  try {
    if (!(await db.ping())) throw new Error(`can't reach the database at ${redactUrl(databaseUrl)}`);
    const report = await migrate(db, undefined, log);
    log(`[db] ${redactUrl(databaseUrl)}: schema version ${report.current}${report.applied.length > 0 ? ` (${report.applied.length} applied now)` : ''}`);
    return new PgStore(db);
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
}

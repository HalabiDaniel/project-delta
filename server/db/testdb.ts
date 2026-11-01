import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { Database } from './Database';

/**
 * A private, throw-away schema in the test database (TEST_DATABASE_URL), so test files can run in
 * parallel without seeing each other's rows and nothing outside the schema is touched. Returns
 * null when there is no test database: those tests are skipped (and say so).
 *
 *   TEST_DATABASE_URL=postgres://paperwars:paperwars@localhost:5432/paperwars_test npm test
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || null;

export interface TestDatabase {
  db: Database;
  schema: string;
  /** A url that lands in the same schema (for code that opens its own connection). */
  url: string;
  dispose(): Promise<void>;
}

export async function testDatabase(): Promise<TestDatabase | null> {
  if (!TEST_DATABASE_URL) return null;
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const u = new URL(TEST_DATABASE_URL);
  u.searchParams.set('options', `-c search_path=${schema}`);
  const url = u.toString();
  const db = new Database(url, { max: 12 });
  return {
    db,
    schema,
    url,
    async dispose() {
      await db.close();
      const c = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await c.connect();
      await c.query(`drop schema if exists ${schema} cascade`);
      await c.end();
    },
  };
}

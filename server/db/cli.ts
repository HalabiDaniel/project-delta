import { ConfigError, serverConfig } from '../config';
import { Database, redactUrl } from './Database';
import { migrate } from './migrate';

/**
 * `npm run db:migrate`: applies the migrations to DATABASE_URL (the server also does this on every
 * start; this is for checking a database by hand, or preparing one before the first deploy).
 */
try {
  const { databaseUrl } = serverConfig();
  if (!databaseUrl) throw new ConfigError('DATABASE_URL is not set.');
  const db = new Database(databaseUrl);
  try {
    const report = await migrate(db, undefined, console.log);
    console.log(`${redactUrl(databaseUrl)}: schema version ${report.current} (${report.applied.length} applied now)`);
  } finally {
    await db.close();
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}

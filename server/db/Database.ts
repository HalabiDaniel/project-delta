import pg from 'pg';

/**
 * The connection to PostgreSQL: a pool with timeouts, parameterised queries only, and
 * transactions that are retried when PostgreSQL asks (a serialization failure or a deadlock
 * between two writers). The pool reconnects on its own after the database comes back: a lost
 * connection fails the queries in flight, the next query opens a fresh one.
 */

export type Row = Record<string, unknown>;

/** What a query runs on: the pool, or one connection inside a transaction. */
export interface Queryable {
  query<R extends Row = Row>(text: string, params?: readonly unknown[]): Promise<pg.QueryResult<R>>;
}

export interface DatabaseOptions {
  /** Most connections open at once (default 10). */
  max?: number;
  /** Give up connecting after this long (ms, default 5000). */
  connectTimeout?: number;
  /** Abort a single statement after this long (ms, default 10000). */
  statementTimeout?: number;
  /** Logged instead of crashing when an idle connection breaks. */
  onError?: (error: Error) => void;
}

/** SQLSTATEs worth trying again: serialization_failure, deadlock_detected. */
const RETRYABLE = new Set(['40001', '40P01']);
const MAX_ATTEMPTS = 4;

export class Database implements Queryable {
  readonly pool: pg.Pool;
  private closed = false;

  constructor(
    readonly url: string,
    options: DatabaseOptions = {},
  ) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: options.max ?? 10,
      connectionTimeoutMillis: options.connectTimeout ?? 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: options.statementTimeout ?? 10_000,
      application_name: 'paperwars-server',
    });
    // A connection that breaks while idle (the database restarted) must not crash the process.
    this.pool.on('error', (error) => (options.onError ?? defaultOnError)(error));
  }

  query<R extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params as unknown[]);
  }

  /**
   * Runs `work` in one transaction: committed if it returns, rolled back if it throws. Retried
   * from the start (a few times) on a serialization failure or deadlock, so `work` must not have
   * effects outside the database.
   */
  async transaction<T>(work: (tx: Queryable) => Promise<T>, isolation: 'read committed' | 'repeatable read' | 'serializable' = 'read committed'): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.pool.connect();
      let broken = false;
      try {
        await client.query(`begin isolation level ${isolation}`);
        const result = await work(client);
        await client.query('commit');
        return result;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          broken = true;
        }
        const code = (error as { code?: string }).code;
        if (code && RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
          continue;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    }
  }

  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

function defaultOnError(error: Error): void {
  console.error(`[db] idle connection error: ${error.message}`);
}

/** The url with its password hidden, for logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

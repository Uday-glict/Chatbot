import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/** Anything a repository can run a parameterized query on: the pool or a transaction client. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export { Pool } from 'pg';

export function createPool(connectionString: string, max: number): Pool {
  return new Pool({ connectionString, max, application_name: 'chat-api' });
}

/** Runs `fn` inside a single SQL transaction, rolling back on any throw. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failure must not mask the original error.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL unique_violation error code. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
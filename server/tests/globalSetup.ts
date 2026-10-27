import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { runUp } from '../src/db/migrate';

/**
 * Starts a real, isolated PostgreSQL server for the whole test run, applies
 * migrations, and exposes DATABASE_URL to every worker. The Firestore emulator
 * (when started by `npm test`) provides FIRESTORE_EMULATOR_HOST itself.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test-only-secret-key-0123456789';
  process.env.FIRESTORE_PROJECT_ID ??= 'demo-chat';
  process.env.LOG_LEVEL ??= 'silent';
  // Generous limits so the suite never trips rate limiting; a dedicated test
  // exercises the limiter itself with a small explicit limit.
  process.env.RATE_LIMIT_AUTH_PER_MINUTE ??= '10000';
  process.env.RATE_LIMIT_SEARCH_PER_MINUTE ??= '10000';
  process.env.RATE_LIMIT_SEND_PER_MINUTE ??= '10000';

  const port = 20_000 + Math.floor(Math.random() * 10_000);
  const dataDir = path.resolve(process.cwd(), '.tmp/pgdata');
  fs.rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('chat_test');

  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/chat_test`;
  await runUp(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;

  // Workers read this file so they get the URL even if env propagation fails.
  const envFile = path.resolve(process.cwd(), '.tmp/test-db.json');
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, JSON.stringify({ databaseUrl }), 'utf8');

  return async () => {
    try {
      await pg.stop();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(envFile, { force: true });
    }
  };
}

import fs from 'node:fs';
import path from 'node:path';

/**
 * Runs in every worker before test modules load. Ensures the test database
 * URL produced by globalSetup is visible to process.env.
 */
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-only-secret-key-0123456789';
process.env.FIRESTORE_PROJECT_ID ??= 'demo-chat';
process.env.LOG_LEVEL ??= 'silent';

if (!process.env.DATABASE_URL) {
  const envFile = path.resolve(process.cwd(), '.tmp/test-db.json');
  if (fs.existsSync(envFile)) {
    const parsed = JSON.parse(fs.readFileSync(envFile, 'utf8')) as { databaseUrl?: string };
    if (parsed.databaseUrl) process.env.DATABASE_URL = parsed.databaseUrl;
  }
}

import { getConfig } from './config';
import { createPool } from './db/pool';
import { createApp } from './app';
import { createServices } from './container';
import { verifyFirestoreConnectivity } from './firestore/client';
import { logger } from './logger';

async function main(): Promise<void> {
  const cfg = getConfig();
  const pool = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX);

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.error({ err }, 'cannot reach PostgreSQL — run migrations first (npm run migrate)');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  try {
    await verifyFirestoreConnectivity();
  } catch (err) {
    logger.error(
      { err, projectId: cfg.FIREBASE_PROJECT_ID },
      'cannot reach Cloud Firestore — check Application Default Credentials and project configuration',
    );
    await pool.end();
    process.exitCode = 1;
    return;
  }

  const app = createApp(createServices(pool), cfg);
  const server = app.listen(cfg.PORT, () => {
    logger.info(
      {
        port: cfg.PORT,
        env: cfg.NODE_ENV,
        firebaseProjectId: cfg.FIREBASE_PROJECT_ID,
        firestoreEmulator: Boolean(cfg.FIRESTORE_EMULATOR_HOST),
      },
      'chat API listening',
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});

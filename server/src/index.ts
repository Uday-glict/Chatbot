import { getConfig } from './config';
import { createPool } from './db/pool';
import { createApp } from './app';
import { createServices } from './container';
import { logger } from './logger';

async function main(): Promise<void> {
  const cfg = getConfig();
  const pool = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX);

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.error({ err }, 'cannot reach PostgreSQL — run migrations first (npm run migrate)');
    process.exit(1);
  }

  const app = createApp(createServices(pool), cfg);
  const server = app.listen(cfg.PORT, () => {
    logger.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'chat API listening');
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

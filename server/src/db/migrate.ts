import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import '../loadEnv';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const LOCK_KEY = 727_541_190;

interface MigrationFile {
  version: string;
  name: string;
  upPath: string;
  downPath?: string;
}

function listMigrations(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .sort()
    .map((file) => {
      const base = file.replace(/\.up\.sql$/, '');
      const [version, ...rest] = base.split('_');
      const down = path.join(MIGRATIONS_DIR, `${base}.down.sql`);
      return {
        version: version ?? base,
        name: rest.join('_'),
        upPath: path.join(MIGRATIONS_DIR, file),
        ...(fs.existsSync(down) ? { downPath: down } : {}),
      };
    });
}

async function ensureTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function withLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

export async function runUp(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await withLock(client, async () => {
      await ensureTable(client);
      const applied = new Set(
        (await client.query('SELECT version FROM schema_migrations')).rows.map(
          (r) => (r as { version: string }).version,
        ),
      );
      const migrations = listMigrations();
      let ran = 0;
      for (const m of migrations) {
        if (applied.has(m.version)) continue;
        const sql = fs.readFileSync(m.upPath, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
            m.version,
            m.name,
          ]);
          await client.query('COMMIT');
          ran += 1;
          console.warn(`applied ${m.version}_${m.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      if (ran === 0) console.warn('database up to date');
    });
  } finally {
    await client.end();
  }
}

export async function runDown(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await withLock(client, async () => {
      await ensureTable(client);
      const last = (
        await client.query('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1')
      ).rows[0] as { version: string; name: string } | undefined;
      if (!last) {
        console.warn('no applied migrations to roll back');
        return;
      }
      const base = `${last.version}_${last.name}`;
      const downPath = path.join(MIGRATIONS_DIR, `${base}.down.sql`);
      if (!fs.existsSync(downPath)) {
        throw new Error(`missing down migration for ${base}`);
      }
      const sql = fs.readFileSync(downPath, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [last.version]);
        await client.query('COMMIT');
        console.warn(`rolled back ${base}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  } finally {
    await client.end();
  }
}

function create(): void {
  const existing = listMigrations();
  const next = String(
    (existing.length === 0 ? 0 : Math.max(...existing.map((m) => Number(m.version)))) + 1,
  ).padStart(4, '0');
  const name = process.argv[3];
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error('usage: migrate:create <snake_case_name>');
  }
  const base = `${next}_${name}`;
  fs.writeFileSync(path.join(MIGRATIONS_DIR, `${base}.up.sql`), `-- ${base}\n`);
  fs.writeFileSync(path.join(MIGRATIONS_DIR, `${base}.down.sql`), `-- reverses ${base}\n`);
  console.warn(`created ${base}.up.sql / ${base}.down.sql`);
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (see .env.example)');
  return url;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await runUp(requireDatabaseUrl());
  else if (cmd === 'down') await runDown(requireDatabaseUrl());
  else if (cmd === 'create') create();
  else throw new Error(`unknown command: ${cmd} (expected up | down | create)`);
}

// CLI entry point only — importing this module never runs migrations.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

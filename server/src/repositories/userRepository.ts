import type { Queryable } from '../db/pool';
import type { PublicUser, User } from '../types/domain';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface PublicUserRow {
  id: string;
  name: string;
  email: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
}

export interface SearchUsersInput {
  query: string;
  excludeUserId: string;
  limit: number;
  offset: number;
}

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: CreateUserInput): Promise<User> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, lower($2), $3)
       RETURNING id, name, email, password_hash, created_at, updated_at`,
      [input.name, input.email, input.passwordHash],
    );
    const row = rows[0];
    if (!row) throw new Error('user insert returned no row');
    return toUser(row);
  }

  async findByEmail(email: string): Promise<{ user: User; passwordHash: string } | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, name, email, password_hash, created_at, updated_at
       FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return { user: toUser(row), passwordHash: row.password_hash };
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, name, email, password_hash, created_at, updated_at FROM users WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  /** Minimal profiles (id, name) for rendering participant lists. */
  async findPublicProfiles(ids: string[]): Promise<PublicUser[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<PublicUserRow>(
      `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
  }

  /** Returns the subset of `ids` that exist as users (parameterized ANY). */
  async existingIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map((r) => r.id);
  }

  /**
   * Name search over other users. Parameterized LIKE with escaped wildcards,
   * case-insensitive, keyset-free offset pagination (search pages are bounded).
   */
  async search(input: SearchUsersInput): Promise<PublicUser[]> {
    const pattern = `%${escapeLike(input.query)}%`;
    const { rows } = await this.db.query<PublicUserRow>(
      `SELECT id, name, email
       FROM users
       WHERE id <> $1::uuid
         AND lower(name) LIKE lower($2) ESCAPE '\\'
       ORDER BY lower(name) ASC, id ASC
       LIMIT $3 OFFSET $4`,
      [input.excludeUserId, pattern, input.limit, input.offset],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
  }
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

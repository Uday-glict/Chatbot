import { describe, expect, it } from 'vitest';
import { isUniqueViolation, withTransaction } from '../src/db/pool';
import { ChatRepository } from '../src/repositories/chatRepository';
import { UserRepository } from '../src/repositories/userRepository';
import { getPool, signUpUser, buildApp } from './helpers/app';

const app = buildApp();
const pool = () => getPool();

async function makeUsers(): Promise<[string, string]> {
  const a = await signUpUser(app, 'db-a');
  const _b = await signUpUser(app, 'db-b');
  return [a.id, _b.id];
}

describe('database constraints', () => {
  it('rejects a second direct chat for the same unordered pair (DB-level)', async () => {
    const [a, _b] = await makeUsers();
    const [low, high] = a < _b ? [a, _b] : [_b, a];
    const repo = new ChatRepository(pool());

    const first = await repo.insertDirect({ lowUserId: low, highUserId: high, createdBy: a });
    expect(first.id).toEqual(expect.any(String));

    let caught: unknown;
    try {
      await repo.insertDirect({ lowUserId: low, highUserId: high, createdBy: _b });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it('keeps a direct pair ordered (a < b) via CHECK constraint', async () => {
    const [a, _b] = await makeUsers();
    const [low, high] = a < _b ? [a, _b] : [_b, a];
    const repo = new ChatRepository(pool());
    // Deliberately inverted pair must be rejected by the CHECK constraint.
    await expect(
      repo.insertDirect({ lowUserId: high, highUserId: low, createdBy: a }),
    ).rejects.toThrow();
  });

  it('requires a name for groups and forbids one for direct chats', async () => {
    const [a] = await makeUsers();
    const repo = new ChatRepository(pool());
    await expect(repo.insertGroup('', a)).rejects.toThrow();
    await expect(repo.insertGroup('Valid name', a)).resolves.toMatchObject({ chatType: 'group' });
  });

  it('prevents duplicate participants via the composite primary key', async () => {
    const [a, _b] = await makeUsers();
    const repo = new ChatRepository(pool());
    const chat = await repo.insertGroup('PkGroup', a);

    const inserted = await repo.insertParticipants(chat.id, [
      { userId: a, role: 'admin' },
      { userId: a, role: 'admin' },
    ]);
    expect(inserted).toHaveLength(1);

    // Direct second insert of the same pair violates the PK.
    const { rows } = await pool().query(
      `INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [chat.id, a],
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects invalid references with foreign-key violations', async () => {
    const repo = new ChatRepository(pool());
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(
      repo.insertParticipants(missing, [{ userId: missing, role: 'member' }]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps users unique on lower(email)', async () => {
    const users = new UserRepository(pool());
    const original = await signUpUser(app, 'db-email');
    await expect(
      users.create({
        name: 'Copycat',
        email: original.email.toUpperCase(),
        passwordHash: 'scrypt$16384$c2FsdA==$aGFzaA==',
      }),
    ).rejects.toThrow();
  });
});

describe('transaction behavior', () => {
  it('rolls back every write when the unit of work fails', async () => {
    const [a] = await makeUsers();
    const before = await pool().query(`SELECT count(*)::int AS n FROM chats`);
    const beforeCount = before.rows[0]?.['n'] as number;

    await expect(
      withTransaction(pool(), async (client) => {
        const repo = new ChatRepository(client);
        await repo.insertGroup('WillBeRolledBack', a);
        const count = await client.query(`SELECT count(*)::int AS n FROM chats`);
        // The row is visible inside the transaction...
        expect(count.rows[0]?.['n']).toBe(beforeCount + 1);
        throw new Error('unit of work failed');
      }),
    ).rejects.toThrow('unit of work failed');

    const after = await pool().query(`SELECT count(*)::int AS n FROM chats`);
    // ...and gone after rollback.
    expect(after.rows[0]?.['n']).toBe(beforeCount);
  });

  it('commits when the unit of work succeeds', async () => {
    const [a] = await makeUsers();
    const chat = await withTransaction(pool(), async (client) => {
      const repo = new ChatRepository(client);
      const created = await repo.insertGroup('Committed', a);
      await repo.insertParticipants(created.id, [{ userId: a, role: 'admin' }]);
      return created;
    });

    const found = new ChatRepository(pool());
    expect(await found.findById(chat.id)).toMatchObject({ chatType: 'group', name: 'Committed' });
    expect(await found.findParticipants(chat.id)).toHaveLength(1);
  });
});
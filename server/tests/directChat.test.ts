import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getPool } from './helpers/app';
import { authHeader, buildApp, createDirectChat, signUpUser, type TestUser } from './helpers/app';

const app = buildApp();

describe('POST /api/v1/chat/create', () => {
  it('creates a direct chat with both participants', async () => {
    const a = await signUpUser(app, 'dc-a');
    const b = await signUpUser(app, 'dc-b');

    const res = await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(a.token))
      .send({ userAId: a.id, userBId: b.id })
      .expect(201);

    expect(res.body.data.chat.chatType).toBe('direct');
    expect(res.body.data.chat.name).toBeNull();
    expect(res.body.data.created).toBe(true);
    const ids = res.body.data.participants.map((p: { userId: string }) => p.userId);
    expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
  });

  it('returns the existing chat instead of duplicating (both id orders)', async () => {
    const a = await signUpUser(app, 'dc-ex-a');
    const b = await signUpUser(app, 'dc-ex-b');

    const first = await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(a.token))
      .send({ userAId: a.id, userBId: b.id })
      .expect(201);

    // Same unordered pair, opposite order, other participant as caller.
    const second = await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(b.token))
      .send({ userAId: b.id, userBId: a.id })
      .expect(200);

    expect(second.body.data.chat.id).toBe(first.body.data.chat.id);
    expect(second.body.data.created).toBe(false);

    const count = await getPool().query(
      `SELECT count(*)::int AS n FROM chats WHERE chat_type = 'direct'
         AND direct_user_a = $1 AND direct_user_b = $2`,
      [a.id < b.id ? a.id : b.id, a.id < b.id ? b.id : a.id],
    );
    expect(count.rows[0]?.['n']).toBe(1);
  });

  it('handles concurrent create requests without duplicates', async () => {
    const a = await signUpUser(app, 'dc-race-a');
    const b = await signUpUser(app, 'dc-race-b');

    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post('/api/v1/chat/create')
          .set(authHeader(i % 2 === 0 ? a.token : b.token))
          .send(i % 2 === 0 ? { userAId: a.id, userBId: b.id } : { userAId: b.id, userBId: a.id }),
      ),
    );

    for (const res of attempts) {
      expect([200, 201]).toContain(res.status);
    }
    const ids = new Set(attempts.map((r) => r.body.data.chat.id as string));
    expect(ids.size).toBe(1);

    const count = await getPool().query(
      `SELECT count(*)::int AS n FROM chats WHERE chat_type = 'direct'
         AND direct_user_a = $1 AND direct_user_b = $2`,
      [a.id < b.id ? a.id : b.id, a.id < b.id ? b.id : a.id],
    );
    expect(count.rows[0]?.['n']).toBe(1);

    // Exactly two participant rows for the surviving chat.
    const chatId = [...ids][0] as string;
    const participants = await getPool().query(
      `SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = $1`,
      [chatId],
    );
    expect(participants.rows[0]?.['n']).toBe(2);
  });

  it('rejects self-chat', async () => {
    const a = await signUpUser(app, 'dc-self');
    const res = await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(a.token))
      .send({ userAId: a.id, userBId: a.id })
      .expect(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });

  it('rejects starting a chat between two other users (403)', async () => {
    const a = await signUpUser(app, 'dc-third-a');
    const b = await signUpUser(app, 'dc-third-b');
    const c = await signUpUser(app, 'dc-third-c');

    const res = await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(c.token))
      .send({ userAId: a.id, userBId: b.id })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects nonexistent users (404) and invalid ids (400)', async () => {
    const a = await signUpUser(app, 'dc-missing');
    await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(a.token))
      .send({ userAId: a.id, userBId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);

    await request(app)
      .post('/api/v1/chat/create')
      .set(authHeader(a.token))
      .send({ userAId: a.id, userBId: 'not-a-uuid' })
      .expect(400);
  });

  it('requires authentication', async () => {
    const a = await signUpUser(app, 'dc-noauth');
    await request(app)
      .post('/api/v1/chat/create')
      .send({ userAId: a.id, userBId: a.id })
      .expect(401);
  });
});

describe('chat membership authorization', () => {
  it('hides chats from non-members (404, indistinguishable from missing)', async () => {
    const a = await signUpUser(app, 'hide-a');
    const b = await signUpUser(app, 'hide-b');
    const outsider: TestUser = await signUpUser(app, 'hide-c');

    const { id: chatId } = await createDirectChat(app, a, b);

    const missingChat = await request(app)
      .get('/api/v1/chat/00000000-0000-4000-8000-000000000000/messages')
      .set(authHeader(a.token))
      .expect(404);

    const nonMember = await request(app)
      .get(`/api/v1/chat/${chatId}/messages`)
      .set(authHeader(outsider.token))
      .expect(404);

    expect(missingChat.body.error.message).toBe(nonMember.body.error.message);
  });
});

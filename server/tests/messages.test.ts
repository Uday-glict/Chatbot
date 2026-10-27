import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authHeader,
  buildApp,
  createDirectChat,
  createGroup,
  emulatorAvailable,
  signUpUser,
} from './helpers/app';

const app = buildApp();
const needsEmulator = emulatorAvailable();

function send(user: { token: string }, chatId: string, text: string, extra?: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/chat/${chatId}/message/send`)
    .set(authHeader(user.token))
    .send({ text, ...extra });
}

describe.runIf(needsEmulator)('sending messages (direct and group share one path)', () => {
  it('stores a direct message with a server timestamp', async () => {
    const a = await signUpUser(app, 'msg-a');
    const b = await signUpUser(app, 'msg-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    const res = await send(a, chatId, 'hello there').expect(201);
    expect(res.body.data).toMatchObject({ chatId, senderId: a.id, text: 'hello there' });
    expect(Number.isNaN(Date.parse(res.body.data.createdAt))).toBe(false);
    expect(res.body.data.deletedAt).toBeNull();
  });

  it('stores a group message through the same endpoint', async () => {
    const owner = await signUpUser(app, 'gmsg-o');
    const member = await signUpUser(app, 'gmsg-m');
    const groupId = await createGroup(app, owner, 'GroupMsg', [member.id]);

    const res = await send(member, groupId, 'hi group').expect(201);
    expect(res.body.data).toMatchObject({ chatId: groupId, senderId: member.id });
  });

  it('rejects blank and oversized messages', async () => {
    const a = await signUpUser(app, 'msg-blank-a');
    const b = await signUpUser(app, 'msg-blank-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    await send(a, chatId, '   ').expect(400);
    await send(a, chatId, '').expect(400);
    await send(a, chatId, 'x'.repeat(4001)).expect(400);
  });

  it('is idempotent for the same clientMessageId', async () => {
    const a = await signUpUser(app, 'msg-idem-a');
    const b = await signUpUser(app, 'msg-idem-b');
    const { id: chatId } = await createDirectChat(app, a, b);
    const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const first = await send(a, chatId, 'retry me', { clientMessageId: key }).expect(201);
    const second = await send(a, chatId, 'retry me', { clientMessageId: key }).expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const list = await request(app)
      .get(`/api/v1/chat/${chatId}/messages`)
      .set(authHeader(a.token))
      .expect(200);
    expect(list.body.data.messages).toHaveLength(1);
  });

  it('rejects a reused clientMessageId with a different payload (409)', async () => {
    const a = await signUpUser(app, 'msg-conf-a');
    const b = await signUpUser(app, 'msg-conf-b');
    const { id: chatId } = await createDirectChat(app, a, b);
    const key = `conf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await send(a, chatId, 'first', { clientMessageId: key }).expect(201);
    await send(a, chatId, 'different', { clientMessageId: key }).expect(409);
  });

  it('blocks non-members and removed members from sending', async () => {
    const a = await signUpUser(app, 'msg-nm-a');
    const b = await signUpUser(app, 'msg-nm-b');
    const outsider = await signUpUser(app, 'msg-nm-c');
    const { id: chatId } = await createDirectChat(app, a, b);

    await send(outsider, chatId, 'intruder').expect(404);

    const owner = await signUpUser(app, 'msg-rm-o');
    const member = await signUpUser(app, 'msg-rm-m');
    const groupId = await createGroup(app, owner, 'Kickable', [member.id]);
    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(owner.token))
      .expect(200);
    await send(member, groupId, 'still here?').expect(404);
  });
});

describe.runIf(needsEmulator)('retrieving messages', () => {
  it('returns messages in chronological order with cursor pagination', async () => {
    const a = await signUpUser(app, 'page-a');
    const b = await signUpUser(app, 'page-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    const sentIds: string[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const res = await send(a, chatId, `msg ${i}`).expect(201);
      sentIds.push(res.body.data.id as string);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/api/v1/chat/${chatId}/messages?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await request(app).get(url).set(authHeader(a.token)).expect(200);
      const messages = page.body.data.messages as { id: string; text: string; createdAt: string }[];
      expect(messages.length).toBeLessThanOrEqual(3);
      // Ascending within a page.
      for (let i = 1; i < messages.length; i += 1) {
        expect(Date.parse(messages[i]!.createdAt)).toBeGreaterThanOrEqual(
          Date.parse(messages[i - 1]!.createdAt),
        );
      }
      seen.push(...messages.map((m) => m.id));
      cursor = page.body.meta.nextCursor as string | null;
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...sentIds].sort());
  });

  it('stays stable when message timestamps collide', async () => {
    const a = await signUpUser(app, 'tie-a');
    const b = await signUpUser(app, 'tie-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    // Fire concurrently so several messages can share a millisecond.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => send(a, chatId, `burst ${i}`)),
    );
    for (const r of results) expect(r.status).toBe(201);

    const first = await request(app)
      .get(`/api/v1/chat/${chatId}/messages?limit=4`)
      .set(authHeader(a.token))
      .expect(200);
    const cursor = first.body.meta.nextCursor as string | null;
    expect(cursor).not.toBeNull();

    const second = await request(app)
      .get(`/api/v1/chat/${chatId}/messages?limit=4&cursor=${encodeURIComponent(cursor!)}`)
      .set(authHeader(a.token))
      .expect(200);

    const ids = [
      ...(first.body.data.messages as { id: string }[]).map((m) => m.id),
      ...(second.body.data.messages as { id: string }[]).map((m) => m.id),
    ];
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('validates limit and cursor', async () => {
    const a = await signUpUser(app, 'page-v');
    const b = await signUpUser(app, 'page-v2');
    const { id: chatId } = await createDirectChat(app, a, b);

    await request(app)
      .get(`/api/v1/chat/${chatId}/messages?limit=101`)
      .set(authHeader(a.token))
      .expect(400);

    await request(app)
      .get(`/api/v1/chat/${chatId}/messages?cursor=not-a-valid-cursor!!`)
      .set(authHeader(a.token))
      .expect(400);

    await request(app)
      .get(`/api/v1/chat/${chatId}/messages?cursor=${encodeURIComponent(Buffer.from('{"t":"bad","i":1}').toString('base64url'))}`)
      .set(authHeader(a.token))
      .expect(400);
  });
});

describe.runIf(needsEmulator)('read receipts', () => {
  it('records a receipt once and preserves the first timestamp', async () => {
    const a = await signUpUser(app, 'rcpt-a');
    const b = await signUpUser(app, 'rcpt-b');
    const { id: chatId } = await createDirectChat(app, a, b);
    const messageId = (await send(a, chatId, 'read me')).body.data.id as string;

    const first = await request(app)
      .post(`/api/v1/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(b.token))
      .expect(200);
    expect(first.body.data.created).toBe(true);

    const second = await request(app)
      .post(`/api/v1/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(b.token))
      .expect(200);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.receipt.readAt).toBe(first.body.data.receipt.readAt);

    // The sender sees the reader in the receipts map.
    const list = await request(app)
      .get(`/api/v1/chat/${chatId}/messages`)
      .set(authHeader(a.token))
      .expect(200);
    expect(list.body.data.receipts[messageId]).toEqual(expect.arrayContaining([{ userId: b.id }]));
  });

  it("returns success without a receipt for the sender's own message", async () => {
    const a = await signUpUser(app, 'rcpt-s-a');
    const b = await signUpUser(app, 'rcpt-s-b');
    const { id: chatId } = await createDirectChat(app, a, b);
    const messageId = (await send(a, chatId, 'mine')).body.data.id as string;

    const res = await request(app)
      .post(`/api/v1/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(a.token))
      .expect(200);
    expect(res.body.data).toMatchObject({ receipt: null, created: false, reason: 'sender' });
  });

  it('rejects messages from another chat and unknown messages (404)', async () => {
    const a = await signUpUser(app, 'rcpt-x-a');
    const b = await signUpUser(app, 'rcpt-x-b');
    const c = await signUpUser(app, 'rcpt-x-c');
    const { id: chat1 } = await createDirectChat(app, a, b);
    const { id: chat2 } = await createDirectChat(app, a, c);
    const messageId = (await send(a, chat1, 'in chat 1')).body.data.id as string;

    await request(app)
      .post(`/api/v1/chat/${chat2}/message/${messageId}/read`)
      .set(authHeader(a.token))
      .expect(404);

    // Syntactically valid but nonexistent id → 404; malformed id → 400.
    await request(app)
      .post(`/api/v1/chat/${chat1}/message/does-not-exist/read`)
      .set(authHeader(a.token))
      .expect(404);

    await request(app)
      .post(`/api/v1/chat/${chat1}/message/bad%20id/read`)
      .set(authHeader(a.token))
      .expect(400);
  });
});

describe.runIf(needsEmulator)('last-seen tracking', () => {
  it('advances the pointer and never moves it backwards', async () => {
    const a = await signUpUser(app, 'seen-a');
    const b = await signUpUser(app, 'seen-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    const m1 = (await send(a, chatId, 'one')).body.data.id as string;
    const m2 = (await send(a, chatId, 'two')).body.data.id as string;

    const advanced = await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(b.token))
      .send({ messageId: m2 })
      .expect(200);
    expect(advanced.body.data.status).toBe('advanced');
    expect(advanced.body.data.progress.lastSeenMessageId).toBe(m2);

    // Moving back to the older message must be a no-op.
    const stale = await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(b.token))
      .send({ messageId: m1 })
      .expect(200);
    expect(stale.body.data.status).toBe('unchanged');
    expect(stale.body.data.progress.lastSeenMessageId).toBe(m2);
  });

  it('rejects unknown messages and non-members', async () => {
    const a = await signUpUser(app, 'seen-x-a');
    const b = await signUpUser(app, 'seen-x-b');
    const outsider = await signUpUser(app, 'seen-x-c');
    const { id: chatId } = await createDirectChat(app, a, b);

    await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(b.token))
      .send({ messageId: '00000000000000000000000000000000' })
      .expect(404);

    await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(outsider.token))
      .send({ messageId: '00000000000000000000000000000000' })
      .expect(404);

    await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(b.token))
      .send({ messageId: 'bad id!' })
      .expect(400);
  });

  it('exposes the other participant\'s pointer in a direct chat', async () => {
    const a = await signUpUser(app, 'seen-o-a');
    const b = await signUpUser(app, 'seen-o-b');
    const { id: chatId } = await createDirectChat(app, a, b);
    const m1 = (await send(a, chatId, 'first')).body.data.id as string;

    const before = await request(app)
      .get(`/api/v1/chat/${chatId}/messages`)
      .set(authHeader(a.token))
      .expect(200);
    expect(before.body.data.otherLastSeen).toBeNull();

    await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(b.token))
      .send({ messageId: m1 })
      .expect(200);

    const after = await request(app)
      .get(`/api/v1/chat/${chatId}/messages`)
      .set(authHeader(a.token))
      .expect(200);
    expect(after.body.data.otherLastSeen).toMatchObject({
      userId: b.id,
      lastSeenMessageId: m1,
    });
  });
});

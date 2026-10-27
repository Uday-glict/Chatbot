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

describe.runIf(emulatorAvailable())('GET /api/v1/user/:userId/chats', () => {
  it("lists the caller's chats with participants and previews", async () => {
    const me = await signUpUser(app, 'list-a');
    const other = await signUpUser(app, 'list-b');
    const groupMember = await signUpUser(app, 'list-c');

    await createDirectChat(app, me, other);
    await createGroup(app, me, 'ListGroup', [groupMember.id]);
    await request(app)
      .post(`/api/v1/chat/create`)
      .set(authHeader(me.token))
      .send({ userAId: me.id, userBId: other.id })
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/user/${me.id}/chats`)
      .set(authHeader(me.token))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const group = res.body.data.find(
      (c: { chat: { chatType: string } }) => c.chat.chatType === 'group',
    );
    expect(group.chat.name).toBe('ListGroup');
    expect(group.participants.map((p: { userId: string }) => p.userId)).toEqual(
      expect.arrayContaining([me.id, groupMember.id]),
    );
    expect(group.participantProfiles.length).toBe(2);
    expect(group.participantProfiles[0]).toHaveProperty('name');
  });

  it('shows a last-message preview and unread counts that clear on lastseen', async () => {
    const a = await signUpUser(app, 'unread-a');
    const b = await signUpUser(app, 'unread-b');
    const { id: chatId } = await createDirectChat(app, a, b);

    const sent = await request(app)
      .post(`/api/v1/chat/${chatId}/message/send`)
      .set(authHeader(b.token))
      .send({ text: 'ping' })
      .expect(201);

    const before = await request(app)
      .get(`/api/v1/user/${a.id}/chats`)
      .set(authHeader(a.token))
      .expect(200);
    const entry = before.body.data.find((c: { chat: { id: string } }) => c.chat.id === chatId);
    expect(entry.preview.lastMessage.text).toBe('ping');
    expect(entry.preview.unreadCount).toBe(1);

    await request(app)
      .post(`/api/v1/chat/${chatId}/lastseen`)
      .set(authHeader(a.token))
      .send({ messageId: sent.body.data.id })
      .expect(200);

    const after = await request(app)
      .get(`/api/v1/user/${a.id}/chats`)
      .set(authHeader(a.token))
      .expect(200);
    const updated = after.body.data.find((c: { chat: { id: string } }) => c.chat.id === chatId);
    expect(updated.preview.unreadCount).toBe(0);
  });

  it('paginates with a stable cursor and no duplicates', async () => {
    const me = await signUpUser(app, 'cpag-a');
    const partner = await signUpUser(app, 'cpag-b');
    const chatIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const partnerI = await signUpUser(app, `cpag-p${i}`);
      const { id } = await createDirectChat(app, me, partnerI);
      chatIds.push(id);
    }
    void partner;

    const page1 = await request(app)
      .get(`/api/v1/user/${me.id}/chats?limit=2`)
      .set(authHeader(me.token))
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    const cursor = page1.body.meta.nextCursor as string;
    expect(cursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/api/v1/user/${me.id}/chats?limit=2&cursor=${encodeURIComponent(cursor)}`)
      .set(authHeader(me.token))
      .expect(200);

    const ids = [
      ...page1.body.data.map((c: { chat: { id: string } }) => c.chat.id),
      ...page2.body.data.map((c: { chat: { id: string } }) => c.chat.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to list another user's chats", async () => {
    const me = await signUpUser(app, 'other-a');
    const stranger = await signUpUser(app, 'other-b');
    await createDirectChat(app, me, stranger);

    const res = await request(app)
      .get(`/api/v1/user/${me.id}/chats`)
      .set(authHeader(stranger.token))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    await request(app)
      .get(`/api/v1/user/00000000-0000-4000-8000-000000000000/chats`)
      .set(authHeader(stranger.token))
      .expect(403);

    await request(app)
      .get(`/api/v1/user/${stranger.id}/chats`)
      .set(authHeader(stranger.token))
      .expect(200);
  });

  it('rejects malformed ids and cursors', async () => {
    const me = await signUpUser(app, 'badlist');
    await request(app)
      .get(`/api/v1/user/not-a-uuid/chats`)
      .set(authHeader(me.token))
      .expect(400);

    await request(app)
      .get(`/api/v1/user/${me.id}/chats?cursor=%%%invalid%%%`)
      .set(authHeader(me.token))
      .expect(400);
  });

  it('requires authentication', async () => {
    const me = await signUpUser(app, 'noauthlist');
    await request(app).get(`/api/v1/user/${me.id}/chats`).expect(401);
  });
});

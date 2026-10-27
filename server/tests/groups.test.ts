import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { GroupService } from '../src/services/groupService';
import { ChatService } from '../src/services/chatService';
import { InMemoryMessageRepository, InMemoryReadProgressRepository } from './helpers/memory';
import { authHeader, buildApp, getPool, signUpUser } from './helpers/app';

const app = buildApp();

describe('POST /api/v1/groups', () => {
  it('creates a group with the creator as admin and members as members', async () => {
    const owner = await signUpUser(app, 'grp-owner');
    const memberA = await signUpUser(app, 'grp-ma');
    const memberB = await signUpUser(app, 'grp-mb');

    const res = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Shipping Team', memberIds: [memberA.id, memberB.id] })
      .expect(201);

    expect(res.body.data.chat).toMatchObject({ chatType: 'group', name: 'Shipping Team' });
    const participants = res.body.data.participants as { userId: string; role: string }[];
    expect(participants).toHaveLength(3);

    const ownerRow = participants.find((p) => p.userId === owner.id);
    expect(ownerRow?.role).toBe('admin');
    expect(participants.filter((p) => p.role === 'member')).toHaveLength(2);
  });

  it('deduplicates repeated member ids and ignores the creator id', async () => {
    const owner = await signUpUser(app, 'grp-dup');
    const member = await signUpUser(app, 'grp-dup-m');

    const res = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Dedup', memberIds: [member.id, member.id, owner.id] })
      .expect(201);

    expect(res.body.data.participants).toHaveLength(2);
  });

  it('rejects unknown member ids with 422 and lists them', async () => {
    const owner = await signUpUser(app, 'grp-unknown');
    const res = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({
        name: 'Ghosts',
        memberIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(422);
    expect(res.body.error.details).toMatchObject({
      missingUserIds: ['00000000-0000-4000-8000-000000000000'],
    });
  });

  it('validates name and member list', async () => {
    const owner = await signUpUser(app, 'grp-val');
    await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: '', memberIds: [owner.id] })
      .expect(400);

    await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'No members', memberIds: [] })
      .expect(400);
  });

  it('enforces the configurable member limit', async () => {
    const owner = await signUpUser(app, 'grp-limit');
    const m1 = await signUpUser(app, 'grp-limit-1');
    const m2 = await signUpUser(app, 'grp-limit-2');

    const progress = new InMemoryReadProgressRepository();
    const chatService = new ChatService(
      getPool(),
      () => new InMemoryMessageRepository(),
      () => progress,
      { groupMaxMembers: 2 },
    );
    const groupService = new GroupService(getPool(), chatService, () => progress);

    await expect(
      groupService.create(owner.id, { name: 'Tiny', memberIds: [m1.id, m2.id] }),
    ).rejects.toMatchObject({ status: 422 });

    const ok = await groupService.create(owner.id, { name: 'Tiny', memberIds: [m1.id] });
    expect(ok.participants).toHaveLength(2);
  });
});

describe('GET/PATCH /api/v1/groups/:groupId', () => {
  it('returns group details to members only', async () => {
    const owner = await signUpUser(app, 'grp-get');
    const member = await signUpUser(app, 'grp-get-m');
    const outsider = await signUpUser(app, 'grp-get-o');

    const res = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Readable', memberIds: [member.id] })
      .expect(201);
    const groupId = res.body.data.chat.id as string;

    await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(member.token))
      .expect(200);

    const denied = await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(outsider.token))
      .expect(404);
    expect(denied.body.error.code).toBe('NOT_FOUND');
  });

  it('lets admins rename but not plain members', async () => {
    const owner = await signUpUser(app, 'grp-ren');
    const member = await signUpUser(app, 'grp-ren-m');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Old name', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    await request(app)
      .patch(`/api/v1/groups/${groupId}`)
      .set(authHeader(member.token))
      .send({ name: 'Member rename' })
      .expect(403);

    const ok = await request(app)
      .patch(`/api/v1/groups/${groupId}`)
      .set(authHeader(owner.token))
      .send({ name: 'New name' })
      .expect(200);
    expect(ok.body.data.chat.name).toBe('New name');
  });
});

describe('group member management', () => {
  it('lets admins add members and skips existing ones', async () => {
    const owner = await signUpUser(app, 'add-a');
    const first = await signUpUser(app, 'add-b');
    const second = await signUpUser(app, 'add-c');

    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Adders', memberIds: [first.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    const added = await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set(authHeader(owner.token))
      .send({ userIds: [second.id, second.id] })
      .expect(200);
    expect(added.body.data.participants).toHaveLength(3);

    // Everything already a member → 409, no partial write.
    await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set(authHeader(owner.token))
      .send({ userIds: [second.id] })
      .expect(409);

    // Non-admins cannot add.
    await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set(authHeader(first.token))
      .send({ userIds: [owner.id] })
      .expect(403);
  });

  it('removes members and revokes their access immediately', async () => {
    const owner = await signUpUser(app, 'rem-a');
    const member = await signUpUser(app, 'rem-b');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Removers', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    // Members cannot remove other members.
    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${owner.id}`)
      .set(authHeader(member.token))
      .expect(403);

    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(owner.token))
      .expect(200);

    // Removed member can no longer see the group or its messages.
    await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(member.token))
      .expect(404);
    await request(app)
      .get(`/api/v1/chat/${groupId}/messages`)
      .set(authHeader(member.token))
      .expect(404);
    await request(app)
      .post(`/api/v1/chat/${groupId}/message/send`)
      .set(authHeader(member.token))
      .send({ text: 'ghost message' })
      .expect(404);
  });

  it('allows a member to leave on their own', async () => {
    const owner = await signUpUser(app, 'leave-a');
    const member = await signUpUser(app, 'leave-b');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Leavers', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(member.token))
      .expect(200);

    await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set(authHeader(member.token))
      .expect(404);
  });

  it('refuses to remove a user who is not a participant (404)', async () => {
    const owner = await signUpUser(app, 'rem-x');
    const member = await signUpUser(app, 'rem-z');
    const outsider = await signUpUser(app, 'rem-y');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Nope', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${outsider.id}`)
      .set(authHeader(owner.token))
      .expect(404);
  });
});

describe('group roles', () => {
  it('promotes members to admin and blocks demoting the last admin', async () => {
    const owner = await signUpUser(app, 'role-a');
    const member = await signUpUser(app, 'role-b');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'Roles', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    // Plain member cannot change roles.
    await request(app)
      .patch(`/api/v1/groups/${groupId}/members/${owner.id}`)
      .set(authHeader(member.token))
      .send({ role: 'member' })
      .expect(403);

    const promoted = await request(app)
      .patch(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(owner.token))
      .send({ role: 'admin' })
      .expect(200);
    expect(
      (promoted.body.data.participants as { userId: string; role: string }[]).find(
        (p) => p.userId === member.id,
      )?.role,
    ).toBe('admin');

    // Now two admins: demoting the original owner is allowed.
    await request(app)
      .patch(`/api/v1/groups/${groupId}/members/${owner.id}`)
      .set(authHeader(member.token))
      .send({ role: 'member' })
      .expect(200);

    // But demoting the last remaining admin is refused.
    const res = await request(app)
      .patch(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(member.token))
      .send({ role: 'member' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects unknown roles and unknown targets', async () => {
    const owner = await signUpUser(app, 'role-x');
    const member = await signUpUser(app, 'role-y');
    const created = await request(app)
      .post('/api/v1/groups')
      .set(authHeader(owner.token))
      .send({ name: 'RoleChk', memberIds: [member.id] })
      .expect(201);
    const groupId = created.body.data.chat.id as string;

    await request(app)
      .patch(`/api/v1/groups/${groupId}/members/${member.id}`)
      .set(authHeader(owner.token))
      .send({ role: 'superuser' })
      .expect(400);

    await request(app)
      .patch(`/api/v1/groups/${groupId}/members/00000000-0000-4000-8000-000000000000`)
      .set(authHeader(owner.token))
      .send({ role: 'admin' })
      .expect(404);
  });
});

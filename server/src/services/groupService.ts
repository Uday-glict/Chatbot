import type { Pool } from 'pg';
import { conflict, notFound, unprocessable } from '../errors';
import { withTransaction } from '../db/pool';
import { ChatRepository } from '../repositories/chatRepository';
import type { ReadProgressRepository } from '../repositories/readProgressRepository';
import { UserRepository } from '../repositories/userRepository';
import type { ChatWithParticipants, ParticipantRole } from '../types/domain';
import type { ChatService } from './chatService';

export interface CreateGroupInput {
  name: string;
  memberIds: string[];
}

export class GroupService {
  constructor(
    private readonly pool: Pool,
    private readonly chatService: ChatService,
    private readonly progressRepo: () => ReadProgressRepository,
  ) {}

  private get chats(): ChatRepository {
    return new ChatRepository(this.pool);
  }

  private get users(): UserRepository {
    return new UserRepository(this.pool);
  }

  /**
   * Creates a group in one SQL transaction: chat row + participant rows.
   * The creator is always a member and the only initial administrator.
   */
  async create(authUserId: string, input: CreateGroupInput): Promise<ChatWithParticipants> {
    const deduped = [...new Set(input.memberIds)].filter((id) => id !== authUserId);
    if (deduped.length === 0) {
      throw unprocessable('Select at least one member to create a group');
    }

    const limit = this.chatService.options.groupMaxMembers;
    if (deduped.length + 1 > limit) {
      throw unprocessable(`Group membership is limited to ${limit} users`, {
        limit,
        requested: deduped.length + 1,
      });
    }

    const found = await this.users.existingIds(deduped);
    const missing = deduped.filter((id) => !found.includes(id));
    if (missing.length > 0) {
      throw unprocessable('Some selected users do not exist', { missingUserIds: missing });
    }

    const chat = await withTransaction(this.pool, async (client) => {
      const repo = new ChatRepository(client);
      const created = await repo.insertGroup(input.name.trim(), authUserId);
      await repo.insertParticipants(created.id, [
        { userId: authUserId, role: 'admin' },
        ...deduped.map((userId) => ({ userId, role: 'member' as const })),
      ]);
      return created;
    });

    return { chat, participants: await this.chats.findParticipants(chat.id) };
  }

  async get(groupId: string, userId: string): Promise<ChatWithParticipants> {
    const { chat } = await this.chatService.requireGroupMembership(groupId, userId);
    return { chat, participants: await this.chats.findParticipants(chat.id) };
  }

  async rename(groupId: string, userId: string, name: string): Promise<ChatWithParticipants> {
    const membership = await this.chatService.requireGroupMembership(groupId, userId);
    this.chatService.requireAdmin(membership);
    const renamed = await this.chats.rename(groupId, name.trim());
    if (!renamed) throw notFound('Group not found');
    return { chat: renamed, participants: await this.chats.findParticipants(groupId) };
  }

  /** Admin-only bulk add; duplicates and existing members are skipped. */
  async addMembers(groupId: string, userId: string, memberIds: string[]): Promise<ChatWithParticipants> {
    const membership = await this.chatService.requireGroupMembership(groupId, userId);
    this.chatService.requireAdmin(membership);

    const incoming = [...new Set(memberIds)].filter((id) => id !== userId);
    if (incoming.length === 0) {
      throw unprocessable('No valid members to add');
    }

    const limit = this.chatService.options.groupMaxMembers;
    const current = await this.chats.findParticipants(groupId);
    const alreadyMember = new Set(current.map((p) => p.userId));
    const toAdd = incoming.filter((id) => !alreadyMember.has(id));

    if (toAdd.length === 0) {
      throw conflict('All selected users are already members');
    }
    if (current.length + toAdd.length > limit) {
      throw unprocessable(`Group membership is limited to ${limit} users`, { limit });
    }

    const found = await this.users.existingIds(toAdd);
    const missing = toAdd.filter((id) => !found.includes(id));
    if (missing.length > 0) {
      throw unprocessable('Some selected users do not exist', { missingUserIds: missing });
    }

    await withTransaction(this.pool, async (client) => {
      const repo = new ChatRepository(client);
      await repo.insertParticipants(
        groupId,
        toAdd.map((id) => ({ userId: id, role: 'member' as const })),
      );
      await repo.touchChat(groupId);
    });

    return { chat: membership.chat, participants: await this.chats.findParticipants(groupId) };
  }

  /**
   * Removes a member. Members may remove themselves (leave); removing anyone
   * else requires admin. The last administrator cannot be removed.
   * Losing membership immediately revokes API access to the chat's messages.
   */
  async removeMember(groupId: string, actorId: string, targetId: string): Promise<void> {
    const membership = await this.chatService.requireGroupMembership(groupId, actorId);
    if (actorId !== targetId) this.chatService.requireAdmin(membership);

    const participants = await this.chats.findParticipants(groupId);
    const target = participants.find((p) => p.userId === targetId);
    if (!target) throw notFound('User is not a member of this group');

    if (target.role === 'admin' && participants.filter((p) => p.role === 'admin').length <= 1) {
      throw conflict('A group must keep at least one administrator');
    }

    await withTransaction(this.pool, async (client) => {
      const repo = new ChatRepository(client);
      const removed = await repo.removeParticipant(groupId, targetId);
      if (!removed) throw notFound('User is not a member of this group');
      await repo.touchChat(groupId);
    });

    // Drop Firestore reading-progress data; API access is already revoked by
    // SQL either way, so any Firestore failure here must not fail the request.
    try {
      await this.progressRepo().delete(groupId, targetId);
    } catch {
      // Best effort: membership gate is authoritative.
    }
  }

  /** Admin-only role management; the last admin cannot be demoted. */
  async setRole(
    groupId: string,
    actorId: string,
    targetId: string,
    role: ParticipantRole,
  ): Promise<ChatWithParticipants> {
    const membership = await this.chatService.requireGroupMembership(groupId, actorId);
    this.chatService.requireAdmin(membership);

    const participants = await this.chats.findParticipants(groupId);
    const target = participants.find((p) => p.userId === targetId);
    if (!target) throw notFound('User is not a member of this group');

    if (
      target.role === 'admin' &&
      role === 'member' &&
      participants.filter((p) => p.role === 'admin').length <= 1
    ) {
      throw conflict('A group must keep at least one administrator');
    }

    if (target.role !== role) {
      await withTransaction(this.pool, async (client) => {
        const repo = new ChatRepository(client);
        await repo.setRole(groupId, targetId, role);
        await repo.touchChat(groupId);
      });
    }

    return { chat: membership.chat, participants: await this.chats.findParticipants(groupId) };
  }
}

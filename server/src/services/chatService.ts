import type { Pool } from 'pg';
import { badRequest, forbidden, notFound, unprocessable } from '../errors';
import { isUniqueViolation, withTransaction } from '../db/pool';
import { ChatRepository } from '../repositories/chatRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { ReadProgressRepository } from '../repositories/readProgressRepository';
import { UserRepository } from '../repositories/userRepository';
import type {
  Chat,
  ChatPreview,
  ChatWithParticipants,
  Message,
  Participant,
  PublicUser,
} from '../types/domain';

export interface ChatListItem {
  chat: Chat;
  participants: Participant[];
  participantProfiles: PublicUser[];
  preview: ChatPreview;
}

export interface ListChatsResult {
  chats: ChatListItem[];
  nextCursor: string | null;
}

export interface Membership {
  chat: Chat;
  participant: Participant;
}

export interface DirectChatResult extends ChatWithParticipants {
  /** false when an existing chat was returned instead of a new one. */
  created: boolean;
}

export interface ChatServiceOptions {
  groupMaxMembers: number;
}

/**
 * Chat metadata + membership authorization. Every chat/group operation calls
 * requireMembership so authorization is enforced server-side from the
 * verified token identity, never from client-supplied ids.
 */
export class ChatService {
  constructor(
    private readonly pool: Pool,
    private readonly messageRepo: () => MessageRepository,
    private readonly progressRepo: () => ReadProgressRepository,
    readonly options: ChatServiceOptions,
  ) {}

  private get chats(): ChatRepository {
    return new ChatRepository(this.pool);
  }

  private get users(): UserRepository {
    return new UserRepository(this.pool);
  }

  /**
   * Creates or returns the direct chat for the unordered pair.
   * Uniqueness is enforced by the DB (unique index on the sorted pair), so
   * concurrent requests converge on a single chat.
   */
  async createDirect(authUserId: string, userAId: string, userBId: string): Promise<DirectChatResult> {
    if (userAId === userBId) {
      throw unprocessable('A direct chat needs two different users');
    }
    if (authUserId !== userAId && authUserId !== userBId) {
      // Identity comes from the token: you may only start chats you belong to.
      throw forbidden('You may only start a conversation you are part of');
    }

    const existing = await this.users.existingIds([userAId, userBId]);
    if (existing.length !== 2) {
      throw notFound('One or both users do not exist');
    }

    const [low, high] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

    const found = await this.chats.findDirectByPair(low, high);
    if (found) return { ...(await this.withParticipants(found)), created: false };

    try {
      const chat = await withTransaction(this.pool, async (client) => {
        const repo = new ChatRepository(client);
        const created = await repo.insertDirect({
          lowUserId: low,
          highUserId: high,
          createdBy: authUserId,
        });
        await repo.insertParticipants(created.id, [
          { userId: userAId, role: 'member' },
          { userId: userBId, role: 'member' },
        ]);
        return created;
      });
      return { ...(await this.withParticipants(chat)), created: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent request won the race; reuse its chat.
        const chat = await this.chats.findDirectByPair(low, high);
        if (chat) return { ...(await this.withParticipants(chat)), created: false };
      }
      throw err;
    }
  }

  /**
   * Server-side authorization gate for chat operations.
   * A missing chat and a chat you are not a member of are deliberately
   * indistinguishable (404), so chat ids cannot be probed for existence.
   */
  async requireMembership(chatId: string, userId: string): Promise<Membership> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw notFound('Chat not found');
    const participant = await this.chats.findParticipant(chatId, userId);
    if (!participant) throw notFound('Chat not found');
    return { chat, participant };
  }

  /** Like requireMembership, but only for group chats. */
  async requireGroupMembership(chatId: string, userId: string): Promise<Membership> {
    const membership = await this.requireMembership(chatId, userId);
    if (membership.chat.chatType !== 'group') throw notFound('Group not found');
    return membership;
  }

  /** Admin gate for group management operations (403 for members). */
  requireAdmin(membership: Membership): void {
    if (membership.participant.role !== 'admin') {
      throw forbidden('Group administrator role required');
    }
  }

  /** Membership check plus the full participant list (for rendering a chat). */
  async participantsFor(
    chatId: string,
    userId: string,
  ): Promise<Membership & { participants: Participant[] }> {
    const membership = await this.requireMembership(chatId, userId);
    return { ...membership, participants: await this.chats.findParticipants(chatId) };
  }

  async getChat(chatId: string, userId: string): Promise<ChatWithParticipants> {
    const membership = await this.requireMembership(chatId, userId);
    return this.withParticipants(membership.chat);
  }

  /** Dashboard page: SQL pagination + Firestore previews/unread per chat. */
  async listChats(userId: string, limit: number, cursor: string | null): Promise<ListChatsResult> {
    const decodedCursor = cursor ? decodeChatCursor(cursor) : null;
    const page = await this.chats.listUserChats(userId, limit, decodedCursor);
    const participantRows = await this.chats.findParticipantsFor(page.map((c) => c.id));

    const byChat = new Map<string, Participant[]>();
    for (const p of participantRows) {
      const list = byChat.get(p.chatId) ?? [];
      list.push(p);
      byChat.set(p.chatId, list);
    }

    const profileIds = [...new Set(participantRows.map((p) => p.userId))];
    const profiles = await this.users.findPublicProfiles(profileIds);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const messageRepo = this.messageRepo();
    const progressRepo = this.progressRepo();

    const items = await Promise.all(
      page.map(async (chat): Promise<ChatListItem> => {
        const participants = byChat.get(chat.id) ?? [];
        const me = participants.find((p) => p.userId === userId);

        // One latest-message read and one count() aggregate per chat on this page.
        const [latestPage, progress] = await Promise.all([
          messageRepo.list(chat.id, { limit: 1, cursor: null }),
          progressRepo.get(chat.id, userId),
        ]);
        const lastMessage: Message | null = latestPage.messages[0] ?? null;
        const since = progress?.lastSeenAt ?? me?.joinedAt ?? chat.createdAt;
        const unreadCount = lastMessage
          ? await messageRepo.countAfter(chat.id, since, userId)
          : 0;

        return {
          chat,
          participants,
          participantProfiles: participants.map((p) => profileById.get(p.userId)).filter(isDefined),
          preview: { lastMessage, unreadCount },
        };
      }),
    );

    items.sort((a, b) => {
      const at = a.preview.lastMessage ? Date.parse(a.preview.lastMessage.createdAt) : 0;
      const bt = b.preview.lastMessage ? Date.parse(b.preview.lastMessage.createdAt) : 0;
      return bt - at;
    });

    const hasMore = page.length === limit;
    const last = page[page.length - 1];
    return {
      chats: items,
      nextCursor: hasMore && last ? encodeChatCursor(last) : null,
    };
  }

  private async withParticipants(chat: Chat): Promise<ChatWithParticipants> {
    return { chat, participants: await this.chats.findParticipants(chat.id) };
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

interface ChatCursor {
  updatedAt: string;
  id: string;
}

export function encodeChatCursor(chat: Chat): string {
  return Buffer.from(JSON.stringify({ u: chat.updatedAt, i: chat.id }), 'utf8').toString('base64url');
}

export function decodeChatCursor(cursor: string): ChatCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid pagination cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { u?: unknown }).u !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string' ||
    Number.isNaN(Date.parse((parsed as { u: string }).u))
  ) {
    throw badRequest('Invalid pagination cursor');
  }
  const { u, i } = parsed as { u: string; i: string };
  return { updatedAt: u, id: i };
}

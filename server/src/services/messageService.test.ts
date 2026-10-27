import { describe, expect, it } from 'vitest';
import { AppError, notFound } from '../errors';
import type { ChatService, Membership } from './chatService';
import { MessageService } from './messageService';
import {
  InMemoryMessageRepository,
  InMemoryReadProgressRepository,
  InMemoryReadReceiptRepository,
} from '../../tests/helpers/memory';
import type { Chat, Participant } from '../types/domain';

const CHAT_ID = '123e4567-e89b-42d3-a456-426614174000';
const ALICE = '123e4567-e89b-42d3-a456-426614174001';
const BOB = '123e4567-e89b-42d3-a456-426614174002';

const chat = (chatType: Chat['chatType']): Chat => ({
  id: CHAT_ID,
  chatType,
  name: chatType === 'group' ? 'Team' : null,
  createdBy: ALICE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const participant = (userId: string): Participant => ({
  chatId: CHAT_ID,
  userId,
  role: userId === ALICE ? 'admin' : 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
});

/** Stubbed authorization gate so this stays an isolated unit test. */
function stubChatService(options?: {
  member?: boolean;
  chatType?: Chat['chatType'];
}): ChatService {
  const chatType = options?.chatType ?? 'direct';
  const isMember = options?.member ?? true;
  const membership = (): Membership => {
    if (!isMember) throw notFound('Chat not found');
    return { chat: chat(chatType), participant: participant(ALICE) };
  };
  return {
    requireMembership: async () => membership(),
    participantsFor: async () => ({
      ...membership(),
      participants: [participant(ALICE), participant(BOB)],
    }),
    requireGroupMembership: async () => membership(),
    options: { groupMaxMembers: 100 },
  } as unknown as ChatService;
}

function buildService(chatService = stubChatService()) {
  const messages = new InMemoryMessageRepository();
  const receipts = new InMemoryReadReceiptRepository();
  const progress = new InMemoryReadProgressRepository(messages);
  return {
    service: new MessageService(chatService, () => messages, () => receipts, () => progress),
    messages,
    progress,
  };
}

describe('MessageService.send', () => {
  it('rejects non-members (404) before touching storage', async () => {
    const { service, messages } = buildService(stubChatService({ member: false }));
    await expect(service.send(ALICE, CHAT_ID, { text: 'hi' })).rejects.toMatchObject({
      status: 404,
    });
    expect(await messages.list(CHAT_ID, { limit: 10, cursor: null })).toMatchObject({
      messages: [],
    });
  });

  it('derives the sender from the authenticated user, not the payload', async () => {
    const { service } = buildService();
    const message = await service.send(BOB, CHAT_ID, { text: 'from bob' });
    expect(message.senderId).toBe(BOB);
    expect(message.chatId).toBe(CHAT_ID);
  });

  it('rejects blank text', async () => {
    const { service } = buildService();
    await expect(service.send(ALICE, CHAT_ID, { text: '   ' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('forwards the idempotency key when provided', async () => {
    const { service } = buildService();
    const first = await service.send(ALICE, CHAT_ID, {
      text: 'retry',
      clientMessageId: 'idem-key-12345',
    });
    const replay = await service.send(ALICE, CHAT_ID, {
      text: 'retry',
      clientMessageId: 'idem-key-12345',
    });
    expect(replay.id).toBe(first.id);
  });
});

describe('MessageService.markRead', () => {
  it('skips receipts for the sender\'s own message', async () => {
    const { service } = buildService();
    const message = await service.send(ALICE, CHAT_ID, { text: 'mine' });
    const result = await service.markRead(ALICE, CHAT_ID, message.id);
    expect(result).toMatchObject({ receipt: null, created: false, reason: 'sender' });
  });

  it('is idempotent and preserves the first read timestamp', async () => {
    const { service } = buildService();
    const message = await service.send(ALICE, CHAT_ID, { text: 'yours' });

    const first = await service.markRead(BOB, CHAT_ID, message.id);
    const second = await service.markRead(BOB, CHAT_ID, message.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.receipt?.readAt).toBe(first.receipt?.readAt);
  });

  it('rejects unknown messages (404)', async () => {
    const { service } = buildService();
    await expect(service.markRead(BOB, CHAT_ID, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects non-members before reading the message', async () => {
    const { service } = buildService(stubChatService({ member: false }));
    const err = await service.markRead(BOB, CHAT_ID, 'anything').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).status).toBe(404);
  });
});

describe('MessageService.setLastSeen', () => {
  it('advances, reports stale pointers, and maps unknown messages to 404', async () => {
    const { service } = buildService();
    const m1 = await service.send(ALICE, CHAT_ID, { text: 'one' });
    const m2 = await service.send(ALICE, CHAT_ID, { text: 'two' });

    const advanced = await service.setLastSeen(BOB, CHAT_ID, m2.id);
    expect(advanced).toMatchObject({ status: 'advanced' });
    expect(advanced.progress.lastSeenMessageId).toBe(m2.id);

    const stale = await service.setLastSeen(BOB, CHAT_ID, m1.id);
    expect(stale.status).toBe('unchanged');
    expect(stale.progress.lastSeenMessageId).toBe(m2.id);

    await expect(service.setLastSeen(BOB, CHAT_ID, 'unknown-id')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects non-members', async () => {
    const { service } = buildService(stubChatService({ member: false }));
    await expect(service.setLastSeen(BOB, CHAT_ID, 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('MessageService.list', () => {
  it('attaches receipts for the caller\'s own messages and the direct-chat pointer', async () => {
    const { service } = buildService();
    const mine = await service.send(ALICE, CHAT_ID, { text: 'mine' });
    await service.send(BOB, CHAT_ID, { text: 'theirs' });

    const page = await service.list(ALICE, CHAT_ID, { limit: 10, cursor: null });
    expect(page.messages).toHaveLength(2);
    expect(Object.keys(page.receipts)).toEqual([mine.id]);
    expect(page.otherLastSeen).toBeNull();

    await service.setLastSeen(BOB, CHAT_ID, mine.id);
    const withPointer = await service.list(ALICE, CHAT_ID, { limit: 10, cursor: null });
    expect(withPointer.otherLastSeen).toMatchObject({
      userId: BOB,
      lastSeenMessageId: mine.id,
    });
  });

  it('omits the other-user pointer for group chats', async () => {
    const { service } = buildService(stubChatService({ chatType: 'group' }));
    await service.send(ALICE, CHAT_ID, { text: 'hello team' });
    const page = await service.list(ALICE, CHAT_ID, { limit: 10, cursor: null });
    expect(page.otherLastSeen).toBeNull();
  });

  it('rejects non-members', async () => {
    const { service } = buildService(stubChatService({ member: false }));
    await expect(service.list(BOB, CHAT_ID, { limit: 10, cursor: null })).rejects.toMatchObject({
      status: 404,
    });
  });
});

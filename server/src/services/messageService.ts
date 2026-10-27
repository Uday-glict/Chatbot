import { badRequest, notFound } from '../errors';
import type { MessageRepository, MessagePage } from '../repositories/messageRepository';
import type { ReadProgressRepository } from '../repositories/readProgressRepository';
import type { ReadReceiptRepository } from '../repositories/readReceiptRepository';
import type { Message, Participant, ReadProgress, ReadReceipt } from '../types/domain';
import type { ChatService } from './chatService';

/** Upper bound on receipt lookups per message page (keeps read indicators cheap). */
export const MAX_RECEIPT_LOOKUPS = 50;

export interface SendMessageInput {
  text: string;
  clientMessageId?: string;
}

export interface MessageListResult extends MessagePage {
  /** Read receipts for the caller's own messages in this page. */
  receipts: Record<string, ReadReceipt[]>;
  /** Direct chats: the other participant's last-seen pointer (null if never opened). */
  otherLastSeen: ReadProgress | null;
}

export interface MarkReadResult {
  receipt: ReadReceipt | null;
  created: boolean;
  reason?: 'sender';
}

export interface LastSeenResult {
  status: 'advanced' | 'unchanged';
  progress: ReadProgress;
}

/**
 * Common messaging path for direct and group chats: identical storage,
 * authorization, pagination and receipt handling for both chat types.
 */
export class MessageService {
  constructor(
    private readonly chatService: ChatService,
    private readonly messageRepo: () => MessageRepository,
    private readonly receiptRepo: () => ReadReceiptRepository,
    private readonly progressRepo: () => ReadProgressRepository,
  ) {}

  async send(authUserId: string, chatId: string, input: SendMessageInput): Promise<Message> {
    // Server-side membership check — sender identity is the verified token id.
    await this.chatService.requireMembership(chatId, authUserId);
    const text = input.text;
    if (text.trim().length === 0) {
      throw badRequest('Message text cannot be empty');
    }
    return this.messageRepo().create({
      chatId,
      senderId: authUserId,
      text,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    });
  }

  async list(
    authUserId: string,
    chatId: string,
    options: { limit: number; cursor: string | null },
  ): Promise<MessageListResult> {
    const { chat, participants } = await this.chatService.participantsFor(chatId, authUserId);
    const page = await this.messageRepo().list(chatId, options);

    const own = page.messages.filter((m) => m.senderId === authUserId);
    const receiptTargets = own.slice(-MAX_RECEIPT_LOOKUPS).map((m) => m.id);
    const [receipts, otherLastSeen] = await Promise.all([
      receiptTargets.length > 0
        ? this.receiptRepo().readersOf(chatId, receiptTargets)
        : Promise.resolve({} as Record<string, ReadReceipt[]>),
      chat.chatType === 'direct'
        ? this.otherParticipantLastSeen(chatId, authUserId, participants)
        : Promise.resolve(null),
    ]);

    return { ...page, receipts, otherLastSeen };
  }

  /**
   * Idempotent read receipt. Retries preserve the original read timestamp.
   * The sender's own messages are never recorded as read by the sender.
   */
  async markRead(authUserId: string, chatId: string, messageId: string): Promise<MarkReadResult> {
    await this.chatService.requireMembership(chatId, authUserId);
    const message = await this.messageRepo().findById(chatId, messageId);
    if (!message) throw notFound('Message not found');
    if (message.senderId === authUserId) {
      return { receipt: null, created: false, reason: 'sender' };
    }
    const result = await this.receiptRepo().markRead(chatId, messageId, authUserId);
    return { receipt: result.receipt, created: result.created };
  }

  /**
   * Advances the per-user last-seen pointer (never backwards).
   * Deliberately does NOT create read receipts for preceding messages —
   * receipts come from POST .../message/:messageId/read only.
   */
  async setLastSeen(authUserId: string, chatId: string, messageId: string): Promise<LastSeenResult> {
    await this.chatService.requireMembership(chatId, authUserId);
    const result = await this.progressRepo().advance(chatId, authUserId, messageId);
    if (result.status === 'not_found') throw notFound('Message not found');
    if (result.status === 'stale') return { status: 'unchanged', progress: result.progress };
    return { status: 'advanced', progress: result.progress };
  }

  private async otherParticipantLastSeen(
    chatId: string,
    userId: string,
    participants: Participant[],
  ): Promise<ReadProgress | null> {
    const other = participants.find((p) => p.userId !== userId);
    if (!other) return null;
    return this.progressRepo().get(chatId, other.userId);
  }
}

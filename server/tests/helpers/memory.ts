import { randomUUID } from 'node:crypto';
import { badRequest, conflict } from '../../src/errors';
import type {
  CreateMessageInput,
  ListMessagesOptions,
  MessagePage,
  MessageRepository,
} from '../../src/repositories/messageRepository';
import type {
  AdvanceResult,
  ReadProgressRepository,
} from '../../src/repositories/readProgressRepository';
import type {
  MarkReadResult,
  ReadReceiptRepository,
} from '../../src/repositories/readReceiptRepository';
import type { Message, ReadProgress, ReadReceipt } from '../../src/types/domain';

/**
 * In-memory implementations used ONLY for isolated unit tests and as a
 * clearly-flagged fallback when no Firestore emulator is available.
 * Semantics mirror the Firestore repositories (ordering, idempotency,
 * monotonic progress) so service behavior stays testable without a backend.
 */

function cursorKey(message: Message): { t: number; i: string } {
  return { t: Date.parse(message.createdAt), i: message.id };
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly store = new Map<string, Message[]>();
  private lastMs = 0;

  /** Strictly monotonic timestamps so ordering is deterministic in tests. */
  private nextTime(): string {
    this.lastMs = Math.max(Date.now(), this.lastMs + 1);
    return new Date(this.lastMs).toISOString();
  }

  /** Message creation time (ms) for read-progress comparisons, or null if unknown. */
  timeOf(chatId: string, messageId: string): number | null {
    const found = this.store.get(chatId)?.find((m) => m.id === messageId);
    return found ? Date.parse(found.createdAt) : null;
  }

  async create(input: CreateMessageInput): Promise<Message> {
    const list = this.store.get(input.chatId) ?? [];
    const id = input.clientMessageId ?? randomUUID().replace(/-/g, '').slice(0, 20);

    const existing = list.find((m) => m.id === id);
    if (existing) {
      if (existing.senderId !== input.senderId || existing.text !== input.text) {
        throw conflict('Message id was already used by a different payload');
      }
      return existing; // idempotent replay
    }

    const now = this.nextTime();
    const message: Message = {
      id,
      chatId: input.chatId,
      senderId: input.senderId,
      text: input.text,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    list.push(message);
    this.store.set(input.chatId, list);
    return message;
  }

  async list(chatId: string, options: ListMessagesOptions): Promise<MessagePage> {
    const all = [...(this.store.get(chatId) ?? [])];
    all.sort((a, b) => {
      const bt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (bt !== 0) return bt;
      return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
    });
    let page = all.slice(0, options.limit);
    if (options.cursor) {
      let decoded: { t: number; i: string };
      try {
        decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as {
          t: number;
          i: string;
        };
      } catch {
        throw badRequest('Invalid pagination cursor');
      }
      page = page.filter((m) => {
        const k = cursorKey(m);
        return k.t < decoded.t || (k.t === decoded.t && k.i < decoded.i);
      });
    }
    const hasMore = page.length === options.limit;
    const oldest = page[page.length - 1];
    return {
      messages: [...page].reverse(),
      nextCursor:
        hasMore && oldest
          ? Buffer.from(JSON.stringify(cursorKey(oldest)), 'utf8').toString('base64url')
          : null,
    };
  }

  async findById(chatId: string, messageId: string): Promise<Message | null> {
    return this.store.get(chatId)?.find((m) => m.id === messageId) ?? null;
  }

  async countAfter(chatId: string, since: string, excludeSenderId: string): Promise<number> {
    const sinceMs = Date.parse(since);
    return (this.store.get(chatId) ?? []).filter(
      (m) => Date.parse(m.createdAt) > sinceMs && m.senderId !== excludeSenderId,
    ).length;
  }
}

export class InMemoryReadReceiptRepository implements ReadReceiptRepository {
  private readonly store = new Map<string, ReadReceipt>(); // `${chatId}:${messageId}:${userId}`

  async markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult> {
    const key = `${chatId}:${messageId}:${userId}`;
    const existing = this.store.get(key);
    if (existing) return { receipt: existing, created: false };
    const receipt: ReadReceipt = { messageId, userId, readAt: new Date().toISOString() };
    this.store.set(key, receipt);
    return { receipt, created: true };
  }

  async readersOf(chatId: string, messageIds: string[]): Promise<Record<string, ReadReceipt[]>> {
    const out: Record<string, ReadReceipt[]> = {};
    for (const id of messageIds) {
      out[id] = [...this.store.entries()]
        .filter(([key]) => key.startsWith(`${chatId}:${id}:`))
        .map(([, receipt]) => receipt);
    }
    return out;
  }
}

export class InMemoryReadProgressRepository implements ReadProgressRepository {
  private readonly store = new Map<string, { progress: ReadProgress; messageAt: number }>();

  constructor(
    /** When provided, message existence/times come from the message store. */
    private readonly messages?: { timeOf(chatId: string, messageId: string): number | null },
  ) {}

  async get(chatId: string, userId: string): Promise<ReadProgress | null> {
    return this.store.get(`${chatId}:${userId}`)?.progress ?? null;
  }

  async advance(chatId: string, userId: string, messageId: string): Promise<AdvanceResult> {
    const key = `${chatId}:${userId}`;
    const message = await this.messageAt(chatId, messageId);
    if (message === null) return { status: 'not_found' };

    const current = this.store.get(key);
    if (current) {
      const newMs = message;
      const curMs = current.messageAt;
      if (newMs < curMs || (newMs === curMs && messageId <= (current.progress.lastSeenMessageId ?? ''))) {
        return { status: 'stale', progress: current.progress };
      }
    }
    const progress: ReadProgress = {
      userId,
      lastSeenMessageId: messageId,
      lastSeenAt: new Date().toISOString(),
    };
    this.store.set(key, { progress, messageAt: message });
    return { status: 'advanced', progress };
  }

  async delete(chatId: string, userId: string): Promise<void> {
    this.store.delete(`${chatId}:${userId}`);
  }

  /** Test hooks: place a message at a known time, or mark it as missing. */
  private readonly knownMessages = new Map<string, number>();

  registerMessage(chatId: string, messageId: string, createdAtMs: number): void {
    this.knownMessages.set(`${chatId}:${messageId}`, createdAtMs);
  }

  registerMissingMessage(chatId: string, messageId: string): void {
    this.knownMessages.set(`${chatId}:${messageId}`, -1);
  }

  private async messageAt(chatId: string, messageId: string): Promise<number | null> {
    const key = `${chatId}:${messageId}`;
    if (this.messages) return this.messages.timeOf(chatId, messageId);
    if (this.knownMessages.has(key)) {
      const value = this.knownMessages.get(key) ?? -1;
      return value === -1 ? null : value;
    }
    // Fallback: treat as "now" so standalone happy-path tests work.
    return Date.now();
  }
}

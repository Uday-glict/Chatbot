import { FieldPath, FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { badRequest, conflict, notFound } from '../errors';
import { getFirestoreDb } from '../firestore/client';
import type { Message } from '../types/domain';

export interface CreateMessageInput {
  chatId: string;
  senderId: string;
  text: string;
  /** Optional idempotency key; retries with the same key do not duplicate. */
  clientMessageId?: string;
}

export interface ListMessagesOptions {
  limit: number;
  cursor: string | null;
}

export interface MessagePage {
  messages: Message[]; // ascending by time
  nextCursor: string | null;
}

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<Message>;
  list(chatId: string, options: ListMessagesOptions): Promise<MessagePage>;
  /** Returns null when the message id does not exist under this chat. */
  findById(chatId: string, messageId: string): Promise<Message | null>;
  /**
   * Unread count: messages created after `since` that the caller did not send.
   * Uses the count() aggregate (single server round trip, no doc fetch).
   */
  countAfter(chatId: string, since: string, excludeSenderId: string): Promise<number>;
}

export const MAX_MESSAGE_PAGE_SIZE = 100;
export const DEFAULT_MESSAGE_PAGE_SIZE = 50;

interface CursorPayload {
  t: number;
  i: string;
}

export function encodeMessageCursor(message: Message): string {
  const payload: CursorPayload = {
    t: new Date(message.createdAt).getTime(),
    i: message.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeMessageCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid pagination cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as CursorPayload).t !== 'number' ||
    typeof (parsed as CursorPayload).i !== 'string'
  ) {
    throw badRequest('Invalid pagination cursor');
  }
  const { t, i } = parsed as CursorPayload;
  if (!Number.isFinite(t) || !/^[A-Za-z0-9_-]{1,128}$/.test(i)) {
    throw badRequest('Invalid pagination cursor');
  }
  return { t, i };
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  throw new Error('missing timestamp field on message document');
}

function snapshotToMessage(id: string, chatId: string, data: Record<string, unknown>): Message {
  const text = data['text'];
  const senderId = data['senderId'];
  if (typeof text !== 'string' || typeof senderId !== 'string') {
    throw new Error('malformed message document');
  }
  return {
    id,
    chatId,
    senderId,
    text,
    createdAt: toIso(data['createdAt']),
    updatedAt: toIso(data['updatedAt'] ?? data['createdAt']),
    deletedAt: data['deletedAt'] ? toIso(data['deletedAt']) : null,
  };
}

/** Firestore-backed messages under chats/{chatId}/messages/{messageId}. */
export class FirestoreMessageRepository implements MessageRepository {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private collection(chatId: string) {
    return this.db.collection('chats').doc(chatId).collection('messages');
  }

  async create(input: CreateMessageInput): Promise<Message> {
    const ref = input.clientMessageId
      ? this.collection(input.chatId).doc(input.clientMessageId)
      : this.collection(input.chatId).doc();

    const outcome = await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const data = existing.data() as Record<string, unknown> | undefined;
        if (!data || data['senderId'] !== input.senderId) {
          return { kind: 'conflict' as const };
        }
        if (data['text'] !== input.text) {
          return { kind: 'conflict' as const };
        }
        return { kind: 'replay' as const, message: snapshotToMessage(ref.id, input.chatId, data) };
      }
      tx.set(ref, {
        senderId: input.senderId,
        text: input.text,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deletedAt: null,
      });
      return { kind: 'created' as const };
    });

    if (outcome.kind === 'conflict') {
      throw conflict('Message id was already used by a different payload');
    }
    if (outcome.kind === 'replay') {
      return outcome.message;
    }

    // Read back so the response carries the resolved server timestamp.
    const snap = await ref.get();
    const data = snap.data();
    if (!snap.exists || !data) {
      throw notFound('Message could not be read after write');
    }
    return snapshotToMessage(snap.id, input.chatId, data);
  }

  async list(chatId: string, options: ListMessagesOptions): Promise<MessagePage> {
    const limit = Math.min(Math.max(options.limit, 1), MAX_MESSAGE_PAGE_SIZE);
    const base = this.collection(chatId)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(limit);

    const cursor = options.cursor ? decodeMessageCursor(options.cursor) : null;
    const query = cursor
      ? base.startAfter(Timestamp.fromMillis(cursor.t), this.collection(chatId).doc(cursor.i))
      : base;

    const snap = await query.get();
    const messages = snap.docs.map((doc) =>
      snapshotToMessage(doc.id, chatId, doc.data() as Record<string, unknown>),
    );

    const hasMore = messages.length === limit;
    const oldest = messages[messages.length - 1];
    return {
      messages: messages.reverse(),
      nextCursor: hasMore && oldest ? encodeMessageCursor(oldest) : null,
    };
  }

  async countAfter(chatId: string, since: string, excludeSenderId: string): Promise<number> {
    const sinceTs = Timestamp.fromDate(new Date(since));
    const snapshot = await this.collection(chatId)
      .where('createdAt', '>', sinceTs)
      .where('senderId', '!=', excludeSenderId)
      .count()
      .get();
    return snapshot.data().count;
  }

  async findById(chatId: string, messageId: string): Promise<Message | null> {
    let snap: DocumentSnapshot;
    try {
      snap = await this.collection(chatId).doc(messageId).get();
    } catch (err) {
      if (isInvalidDocumentName(err)) throw notFound('Message not found');
      throw err;
    }
    if (!snap.exists) return null;
    return snapshotToMessage(snap.id, chatId, snap.data() as Record<string, unknown>);
  }
}

/** Firestore rejects ids containing '/' or '..' — surface them as 404, not 500. */
function isInvalidDocumentName(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: number }).code;
  return code === 3 || /invalid.*document.*name/i.test(err.message);
}

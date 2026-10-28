import { FieldValue, Timestamp, type Firestore } from '@google-cloud/firestore';
import { notFound } from '../errors';
import { getFirestoreDb } from '../firestore/client';
import type { ReadReceipt } from '../types/domain';

export interface MarkReadResult {
  receipt: ReadReceipt;
  /** false when a receipt already existed (first-read semantics preserved). */
  created: boolean;
}

export interface ReadReceiptRepository {
  /**
   * Idempotent: creates the receipt only if absent, preserving the original
   * readAt when the caller retries.
   */
  markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult>;
  /** Readers for the given messages (bounded by the caller's page size). */
  readersOf(chatId: string, messageIds: string[]): Promise<Record<string, ReadReceipt[]>>;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  throw new Error('missing readAt on receipt document');
}

/** Receipts live at chats/{chatId}/messages/{messageId}/readBy/{userId}. */
export class FirestoreReadReceiptRepository implements ReadReceiptRepository {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private receiptRef(chatId: string, messageId: string, userId: string) {
    return this.db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .doc(messageId)
      .collection('readBy')
      .doc(userId);
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<MarkReadResult> {
    const ref = this.receiptRef(chatId, messageId, userId);
    const outcome = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const data = snap.data() as { userId?: unknown; readAt?: unknown };
        return {
          created: false,
          readAt: data.readAt !== undefined ? toIso(data.readAt) : new Date().toISOString(),
        };
      }
      tx.set(ref, { userId, readAt: FieldValue.serverTimestamp() });
      return { created: true, readAt: null as string | null };
    });

    if (!outcome.created && outcome.readAt) {
      return {
        receipt: { messageId, userId, readAt: outcome.readAt },
        created: false,
      };
    }
    const snap = await ref.get();
    const data = snap.data();
    if (!snap.exists || !data) throw notFound('Receipt could not be read after write');
    return {
      receipt: { messageId, userId, readAt: toIso(data['readAt']) },
      created: true,
    };
  }

  async readersOf(chatId: string, messageIds: string[]): Promise<Record<string, ReadReceipt[]>> {
    const results: Record<string, ReadReceipt[]> = {};
    await Promise.all(
      messageIds.map(async (messageId) => {
        const snap = await this.db
          .collection('chats')
          .doc(chatId)
          .collection('messages')
          .doc(messageId)
          .collection('readBy')
          .get();
        results[messageId] = snap.docs.map((doc) => {
          const data = doc.data() as { userId?: unknown; readAt?: unknown };
          return {
            messageId,
            userId: typeof data.userId === 'string' ? data.userId : doc.id,
            readAt: data.readAt !== undefined ? toIso(data.readAt) : new Date(0).toISOString(),
          };
        });
      }),
    );
    return results;
  }
}

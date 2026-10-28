import { FieldValue, Timestamp, type Firestore } from '@google-cloud/firestore';
import { getFirestoreDb } from '../firestore/client';
import type { ReadProgress } from '../types/domain';

export type AdvanceResult =
  | { status: 'not_found' }
  | { status: 'stale'; progress: ReadProgress }
  | { status: 'advanced'; progress: ReadProgress };

export interface ReadProgressRepository {
  get(chatId: string, userId: string): Promise<ReadProgress | null>;
  /**
   * Moves the per-user pointer forward only. A request for an older message
   * than the current pointer is a no-op (progress never moves backwards).
   */
  advance(chatId: string, userId: string, messageId: string): Promise<AdvanceResult>;
  /** Best-effort cleanup when membership is revoked. */
  delete(chatId: string, userId: string): Promise<void>;
}

interface ProgressDoc {
  userId?: unknown;
  lastSeenMessageId?: unknown;
  lastSeenAt?: unknown;
  lastSeenMessageAt?: unknown;
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(0).toISOString();
}

function toDocProgress(userId: string, data: ProgressDoc): ReadProgress {
  return {
    userId,
    lastSeenMessageId: typeof data.lastSeenMessageId === 'string' ? data.lastSeenMessageId : null,
    lastSeenAt: data.lastSeenAt !== undefined ? toIso(data.lastSeenAt) : null,
  };
}

/** Reading progress lives at chats/{chatId}/members/{userId}. */
export class FirestoreReadProgressRepository implements ReadProgressRepository {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private memberRef(chatId: string, userId: string) {
    return this.db.collection('chats').doc(chatId).collection('members').doc(userId);
  }

  private messageRef(chatId: string, messageId: string) {
    return this.db.collection('chats').doc(chatId).collection('messages').doc(messageId);
  }

  async get(chatId: string, userId: string): Promise<ReadProgress | null> {
    const snap = await this.memberRef(chatId, userId).get();
    if (!snap.exists) return null;
    return toDocProgress(userId, snap.data() as ProgressDoc);
  }

  async advance(chatId: string, userId: string, messageId: string): Promise<AdvanceResult> {
    const memberRef = this.memberRef(chatId, userId);
    const messageRef = this.messageRef(chatId, messageId);

    const outcome = await this.db.runTransaction(async (tx) => {
      const [messageSnap, memberSnap] = await Promise.all([tx.get(messageRef), tx.get(memberRef)]);
      if (!messageSnap.exists) return { status: 'not_found' as const };

      const messageData = messageSnap.data() as { createdAt?: unknown } | undefined;
      const messageCreatedAt = messageData?.createdAt;
      if (!(messageCreatedAt instanceof Timestamp)) {
        return { status: 'not_found' as const };
      }

      const memberData = (memberSnap.exists ? memberSnap.data() : {}) as ProgressDoc;
      const currentId =
        typeof memberData.lastSeenMessageId === 'string' ? memberData.lastSeenMessageId : null;
      const currentAt =
        memberData.lastSeenMessageAt instanceof Timestamp ? memberData.lastSeenMessageAt : null;

      // Monotonic guard: reject if (createdAt, id) of the new pointer is older
      // than the stored pointer.
      if (currentId !== null && currentAt !== null) {
        const newMs = messageCreatedAt.toMillis();
        const curMs = currentAt.toMillis();
        if (newMs < curMs || (newMs === curMs && messageId <= currentId)) {
          return {
            status: 'stale' as const,
            progress: {
              userId,
              lastSeenMessageId: currentId,
              lastSeenAt: memberData.lastSeenAt !== undefined ? toIso(memberData.lastSeenAt) : null,
            } satisfies ReadProgress,
          };
        }
      }

      tx.set(
        memberRef,
        {
          userId,
          lastSeenMessageId: messageId,
          lastSeenAt: FieldValue.serverTimestamp(),
          lastSeenMessageAt: messageCreatedAt,
        },
        { merge: true },
      );
      return { status: 'advanced' as const };
    });

    if (outcome.status !== 'advanced') return outcome;

    const snap = await memberRef.get();
    const data = (snap.data() ?? {}) as ProgressDoc;
    return {
      status: 'advanced',
      progress: toDocProgress(userId, data),
    };
  }

  async delete(chatId: string, userId: string): Promise<void> {
    try {
      await this.memberRef(chatId, userId).delete();
    } catch {
      // Best effort: API access is gated by SQL membership regardless.
    }
  }
}

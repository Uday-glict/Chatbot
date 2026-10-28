import { Firestore } from '@google-cloud/firestore';
import { getConfig } from '../config';

let db: Firestore | undefined;

/** Raised when Firestore cannot be initialized or reached. */
export class FirestoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FirestoreUnavailableError';
  }
}

/**
 * Lazily initialized Firestore. Cloud mode uses Application Default
 * Credentials, including GOOGLE_APPLICATION_CREDENTIALS for local
 * development. The emulator is enabled only when explicitly configured by
 * the Firestore client through FIRESTORE_EMULATOR_HOST.
 * Service-account material never reaches the browser.
 */
export function getFirestoreDb(): Firestore {
  if (db) return db;
  const cfg = getConfig();
  try {
    db = new Firestore({
      projectId: cfg.FIREBASE_PROJECT_ID,
      databaseId: cfg.FIRESTORE_DATABASE_ID,
    });
    return db;
  } catch (err) {
    throw new FirestoreUnavailableError('Firestore is unavailable', { cause: err });
  }
}

/** Performs a read-only metadata request to prove Firestore is reachable. */
export async function verifyFirestoreConnectivity(): Promise<void> {
  const db = getFirestoreDb();
  try {
    await db.listCollections();
  } catch (err) {
    throw new FirestoreUnavailableError('Firestore connectivity check failed', { cause: err });
  }
}

/** Maps transient Firebase/gRPC failures to the API's dependency error. */
export function isFirestoreUnavailableError(err: unknown): boolean {
  if (err instanceof FirestoreUnavailableError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return [2, 4, 8, 10, 11, 13, 14, 'ABORTED', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNAVAILABLE']
    .includes(code as never);
}

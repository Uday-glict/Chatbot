import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getConfig } from '../config';

let db: Firestore | undefined;

/**
 * Lazily initialized Firestore (Admin SDK). Runs against the emulator when
 * FIRESTORE_EMULATOR_HOST is set (no credentials needed); otherwise uses
 * application-default credentials (GOOGLE_APPLICATION_CREDENTIALS).
 * Service-account material never reaches the browser.
 */
export function getFirestoreDb(): Firestore {
  if (db) return db;
  const cfg = getConfig();
  const app =
    getApps()[0] ??
    initializeApp(
      cfg.FIRESTORE_EMULATOR_HOST
        ? { projectId: cfg.FIRESTORE_PROJECT_ID }
        : {
            projectId: cfg.FIRESTORE_PROJECT_ID,
            credential: applicationDefault(),
          },
    );
  db = getFirestore(app);
  return db;
}

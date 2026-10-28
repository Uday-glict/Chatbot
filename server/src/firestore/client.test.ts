import { describe, expect, it } from 'vitest';
import { getFirestoreDb } from './client';

describe('Firestore client', () => {
  it('selects the configured named database without performing I/O', () => {
    const db = getFirestoreDb();

    expect(db.databaseId).toBe('default');
  });
});

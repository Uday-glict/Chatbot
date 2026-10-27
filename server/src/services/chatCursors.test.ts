import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import type { Chat } from '../types/domain';
import { decodeChatCursor, encodeChatCursor } from './chatService';

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  chatType: 'group',
  name: 'Team',
  createdBy: '123e4567-e89b-42d3-a456-426614174001',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T12:30:45.123Z',
  ...overrides,
});

describe('chat list cursor codec', () => {
  it('round-trips a chat position (encode and decode must agree)', () => {
    const original = chat();
    const decoded = decodeChatCursor(encodeChatCursor(original));
    expect(decoded).toEqual({ updatedAt: original.updatedAt, id: original.id });
  });

  it('rejects invalid cursors with 400', () => {
    const invalid = [
      'garbage!!!',
      Buffer.from('{"updatedAt":"2026-01-01T00:00:00.000Z","id":"x"}').toString('base64url'),
      Buffer.from('{"u":"not-a-date","i":"x"}').toString('base64url'),
      Buffer.from('{"u":123,"i":"x"}').toString('base64url'),
      Buffer.from('{"u":"2026-01-01T00:00:00.000Z"}').toString('base64url'),
      Buffer.from('"string"').toString('base64url'),
    ];
    for (const cursor of invalid) {
      try {
        decodeChatCursor(cursor);
        expect.unreachable(`cursor ${cursor} should have been rejected`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(400);
      }
    }
  });
});

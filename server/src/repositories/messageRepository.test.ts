import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import type { Message } from '../types/domain';
import {
  decodeMessageCursor,
  encodeMessageCursor,
  MAX_MESSAGE_PAGE_SIZE,
} from './messageRepository';

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'abc123',
  chatId: '123e4567-e89b-42d3-a456-426614174000',
  senderId: '123e4567-e89b-42d3-a456-426614174001',
  text: 'hi',
  createdAt: '2026-01-02T03:04:05.006Z',
  updatedAt: '2026-01-02T03:04:05.006Z',
  deletedAt: null,
  ...overrides,
});

describe('message cursor codec', () => {
  it('round-trips a message position', () => {
    const cursor = encodeMessageCursor(message());
    const decoded = decodeMessageCursor(cursor);
    expect(decoded).toEqual({ t: Date.parse('2026-01-02T03:04:05.006Z'), i: 'abc123' });
  });

  it('produces URL-safe output', () => {
    const cursor = encodeMessageCursor(message());
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects garbage cursors with a 400 AppError', () => {
    const invalid = [
      'not-base64!!',
      Buffer.from('{"t":"nope","i":1}').toString('base64url'),
      Buffer.from('{"t":123,"i":"has spaces"}').toString('base64url'),
      Buffer.from('"just a string"').toString('base64url'),
      Buffer.from('{"t":123}').toString('base64url'),
    ];
    for (const cursor of invalid) {
      try {
        decodeMessageCursor(cursor);
        expect.unreachable(`cursor ${cursor} should have been rejected`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(400);
      }
    }
  });
});

describe('page size bounds', () => {
  it('caps the page size constant', () => {
    expect(MAX_MESSAGE_PAGE_SIZE).toBe(100);
  });
});

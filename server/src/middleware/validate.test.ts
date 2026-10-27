import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors';
import { parseBody, parseParam, parseQuery } from './validate';

const fakeReq = (body: unknown, query: unknown = {}) =>
  ({ body, query }) as unknown as Parameters<typeof parseBody>[0];

describe('parseBody', () => {
  const schema = z.object({ name: z.string().min(1), age: z.coerce.number().int().positive() });

  it('returns parsed data when valid', () => {
    expect(parseBody(fakeReq({ name: 'Ada', age: '30' }), schema)).toEqual({ name: 'Ada', age: 30 });
  });

  it('throws a 400 AppError with field details when invalid', () => {
    try {
      parseBody(fakeReq({ name: '', age: -5 }), schema);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.status).toBe(400);
      expect(appErr.code).toBe('VALIDATION_ERROR');
      const fields = (appErr.details?.['fields'] as { path: string }[]).map((f) => f.path);
      expect(fields).toContain('name');
      expect(fields).toContain('age');
    }
  });

  it('rejects a missing payload', () => {
    expect(() => parseBody(fakeReq(undefined), schema)).toThrow(AppError);
  });
});

describe('parseQuery', () => {
  const schema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

  it('applies defaults', () => {
    expect(parseQuery(fakeReq({}, {}), schema)).toEqual({ limit: 20 });
  });

  it('coerces numeric strings and enforces bounds', () => {
    expect(parseQuery(fakeReq({}, { limit: '10' }), schema)).toEqual({ limit: 10 });
    expect(() => parseQuery(fakeReq({}, { limit: '51' }), schema)).toThrow(AppError);
    expect(() => parseQuery(fakeReq({}, { limit: 'abc' }), schema)).toThrow(AppError);
  });
});

describe('parseParam', () => {
  const uuid = z.uuid();

  it('accepts a valid uuid', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(parseParam(id, uuid, 'chatId')).toBe(id);
  });

  it('rejects undefined, arrays and malformed values with 400', () => {
    expect(() => parseParam(undefined, uuid, 'chatId')).toThrow(AppError);
    expect(() => parseParam(['a', 'b'], uuid, 'chatId')).toThrow(AppError);
    expect(() => parseParam('not-a-uuid', uuid, 'chatId')).toThrow(AppError);
    try {
      parseParam('not-a-uuid', uuid, 'chatId');
    } catch (err) {
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).details?.['fields']).toBeDefined();
    }
  });
});

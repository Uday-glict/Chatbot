import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError, forbidden } from '../errors';
import { FirestoreUnavailableError } from '../firestore/client';
import { errorHandler, notFoundHandler } from './errorHandler';
import { requestId } from './requestId';

function build() {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '64kb' }));

  app.get('/app-error', () => {
    throw forbidden('no entry here');
  });
  app.get('/boom', () => {
    throw new Error('secret database password leaked in message');
  });
  app.get('/app-error-with-details', () => {
    throw new AppError(409, 'CONFLICT', 'duplicate', { field: 'email' });
  });
  app.get('/firestore-unavailable', () => {
    throw new FirestoreUnavailableError('Firestore is unavailable');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = build();

describe('centralized error handling', () => {
  it('renders AppError with its status, code and requestId', async () => {
    const res = await request(app).get('/app-error').expect(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', message: 'no entry here' });
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('includes structured details when present', async () => {
    const res = await request(app).get('/app-error-with-details').expect(409);
    expect(res.body.error.details).toEqual({ field: 'email' });
  });

  it('never leaks stack traces or internal messages for unknown errors', async () => {
    const res = await request(app).get('/boom').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secret database password');
    expect(raw).not.toContain('stack');
  });

  it('maps Firestore outages to a controlled 503 response', async () => {
    const res = await request(app).get('/firestore-unavailable').expect(503);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Firestore is temporarily unavailable',
    });
  });

  it('returns the standard envelope for unknown routes', async () => {
    const res = await request(app).get('/nope/nowhere').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('maps malformed JSON to 400', async () => {
    const res = await request(app)
      .post('/app-error')
      .set('Content-Type', 'application/json')
      .send('{"broken": ')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

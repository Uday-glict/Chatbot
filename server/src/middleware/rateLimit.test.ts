import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errorHandler';
import { limiter } from './rateLimit';
import { requestId } from './requestId';

function build(limit: number) {
  const app = express();
  app.use(requestId);
  app.get('/resource', limiter(limit, 'unit-test'), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('rate limiting', () => {
  it('allows requests under the limit and returns the standard 429 envelope above it', async () => {
    const app = build(3);

    for (let i = 0; i < 3; i += 1) {
      await request(app).get('/resource').expect(200);
    }

    const blocked = await request(app).get('/resource').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.requestId).toEqual(expect.any(String));
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('applies the limit per scope', async () => {
    const app = express();
    app.use(requestId);
    app.get('/a', limiter(1, 'scope-a'), (_req, res) => res.status(200).end());
    app.get('/b', limiter(1, 'scope-b'), (_req, res) => res.status(200).end());
    app.use(errorHandler);

    await request(app).get('/a').expect(200);
    await request(app).get('/a').expect(429);
    // A different scope still has budget.
    await request(app).get('/b').expect(200);
  });
});

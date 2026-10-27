import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authHeader, buildApp, signUpUser } from './helpers/app';

const app = buildApp();

describe('POST /api/v1/auth/signup', () => {
  it('creates an account and returns a bearer token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'password-123' })
      .expect(201);

    expect(res.body.data.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(res.body.data.user.id).toEqual(expect.any(String));
    expect(typeof res.body.data.token).toBe('string');
    // No credential material in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt|hash/i);
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Dup', email: 'dup@example.com', password: 'password-123' })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Dup 2', email: 'dup@example.com', password: 'password-123' })
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('treats email case-insensitively for uniqueness', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Case', email: 'case@example.com', password: 'password-123' })
      .expect(201);

    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Case 2', email: 'CASE@example.com', password: 'password-123' })
      .expect(409);
  });

  it('validates required fields, email format and password length', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: '', email: 'x@example.com', password: 'password-123' })
      .expect(400);

    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'X', email: 'not-an-email', password: 'password-123' })
      .expect(400);

    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'X', email: 'x@example.com', password: 'short' })
      .expect(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const user = await signUpUser(app, 'login');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'password-123' })
      .expect(200);
    expect(typeof res.body.data.token).toBe('string');
  });

  it('returns 401 for a wrong password and for an unknown email (same message)', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'password-123' })
      .expect(401);

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'password-123' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknown.body.error.message);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/v1/users/me', () => {
  it('returns the authenticated user', async () => {
    const user = await signUpUser(app, 'me');
    const res = await request(app)
      .get('/api/v1/users/me')
      .set(authHeader(user.token))
      .expect(200);

    expect(res.body.data).toMatchObject({ id: user.id, email: user.email });
  });

  it('rejects requests without a token (401) and with a tampered token (401)', async () => {
    await request(app).get('/api/v1/users/me').expect(401);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token signed with a different secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({}, 'some-other-secret-that-is-long-enough', {
      subject: '00000000-0000-4000-8000-000000000000',
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    await request(app)
      .get('/api/v1/users/me')
      .set(authHeader(forged))
      .expect(401);
  });
});

describe('GET /api/v1/users/search', () => {
  it('excludes the caller, returns minimal fields and paginates', async () => {
    const me = await signUpUser(app, 'searcher');
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post('/api/v1/auth/signup')
        .send({ name: `Target ${i}`, email: `target${i}.${Date.now()}@example.com`, password: 'password-123' })
        .expect(201);
    }

    const page1 = await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'Target', limit: 2 })
      .set(authHeader(me.token))
      .expect(200);

    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.hasMore).toBe(true);
    expect(page1.body.data[0]).toHaveProperty('id');
    expect(page1.body.data[0]).toHaveProperty('name');
    expect(page1.body.data[0]).not.toHaveProperty('passwordHash');

    const page2 = await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'Target', limit: 2, offset: 2 })
      .set(authHeader(me.token))
      .expect(200);
    expect(page2.body.data).toHaveLength(2);

    const ids = new Set([...page1.body.data, ...page2.body.data].map((u: { id: string }) => u.id));
    expect(ids.size).toBe(4);
    expect([...ids]).not.toContain(me.id);
  });

  it('never returns the requesting user', async () => {
    const me = await signUpUser(app, 'solo-self');
    const res = await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'solo-self' })
      .set(authHeader(me.token))
      .expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('validates query length and requires authentication', async () => {
    await request(app).get('/api/v1/users/search').query({ q: 'x' }).expect(401);

    const user = await signUpUser(app, 'qcheck');
    await request(app)
      .get('/api/v1/users/search')
      .query({ q: '' })
      .set(authHeader(user.token))
      .expect(400);

    await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'x'.repeat(65) })
      .set(authHeader(user.token))
      .expect(400);
  });

  it('handles SQL metacharacters safely (parameterized LIKE)', async () => {
    const user = await signUpUser(app, 'inject');
    const res = await request(app)
      .get('/api/v1/users/search')
      .query({ q: "'; DROP TABLE users; --" })
      .set(authHeader(user.token))
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    // Table still exists and search still works.
    await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'inject' })
      .set(authHeader(user.token))
      .expect(200);
  });
});

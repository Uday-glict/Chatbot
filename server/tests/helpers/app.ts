import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { getConfig, resetConfigForTests } from '../../src/config';
import { createPool, type Pool } from '../../src/db/pool';
import { createServices, type RepositoryOverrides } from '../../src/container';
import type { Services } from '../../src/controllers/helpers';
import {
  InMemoryMessageRepository,
  InMemoryReadProgressRepository,
  InMemoryReadReceiptRepository,
} from './memory';

const POOL_KEY = Symbol.for('chatApp.test.pool');

/** One shared pool for the whole run (workers reuse globalThis). */
export function getPool(): Pool {
  const globals = globalThis as unknown as Record<symbol, Pool | undefined>;
  const existing = globals[POOL_KEY];
  if (existing) return existing;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — globalSetup did not run');
  const pool = createPool(url, 5);
  globals[POOL_KEY] = pool;
  return pool;
}

export function buildServices(overrides: RepositoryOverrides = {}): Services {
  resetConfigForTests();
  return createServices(getPool(), { ...defaultOverrides(), ...overrides });
}

/**
 * Without the Firestore emulator, use in-memory repositories so SQL-side
 * tests never construct a real Firestore client. With the emulator, the real
 * Firestore repositories are used end-to-end.
 */
function defaultOverrides(): RepositoryOverrides {
  if (emulatorAvailable()) return {};
  const messages = new InMemoryMessageRepository();
  const receipts = new InMemoryReadReceiptRepository();
  const progress = new InMemoryReadProgressRepository();
  return {
    messages: () => messages,
    receipts: () => receipts,
    progress: () => progress,
  };
}

export function buildApp(overrides: RepositoryOverrides = {}): Express {
  return createApp(buildServices(overrides), getConfig());
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
}

let userCounter = 0;

/** Signs up a fresh user through the real API and returns credentials. */
export async function signUpUser(
  app: Express,
  label = 'user',
): Promise<TestUser> {
  userCounter += 1;
  const unique = `${label}${userCounter}.${Date.now().toString(36)}`;
  const email = `${unique}@example.com`;
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ name: `${label} ${userCounter}`, email, password: 'password-123' })
    .expect(201);
  const data = res.body.data as { user: { id: string; name: string }; token: string };
  return { id: data.user.id, name: data.user.name, email, token: data.token };
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Creates (or reuses) a direct chat between two users. */
export async function createDirectChat(
  app: Express,
  a: TestUser,
  b: TestUser,
): Promise<{ id: string; created: boolean }> {
  const res = await request(app)
    .post('/api/v1/chat/create')
    .set(authHeader(a.token))
    .send({ userAId: a.id, userBId: b.id });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`direct chat creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.data.chat.id as string, created: res.status === 201 };
}

/** Creates a group with `owner` as admin and the given member ids. */
export async function createGroup(
  app: Express,
  owner: TestUser,
  name: string,
  memberIds: string[],
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/groups')
    .set(authHeader(owner.token))
    .send({ name, memberIds })
    .expect(201);
  return res.body.data.chat.id as string;
}

/** Firestore-backed integration tests need the emulator; others don't. */
export const emulatorAvailable = (): boolean => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

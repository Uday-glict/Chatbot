import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple', 16384);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('right-password', 16384);
    expect(await verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    const a = await hashPassword('same-password', 16384);
    const b = await hashPassword('same-password', 16384);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc$!!$!!')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

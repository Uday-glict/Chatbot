import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const R = 8;
const P = 1;

function scryptParams(costRounds: number): { N: number; r: number; p: number; maxmem: number } {
  return { N: costRounds, r: R, p: P, maxmem: 256 * 1024 * 1024 };
}

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native dep).
 * Stored format: scrypt$<cost>$<salt-b64>$<hash-b64>
 */
export async function hashPassword(password: string, costRounds: number): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, scryptParams(costRounds));
  return `scrypt$${costRounds}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost <= 0) return false;
  const salt = Buffer.from(parts[2] ?? '', 'base64');
  const expected = Buffer.from(parts[3] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scrypt(password, salt, expected.length, scryptParams(cost));
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { unauthorized } from '../errors';

export interface TokenPayload {
  sub: string;
}

export function signToken(userId: string): string {
  const cfg = getConfig();
  return jwt.sign({}, cfg.JWT_SECRET, {
    subject: userId,
    algorithm: 'HS256',
    expiresIn: cfg.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Verifies signature + expiry and returns the authenticated user id. */
export function verifyToken(token: string): string {
  try {
    const decoded = jwt.verify(token, getConfig().JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || !decoded.sub) {
      throw unauthorized('Invalid token payload');
    }
    return decoded.sub;
  } catch (err) {
    if (err instanceof Error && err.name === 'AppError') throw err;
    throw unauthorized('Invalid or expired token');
  }
}

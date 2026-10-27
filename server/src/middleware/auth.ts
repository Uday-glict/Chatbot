import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { unauthorized, forbidden } from '../errors';
import { verifyToken } from '../services/token';

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by requireAuth from the verified JWT — never from the request body. */
    auth?: { userId: string };
  }
}

/**
 * Rejects unauthenticated requests. Identity comes exclusively from the
 * verified access token; body/query user ids are never trusted as identity.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.header('authorization') ?? '';
  const parts = header.split(' ');
  const scheme = parts[0] ?? '';
  const token = parts[1];
  if (!token || scheme.toLowerCase() !== 'bearer') {
    next(unauthorized('Missing bearer access token'));
    return;
  }
  try {
    req.auth = { userId: verifyToken(token) };
    next();
  } catch (err) {
    next(err);
  }
};

/** Narrows the authenticated user id after requireAuth. Throws if absent. */
export function authenticatedUserId(req: Request): string {
  const id = req.auth?.userId;
  if (!id) throw unauthorized();
  return id;
}

/** Guards: the authenticated user must be the requested user. */
export function assertSelfOrForbidden(authUserId: string, requestedUserId: string): void {
  if (authUserId !== requestedUserId) {
    throw forbidden('You may only access your own resources');
  }
}

import { rateLimit } from 'express-rate-limit';
import { getConfig } from '../config';
import { rateLimited } from '../errors';

/**
 * Fixed-window rate limiter. Limits are configurable per traffic class
 * (auth, search, message send) via environment variables.
 */
export function limiter(limitPerMinute: number, scope: string) {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, _next) => {
      _next(rateLimited(`Rate limit exceeded for ${scope}`));
    },
  });
}

export const authLimiter = () => limiter(getConfig().RATE_LIMIT_AUTH_PER_MINUTE, 'auth');
export const searchLimiter = () => limiter(getConfig().RATE_LIMIT_SEARCH_PER_MINUTE, 'search');
export const sendLimiter = () => limiter(getConfig().RATE_LIMIT_SEND_PER_MINUTE, 'send');

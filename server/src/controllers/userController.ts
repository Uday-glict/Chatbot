import type { Request, Response } from 'express';
import { authenticatedUserId } from '../middleware/auth';
import { parseQuery } from '../middleware/validate';
import { makeSearchQuerySchema } from '../http/schemas';
import { asyncRoute, type Services } from './helpers';

export function createUserController(services: Services) {
  return {
    me: asyncRoute(async (req: Request, res: Response) => {
      const user = await services.users.me(authenticatedUserId(req));
      res.status(200).json({ data: user });
    }),

    search: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const query = parseQuery(req, makeSearchQuerySchema());
      const users = await services.users.search({
        query: query.q,
        limit: query.limit,
        offset: query.offset,
        excludeUserId: userId,
      });
      res.status(200).json({
        data: users,
        meta: { limit: query.limit, offset: query.offset, hasMore: users.length === query.limit },
      });
    }),
  };
}

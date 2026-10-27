import type { Request, Response } from 'express';
import { parseBody } from '../middleware/validate';
import { loginSchema, signupSchema } from '../http/schemas';
import { asyncRoute, type Services } from './helpers';

export function createAuthController(services: Services) {
  return {
    signup: asyncRoute(async (req: Request, res: Response) => {
      const body = parseBody(req, signupSchema);
      const { user, token } = await services.auth.signup(body);
      res.status(201).json({ data: { user, token } });
    }),

    login: asyncRoute(async (req: Request, res: Response) => {
      const body = parseBody(req, loginSchema);
      const { user, token } = await services.auth.login(body.email, body.password);
      res.status(200).json({ data: { user, token } });
    }),
  };
}

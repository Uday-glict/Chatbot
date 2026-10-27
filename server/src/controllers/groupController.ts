import type { Request, Response } from 'express';
import { authenticatedUserId } from '../middleware/auth';
import { parseBody, parseParam } from '../middleware/validate';
import {
  addMembersSchema,
  makeCreateGroupSchema,
  renameGroupSchema,
  setRoleSchema,
  uuidSchema,
} from '../http/schemas';
import { asyncRoute, type Services } from './helpers';

export function createGroupController(services: Services) {
  const groupId = (req: Request): string => parseParam(req.params['groupId'], uuidSchema, 'groupId');

  return {
    /** POST /groups — creator becomes member + admin in one transaction. */
    create: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const body = parseBody(req, makeCreateGroupSchema());
      const result = await services.groups.create(userId, body);
      res.status(201).json({ data: result });
    }),

    /** GET /groups/:groupId */
    get: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const result = await services.groups.get(groupId(req), userId);
      res.status(200).json({ data: result });
    }),

    /** PATCH /groups/:groupId — admin only. */
    rename: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const body = parseBody(req, renameGroupSchema);
      const result = await services.groups.rename(groupId(req), userId, body.name);
      res.status(200).json({ data: result });
    }),

    /** POST /groups/:groupId/members — admin only, idempotent add. */
    addMembers: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const body = parseBody(req, addMembersSchema);
      const result = await services.groups.addMembers(groupId(req), userId, body.userIds);
      res.status(200).json({ data: result });
    }),

    /** DELETE /groups/:groupId/members/:userId — admin removes others, any member may leave. */
    removeMember: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const id = parseParam(req.params['userId'], uuidSchema, 'userId');
      await services.groups.removeMember(groupId(req), userId, id);
      res.status(200).json({ data: { removed: true } });
    }),

    /** PATCH /groups/:groupId/members/:userId — admin only (promote/demote). */
    setRole: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const targetId = parseParam(req.params['userId'], uuidSchema, 'userId');
      const body = parseBody(req, setRoleSchema);
      const result = await services.groups.setRole(groupId(req), userId, targetId, body.role);
      res.status(200).json({ data: result });
    }),
  };
}

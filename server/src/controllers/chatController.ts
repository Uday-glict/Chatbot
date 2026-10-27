import type { Request, Response } from 'express';
import { authenticatedUserId } from '../middleware/auth';
import { forbidden } from '../errors';
import { parseBody, parseParam, parseQuery } from '../middleware/validate';
import {
  createDirectSchema,
  lastSeenSchema,
  listChatsQuerySchema,
  listMessagesQuerySchema,
  makeSendMessageSchema,
  messageIdSchema,
  uuidSchema,
} from '../http/schemas';
import { asyncRoute, type Services } from './helpers';

export function createChatController(services: Services) {
  return {
    /** POST /chat/create — returns the existing direct chat when one exists. */
    createDirect: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const body = parseBody(req, createDirectSchema);
      const result = await services.chats.createDirect(userId, body.userAId, body.userBId);
      res.status(result.created ? 201 : 200).json({ data: result });
    }),

    /** GET /user/:userId/chats — own list only (403 for any other user). */
    listChats: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const requested = parseParam(req.params['userId'], uuidSchema, 'userId');
      if (requested !== userId) {
        throw forbidden('You may only list your own chats');
      }
      const query = parseQuery(req, listChatsQuerySchema);
      const result = await services.chats.listChats(userId, query.limit, query.cursor ?? null);
      res.status(200).json({ data: result.chats, meta: { nextCursor: result.nextCursor } });
    }),

    /** GET /chat/:chatId/messages — cursor-paginated, chronological. */
    listMessages: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const chatId = parseParam(req.params['chatId'], uuidSchema, 'chatId');
      const query = parseQuery(req, listMessagesQuerySchema);
      const result = await services.messages.list(userId, chatId, {
        limit: query.limit,
        cursor: query.cursor ?? null,
      });
      res.status(200).json({
        data: {
          messages: result.messages,
          receipts: result.receipts,
          otherLastSeen: result.otherLastSeen,
        },
        meta: { nextCursor: result.nextCursor },
      });
    }),

    /** POST /chat/:chatId/message/send */
    sendMessage: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const chatId = parseParam(req.params['chatId'], uuidSchema, 'chatId');
      const body = parseBody(req, makeSendMessageSchema());
      const message = await services.messages.send(userId, chatId, body);
      res.status(201).json({ data: message });
    }),

    /** POST /chat/:chatId/message/:messageId/read — idempotent receipt. */
    markRead: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const chatId = parseParam(req.params['chatId'], uuidSchema, 'chatId');
      const messageId = parseParam(req.params['messageId'], messageIdSchema, 'messageId');
      const result = await services.messages.markRead(userId, chatId, messageId);
      res.status(200).json({ data: result });
    }),

    /** POST /chat/:chatId/lastseen — monotonic per-user reading progress. */
    setLastSeen: asyncRoute(async (req: Request, res: Response) => {
      const userId = authenticatedUserId(req);
      const chatId = parseParam(req.params['chatId'], uuidSchema, 'chatId');
      const body = parseBody(req, lastSeenSchema);
      const result = await services.messages.setLastSeen(userId, chatId, body.messageId);
      res.status(200).json({ data: result });
    }),
  };
}

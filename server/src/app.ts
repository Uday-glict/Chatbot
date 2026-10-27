import cors from 'cors';
import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import type { Env } from './config';
import { createAuthController } from './controllers/authController';
import { createChatController } from './controllers/chatController';
import { createGroupController } from './controllers/groupController';
import { createUserController } from './controllers/userController';
import type { Services } from './controllers/helpers';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authLimiter, searchLimiter, sendLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { logger } from './logger';

export function createApp(services: Services, cfg: Env): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as { requestId?: string }).requestId ?? 'unknown',
      autoLogging: cfg.NODE_ENV !== 'test',
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // No-Origin requests (curl, server-to-server) are allowed; browsers are
        // restricted to the configured origins.
        if (!origin || cfg.CORS_ORIGINS.includes(origin)) cb(null, true);
        else cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const auth = createAuthController(services);
  const users = createUserController(services);
  const chats = createChatController(services);
  const groups = createGroupController(services);

  const api = express.Router();

  // Authentication
  api.post('/auth/signup', authLimiter(), auth.signup);
  api.post('/auth/login', authLimiter(), auth.login);

  // Users
  api.get('/users/me', requireAuth, users.me);
  api.get('/users/search', requireAuth, searchLimiter(), users.search);

  // Direct chat + shared messaging (both chat types)
  api.post('/chat/create', requireAuth, chats.createDirect);
  api.get('/chat/:chatId/messages', requireAuth, chats.listMessages);
  api.post('/chat/:chatId/message/send', requireAuth, sendLimiter(), chats.sendMessage);
  api.post('/chat/:chatId/message/:messageId/read', requireAuth, chats.markRead);
  api.post('/chat/:chatId/lastseen', requireAuth, chats.setLastSeen);
  api.get('/user/:userId/chats', requireAuth, chats.listChats);

  // Groups
  api.post('/groups', requireAuth, groups.create);
  api.get('/groups/:groupId', requireAuth, groups.get);
  api.patch('/groups/:groupId', requireAuth, groups.rename);
  api.post('/groups/:groupId/members', requireAuth, groups.addMembers);
  api.delete('/groups/:groupId/members/:userId', requireAuth, groups.removeMember);
  api.patch('/groups/:groupId/members/:userId', requireAuth, groups.setRole);

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

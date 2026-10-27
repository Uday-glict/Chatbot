import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthService } from '../services/authService';
import type { UserService } from '../services/userService';
import type { ChatService } from '../services/chatService';
import type { GroupService } from '../services/groupService';
import type { MessageService } from '../services/messageService';

/** Express 5 forwards rejected promises, but this keeps handlers explicit. */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** Everything a controller needs; provided by the app container. */
export interface Services {
  auth: AuthService;
  users: UserService;
  chats: ChatService;
  groups: GroupService;
  messages: MessageService;
}

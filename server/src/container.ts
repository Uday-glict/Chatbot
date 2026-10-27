import type { Pool } from 'pg';
import { getConfig } from './config';
import { ChatRepository } from './repositories/chatRepository';
import { FirestoreMessageRepository, type MessageRepository } from './repositories/messageRepository';
import { FirestoreReadProgressRepository, type ReadProgressRepository } from './repositories/readProgressRepository';
import { FirestoreReadReceiptRepository, type ReadReceiptRepository } from './repositories/readReceiptRepository';
import { UserRepository } from './repositories/userRepository';
import { AuthService } from './services/authService';
import { ChatService } from './services/chatService';
import { GroupService } from './services/groupService';
import { MessageService } from './services/messageService';
import { UserService } from './services/userService';
import type { Services } from './controllers/helpers';

/** Test seam: swap Firestore-backed repositories for in-memory fakes. */
export interface RepositoryOverrides {
  messages?: () => MessageRepository;
  receipts?: () => ReadReceiptRepository;
  progress?: () => ReadProgressRepository;
}

export function createServices(pool: Pool, overrides: RepositoryOverrides = {}): Services {
  const cfg = getConfig();
  const users = () => new UserRepository(pool);
  const messages = overrides.messages ?? (() => new FirestoreMessageRepository());
  const receipts = overrides.receipts ?? (() => new FirestoreReadReceiptRepository());
  const progress = overrides.progress ?? (() => new FirestoreReadProgressRepository());

  const chats = new ChatService(pool, messages, progress, {
    groupMaxMembers: cfg.GROUP_MAX_MEMBERS,
  });

  return {
    auth: new AuthService(users, cfg.PASSWORD_SALT_ROUNDS),
    users: new UserService(users),
    chats,
    groups: new GroupService(pool, chats, progress),
    messages: new MessageService(chats, messages, receipts, progress),
  };
}

/** Exposed for tests that need direct participant lookups. */
export type { ChatRepository };

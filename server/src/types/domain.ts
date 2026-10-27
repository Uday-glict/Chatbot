export type ChatType = 'direct' | 'group';
export type ParticipantRole = 'admin' | 'member';

/** Authenticated user record (never exposes password_hash). */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/** Minimal profile exposed by user search. */
export interface PublicUser {
  id: string;
  name: string;
  email?: string;
}

export interface Chat {
  id: string;
  chatType: ChatType;
  name: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  chatId: string;
  userId: string;
  role: ParticipantRole;
  joinedAt: string;
}

export interface ChatWithParticipants {
  chat: Chat;
  participants: Participant[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReadReceipt {
  messageId: string;
  userId: string;
  readAt: string;
}

export interface ReadProgress {
  userId: string;
  lastSeenMessageId: string | null;
  lastSeenAt: string | null;
}

export interface ChatPreview {
  lastMessage: Message | null;
  unreadCount: number;
}

export interface AuthenticatedUser {
  userId: string;
}

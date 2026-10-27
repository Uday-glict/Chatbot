export type ChatType = 'direct' | 'group';
export type ParticipantRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
}

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

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReadProgress {
  userId: string;
  lastSeenMessageId: string | null;
  lastSeenAt: string | null;
}

export interface ChatListItem {
  chat: Chat;
  participants: Participant[];
  participantProfiles: PublicUser[];
  preview: {
    lastMessage: Message | null;
    unreadCount: number;
  };
}

export interface ChatWithParticipants {
  chat: Chat;
  participants: Participant[];
}

export interface MessagesPayload {
  messages: Message[];
  receipts: Record<string, { messageId: string; userId: string; readAt: string }[]>;
  otherLastSeen: ReadProgress | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

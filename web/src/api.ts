import type { ApiErrorBody } from './types';

const TOKEN_KEY = 'chat.token';
const USER_KEY = 'chat.user';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const tokenStore = {
  get(): string | null {
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};

export const userStore = {
  get<T>(): T | null {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set(value: unknown): void {
    window.localStorage.setItem(USER_KEY, JSON.stringify(value));
  },
};

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const err = payload as ApiErrorBody | null;
    if (err && typeof err === 'object' && 'error' in err) {
      throw new ApiError(response.status, err.error.code, err.error.message);
    }
    throw new ApiError(response.status, 'UNKNOWN_ERROR', `Request failed (${response.status})`);
  }
  return payload as T;
}

export const api = {
  signup: (body: { name: string; email: string; password: string }) =>
    request<{ data: { user: import('./types').User; token: string } }>('/api/v1/auth/signup', {
      method: 'POST',
      body,
    }),
  login: (body: { email: string; password: string }) =>
    request<{ data: { user: import('./types').User; token: string } }>('/api/v1/auth/login', {
      method: 'POST',
      body,
    }),
  me: () => request<{ data: import('./types').User }>('/api/v1/users/me'),
  searchUsers: (q: string, limit = 10, offset = 0) =>
    request<{ data: import('./types').PublicUser[]; meta: { hasMore: boolean } }>(
      '/api/v1/users/search',
      { query: { q, limit, offset } },
    ),
  listChats: (userId: string, limit = 30, cursor?: string) =>
    request<{ data: import('./types').ChatListItem[]; meta: { nextCursor: string | null } }>(
      `/api/v1/user/${userId}/chats`,
      { query: { limit, cursor } },
    ),
  createDirectChat: (userAId: string, userBId: string) =>
    request<{ data: import('./types').ChatWithParticipants }>('/api/v1/chat/create', {
      method: 'POST',
      body: { userAId, userBId },
    }),
  createGroup: (name: string, memberIds: string[]) =>
    request<{ data: import('./types').ChatWithParticipants }>('/api/v1/groups', {
      method: 'POST',
      body: { name, memberIds },
    }),
  listMessages: (chatId: string, limit = 50, cursor?: string) =>
    request<{
      data: import('./types').MessagesPayload;
      meta: { nextCursor: string | null };
    }>(`/api/v1/chat/${chatId}/messages`, { query: { limit, cursor } }),
  sendMessage: (chatId: string, text: string, clientMessageId?: string) =>
    request<{ data: import('./types').Message }>(`/api/v1/chat/${chatId}/message/send`, {
      method: 'POST',
      body: clientMessageId ? { text, clientMessageId } : { text },
    }),
  markRead: (chatId: string, messageId: string) =>
    request<{ data: { receipt: unknown; created: boolean } }>(
      `/api/v1/chat/${chatId}/message/${messageId}/read`,
      { method: 'POST', body: {} },
    ),
  setLastSeen: (chatId: string, messageId: string) =>
    request<{ data: { status: string; progress: import('./types').ReadProgress } }>(
      `/api/v1/chat/${chatId}/lastseen`,
      { method: 'POST', body: { messageId } },
    ),
};

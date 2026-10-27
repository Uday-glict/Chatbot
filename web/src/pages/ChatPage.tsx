import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { ChatListItem, Message, MessagesPayload, ReadProgress } from '../types';

const POLL_MS = 4000;
const PAGE = 50;

function sortKey(m: Message): number {
  return Date.parse(m.createdAt);
}

/** Stable ordering: time, then id (matches the server's cursor ordering). */
function compareMessages(a: Message, b: Message): number {
  const dt = sortKey(a) - sortKey(b);
  if (dt !== 0) return dt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

export function ChatPage() {
  const { chatId = '' } = useParams();
  const { user } = useAuth();

  const [meta, setMeta] = useState<ChatListItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [receipts, setReceipts] = useState<Record<string, { userId: string }[]>>({});
  const [otherLastSeen, setOtherLastSeen] = useState<ReadProgress | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef<Set<string>>(new Set());
  const initialScrollRef = useRef(true);

  const title = (): string => {
    if (!meta) return 'Conversation';
    if (meta.chat.chatType === 'group') return meta.chat.name ?? 'Group';
    const other = meta.participantProfiles.find((p) => p.id !== user?.id);
    return other?.name ?? 'Direct message';
  };

  /** Resolve the header (name, participants) from the caller's own chat list. */
  useEffect(() => {
    if (!user || !chatId) return;
    let cancelled = false;
    api
      .listChats(user.id, 100)
      .then((res) => {
        if (cancelled) return;
        setMeta(res.data.find((item) => item.chat.id === chatId) ?? null);
      })
      .catch(() => {
        // Header is cosmetic; message loading below still reports real errors.
      });
    return () => {
      cancelled = true;
    };
  }, [user, chatId]);

  const applyPayload = useCallback((payload: MessagesPayload, replace: boolean) => {
    setMessages((prev) => (replace ? payload.messages : mergeMessages(prev, payload.messages)));
    if (Object.keys(payload.receipts).length > 0) {
      setReceipts((prev) => ({ ...prev, ...payload.receipts }));
    }
    setOtherLastSeen(payload.otherLastSeen);
  }, []);

  const loadLatest = useCallback(
    async (replace: boolean): Promise<MessagesPayload | null> => {
      try {
        const res = await api.listMessages(chatId, PAGE);
        applyPayload(res.data, replace);
        setOlderCursor(res.meta.nextCursor);
        setError(null);
        return res.data;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load messages');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [chatId, applyPayload],
  );

  useEffect(() => {
    setLoading(true);
    markedRef.current = new Set();
    void loadLatest(true);
    const timer = window.setInterval(() => {
      void loadLatest(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadLatest]);

  // Keep the newest messages in view until the user scrolls up.
  useEffect(() => {
    if (initialScrollRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  /** Visible non-own messages become read receipts; the pointer advances too. */
  useEffect(() => {
    if (!user || messages.length === 0) return;
    const visible = messages.slice(-20);
    for (const m of visible) {
      if (m.senderId === user.id) continue;
      if (receipts[m.id]?.some((r) => r.userId === user.id)) continue;
      if (markedRef.current.has(m.id)) continue;
      markedRef.current.add(m.id);
      api.markRead(chatId, m.id).catch(() => undefined);
    }
    const newest = visible[visible.length - 1];
    if (newest) {
      api.setLastSeen(chatId, newest.id).catch(() => undefined);
    }
  }, [messages, receipts, chatId, user]);

  async function loadOlder(): Promise<void> {
    if (!olderCursor) return;
    setLoadingOlder(true);
    try {
      const res = await api.listMessages(chatId, PAGE, olderCursor);
      applyPayload(res.data, false);
      setOlderCursor(res.meta.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onSend(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.sendMessage(chatId, text);
      setMessages((prev) => mergeMessages(prev, [res.data]));
      setDraft('');
      initialScrollRef.current = true;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      await api.setLastSeen(chatId, res.data.id).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Message could not be sent');
    } finally {
      setSending(false);
    }
  }

  function isSeenByOther(message: Message): boolean {
    if (!otherLastSeen?.lastSeenMessageId) return false;
    const pointerIndex = messages.findIndex((m) => m.id === otherLastSeen.lastSeenMessageId);
    if (pointerIndex < 0) return false;
    const ownIndex = messages.findIndex((m) => m.id === message.id);
    return ownIndex >= 0 && ownIndex <= pointerIndex;
  }

  function readersOf(message: Message): number {
    if (!user) return 0;
    return (receipts[message.id] ?? []).filter((r) => r.userId !== user.id).length;
  }

  const memberCount = meta?.participants.length;

  return (
    <div className="app-shell chat-page">
      <header className="topbar chat-header">
        <div className="chat-header-title">
          <Link to="/" className="btn link" aria-label="Back to conversations">
            ← Chats
          </Link>
          <div>
            <h1>{title()}</h1>
            <p className="muted small-text">
              {meta?.chat.chatType === 'group' && memberCount
                ? `${memberCount} members`
                : otherLastSeen?.lastSeenAt
                  ? `Last seen ${new Date(otherLastSeen.lastSeenAt).toLocaleString()}`
                  : 'Direct message'}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      <section
        className="messages"
        aria-label="Messages"
        onScroll={() => {
          initialScrollRef.current = false;
        }}
      >
        {loading && messages.length === 0 && (
          <p className="muted" role="status">
            Loading messages…
          </p>
        )}
        {!loading && messages.length === 0 && (
          <p className="muted">No messages yet. Say hello!</p>
        )}

        {olderCursor && messages.length > 0 && (
          <button
            type="button"
            className="btn link load-older"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}

        {messages.map((m) => {
          const mine = m.senderId === user?.id;
          const senderName = meta?.participantProfiles.find((p) => p.id === m.senderId)?.name;
          return (
            <article
              key={m.id}
              className={`bubble-row ${mine ? 'mine' : 'theirs'}`}
              onWheel={() => {
                initialScrollRef.current = false;
              }}
            >
              <div className={`bubble ${mine ? 'mine' : 'theirs'}`}>
                {!mine && meta?.chat.chatType === 'group' && (
                  <span className="sender">{senderName ?? 'Member'}</span>
                )}
                <p>{m.text}</p>
                <footer>
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {mine && readersOf(m) > 0 && (
                    <span className="receipt">
                      Read{meta?.chat.chatType === 'group' ? ` by ${readersOf(m)}` : ''}
                    </span>
                  )}
                  {mine && isSeenByOther(m) && <span className="receipt">Seen</span>}
                </footer>
              </div>
            </article>
          );
        })}

        <div ref={bottomRef} />
      </section>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <label htmlFor="message-input" className="visually-hidden">
          Message
        </label>
        <input
          id="message-input"
          type="text"
          placeholder="Type a message"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn primary" disabled={sending || draft.trim().length === 0}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

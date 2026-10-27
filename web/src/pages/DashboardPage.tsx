import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { CreateGroupModal } from '../components/CreateGroupModal';
import type { ChatListItem, PublicUser } from '../types';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [startingChat, setStartingChat] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);

  const loadChats = useCallback(
    async (cursor?: string) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.listChats(user.id, 30, cursor);
        setChats((prev) => {
          const merged = cursor ? [...prev, ...res.data] : res.data;
          const seen = new Set<string>();
          return merged.filter((item) =>
            seen.has(item.chat.id) ? false : (seen.add(item.chat.id), true),
          );
        });
        setNextCursor(res.meta.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load your chats');
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  // Debounced user search.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setSearching(true);
      api
        .searchUsers(trimmed, 10)
        .then((res) => setResults(res.data))
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Search failed'))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  async function startDirectChat(other: PublicUser): Promise<void> {
    if (!user) return;
    setStartingChat(other.id);
    setError(null);
    try {
      const res = await api.createDirectChat(user.id, other.id);
      navigate(`/chat/${res.data.chat.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the conversation');
    } finally {
      setStartingChat(null);
    }
  }

  function title(item: ChatListItem): string {
    if (item.chat.chatType === 'group') return item.chat.name ?? 'Group';
    const other = item.participantProfiles.find((p) => p.id !== user?.id);
    return other?.name ?? 'Direct message';
  }

  function timeOf(item: ChatListItem): string | null {
    const last = item.preview.lastMessage;
    if (!last) return null;
    const date = new Date(last.createdAt);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Chats</h1>
          <p className="muted">Signed in as {user?.name}</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={() => setShowGroupModal(true)}>
            New group
          </button>
          <button type="button" className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <p className="alert error" role="alert">
          {error}{' '}
          <button type="button" className="btn link" onClick={() => void loadChats()}>
            Retry
          </button>
        </p>
      )}

      <section className="card search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Start a conversation</h2>
        <div className="field">
          <label htmlFor="user-search">Search people by name</label>
          <input
            id="user-search"
            type="search"
            placeholder="Type a name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        {searching && <p className="muted">Searching…</p>}
        <ul className="search-results" aria-label="User search results">
          {results.map((person) => (
            <li key={person.id}>
              <span>
                <strong>{person.name}</strong>
                {person.email && <span className="muted"> · {person.email}</span>}
              </span>
              <button
                type="button"
                className="btn small primary"
                disabled={startingChat === person.id}
                onClick={() => void startDirectChat(person)}
              >
                {startingChat === person.id ? 'Opening…' : 'Message'}
              </button>
            </li>
          ))}
          {!searching && query.trim() && results.length === 0 && (
            <li className="muted">No users found</li>
          )}
        </ul>
      </section>

      <section className="chat-list-section" aria-labelledby="conversations-heading">
        <h2 id="conversations-heading">Your conversations</h2>

        {loading && chats.length === 0 && (
          <p className="muted" role="status">
            Loading conversations…
          </p>
        )}
        {!loading && chats.length === 0 && !error && (
          <p className="muted">No conversations yet. Search for someone to get started.</p>
        )}

        <ul className="chat-list">
          {chats.map((item) => (
            <li key={item.chat.id}>
              <button
                type="button"
                className="chat-row"
                onClick={() => navigate(`/chat/${item.chat.id}`)}
              >
                <span className="avatar" aria-hidden="true">
                  {title(item).slice(0, 1).toUpperCase()}
                </span>
                <span className="chat-row-body">
                  <span className="chat-row-title">
                    <span>{title(item)}</span>
                    <span className="muted small-text">{timeOf(item)}</span>
                  </span>
                  <span className="chat-row-preview">
                    <span className="muted">
                      {item.preview.lastMessage
                        ? `${item.preview.lastMessage.text.slice(0, 60)}${
                            item.preview.lastMessage.text.length > 60 ? '…' : ''
                          }`
                        : 'No messages yet'}
                    </span>
                    {item.preview.unreadCount > 0 && (
                      <span className="badge" aria-label={`${item.preview.unreadCount} unread`}>
                        {item.preview.unreadCount > 99 ? '99+' : item.preview.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="muted small-text">
                    {item.chat.chatType === 'group'
                      ? `Group · ${item.participants.length} members`
                      : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {nextCursor && (
          <button
            type="button"
            className="btn"
            onClick={() => void loadChats(nextCursor)}
            disabled={loading}
          >
            Load more
          </button>
        )}
      </section>

      {showGroupModal && (
        <CreateGroupModal
          onClose={() => setShowGroupModal(false)}
          onCreated={(chatId) => navigate(`/chat/${chatId}`)}
        />
      )}
    </div>
  );
}

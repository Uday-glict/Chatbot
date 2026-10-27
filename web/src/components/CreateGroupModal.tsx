import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { PublicUser } from '../types';

interface Props {
  onClose: () => void;
  onCreated: (chatId: string) => void;
}

/** Group name + searchable multi-select; the creator is added as admin server-side. */
export function CreateGroupModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<PublicUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Debounced user search (skips the currently selected members).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      api
        .searchUsers(trimmed, 8)
        .then((res) => {
          const chosen = new Set(selected.map((u) => u.id));
          setResults(res.data.filter((u) => !chosen.has(u.id)));
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Search failed');
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, selected]);

  function toggle(user: PublicUser): void {
    setSelected((prev) => (prev.some((u) => u.id === user.id) ? prev : [...prev, user]));
    setResults((prev) => prev.filter((u) => u.id !== user.id));
  }

  function remove(userId: string): void {
    setSelected((prev) => prev.filter((u) => u.id !== userId));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (name.trim().length === 0) {
      setError('Enter a group name');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one member');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createGroup(
        name.trim(),
        selected.map((u) => u.id),
      );
      onCreated(res.data.chat.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the group');
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="card modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="create-group-title">Create group</h2>

        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              ref={nameRef}
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="member-search">Add members</label>
            <input
              id="member-search"
              type="search"
              placeholder="Search people by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>

          {searching && <p className="muted">Searching…</p>}
          <ul className="search-results" aria-label="Search results">
            {results.map((user) => (
              <li key={user.id}>
                <span>{user.name}</span>
                <button type="button" className="btn small" onClick={() => toggle(user)}>
                  Add
                </button>
              </li>
            ))}
            {!searching && query.trim() && results.length === 0 && (
              <li className="muted">No users found</li>
            )}
          </ul>

          {selected.length > 0 && (
            <div className="chips" aria-label="Selected members">
              {selected.map((user) => (
                <span key={user.id} className="chip">
                  {user.name}
                  <button
                    type="button"
                    aria-label={`Remove ${user.name}`}
                    onClick={() => remove(user.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <p className="muted small-text">
            You will be added automatically as the group administrator ({selected.length + 1}{' '}
            member{selected.length === 0 ? '' : 's'} total).
          </p>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

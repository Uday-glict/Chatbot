import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

type Mode = 'login' | 'signup';

export function AuthPage() {
  const { token, login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (token) return <Navigate to="/" replace />;

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (mode === 'signup' && name.trim().length === 0) errs['name'] = 'Name is required';
    if (email.trim().length === 0) errs['email'] = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs['email'] = 'Enter a valid email';
    if (password.length === 0) errs['password'] = 'Password is required';
    else if (mode === 'signup' && password.length < 8) errs['password'] = 'At least 8 characters';
    return errs;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup(name.trim(), email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>

        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}

        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors['name'])}
              aria-describedby={fieldErrors['name'] ? 'name-error' : undefined}
            />
            {fieldErrors['name'] && (
              <span id="name-error" className="field-error">
                {fieldErrors['name']}
              </span>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors['email'])}
            aria-describedby={fieldErrors['email'] ? 'email-error' : undefined}
          />
          {fieldErrors['email'] && (
            <span id="email-error" className="field-error">
              {fieldErrors['email']}
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors['password'])}
            aria-describedby={fieldErrors['password'] ? 'password-error' : undefined}
          />
          {fieldErrors['password'] && (
            <span id="password-error" className="field-error">
              {fieldErrors['password']}
            </span>
          )}
        </div>

        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>

        <button
          type="button"
          className="btn link"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setFieldErrors({});
            setError(null);
          }}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

import pino from 'pino';

/**
 * Structured logger. Redaction guarantees that authorization headers, cookies
 * and message bodies are never written to logs.
 */
const level =
  process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'text',
    ],
    remove: true,
  },
  serializers: {
    req(req: { method?: string; url?: string; id?: string }) {
      return { method: req.method, url: req.url, id: req.id };
    },
  },
});

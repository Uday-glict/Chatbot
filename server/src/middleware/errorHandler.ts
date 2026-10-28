import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, badRequest, internal } from '../errors';
import { isFirestoreUnavailableError } from '../firestore/client';
import { logger } from '../logger';

/** 404 for unmatched routes, in the standard error envelope. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
};

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Centralized error handler: maps known errors to stable status codes and
 * renders a consistent envelope. Unknown errors are logged server-side and
 * returned as a generic 500 without stack traces or internal details.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = badRequest('Invalid request payload', {
      fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  } else if (isBodyParserSyntaxError(err)) {
    appError = badRequest('Malformed JSON body');
  } else if (isFirestoreUnavailableError(err)) {
    appError = new AppError(503, 'SERVICE_UNAVAILABLE', 'Firestore is temporarily unavailable');
  } else if (isPgUniqueViolation(err)) {
    appError = new AppError(409, 'CONFLICT', 'Resource already exists');
  } else {
    logger.error({ err, requestId: req.requestId, url: req.url }, 'unhandled error');
    appError = internal();
  }

  if (appError.status >= 500) {
    logger.error(
      { code: appError.code, message: appError.message, requestId: req.requestId },
      'request failed',
    );
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  });
};

function isBodyParserSyntaxError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: unknown }).type === 'entity.parse.failed'
  );
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as PgLikeError).code === '23505'
  );
}

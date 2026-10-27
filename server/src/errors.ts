/**
 * Application error type with a stable machine-readable code and the HTTP
 * status the API returns. Controllers/services throw these; the centralized
 * error middleware renders them, so no stack trace or internal detail leaks.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource'): AppError =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError(409, 'CONFLICT', message, details);

export const unprocessable = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError(422, 'UNPROCESSABLE', message, details);

export const rateLimited = (message = 'Too many requests, please retry later'): AppError =>
  new AppError(429, 'RATE_LIMITED', message);

export const serviceUnavailable = (message: string): AppError =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

export const internal = (message = 'Internal server error'): AppError =>
  new AppError(500, 'INTERNAL_ERROR', message);

import type { Request } from 'express';
import type { z } from 'zod';
import { badRequest, rateLimited } from '../errors';

function zodToDetails(error: z.ZodError): Record<string, unknown> {
  return {
    fields: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/** Validates req.body against a schema at the API boundary. Throws 400 on failure. */
export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw badRequest('Invalid request payload', zodToDetails(result.error));
  }
  return result.data;
}

/** Validates req.query against a schema. Throws 400 on failure. */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw badRequest('Invalid query parameters', zodToDetails(result.error));
  }
  return result.data;
}

/** Validates an express route param (string). Throws 400 on failure. */
export function parseParam<S extends z.ZodType>(
  value: string | string[] | undefined,
  schema: S,
  name: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`Invalid path parameter: ${name}`, zodToDetails(result.error));
  }
  return result.data;
}

export function rateLimitError(): ReturnType<typeof rateLimited> {
  return rateLimited();
}

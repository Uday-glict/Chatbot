import { z } from 'zod';
import { getConfig } from '../config';

/** Firestore ids: auto-generated (20 chars) or validated clientMessageId. */
export const messageIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'invalid message id');

export const uuidSchema = z.uuid();

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});

export function makeSearchQuerySchema() {
  const cfg = getConfig();
  return z.object({
    q: z.string().trim().min(cfg.SEARCH_MIN_QUERY_LENGTH).max(cfg.SEARCH_MAX_QUERY_LENGTH),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  });
}

export const createDirectSchema = z.object({
  userAId: uuidSchema,
  userBId: uuidSchema,
});

export function makeCreateGroupSchema() {
  return z.object({
    name: z.string().trim().min(1).max(120),
    memberIds: z.array(uuidSchema).min(1).max(1000),
  });
}

export const renameGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const addMembersSchema = z.object({
  userIds: z.array(uuidSchema).min(1).max(1000),
});

export const setRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export function makeSendMessageSchema() {
  const cfg = getConfig();
  return z.object({
    text: z
      .string()
      .min(1)
      .max(cfg.MAX_MESSAGE_LENGTH, `Message exceeds ${cfg.MAX_MESSAGE_LENGTH} characters`)
      .refine((v) => v.trim().length > 0, 'Message cannot be blank'),
    clientMessageId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'invalid idempotency key')
      .optional(),
  });
}

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
});

export const listChatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(512).optional(),
});

export const lastSeenSchema = z.object({
  messageId: messageIdSchema,
});

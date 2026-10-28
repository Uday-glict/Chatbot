import { z } from 'zod';
import './loadEnv';

const numberFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Some environments export PORT=0 or a non-numeric value; fall back safely.
  PORT: z.coerce.number().int().min(1).max(65535).catch(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: numberFromEnv(10),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  PASSWORD_SALT_ROUNDS: numberFromEnv(16384),

  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIRESTORE_DATABASE_ID: z
    .string()
    .trim()
    .min(1, 'FIRESTORE_DATABASE_ID must not be empty')
    .default('default'),
  // Optional and test-only. Production must use Cloud Firestore.
  FIRESTORE_EMULATOR_HOST: z.string().default(''),

  GROUP_MAX_MEMBERS: numberFromEnv(100),
  MAX_MESSAGE_LENGTH: numberFromEnv(4000),
  SEARCH_MIN_QUERY_LENGTH: numberFromEnv(1),
  SEARCH_MAX_QUERY_LENGTH: numberFromEnv(64),

  RATE_LIMIT_AUTH_PER_MINUTE: numberFromEnv(10),
  RATE_LIMIT_SEARCH_PER_MINUTE: numberFromEnv(30),
  RATE_LIMIT_SEND_PER_MINUTE: numberFromEnv(60),
}).superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV === 'production' && cfg.FIRESTORE_EMULATOR_HOST) {
    ctx.addIssue({
      code: 'custom',
      path: ['FIRESTORE_EMULATOR_HOST'],
      message: 'FIRESTORE_EMULATOR_HOST must be empty in production',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Memoized, validated configuration. Tests set process.env before first call. */
export function getConfig(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoized config so a new environment takes effect. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export const isProduction = (): boolean => getConfig().NODE_ENV === 'production';

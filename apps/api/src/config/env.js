import { z } from 'zod';

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // Public origin of the web app; used to build links in emails.
  APP_BASE_URL: z.url(),
  // Comma-separated browser origins allowed by CORS.
  CORS_ORIGINS: z.string().default(''),
  // Number of trusted reverse-proxy hops in front of the API (0 = none).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  COOKIE_SECURE: bool(true),
  COOKIE_DOMAIN: optionalString,

  // HMAC key for OTP codes, destination fingerprints and IP hashing. Rotate with care: rotating invalidates pending OTPs.
  OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,

  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_OTP_TEMPLATE: optionalString,
  WHATSAPP_TEMPLATE_LANG: z.string().default('en_US'),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  // Speech-to-text model for voice input in the discovery assistant.
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  AI_DAILY_REQUEST_CAP: z.coerce.number().int().min(0).default(5000),

  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,

  EXPO_ACCESS_TOKEN: optionalString,

  OTP_DAILY_GLOBAL_CAP: z.coerce.number().int().min(1).default(10000),
  RUN_WORKER: bool(true),
  // Development only: print OTP codes and email links to the server console when no provider is configured.
  DEV_PRINT_OTP: bool(false),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  const prod = env.NODE_ENV === 'production';

  if (prod) {
    const missing = [];
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) missing.push('RESEND_API_KEY and EMAIL_FROM (email OTP and transactional email)');
    if (!env.CORS_ORIGINS) missing.push('CORS_ORIGINS');
    if (!env.COOKIE_SECURE) missing.push('COOKIE_SECURE must be true in production');
    if (env.DEV_PRINT_OTP) missing.push('DEV_PRINT_OTP must be false in production');
    if (!env.APP_BASE_URL.startsWith('https://')) missing.push('APP_BASE_URL must use https in production');
    if (missing.length) throw new Error(`Production configuration incomplete:\n  - ${missing.join('\n  - ')}`);
  }

  return Object.freeze({
    ...env,
    isProd: prod,
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    features: Object.freeze({
      email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
      whatsapp: Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_OTP_TEMPLATE),
      ai: Boolean(env.OPENAI_API_KEY),
      media: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
    }),
  });
}

let cached;
export function getEnv() {
  if (!cached) cached = load();
  return cached;
}

// Tests reconfigure the environment between suites.
export function resetEnvCache() {
  cached = undefined;
}

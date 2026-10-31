import { getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createOpenAI } from './ai.js';
import { createResendEmail } from './email.js';
import { createCloudinary } from './media.js';
import { createExpoPush } from './push.js';
import { createMetaWhatsApp } from './whatsapp.js';

// Development stand-ins used only when a provider is not configured outside production.
// They record messages in memory; DEV_PRINT_OTP additionally prints them to the console so
// a developer can sign in locally. Production startup refuses DEV_PRINT_OTP.
export const devOutbox = [];

function devEmail(print) {
  return {
    name: 'dev-email',
    async send(msg) {
      devOutbox.push({ channel: 'email', ...msg });
      if (print) logger.warn({ to: msg.to, subject: msg.subject }, `[dev-email] ${msg.text}`);
      return { id: `dev-${devOutbox.length}` };
    },
  };
}

function devWhatsApp(print) {
  return {
    name: 'dev-whatsapp',
    async sendOtp(msg) {
      devOutbox.push({ channel: 'whatsapp', ...msg });
      if (print) logger.warn(`[dev-whatsapp] code for ${msg.to}: ${msg.code}`);
      return { id: `dev-${devOutbox.length}` };
    },
  };
}

let overrides = {};
let cache;

function build() {
  const env = getEnv();
  const devPrint = !env.isProd && env.DEV_PRINT_OTP;
  return {
    email: env.features.email
      ? createResendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
      : env.isProd
        ? null
        : devEmail(devPrint),
    whatsapp: env.features.whatsapp
      ? createMetaWhatsApp({
          accessToken: env.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
          template: env.WHATSAPP_OTP_TEMPLATE,
          language: env.WHATSAPP_TEMPLATE_LANG,
          apiVersion: env.WHATSAPP_API_VERSION,
        })
      : env.isProd
        ? null
        : devWhatsApp(devPrint),
    push: createExpoPush({ accessToken: env.EXPO_ACCESS_TOKEN }),
    media: env.features.media
      ? createCloudinary({ cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET })
      : null,
    ai: env.features.ai ? createOpenAI({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, transcribeModel: env.OPENAI_TRANSCRIBE_MODEL }) : null,
  };
}

export function providers() {
  if (!cache) cache = build();
  return { ...cache, ...overrides };
}

// Test hook: replace individual providers with fakes.
export function setProviderOverrides(next) {
  overrides = next;
}

export function resetProviders() {
  overrides = {};
  cache = undefined;
  devOutbox.length = 0;
}

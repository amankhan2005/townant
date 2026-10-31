import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { authenticate, csrfProtection, enforcePasswordChange } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { rejectOperatorKeys, requestId, requireJsonBody } from './middleware/requestGuards.js';
import v1 from './routes/v1/index.js';
import webhooks from './routes/webhooks.js';

export function createApp() {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  // Only the configured number of proxy hops is trusted for the client IP; X-Forwarded-For
  // from anyone else is ignored, so it cannot be used to dodge rate limits.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url.startsWith('/api/health') },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // The API serves JSON only, so the strictest CSP applies; the web app sets its own.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Credentialed CORS for an explicit allowlist only. Requests without an Origin header
  // (mobile app, server-to-server) are not browsers and are governed by auth, not CORS.
  const allowed = new Set(env.corsOrigins);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin) ? origin || false : false),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Company-Id', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Remaining', 'Content-Disposition', 'X-Export-Rows', 'X-Export-Total', 'X-Export-Truncated'],
      maxAge: 600,
    }),
  );

  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });

  // Raw-body routes are mounted before the JSON parser so signatures verify over exact bytes.
  app.use('/api/webhooks', webhooks);

  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(cookieParser());
  app.use(requireJsonBody);
  app.use(rejectOperatorKeys);
  app.use('/api', rateLimit({ name: 'global', windowMs: 60 * 1000, max: 600 }));
  app.use(authenticate);
  app.use(csrfProtection);
  app.use(enforcePasswordChange);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

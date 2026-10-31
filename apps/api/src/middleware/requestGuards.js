import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Accepts a well-formed inbound request ID (from a trusted gateway) or generates one.
export function requestId(req, res, next) {
  const inbound = req.get('x-request-id');
  req.id = inbound && /^[A-Za-z0-9._-]{8,64}$/.test(inbound) ? inbound : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// Requests with a body must be JSON. Cross-site HTML forms cannot send application/json
// without a CORS preflight, which closes a class of CSRF on unauthenticated endpoints.
export function requireJsonBody(req, _res, next) {
  if (!BODY_METHODS.has(req.method)) return next();
  const length = Number(req.get('content-length') ?? 0);
  const chunked = Boolean(req.get('transfer-encoding'));
  if (length === 0 && !chunked) return next();
  if (req.is('application/json') || req.is('multipart/form-data')) return next();
  return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as JSON.'));
}

// Rejects keys that MongoDB would interpret as operators or paths, at any depth.
export function rejectOperatorKeys(req, _res, next) {
  const bad = (value, depth = 0) => {
    if (depth > 10) return true;
    if (Array.isArray(value)) return value.some((v) => bad(v, depth + 1));
    if (value && typeof value === 'object') {
      return Object.keys(value).some((k) => k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || bad(value[k], depth + 1));
    }
    return false;
  };
  if (bad(req.body)) return next(new AppError(400, 'BAD_REQUEST', 'The request contains unsupported field names.'));
  return next();
}

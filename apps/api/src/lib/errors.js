// Errors thrown deliberately by application code. Anything else is treated as an
// internal error and never exposed to clients.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message = 'The request is invalid.', details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message);
// Used for objects the caller may not see, so existence is not revealed.
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const tooMany = (message, retryAfterSeconds) =>
  new AppError(429, 'RATE_LIMITED', message ?? 'Too many requests. Please wait and try again.', retryAfterSeconds ? { retryAfterSeconds } : undefined);
export const unavailable = (code, message) => new AppError(503, code, message);

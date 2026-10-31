import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';

// Converts every error to the standard envelope:
//   { error: { code, message, requestId, details? } }
// Internal errors return a generic message; the stack and cause go to the log only.
export function errorHandler(err, req, res, _next) {
  let appErr = err instanceof AppError ? err : null;

  if (!appErr) {
    if (err?.type === 'entity.too.large') appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
    else if (err?.type === 'entity.parse.failed') appErr = new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
    else if (err?.name === 'MulterError') {
      appErr =
        err.code === 'LIMIT_FILE_SIZE'
          ? new AppError(413, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller.')
          : new AppError(400, 'UPLOAD_INVALID', 'The upload is invalid.');
    } else if (err instanceof mongoose.Error.CastError) appErr = new AppError(400, 'BAD_REQUEST', 'The request is invalid.');
    else if (err instanceof mongoose.Error.ValidationError) appErr = new AppError(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.');
    else if (err instanceof mongoose.Error.VersionError) appErr = new AppError(409, 'CONFLICT', 'This record changed. Refresh and try again.');
  }

  const status = appErr?.status ?? 500;
  if (status >= 500) {
    req.log?.error({ err }, 'request failed');
  } else if (status !== 404) {
    req.log?.info({ code: appErr.code, status }, 'request rejected');
  }

  if (status === 429 && appErr.details?.retryAfterSeconds) res.setHeader('Retry-After', appErr.details.retryAfterSeconds);

  res.status(status).json({
    error: {
      code: appErr?.code ?? 'INTERNAL_ERROR',
      message: appErr?.message ?? 'Something went wrong on our side. Please try again.',
      requestId: req.id,
      ...(appErr?.details ? { details: appErr.details } : {}),
    },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: req.id } });
}

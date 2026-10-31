import { isValidIsoDate } from '@townant/shared';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from './errors.js';

// Parses req[part] with a zod schema and replaces it with the parsed (allowlisted) value.
// Object schemas should be .strict() so unexpected properties are rejected, not silently dropped.
export function validate(schemas) {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        return next(
          new AppError(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.', {
            fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          }),
        );
      }
      // Express 5 exposes req.query as a getter, so parsed values live on req.valid.
      req.valid = { ...req.valid, [part]: result.data };
    }
    return next();
  };
}

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid identifier');

// Wire format stays ISO (YYYY-MM-DD); clients display MM/DD/YYYY. Must be a real calendar day.
export const isoDate = z.string().refine(isValidIsoDate, 'Enter a valid date.');

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24-hour)');

// Plain text field: trimmed, control characters stripped (newlines kept when multiline).
// eslint-disable-next-line no-control-regex -- stripping control characters is the intent
const CONTROL = /[\u0000-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

export const text = (max, { min = 0, multiline = false } = {}) =>
  z
    .string()
    .transform((v) => v.replace(multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL, '').trim())
    .pipe(z.string().min(min).max(max));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address'));

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const paginate = ({ page, limit }) => ({ skip: (page - 1) * limit, limit });

export const pageMeta = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) });

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

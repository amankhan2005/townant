import { z } from 'zod';
import { objectId, pagination, text } from '../../lib/validate.js';
import { SUPPORT_STATUSES } from '../../models/index.js';

export const idParam = z.object({ id: objectId }).strict();
export const messageBody = z.object({ body: text(4000, { min: 2, multiline: true }) }).strict();
export const listQuery = pagination.extend({ status: z.enum([...SUPPORT_STATUSES, 'active']).optional() }).strict();
export const createBody = (categories) =>
  z.object({ category: z.enum(categories), subject: text(120, { min: 4 }), body: text(4000, { min: 10, multiline: true }) }).strict();
export const statusBody = z.object({ action: z.enum(['resolve', 'reopen']) }).strict();

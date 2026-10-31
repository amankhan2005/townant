import { ipFingerprint } from '../lib/crypto.js';
import { AuditEvent } from '../models/index.js';

export const actorOf = (user) => ({ actorType: user.role === 'super_admin' ? 'admin' : user.role, actorId: user._id });

export function actorFrom(req) {
  if (!req?.auth) return { actorType: 'system' };
  return actorOf(req.auth.user);
}

// Writes an audit record. Pass the transaction session so the record commits or rolls back
// with the change it describes. Metadata must not contain secrets or contact details.
// `actor` overrides the request's caller, for flows that authenticate mid-request.
export async function audit(req, { action, entityType, entityId, companyId, reason, metadata, actor }, session) {
  const doc = {
    ...(actor ?? actorFrom(req)),
    action,
    entityType,
    entityId,
    companyId,
    reason,
    metadata,
    requestId: req?.id,
    ipHash: req?.ip ? ipFingerprint(req.ip) : undefined,
  };
  await AuditEvent.create([doc], session ? { session } : undefined);
}

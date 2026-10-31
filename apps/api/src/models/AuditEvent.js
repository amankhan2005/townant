import mongoose from 'mongoose';

const { Schema } = mongoose;

// Append-only record of consequential actions. No API route updates or deletes these.
const auditEventSchema = new Schema(
  {
    actorType: { type: String, enum: ['customer', 'vendor', 'admin', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    reason: String,
    metadata: { type: Object, default: {} },
    requestId: String,
    ipHash: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ actorId: 1, createdAt: -1 });

export const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);

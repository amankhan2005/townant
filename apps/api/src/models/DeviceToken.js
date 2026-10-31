import mongoose from 'mongoose';

const { Schema } = mongoose;

const deviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
    lastSeenAt: { type: Date, default: Date.now },
    disabledAt: Date,
  },
  { timestamps: true },
);

export const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

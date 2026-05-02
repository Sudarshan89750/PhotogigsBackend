import mongoose, { Schema } from 'mongoose';
import { INotification } from '../../interfaces/INotification';

const NotificationSchema = new Schema<INotification & mongoose.Document>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    referenceId: String,
    referenceType: String,
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model<INotification & mongoose.Document>(
  'Notification',
  NotificationSchema
);

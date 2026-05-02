import mongoose, { Schema } from 'mongoose';

export type MessageType = 'text' | 'image' | 'file';

export interface IMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: MessageType;
  fileUrl?: string;
  readBy: string[];
  isDelivered?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage & mongoose.Document>(
  {
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    content: { type: String, required: true },
    messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
    fileUrl: String,
    readBy: { type: [String], default: [] },
    isDelivered: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });

export default mongoose.model<IMessage & mongoose.Document>('Message', MessageSchema);

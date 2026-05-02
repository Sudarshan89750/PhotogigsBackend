import mongoose, { Schema } from 'mongoose';

export interface IConversation {
  _id: string;
  participants: string[]; // PG user ids
  jobId?: string;
  marketplaceListingId?: string;
  lastMessage?: string;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation & mongoose.Document>(
  {
    participants: { type: [String], required: true },
    jobId: String,
    marketplaceListingId: String,
    lastMessage: String,
    lastMessageAt: Date,
  },
  { timestamps: true }
);

ConversationSchema.index({ participants: 1 });

export default mongoose.model<IConversation & mongoose.Document>(
  'Conversation',
  ConversationSchema
);

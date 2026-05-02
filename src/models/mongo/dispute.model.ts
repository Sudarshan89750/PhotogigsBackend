import mongoose, { Schema } from 'mongoose';
import { IDispute } from '../../interfaces/IDispute';

const DisputeSchema = new Schema<IDispute & mongoose.Document>(
  {
    raisedBy: { type: String, required: true, index: true },
    againstUserId: { type: String, required: true },
    type: { type: String, enum: ['job', 'marketplace_order'], required: true },
    referenceId: { type: String, required: true },
    reason: { type: String, required: true },
    description: { type: String, required: true },
    evidence: [String],
    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'rejected'],
      default: 'open',
      index: true,
    },
    resolution: { type: String, enum: ['refund', 'force_complete', 'reject'] },
    adminNotes: String,
  },
  { timestamps: true }
);

export default mongoose.model<IDispute & mongoose.Document>('Dispute', DisputeSchema);

import mongoose, { Schema } from 'mongoose';
import { IProposal } from '../../interfaces/IProposal';

const ProposalSchema = new Schema<IProposal & mongoose.Document>(
  {
    jobId: { type: String, required: true, index: true },
    freelancerId: { type: String, required: true, index: true },
    coverLetter: { type: String, required: true },
    proposedPrice: { type: Number, required: true },
    estimatedDuration: String,
    portfolioLinks: [String],
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

ProposalSchema.index({ jobId: 1, freelancerId: 1 }, { unique: true });

export default mongoose.model<IProposal & mongoose.Document>('Proposal', ProposalSchema);

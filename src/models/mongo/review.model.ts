import mongoose, { Schema } from 'mongoose';

const ReviewSchema = new Schema(
  {
    jobId: { type: String, required: true, index: true },
    reviewerId: { type: String, required: true, index: true },
    revieweeId: { type: String, required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  },
  { timestamps: true }
);

ReviewSchema.index({ jobId: 1, reviewerId: 1 }, { unique: true });

export default mongoose.model('Review', ReviewSchema);
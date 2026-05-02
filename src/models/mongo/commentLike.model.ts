import mongoose, { Schema } from 'mongoose';

const CommentLikeSchema = new Schema(
  {
    commentId: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true }
);

CommentLikeSchema.index({ commentId: 1, userId: 1 }, { unique: true });

export default mongoose.model('CommentLike', CommentLikeSchema);

import mongoose, { Schema } from 'mongoose';

const PostLikeSchema = new Schema(
  {
    postId: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true }
);

PostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export default mongoose.model('PostLike', PostLikeSchema);

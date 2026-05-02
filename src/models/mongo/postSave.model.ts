import mongoose, { Schema } from 'mongoose';

const PostSaveSchema = new Schema(
  {
    postId: { type: String, required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true }
);

PostSaveSchema.index({ postId: 1, userId: 1 }, { unique: true });
PostSaveSchema.index({ userId: 1 });

export default mongoose.model('PostSave', PostSaveSchema);

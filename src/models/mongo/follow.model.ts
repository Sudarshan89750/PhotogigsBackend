import mongoose, { Schema } from 'mongoose';
import { IFollow } from '../../interfaces/ICommunity';

const FollowSchema = new Schema<IFollow & mongoose.Document>(
  {
    followerId: { type: String, required: true },
    followingId: { type: String, required: true },
  },
  { timestamps: true }
);

FollowSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
FollowSchema.index({ followingId: 1 });

export default mongoose.model<IFollow & mongoose.Document>('Follow', FollowSchema);

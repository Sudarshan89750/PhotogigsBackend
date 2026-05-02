import mongoose, { Schema } from 'mongoose';
import { IPost } from '../../interfaces/ICommunity';

const PostSchema = new Schema<IPost & mongoose.Document>(
  {
    authorId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    media: [String],
    hashtags: { type: [String], index: true },
    city: String,
    state: String,
    country: String,
    latitude: Number,
    longitude: Number,
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    savesCount: { type: Number, default: 0 },
    trendingScore: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

// Text index for post content search
PostSchema.index({ content: 'text' });

PostSchema.index({ trendingScore: -1, createdAt: -1 });
PostSchema.index({ createdAt: -1 });

export default mongoose.model<IPost & mongoose.Document>('Post', PostSchema);

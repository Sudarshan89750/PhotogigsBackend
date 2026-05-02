import mongoose, { Schema } from 'mongoose';

export interface IHashtag {
  tag: string;
  count: number;
  lastUsedAt: Date;
}

const HashtagSchema = new Schema<IHashtag & mongoose.Document>(
  {
    tag: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    count: { type: Number, default: 1 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

HashtagSchema.index({ count: -1, lastUsedAt: -1 });

export default mongoose.model<IHashtag & mongoose.Document>('Hashtag', HashtagSchema);

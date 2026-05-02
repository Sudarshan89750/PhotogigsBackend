import mongoose, { Schema } from 'mongoose';
import { IComment } from '../../interfaces/ICommunity';

const CommentSchema = new Schema<IComment & mongoose.Document>(
  {
    postId: { type: String, required: true, index: true },
    authorId: { type: String, required: true },
    content: { type: String, required: true },
    parentCommentId: { type: String, index: true },
    likesCount: { type: Number, default: 0 },
    repliesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IComment & mongoose.Document>('Comment', CommentSchema);

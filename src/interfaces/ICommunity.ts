export interface IPost {
  _id: string;
  authorId: string;
  content: string;
  media: string[];
  hashtags: string[];
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  trendingScore: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IComment {
  _id: string;
  postId: string;
  authorId: string;
  content: string;
  parentCommentId?: string;
  likesCount: number;
  repliesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFollow {
  _id: string;
  followerId: string;
  followingId: string;
  createdAt: Date;
}

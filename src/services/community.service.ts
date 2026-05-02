import { Service, Inject, Container } from 'typedi';
import { NotificationService } from './notification.service';
import { parsePagination, buildMeta } from '../utils/pagination';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { trendingQueue } from '../jobs/queues';

@Service()
export class CommunityService {
  private notif: NotificationService;

  constructor(
    @Inject('postModel') private postModel: any,
    @Inject('commentModel') private commentModel: any,
    @Inject('followModel') private followModel: any,
    @Inject('postLikeModel') private postLikeModel: any,
    @Inject('postSaveModel') private postSaveModel: any,
    @Inject('commentLikeModel') private commentLikeModel: any,
    @Inject('hashtagModel') private hashtagModel: any,
    @Inject('pgPool') private db: any,
    @Inject('logger') private logger: any
  ) {
    this.notif = Container.get(NotificationService);
  }

  // ─── Posts ────────────────────────────────────────────────────────────────

  async createPost(data: {
    authorId: string;
    content: string;
    media: string[];
    hashtags: string[];
    city?: string;
    state?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }) {
    const post = await this.postModel.create(data);

    if (data.media && data.media.length > 0) {
      await this.db.query(
        'UPDATE users SET used_images = used_images + $1 WHERE id = $2',
        [data.media.length, data.authorId]
      ).catch((err: any) => this.logger.error('Failed to increment used_images for post', err));
    }
    
    // Track hashtags
    if (data.hashtags && data.hashtags.length > 0) {
      const ops = data.hashtags.map(t => ({
        updateOne: {
          filter: { tag: t.toLowerCase() },
          update: { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
          upsert: true
        }
      }));
      await this.hashtagModel.bulkWrite(ops).catch((err: any) => this.logger.error('Hashtag track failed', err));
    }

    return this.enrichPost(post.toObject(), data.authorId);
  }

  async suggestHashtags(query: string) {
    return this.hashtagModel.find({
      tag: { $regex: new RegExp(`^${query.toLowerCase()}`) }
    })
    .sort({ count: -1 })
    .limit(10)
    .lean();
  }

  async getPost(postId: string, viewerId?: string) {
    const post = await this.postModel.findById(postId).lean();
    if (!post) throw new NotFoundError('Post not found');
    return this.enrichPost(post, viewerId);
  }

  async deletePost(postId: string, authorId: string) {
    const post = await this.postModel.findOne({ _id: postId, authorId });
    if (!post) throw new ForbiddenError('Post not found or access denied');

    if (post.media && post.media.length > 0) {
      await this.db.query(
        'UPDATE users SET used_images = GREATEST(used_images - $1, 0) WHERE id = $2',
        [post.media.length, authorId]
      ).catch((err: any) => this.logger.error('Failed to decrement used_images for post delete', err));
    }

    await post.deleteOne();
  }

  // ─── Likes ────────────────────────────────────────────────────────────────

  async togglePostLike(postId: string, userId: string): Promise<{ liked: boolean }> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundError('Post not found');

    const existing = await this.postLikeModel.findOne({ postId, userId });

    if (existing) {
      await existing.deleteOne();
      await this.postModel.findByIdAndUpdate(postId, { $inc: { likesCount: -1 } });
      await this.enqueueTrending(postId);
      return { liked: false };
    }

    await this.postLikeModel.create({ postId, userId });
    await this.postModel.findByIdAndUpdate(postId, { $inc: { likesCount: 1 } });
    await this.enqueueTrending(postId);

    if (post.authorId !== userId) {
      await this.notif.create({
        userId: post.authorId,
        type: 'post_liked',
        title: 'New Like',
        body: 'Someone liked your post',
        referenceId: postId,
        referenceType: 'post',
      });
    }

    return { liked: true };
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async addComment(data: {
    postId: string;
    authorId: string;
    content: string;
    parentCommentId?: string;
  }) {
    const post = await this.postModel.findById(data.postId);
    if (!post) throw new NotFoundError('Post not found');

    const comment = await this.commentModel.create(data);
    await this.postModel.findByIdAndUpdate(data.postId, { $inc: { commentsCount: 1 } });

    if (data.parentCommentId) {
      await this.commentModel.findByIdAndUpdate(data.parentCommentId, {
        $inc: { repliesCount: 1 },
      });
    }

    await this.enqueueTrending(data.postId);

    if (post.authorId !== data.authorId) {
      await this.notif.create({
        userId: post.authorId,
        type: 'post_commented',
        title: 'New Comment',
        body: 'Someone commented on your post',
        referenceId: data.postId,
        referenceType: 'post',
      });
    }

    return comment;
  }

  async getComments(postId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter = { postId, parentCommentId: { $exists: false } };

    const data = await this.commentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async deleteComment(commentId: string, authorId: string) {
    const comment = await this.commentModel.findOne({ _id: commentId, authorId });
    if (!comment) throw new ForbiddenError('Comment not found or access denied');

    await comment.deleteOne();
    await this.postModel.findByIdAndUpdate(comment.postId, { $inc: { commentsCount: -1 } });
  }

  async toggleCommentLike(
    commentId: string,
    userId: string
  ): Promise<{ liked: boolean }> {
    const comment = await this.commentModel.findById(commentId);
    if (!comment) throw new NotFoundError('Comment not found');

    const existing = await this.commentLikeModel.findOne({ commentId, userId });

    if (existing) {
      await existing.deleteOne();
      await this.commentModel.findByIdAndUpdate(commentId, { $inc: { likesCount: -1 } });
      return { liked: false };
    }

    await this.commentLikeModel.create({ commentId, userId });
    await this.commentModel.findByIdAndUpdate(commentId, { $inc: { likesCount: 1 } });
    return { liked: true };
  }

  // ─── Save (bookmark) ──────────────────────────────────────────────────────

  async toggleSave(postId: string, userId: string): Promise<{ saved: boolean }> {
    const existing = await this.postSaveModel.findOne({ postId, userId });

    if (existing) {
      await existing.deleteOne();
      await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: -1 } });
      return { saved: false };
    }

    await this.postSaveModel.create({ postId, userId });
    await this.postModel.findByIdAndUpdate(postId, { $inc: { savesCount: 1 } });
    await this.enqueueTrending(postId);
    return { saved: true };
  }

  async sharePost(postId: string, userId: string, sharedTo: 'in_app' | 'external') {
    await this.postModel.findByIdAndUpdate(postId, { $inc: { sharesCount: 1 } });
    await this.enqueueTrending(postId);
    this.logger.info('Post shared', { postId, userId, sharedTo });
  }

  // ─── Follow ───────────────────────────────────────────────────────────────

  async toggleFollow(
    followerId: string,
    followingId: string
  ): Promise<{ following: boolean }> {
    if (followerId === followingId) throw new ForbiddenError('Cannot follow yourself');

    const existing = await this.followModel.findOne({ followerId, followingId });

    if (existing) {
      await existing.deleteOne();
      return { following: false };
    }

    await this.followModel.create({ followerId, followingId });

    await this.notif.create({
      userId: followingId,
      type: 'new_follower',
      title: 'New Follower',
      body: 'Someone started following you',
      referenceId: followerId,
      referenceType: 'user',
    });

    return { following: true };
  }

  async getFollowers(userId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const data = await this.followModel
      .find({ followingId: userId })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getFollowing(userId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const data = await this.followModel
      .find({ followerId: userId })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getFollowStats(userId: string, viewerId?: string) {
    const [followersCount, followingCount, isFollowing] = await Promise.all([
      this.followModel.countDocuments({ followingId: userId }),
      this.followModel.countDocuments({ followerId: userId }),
      viewerId ? this.followModel.exists({ followerId: viewerId, followingId: userId }) : Promise.resolve(null),
    ]);

    return {
      followersCount,
      followingCount,
      isFollowing: Boolean(isFollowing),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async enrichPost(post: any, viewerId?: string) {
    let viewerState = { liked: false, saved: false };

    if (viewerId) {
      const [liked, saved] = await Promise.all([
        this.postLikeModel.exists({ postId: String(post._id), userId: viewerId }),
        this.postSaveModel.exists({ postId: String(post._id), userId: viewerId }),
      ]);
      viewerState = { liked: !!liked, saved: !!saved };
    }

    return { ...post, viewerState };
  }

  private async enqueueTrending(postId: string): Promise<void> {
    try {
      await trendingQueue.add(
        'update-score',
        { postId },
        { delay: 1000, removeOnComplete: true, removeOnFail: 100 }
      );
    } catch (err) {
      // Queue failure must never break the user-facing action
      this.logger.error('Failed to enqueue trending update', { postId, err });
    }
  }
}

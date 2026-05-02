import { Service, Inject, Container } from 'typedi';
import { parsePagination, buildMeta } from '../utils/pagination';
import { RedisService } from './redis.service';

// FIX #5: Max follows cap — prevents $in explosion on power users
// At scale, this becomes a precomputed fanout. For now, cap at 500.
const MAX_FOLLOWING_FOR_FEED = 500;

@Service()
export class FeedService {
  private redis: RedisService;

  constructor(
    @Inject('postModel') private postModel: any,
    @Inject('followModel') private followModel: any,
    @Inject('campaignModel') private campaignModel: any,
    @Inject('postLikeModel') private postLikeModel: any,
    @Inject('postSaveModel') private postSaveModel: any,
    @Inject('logger') private logger: any
  ) {
    this.redis = Container.get(RedisService);
  }

  async getFeed(
    query: Record<string, unknown>,
    userId?: string
  ) {
    const { page, limit, skip, lastSeenId } = parsePagination(query);
    const filter: Record<string, any> = {};

    if (query.hashtag) filter.hashtags = query.hashtag;
    
    // Performance: Use Text Index for keyword search
    if (query.search) {
      filter.$text = { $search: query.search as string };
    }

    // Legacy city/state filters (anchored regex is okay on indexed fields)
    if (query.city) filter.city = new RegExp(`^${query.city}`, 'i');
    if (query.state) filter.state = new RegExp(`^${query.state}`, 'i');
    if (query.authorId) filter.authorId = query.authorId;

    // FIX #5: Cap follow list to 500 to prevent memory blow-up
    if (query.filter === 'following' && userId) {
      const follows = await this.followModel
        .find({ followerId: userId })
        .select('followingId')
        .limit(MAX_FOLLOWING_FOR_FEED)
        .lean();
      filter.authorId = { $in: follows.map((f: any) => f.followingId) };
    }

    const sort: Record<string, any> =
      query.filter === 'trending'
        ? { trendingScore: -1, _id: -1 }
        : { _id: -1 };

    // Cursor-Based Pagination: Direct index lookup
    if (lastSeenId && query.filter !== 'trending') {
      filter._id = { $lt: lastSeenId };
    }

    const posts = await this.postModel
      .find(filter)
      .sort(sort)
      .skip(lastSeenId ? 0 : skip)
      .limit(limit + 1) // Fetch Limit + 1
      .lean();

    const hasNextPage = posts.length > limit;
    if (hasNextPage) posts.pop();

    const nextCursor = posts.length === limit ? posts[posts.length - 1]._id.toString() : undefined;

    // Attach viewer state
    let enrichedPosts = posts;
    if (userId) {
      const postIds = posts.map((p: any) => String(p._id));
      const [likes, saves] = await Promise.all([
        this.postLikeModel.find({ userId, postId: { $in: postIds } }).select('postId').lean(),
        this.postSaveModel.find({ userId, postId: { $in: postIds } }).select('postId').lean(),
      ]);
      const likedSet = new Set(likes.map((l: any) => l.postId));
      const savedSet = new Set(saves.map((s: any) => s.postId));

      enrichedPosts = posts.map((p: any) => ({
        ...p,
        viewerState: {
          liked: likedSet.has(String(p._id)),
          saved: savedSet.has(String(p._id)),
        },
      }));
    }

    // Inject campaigns on page 1
    let campaigns: any[] = [];
    if (page === 1 && userId) {
      campaigns = await this.getActiveCampaignsForUser(userId);
    }

    return {
      data: enrichedPosts,
      campaigns,
      meta: buildMeta({ page, limit, hasNextPage, nextCursor }),
    };
  }

  async getTrendingHashtags() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.postModel.aggregate([
      { $match: { createdAt: { $gte: oneWeekAgo } } },
      { $unwind: '$hashtags' },
      {
        $group: {
          _id: '$hashtags',
          postCount: { $sum: 1 },
          totalEngagement: {
            $sum: { $add: ['$likesCount', '$commentsCount', '$sharesCount'] },
          },
        },
      },
      { $sort: { totalEngagement: -1 } },
      { $limit: 20 },
      { $project: { hashtag: '$_id', postCount: 1, totalEngagement: 1, _id: 0 } },
    ]);
    return result;
  }

  private async getActiveCampaignsForUser(userId: string) {
    const now = new Date();
    const campaigns = await this.campaignModel
      .find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
        'media.0': { $exists: true },
      })
      .lean();

    const eligible: any[] = [];

    // FIX #6: Batch all Redis reads + writes in a pipeline (one round-trip per campaign batch)
    if (campaigns.length === 0) return eligible;

    const viewKeys = campaigns.map((c: any) => `campaign_views:${c._id}:${userId}`);

    // Read all view counts in one pipeline
    const readPipeline = this.redis.pipeline();
    for (const key of viewKeys) {
      readPipeline.get(key);
    }
    const readResults: Array<[Error | null, string | null]> = await readPipeline.exec() as any;

    // Build write pipeline for eligible campaigns
    const writePipeline = this.redis.pipeline();
    const impressionOps: any[] = [];
    for (let i = 0; i < campaigns.length; i++) {
      const c = campaigns[i];
      const views = parseInt(readResults[i]?.[1] ?? '0', 10);
      if (views < c.maxViewsPerUser) {
        eligible.push({ ...c, isCampaign: true });
        writePipeline.incr(viewKeys[i]);
        writePipeline.expire(viewKeys[i], 60 * 60 * 24 * 30); // 30 day window
        impressionOps.push({
          updateOne: {
            filter: { _id: c._id },
            update: { $inc: { impressions: 1 } },
          },
        });
      }
    }
    if (eligible.length > 0) await writePipeline.exec();
    if (impressionOps.length > 0) {
      await this.campaignModel.bulkWrite(impressionOps);
    }

    return eligible;
  }
}

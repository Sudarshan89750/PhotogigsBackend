import { Service, Inject, Container } from 'typedi';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { EmailService } from './email.service';
import { NotificationService } from './notification.service';
import { PhonePeService } from './phonepe.service';
import { RedisService } from './redis.service';
import { parsePagination, buildMeta } from '../utils/pagination';
import { NotFoundError, BadRequestError } from '../utils/errors';

@Service()
export class AdminService {
  private email: EmailService;
  private notif: NotificationService;
  private phonepe: PhonePeService;

  constructor(
    @Inject('pgPool') private db: Pool,
    @Inject('jobModel') private jobModel: any,
    @Inject('marketplaceOrderModel') private orderModel: any,
    @Inject('campaignModel') private campaignModel: any,
    @Inject('postModel') private postModel: any,
    @Inject('logger') private logger: any
  ) {
    this.email = Container.get(EmailService);
    this.notif = Container.get(NotificationService);
    this.phonepe = Container.get(PhonePeService);
  }

  // ─── User Management ──────────────────────────────────────────────────────

  async listUsers(query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let idx = 1;

    if (query.status) {
      conditions.push(`status = $${idx++}`);
      values.push(query.status);
    }
    if (query.search) {
      conditions.push(
        `(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`
      );
      values.push(`%${query.search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');
    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, status, role, city, created_at
       FROM users WHERE ${where}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit + 1, skip]
    );

    const hasNextPage = rows.length > limit;
    if (hasNextPage) rows.pop();

    return { 
      data: rows, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getPendingApprovals() {
    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, city, id_document_url, created_at
       FROM users WHERE status = 'pending_approval' ORDER BY created_at ASC`
    );
    return rows;
  }

  async approveUser(userId: string) {
    const { rows } = await this.db.query(
      `UPDATE users SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'pending_approval'
       RETURNING id, email, first_name, last_name`,
      [userId]
    );
    if (!rows[0]) throw new NotFoundError('User not found or not pending approval');

    await Promise.all([
      this.email.sendApprovalEmail(rows[0].email, rows[0].first_name),
      this.notif.create({
        userId,
        type: 'account_approved',
        title: 'Account Approved!',
        body: 'Your PhotoGigs account has been verified. You can now post and bid on jobs.',
      }),
    ]);

    return rows[0];
  }

  async blockUser(userId: string) {
    const { rows } = await this.db.query(
      `UPDATE users SET status = 'blocked', updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [userId]
    );
    if (!rows[0]) throw new NotFoundError('User not found');

    // Lightning-fast session revocation
    const redis = Container.get(RedisService);
    await redis.set(`user:revoked:${userId}`, 'true', 900); // 15 mins
  }

  async unblockUser(userId: string) {
    const { rows } = await this.db.query(
      `UPDATE users SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'blocked' RETURNING id`,
      [userId]
    );
    if (!rows[0]) throw new NotFoundError('User not found or not blocked');

    const redis = Container.get(RedisService);
    await redis.del(`user:revoked:${userId}`);
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async createCampaign(data: Record<string, unknown>) {
    return this.campaignModel.create(data);
  }

  async listCampaigns(query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const data = await this.campaignModel
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

  async getCampaign(campaignId: string) {
    const campaign = await this.campaignModel.findById(campaignId).lean();
    if (!campaign) throw new NotFoundError('Campaign not found');

    const ctr =
      campaign.impressions > 0
        ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2)
        : '0.00';

    return {
      ...campaign,
      analytics: {
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        ctr: `${ctr}%`,
      },
    };
  }

  async updateCampaign(campaignId: string, updates: Record<string, unknown>) {
    const campaign = await this.campaignModel.findByIdAndUpdate(
      campaignId,
      { $set: updates },
      { new: true }
    );
    if (!campaign) throw new NotFoundError('Campaign not found');
    return campaign;
  }

  async deleteCampaign(campaignId: string) {
    const result = await this.campaignModel.deleteOne({ _id: campaignId });
    if (result.deletedCount === 0) throw new NotFoundError('Campaign not found');
  }

  async recordCampaignClick(campaignId: string) {
    await this.campaignModel.findByIdAndUpdate(campaignId, { $inc: { clicks: 1 } });
  }

  // ─── Orders / Revenue ─────────────────────────────────────────────────────

  async listAdminJobs(query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.search) filter.title = new RegExp(query.search as string, 'i');

    const data = await this.jobModel
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

  async listAdminOrders(query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const data = await this.orderModel
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

  async getActiveBookings() {
    const [jobs, orders] = await Promise.all([
      this.jobModel
        .find({ status: { $in: ['open', 'in_progress', 'submitted', 'revision'] } })
        .lean(),
      this.orderModel.find({ status: 'paid' }).lean(),
    ]);
    return { jobs, orders };
  }

  async getRevenue(startDate?: string, endDate?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const matchStage = Object.keys(dateFilter).length
      ? { createdAt: dateFilter }
      : {};

    const [jobRevenue, marketplaceRevenue] = await Promise.all([
      this.jobModel.aggregate([
        { $match: { status: 'completed', ...(Object.keys(matchStage).length ? matchStage : {}) } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: { $sum: '$platformFee' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.orderModel.aggregate([
        { $match: { status: 'paid', ...(Object.keys(matchStage).length ? matchStage : {}) } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            revenue: { $sum: '$platformFee' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return { jobRevenue, marketplaceRevenue };
  }

  async manualRefund(referenceId: string, type: 'job' | 'marketplace_order') {
    let transactionId: string | undefined;
    let amount: number | undefined;

    if (type === 'job') {
      const job = await this.jobModel.findById(referenceId);
      if (!job) throw new NotFoundError('Job not found');
      transactionId = job.phonePeTransactionId;
      amount = job.budget;
    } else {
      const order = await this.orderModel.findById(referenceId);
      if (!order) throw new NotFoundError('Order not found');
      transactionId = order.phonePeTransactionId;
      amount = order.amount;
    }

    if (!transactionId || !amount) throw new BadRequestError('No payment found for this reference');

    await this.phonepe.initiateRefund({
      originalTransactionId: transactionId,
      refundTransactionId: `MANUAL_${uuidv4().replace(/-/g, '')}`,
      amount,
    });
  }

  // ─── Platform Analytics ───────────────────────────────────────────────────

  async getPlatformAnalytics(startDate?: string, endDate?: string) {
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    const createdAt = Object.keys(dateFilter).length ? dateFilter : undefined;

    const pgDateFilter = startDate
      ? `AND created_at >= '${startDate}' AND created_at <= '${endDate ?? new Date().toISOString()}'`
      : '';

    const [userCount, jobStats, postStats] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'approved') as approved,
                COUNT(*) FILTER (WHERE status = 'pending_approval') as pending
         FROM users WHERE 1=1 ${pgDateFilter}`
      ),
      this.jobModel.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalBudget: { $sum: '$budget' },
            platformRevenue: { $sum: '$platformFee' },
          },
        },
      ]),
      this.postModel.aggregate([
        ...(createdAt ? [{ $match: { createdAt } }] : []),
        {
          $group: {
            _id: null,
            totalPosts: { $sum: 1 },
            totalLikes: { $sum: '$likesCount' },
            totalComments: { $sum: '$commentsCount' },
          },
        },
      ]),
    ]);

    return {
      users: userCount.rows[0],
      jobs: jobStats,
      engagement: postStats[0] ?? {},
    };
  }

  async getUserAnalytics(userId: string, role: 'freelancer' | 'client') {
    const { rows: userRows } = await this.db.query(
      `SELECT average_rating, total_reviews, skills, created_at FROM users WHERE id = $1`,
      [userId]
    );
    if (!userRows[0]) throw new NotFoundError('User not found');
    const user = userRows[0];

    if (role === 'freelancer') {
      const [completedJobs, proposalStats] = await Promise.all([
        this.jobModel.countDocuments({ freelancerId: userId, status: 'completed' }),
        this.jobModel.aggregate([
          { $match: { freelancerId: userId, status: 'completed' } },
          { $group: { _id: null, earnings: { $sum: '$freelancerPayout' } } },
        ]),
      ]);

      return {
        profile: {
          averageRating: user.average_rating,
          totalReviews: user.total_reviews,
          totalJobsCompleted: completedJobs,
          memberSince: user.created_at,
        },
        earnings: proposalStats[0]?.earnings ?? 0,
        topSkills: user.skills ?? [],
      };
    }

    // Client analytics
    const postedJobs = await this.jobModel.countDocuments({ clientId: userId });
    return {
      profile: {
        memberSince: user.created_at,
        totalJobsPosted: postedJobs,
      },
    };
  }
}

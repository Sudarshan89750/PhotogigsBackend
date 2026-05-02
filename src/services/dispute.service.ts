import { Service, Inject, Container } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { DisputeResolution } from '../interfaces/IDispute';
import { NotificationService } from './notification.service';
import { parsePagination, buildMeta } from '../utils/pagination';
import { NotFoundError, BadRequestError } from '../utils/errors';

@Service()
export class DisputeService {
  private notif: NotificationService;

  constructor(
    @Inject('disputeModel') private disputeModel: any,
    @Inject('jobModel') private jobModel: any,
    @Inject('marketplaceOrderModel') private orderModel: any,
    @Inject('logger') private logger: any
  ) {
    this.notif = Container.get(NotificationService);
  }

  async raiseDispute(data: {
    raisedBy: string;
    type: 'job' | 'marketplace_order';
    referenceId: string;
    reason: string;
    description: string;
    evidence: string[];
  }) {
    // Determine the other party
    let againstUserId: string;

    if (data.type === 'job') {
      const job = await this.jobModel.findById(data.referenceId);
      if (!job) throw new NotFoundError('Job not found');
      againstUserId =
        job.clientId === data.raisedBy ? job.freelancerId : job.clientId;

      // Flag the job as disputed
      await this.jobModel.findByIdAndUpdate(data.referenceId, { status: 'disputed' });
    } else {
      const order = await this.orderModel.findById(data.referenceId);
      if (!order) throw new NotFoundError('Order not found');
      againstUserId =
        order.buyerId === data.raisedBy ? order.sellerId : order.buyerId;
    }

    const dispute = await this.disputeModel.create({ ...data, againstUserId });

    await this.notif.create({
      userId: againstUserId,
      type: 'dispute_raised',
      title: 'Dispute Filed',
      body: 'A dispute has been raised against a transaction involving you',
      referenceId: String(dispute._id),
      referenceType: 'dispute',
    });

    return dispute;
  }

  async listDisputes(query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const data = await this.disputeModel
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

  async resolveDispute(
    disputeId: string,
    resolution: DisputeResolution,
    adminNotes: string
  ) {
    const dispute = await this.disputeModel.findOne({
      _id: disputeId,
      status: { $in: ['open', 'under_review'] },
    });
    if (!dispute) throw new NotFoundError('Dispute not found or already resolved');

    dispute.status = 'resolved';
    dispute.resolution = resolution;
    dispute.adminNotes = adminNotes;
    await dispute.save();

    if (resolution === 'force_complete' && dispute.type === 'job') {
      await this.jobModel.findByIdAndUpdate(dispute.referenceId, { status: 'completed' });
    }

    // Notify both parties
    await Promise.all([
      this.notif.create({
        userId: dispute.raisedBy,
        type: 'dispute_resolved',
        title: 'Dispute Resolved',
        body: `Your dispute has been resolved: ${resolution}`,
        referenceId: disputeId,
        referenceType: 'dispute',
      }),
      this.notif.create({
        userId: dispute.againstUserId,
        type: 'dispute_resolved',
        title: 'Dispute Resolved',
        body: `A dispute involving you has been resolved: ${resolution}`,
        referenceId: disputeId,
        referenceType: 'dispute',
      }),
    ]);

    return dispute;
  }

  // Off-platform refund processing is manual via admin panel now
}

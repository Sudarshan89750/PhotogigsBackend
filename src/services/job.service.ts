import mongoose from 'mongoose';
import { Service, Inject, Container } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { CreateJobDto } from '../interfaces/IJob';
import { NotificationService } from './notification.service';
import { buildGeoNearFilter, buildGeoPoint } from '../utils/geo';
import { parsePagination, buildMeta } from '../utils/pagination';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../utils/errors';

@Service()
export class JobService {
  private notif: NotificationService;

  constructor(
    @Inject('jobModel') private jobModel: any,
    @Inject('proposalModel') private proposalModel: any,
    @Inject('logger') private logger: any
  ) {
    this.notif = Container.get(NotificationService);
  }

  // ─── Create Job (creates draft + payment intent) ──────────────────────────

  async createJob(dto: CreateJobDto) {
    const job = await this.jobModel.create({
      ...dto,
      status: 'open',
      // FIX #3: Populate GeoJSON location for 2dsphere index
      ...(dto.latitude && dto.longitude
        ? { location: buildGeoPoint(dto.latitude, dto.longitude) }
        : {}),
    });

    return { job };
  }

  // (Removed verifyJobPayment as Escrow is removed)


  async listJobs(query: Record<string, unknown>) {
    const { page, limit, skip, lastSeenId } = parsePagination(query);
    const filter: Record<string, any> = { status: 'open' };

    if (query.category) filter.category = query.category;

    if (query.minBudget || query.maxBudget) {
      filter.budget = {
        ...(query.minBudget ? { $gte: Number(query.minBudget) } : {}),
        ...(query.maxBudget ? { $lte: Number(query.maxBudget) } : {}),
      };
    }

    const hasGeo = query.latitude && query.longitude && query.radiusKm;
    const hasText = !!query.search;
    let data: any[] = [];

    // FIX #2: Solve MongoDB Special Index Collision ($text + $near)
    if (hasGeo && hasText) {
      const radiusInMeters = Number(query.radiusKm) * 1000;
      const lng = Number(query.longitude);
      const lat = Number(query.latitude);

      const pipeline: any[] = [
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            distanceField: 'dist.calculated',
            maxDistance: radiusInMeters,
            query: filter,
            spherical: true,
          },
        },
        { $match: { $text: { $search: query.search as string } } },
        { $sort: { _id: -1 } },
      ];

      if (lastSeenId) pipeline.push({ $match: { _id: { $lt: new mongoose.Types.ObjectId(lastSeenId) } } });
      
      // FIX #3: Fetch Limit + 1
      pipeline.push({ $limit: limit + 1 });
      data = await this.jobModel.aggregate(pipeline);
    } else {
      // Normal path
      if (hasText) filter.$text = { $search: query.search as string };
      if (hasGeo) {
        Object.assign(
          filter,
          buildGeoNearFilter(Number(query.latitude), Number(query.longitude), Number(query.radiusKm))
        );
      }

      if (lastSeenId) filter._id = { $lt: lastSeenId };

      data = await this.jobModel
        .find(filter)
        .sort({ _id: -1 })
        .skip(lastSeenId ? 0 : skip)
        .limit(limit + 1) // Fetch Limit + 1
        .lean();
    }

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    const nextCursor = hasNextPage ? data[data.length - 1]._id.toString() : undefined;
    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage, nextCursor }) 
    };
  }

  async getJobById(jobId: string) {
    const job = await this.jobModel.findById(jobId).lean();
    if (!job) throw new NotFoundError('Job not found');
    return job;
  }

  // ─── Submit work ──────────────────────────────────────────────────────────

  async submitWork(
    jobId: string,
    freelancerId: string,
    description: string,
    fileUrls: string[]
  ) {
    const job = await this.jobModel.findOne({
      _id: jobId,
      freelancerId,
      status: 'in_progress',
    });
    if (!job) throw new NotFoundError('Job not found or not in progress');

    job.submissionFiles = fileUrls;
    job.submissionDescription = description;
    job.status = 'submitted';
    await job.save();

    await this.notif.create({
      userId: job.clientId,
      type: 'work_submitted',
      title: 'Work Submitted',
      body: `Your photographer has submitted work for: ${job.title}`,
      referenceId: jobId,
      referenceType: 'job',
    });

    return job;
  }

  // ─── Request revision ────────────────────────────────────────────────────

  async requestRevision(jobId: string, clientId: string, notes: string) {
    const job = await this.jobModel.findOne({ _id: jobId, clientId, status: 'submitted' });
    if (!job) throw new NotFoundError('No submitted work found for this job');

    job.revisionNotes = notes;
    job.status = 'revision';
    await job.save();

    await this.notif.create({
      userId: job.freelancerId,
      type: 'revision_requested',
      title: 'Revision Requested',
      body: `Client requested changes on: ${job.title}`,
      referenceId: jobId,
      referenceType: 'job',
    });

    return job;
  }

  // ─── Complete job → Mark as Paid ──────────────────────────────────────

  async markAsPaid(jobId: string, clientId: string) {
    const job = await this.jobModel.findOne({
      _id: jobId,
      clientId,
      status: 'submitted',
    });
    if (!job) throw new NotFoundError('No submitted work found to approve and pay');

    job.status = 'completed'; // For job, completed implies it is ready for off-platform payment receipt
    await job.save();

    await this.notif.create({
      userId: job.freelancerId,
      type: 'payment_marked',
      title: 'Client Marked Paid!',
      body: `Client has marked the payment as complete for: ${job.title}. Please verify.`,
      referenceId: jobId,
      referenceType: 'job',
    });

    return job;
  }

async confirmReceipt(jobId: string, freelancerId: string) {
    const job = await this.jobModel.findOne({
      _id: jobId,
      freelancerId,
      status: 'completed'
    });
    if (!job) throw new NotFoundError('Job not in completed state to confirm receipt');

    job.status = 'closed';
    await job.save();

    await Promise.all([
      this.notif.create({
        userId: job.clientId,
        type: 'receipt_confirmed',
        title: 'Payment Confirmed',
        body: `Freelancer confirmed receipt for: ${job.title}. Leave a review to help them grow!`,
        referenceId: jobId,
        referenceType: 'job',
      }),
      this.notif.create({
        userId: freelancerId,
        type: 'receipt_confirmed',
        title: 'All Done! 🎉',
        body: `You confirmed receipt for "${job.title}". The client has been notified to leave a review.`,
        referenceId: jobId,
        referenceType: 'job',
      }),
    ]);

    return job;
  }

  // ─── Cancel job ───────────────────────────────────────────────────────────

  async cancelJob(jobId: string, clientId: string) {
    const job = await this.jobModel.findOne({ _id: jobId, clientId, status: 'open' });
    if (!job) throw new NotFoundError('Only open jobs can be cancelled');

    job.status = 'cancelled';
    await job.save();

    return job;
  }

  async getClientJobs(clientId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = { clientId };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;

    const data = await this.jobModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1) // Fetch Limit + 1
      .lean();

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getFreelancerJobs(freelancerId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);
    const filter: Record<string, unknown> = { freelancerId };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;

    const data = await this.jobModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit + 1) // Fetch Limit + 1
      .lean();

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getPostedJobProposalCounts(clientId: string) {
    const jobs = await this.jobModel
      .find({ clientId, status: 'open' })
      .select('_id')
      .lean();
    
    const jobIds = jobs.map((j: any) => j._id);
    
    if (jobIds.length === 0) return [];

    const proposalCounts = await this.proposalModel.aggregate([
      { $match: { jobId: { $in: jobIds.map((id: any) => String(id)) } } },
      { $group: { _id: '$jobId', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(proposalCounts.map((p: any) => [p._id, p.count]));
    return (jobIds as any[]).map((id) => ({
      jobId: String(id),
      count: countMap.get(String(id)) ?? 0,
    }));
  }
}

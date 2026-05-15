import { Service, Inject, Container } from 'typedi';
import { CreateProposalDto } from '../interfaces/IProposal';
import { NotificationService } from './notification.service';
import { EmailService } from './email.service';
import { UserService } from './user.service';
import { BadRequestError, ForbiddenError, NotFoundError, ConflictError } from '../utils/errors';

@Service()
export class ProposalService {
  private notif: NotificationService;
  private email: EmailService;
  private userService: UserService;

  constructor(
    @Inject('proposalModel') private proposalModel: any,
    @Inject('jobModel') private jobModel: any,
    @Inject('logger') private logger: any
  ) {
    this.notif = Container.get(NotificationService);
    this.email = Container.get(EmailService);
    this.userService = Container.get(UserService);
  }

  async createProposal(dto: CreateProposalDto) {
    const job = await this.jobModel.findOne({ _id: dto.jobId, status: 'open' });
    if (!job) throw new NotFoundError('Job not found or not open for proposals');
    if (job.clientId === dto.freelancerId) {
      throw new ForbiddenError('You cannot bid on your own job');
    }

    const existing = await this.proposalModel.findOne({
      jobId: dto.jobId,
      freelancerId: dto.freelancerId,
    });
    if (existing) throw new ConflictError('You have already submitted a proposal for this job');

    const proposal = await this.proposalModel.create(dto);

    await this.notif.create({
      userId: job.clientId,
      type: 'proposal_received',
      title: 'New Proposal',
      body: `You received a new proposal for: ${job.title}`,
      referenceId: dto.jobId,
      referenceType: 'job',
    });

    return proposal;
  }

  async getProposalsForJob(jobId: string, clientId: string) {
    const job = await this.jobModel.findOne({ _id: jobId, clientId });
    if (!job) throw new ForbiddenError('Access denied');

    const proposals = await this.proposalModel
      .find({ jobId })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with freelancer profiles
    const freelancerIds = [...new Set(proposals.map((p: any) => p.freelancerId))];
    const freelancers = await this.userService.getUsersByIds(freelancerIds as string[]);
    const freelancerMap = new Map(freelancers.map((f: any) => [f.id, f]));

    return proposals.map((p: any) => ({
      ...p,
      freelancer: freelancerMap.get(p.freelancerId) ?? null,
    }));
  }

  async acceptProposal(proposalId: string, clientId: string, message?: string) {
    const proposal = await this.proposalModel.findById(proposalId);
    if (!proposal) throw new NotFoundError('Proposal not found');

    const job = await this.jobModel.findOne({ _id: proposal.jobId, clientId, status: 'open' });
    if (!job) throw new ForbiddenError('Access denied or job not open');

    // Reject all other proposals atomically
    await this.proposalModel.updateMany(
      { jobId: proposal.jobId, _id: { $ne: proposalId } },
      { $set: { status: 'rejected' } }
    );

    proposal.status = 'accepted';
    await proposal.save();

    job.status = 'in_progress';
    job.freelancerId = proposal.freelancerId;
    job.acceptedProposalId = proposalId;
    await job.save();

    const [freelancer] = await this.userService.getUsersByIds([proposal.freelancerId]);

    await Promise.all([
      this.notif.create({
        userId: proposal.freelancerId,
        type: 'proposal_accepted',
        title: 'Proposal Accepted!',
        body: `Your proposal for "${job.title}" was accepted`,
        referenceId: String(job._id),
        referenceType: 'job',
      }),
      freelancer
        ? this.email.sendProposalAccepted(freelancer.email, freelancer.first_name, job.title)
        : Promise.resolve(),
    ]);

    return { job, proposal };
  }

  async rejectProposal(proposalId: string, clientId: string) {
    const proposal = await this.proposalModel.findById(proposalId);
    if (!proposal) throw new NotFoundError('Proposal not found');

    const job = await this.jobModel.findOne({ _id: proposal.jobId, clientId });
    if (!job) throw new ForbiddenError('Access denied');

    proposal.status = 'rejected';
    await proposal.save();

    await this.notif.create({
      userId: proposal.freelancerId,
      type: 'proposal_rejected',
      title: 'Proposal Update',
      body: `Your proposal for "${job.title}" was not selected`,
      referenceId: String(job._id),
      referenceType: 'job',
    });

    return proposal;
  }

  async withdrawProposal(proposalId: string, freelancerId: string) {
    const proposal = await this.proposalModel.findOne({
      _id: proposalId,
      freelancerId,
      status: 'pending',
    });
    if (!proposal) throw new NotFoundError('Proposal not found or cannot be withdrawn');

    proposal.status = 'withdrawn';
    await proposal.save();
    return proposal;
  }

  async getMyProposals(freelancerId: string) {
    const proposals = await this.proposalModel
      .find({ freelancerId })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with job details
    const jobIds = [...new Set(proposals.map((p: any) => p.jobId))];
    const jobs = await this.jobModel
      .find({ _id: { $in: jobIds } })
      .select('_id title status category budget city clientId')
      .lean();
    const jobMap = new Map(jobs.map((j: any) => [String(j._id), j]));

    return proposals.map((p: any) => ({
      ...p,
      job: jobMap.get(String(p.jobId)) ?? null,
    }));
  }
}

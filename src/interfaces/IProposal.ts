export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface IProposal {
  _id: string;
  jobId: string;
  freelancerId: string; // PG user id
  coverLetter: string;
  proposedPrice: number;
  estimatedDuration?: string;
  portfolioLinks?: string[];
  status: ProposalStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class CreateProposalDto {
  jobId!: string;
  freelancerId!: string;
  coverLetter!: string;
  proposedPrice!: number;
  estimatedDuration?: string;
  portfolioLinks?: string[];
}

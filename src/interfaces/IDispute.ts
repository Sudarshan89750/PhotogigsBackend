export type DisputeType = 'job' | 'marketplace_order';
export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';
export type DisputeResolution = 'refund' | 'force_complete' | 'reject';

export interface IDispute {
  _id: string;
  raisedBy: string;
  againstUserId: string;
  type: DisputeType;
  referenceId: string;
  reason: string;
  description: string;
  evidence: string[];
  status: DisputeStatus;
  resolution?: DisputeResolution;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

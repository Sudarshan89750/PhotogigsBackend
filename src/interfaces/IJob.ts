export type JobStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'submitted'
  | 'revision'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export interface IGeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude] — GeoJSON order
}

export interface IJob {
  _id: string;
  clientId: string;
  freelancerId?: string;
  title: string;
  description: string;
  category: string;
  budget: number;
  city: string;
  state: string;
  country: string;
  latitude?: number;
  longitude?: number;
  location?: IGeoPoint; // FIX #3: GeoJSON field for 2dsphere index
  eventDate?: Date;
  duration?: string;
  deliverables?: string;
  requirements?: string[];
  images?: string[];
  status: JobStatus;
  acceptedProposalId?: string;
  submissionFiles?: string[];
  submissionDescription?: string;
  revisionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class CreateJobDto {
  clientId!: string;
  title!: string;
  description!: string;
  category!: string;
  budget!: number;
  city!: string;
  state!: string;
  country!: string;
  latitude?: number;
  longitude?: number;
  eventDate?: Date;
  duration?: string;
  deliverables?: string;
  requirements?: string[];
  images?: string[];
}

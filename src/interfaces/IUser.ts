import { UserStatus } from './IAuth';

export interface IUser {
  id: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  status: UserStatus;
  role: 'user' | 'admin';
  avatarUrl?: string;
  idDocumentUrl?: string;
  bio?: string;
  skills?: string[];
  hourlyRate?: number;
  portfolioUrls?: string[];
  fcmTokens?: { token: string; deviceId: string }[];
  averageRating?: number;
  totalReviews?: number;
  membershipTier: 'free' | 'pro';
  hasUsedTrial: boolean;
  baseImageLimit: number;
  addonImageLimit: number;
  usedImages: number;
  createdAt: Date;
  updatedAt: Date;
}

export class UpdateProfileDto {
  userId!: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  bio?: string;
  skills?: string[];
  hourlyRate?: number;
  portfolioUrls?: string[];
}

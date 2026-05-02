export type CampaignStatus = 'active' | 'inactive' | 'scheduled' | 'expired';
export type CampaignTargetType = 'all' | 'location';

export interface ICampaign {
  _id: string;
  title: string;
  description: string;
  media: string[];
  ctaText?: string;
  ctaLink?: string;
  targetType: CampaignTargetType;
  targetCities?: string[];
  targetStates?: string[];
  targetCountry?: string;
  startDate: Date;
  endDate: Date;
  maxViewsPerUser: number;
  status: CampaignStatus;
  impressions: number;
  clicks: number;
  createdAt: Date;
  updatedAt: Date;
}

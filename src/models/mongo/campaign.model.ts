import mongoose, { Schema } from 'mongoose';
import { ICampaign } from '../../interfaces/ICampaign';

const CampaignSchema = new Schema<ICampaign & mongoose.Document>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    media: [String],
    ctaText: String,
    ctaLink: String,
    targetType: { type: String, enum: ['all', 'location'], default: 'all' },
    targetCities: [String],
    targetStates: [String],
    targetCountry: String,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    maxViewsPerUser: { type: Number, default: 3 },
    status: {
      type: String,
      enum: ['active', 'inactive', 'scheduled', 'expired'],
      default: 'scheduled',
      index: true,
    },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Track which users have seen a campaign (in Redis for performance, schema for reference)
const CampaignViewSchema = new Schema(
  {
    campaignId: { type: String, required: true },
    userId: { type: String, required: true },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CampaignViewSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export const CampaignView = mongoose.model('CampaignView', CampaignViewSchema);
export default mongoose.model<ICampaign & mongoose.Document>('Campaign', CampaignSchema);

import mongoose from 'mongoose';
import { Container } from 'typedi';
import { config } from '../config';
import logger from '../utils/logger';

// Import all models
import JobModel from '../models/mongo/job.model';
import ProposalModel from '../models/mongo/proposal.model';
import ListingModel from '../models/mongo/listing.model';
import MarketplaceOrderModel from '../models/mongo/marketplaceOrder.model';
import PostModel from '../models/mongo/post.model';
import CommentModel from '../models/mongo/comment.model';
import FollowModel from '../models/mongo/follow.model';
import PostLikeModel from '../models/mongo/postLike.model';
import PostSaveModel from '../models/mongo/postSave.model';
import CommentLikeModel from '../models/mongo/commentLike.model';
import NotificationModel from '../models/mongo/notification.model';
import ConversationModel from '../models/mongo/conversation.model';
import MessageModel from '../models/mongo/message.model';
import CampaignModel from '../models/mongo/campaign.model';
import DisputeModel from '../models/mongo/dispute.model';
import HashtagModel from '../models/mongo/hashtag.model';

export const loadMongo = async (): Promise<void> => {
  try {
    await mongoose.connect(config.db.mongoUri, {
      // 30s: default Mongoose behavior; 5s was too aggressive on slow DNS / mobile hotspots
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });

    logger.info('✌️ MongoDB connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`🛑 FATAL: MongoDB connection failed: ${message}`);
    process.exit(1);
  }

  // Register all models in DI container
  Container.set('jobModel', JobModel);
  Container.set('proposalModel', ProposalModel);
  Container.set('listingModel', ListingModel);
  Container.set('marketplaceOrderModel', MarketplaceOrderModel);
  Container.set('postModel', PostModel);
  Container.set('commentModel', CommentModel);
  Container.set('followModel', FollowModel);
  Container.set('postLikeModel', PostLikeModel);
  Container.set('postSaveModel', PostSaveModel);
  Container.set('commentLikeModel', CommentLikeModel);
  Container.set('notificationModel', NotificationModel);
  Container.set('conversationModel', ConversationModel);
  Container.set('messageModel', MessageModel);
  Container.set('campaignModel', CampaignModel);
  Container.set('disputeModel', DisputeModel);
  Container.set('hashtagModel', HashtagModel);
};

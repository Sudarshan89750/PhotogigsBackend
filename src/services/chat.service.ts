import { Service, Inject, Container } from 'typedi';
import { parsePagination, buildMeta } from '../utils/pagination';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { Server as SocketServer } from 'socket.io';
import { UserService } from './user.service';

let io: SocketServer | null = null;

export const setSocketServer = (server: SocketServer) => {
  io = server;
};

@Service()
export class ChatService {
  private userService: UserService;

  constructor(
    @Inject('conversationModel') private conversationModel: any,
    @Inject('messageModel') private messageModel: any,
    @Inject('logger') private logger: any
  ) {
    this.userService = Container.get(UserService);
  }

  async canAccessConversation(conversationId: string, userId: string): Promise<boolean> {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      participants: userId,
    }).select('_id');

    return Boolean(conversation);
  }

  async getOrCreateConversation(
    userId: string,
    participantId: string,
    jobId?: string,
    marketplaceListingId?: string
  ) {
    let conversation = await this.conversationModel.findOne({
      participants: { $all: [userId, participantId], $size: 2 },
      ...(jobId ? { jobId } : {}),
    });

    if (!conversation) {
      conversation = await this.conversationModel.create({
        participants: [userId, participantId],
        jobId,
        marketplaceListingId,
      });
    }

    return conversation;
  }

  async getConversations(userId: string, query: Record<string, unknown>) {
    const { page, limit, skip } = parsePagination(query);

    // FIX #4: Single aggregation pipeline — eliminates N+1 unread count queries
    const data = await this.conversationModel.aggregate([
      { $match: { participants: userId } },
      { $sort: { lastMessageAt: -1, updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit + 1 }, // Fetch Limit + 1
      {
        $lookup: {
          from: 'messages',
          let: { convId: { $toString: '$_id' } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$conversationId', '$$convId'] },
                    { $not: [{ $in: [userId, '$readBy'] }] },
                    { $ne: ['$senderId', userId] },
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          as: 'unreadDocs',
        },
      },
      {
        $addFields: {
          unreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadDocs.count', 0] }, 0] },
        },
      },
      { $project: { unreadDocs: 0 } },
    ]);

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    // ─── Populate participant details ───
    const otherParticipantIds = data.map((c: any) =>
      c.participants.find((p: string) => p !== userId)
    ).filter(Boolean);

    const users = await this.userService.getUsersByIds(otherParticipantIds);
    const userMap = new Map(users.map(u => [u.id, u]));

    const enrichedData = data.map((c: any) => {
      const otherId = c.participants.find((p: string) => p !== userId);
      const other = userMap.get(otherId);
      return {
        ...c,
        otherParticipantName: other ? `${other.first_name} ${other.last_name}` : 'User',
        otherParticipantAvatar: other?.avatar_url,
        otherParticipantCity: other?.city,
        otherParticipantStatus: other?.status || 'active',
      };
    });

    return { 
      data: enrichedData, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getMessages(conversationId: string, userId: string, query: Record<string, unknown>) {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      participants: userId,
    });
    if (!conversation) throw new ForbiddenError('Access denied');

    // ONLY return messages that have not been delivered/acknowledged yet
    // This turns the server into a relay for offline devices
    const data = await this.messageModel
        .find({ conversationId, isDelivered: { $ne: true } })
        .sort({ createdAt: 1 })
        .lean();

    return { 
      data, 
      meta: buildMeta({ page: 1, limit: data.length, hasNextPage: false }) 
    };
  }

  async acknowledgeReceipt(conversationId: string, userId: string, messageIds: string[]) {
    this.logger.info(`ACK received from ${userId} for ${messageIds.length} messages in ${conversationId}`);
    
    // Once acknowledged by a recipient, we can delete it from our server relay
    // In a production environment with multiple devices per user, we would track individual delivery status
    // For PhotoGigs 1:1 chat, simple deletion after ACK is sufficient for the "not on our server" requirement
    await this.messageModel.deleteMany({
      _id: { $in: messageIds },
      conversationId,
      senderId: { $ne: userId } // Ensure we don't delete messages the user themselves sent until synced on their other devices (if any)
    });

    return { success: true };
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    messageType: string,
    fileUrl?: string
  ) {
    const conversation = await this.conversationModel.findOne({
      _id: conversationId,
      participants: senderId,
    });
    if (!conversation) throw new ForbiddenError('Access denied');

    const message = await this.messageModel.create({
      conversationId,
      senderId,
      content,
      messageType,
      fileUrl,
      readBy: [senderId],
      isDelivered: false, // Flagged for relay delivery
    });

    await this.conversationModel.findByIdAndUpdate(conversationId, {
      lastMessage: content,
      lastMessageAt: new Date(),
    });

    if (io) {
      io.to(conversationId).emit('new_message', message.toObject());
    }

    return message;
  }

  async markRead(conversationId: string, userId: string, upToMessageId?: string) {
    const filter: Record<string, unknown> = {
      conversationId,
      readBy: { $ne: userId },
      senderId: { $ne: userId },
    };
    if (upToMessageId) {
      const msg = await this.messageModel.findById(upToMessageId);
      if (msg) filter.createdAt = { $lte: msg.createdAt };
    }

    const result = await this.messageModel.updateMany(filter, {
      $addToSet: { readBy: userId },
    });

    if (io) {
      io.to(conversationId).emit('messages_read', { conversationId, userId });
    }

    return { modifiedCount: result.modifiedCount };
  }
}

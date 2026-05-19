import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config';
import { verifyAccessToken } from '../utils/jwt';
import { setSocketServer } from '../services/chat.service';
import logger from '../utils/logger';
import { RedisService } from '../services/redis.service';
import { Container } from 'typedi';
import { ChatService } from '../services/chat.service';

export const loadSocket = (httpServer: HttpServer): SocketServer => {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.isProduction
        ? config.corsOrigins.length > 0
          ? config.corsOrigins
          : [config.frontendUrl]
        : ['http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // FIX #2: Redis adapter so events fan out across ALL pods
  const redisService = Container.get(RedisService);
  const chatService = Container.get(ChatService);
  const pubClient = redisService.getClient();
  
  if (pubClient) {
    const subClient = redisService.duplicate();
    if (subClient) {
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('✌️ Socket.io Redis adapter attached');
    } else {
      logger.info('📦 Socket.io using default memory adapter (Redis duplicate failed)');
    }
  } else {
    logger.info('📦 Socket.io using default memory adapter (Redis disabled/failed)');
  }

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string;
    if (!token) return next(new Error('Authentication required'));
    try {
      const claims = verifyAccessToken(token);
      (socket as any).currentUser = claims;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = (socket as any).currentUser;
    logger.debug('Socket connected', { userId: user?.userId, socketId: socket.id });

    socket.on('join_conversation', async (conversationId: string) => {
      if (!user?.userId || !conversationId) return;

      const canAccess = await chatService.canAccessConversation(conversationId, user.userId);
      if (!canAccess) {
        logger.warn('Blocked unauthorized socket room join', {
          userId: user.userId,
          conversationId,
          socketId: socket.id,
        });
        socket.emit('socket_error', { code: 'FORBIDDEN', message: 'Access denied' });
        return;
      }

      socket.join(conversationId);
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(conversationId);
    });

    socket.on('typing', async (conversationId: string) => {
      if (!user?.userId || !conversationId) return;
      const canAccess = await chatService.canAccessConversation(conversationId, user.userId);
      if (!canAccess) return;
      socket.to(conversationId).emit('user_typing', { userId: user?.userId, conversationId });
    });

    socket.on('stop_typing', async (conversationId: string) => {
      if (!user?.userId || !conversationId) return;
      const canAccess = await chatService.canAccessConversation(conversationId, user.userId);
      if (!canAccess) return;
      socket.to(conversationId).emit('user_stop_typing', { userId: user?.userId, conversationId });
    });

    socket.on('mark_read', async (conversationId: string) => {
      if (!user?.userId || !conversationId) return;
      const canAccess = await chatService.canAccessConversation(conversationId, user.userId);
      if (!canAccess) return;
      io.to(conversationId).emit('messages_read', { conversationId, readBy: user?.userId, readAt: new Date().toISOString() });
    });

    // Heartbeat: prevent 'offline' status for active chat users
    socket.on('presence_ping', async () => {
      if (user?.userId) {
        await redisService.sadd('presence:pending_sync', user.userId);
      }
    });

    // ─── WebRTC Call Signaling ───────────────────────────────────────────────
    socket.on('call_request', async (data: { conversationId: string; calleeId: string; callType: 'audio' | 'video' }) => {
      if (!user?.userId || !data.conversationId || !data.calleeId) return;
      const canAccess = await chatService.canAccessConversation(data.conversationId, user.userId);
      if (!canAccess) return;
      
      socket.to(data.calleeId).emit('incoming_call', {
        callerId: user.userId,
        callerName: user.firstName || user.email,
        conversationId: data.conversationId,
        callType: data.callType,
      });
    });

    socket.on('call_accepted', async (data: { conversationId: string; callerId: string }) => {
      if (!user?.userId || !data.conversationId) return;
      socket.to(data.callerId).emit('call_accepted', { calleeId: user.userId });
    });

    socket.on('call_rejected', async (data: { conversationId: string; callerId: string; reason?: string }) => {
      if (!user?.userId || !data.conversationId) return;
      socket.to(data.callerId).emit('call_rejected', { calleeId: user.userId, reason: data.reason });
    });

    socket.on('call_ended', async (data: { conversationId: string; otherUserId: string }) => {
      if (!user?.userId || !data.conversationId) return;
      socket.to(data.otherUserId).emit('call_ended', { userId: user.userId });
    });

    socket.on('ice_candidate', async (data: { conversationId: string; targetUserId: string; candidate: any }) => {
      if (!user?.userId || !data.conversationId || !data.targetUserId) return;
      socket.to(data.targetUserId).emit('ice_candidate', {
        fromUserId: user.userId,
        candidate: data.candidate,
      });
    });

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { userId: user?.userId });
    });
  });

  setSocketServer(io);
  logger.info('✌️ Socket.io initialized');

  return io;
};

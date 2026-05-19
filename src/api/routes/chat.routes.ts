import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { ChatService } from '../../services/chat.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, requireProMembership } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const createConvSchema = z.object({
  participantId: z.string().min(1),
  jobId: z.string().optional(),
  marketplaceListingId: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
  messageType: z.enum(['text']).default('text'),
});

export default (app: Router): void => {
  app.use('/chat', router);

  const svc = Container.get(ChatService);
  const cloudinary = Container.get(CloudinaryService);

  // Create or get conversation
  router.post('/conversations', authenticate, validate(createConvSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { participantId, jobId, marketplaceListingId } = req.body;
      const data = await svc.getOrCreateConversation(
        req.currentUser!.userId,
        participantId,
        jobId,
        marketplaceListingId
      );
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // My conversations
  router.get('/conversations', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getConversations(req.currentUser!.userId, req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  // Get messages in conversation
  router.get('/conversations/:conversationId/messages', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getMessages(req.params.conversationId, req.currentUser!.userId, req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  // Send text message
  router.post('/conversations/:conversationId/messages', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      let data;
      
      if (req.file) {
        // File uploaded via multipart
        const fileUrl = await cloudinary.uploadBuffer(req.file.buffer, 'chat', 'auto');
        const messageType = req.file.mimetype.startsWith('image/') ? 'image' : 'file';
        data = await svc.sendMessage(
          req.params.conversationId,
          req.currentUser!.userId,
          req.file.originalname,
          messageType,
          fileUrl
        );
      } else {
        // Text message
        const parsed = sendMessageSchema.safeParse(req.body);
        if (!parsed.success) throw new BadRequestError(parsed.error.errors[0].message);
        data = await svc.sendMessage(
          req.params.conversationId,
          req.currentUser!.userId,
          parsed.data.content,
          parsed.data.messageType
        );
      }
      
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Send file message
  router.post('/conversations/:conversationId/messages/file', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded');
      const fileUrl = await cloudinary.uploadBuffer(req.file.buffer, 'chat', 'auto');
      const messageType = req.file.mimetype.startsWith('image/') ? 'image' : 'file';
      const data = await svc.sendMessage(
        req.params.conversationId,
        req.currentUser!.userId,
        req.file.originalname,
        messageType,
        fileUrl
      );
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Mark as read
  router.post('/conversations/:conversationId/read', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.markRead(
        req.params.conversationId,
        req.currentUser!.userId,
        req.body.upToMessageId
      );
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  // Acknowledge receipt (Deletes from relay)
  router.post('/conversations/:conversationId/ack', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messageIds } = req.body;
      if (!Array.isArray(messageIds)) throw new BadRequestError('messageIds must be an array');
      const result = await svc.acknowledgeReceipt(
        req.params.conversationId,
        req.currentUser!.userId,
        messageIds
      );
      res.json(result);
    } catch (e) { next(e); }
  });

  // Request to message a user (requires acceptance)
  router.post('/message-request', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body;
      if (!userId) throw new BadRequestError('userId is required');
      await svc.sendMessageRequest(req.currentUser!.userId, userId);
      res.json({ success: true, message: 'Message request sent' });
    } catch (e) { next(e); }
  });

  // Accept/Decline message request
  router.post('/message-request/:requestId/respond', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action } = req.body; // 'accept' or 'decline'
      if (!['accept', 'decline'].includes(action)) throw new BadRequestError('action must be accept or decline');
      await svc.respondToMessageRequest(req.params.requestId, req.currentUser!.userId, action);
      res.json({ success: true, message: action === 'accept' ? 'Request accepted' : 'Request declined' });
    } catch (e) { next(e); }
  });
};

import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { AdminService } from '../../services/admin.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { SubscriptionService } from '../../services/subscription.service';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const campaignSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  targetType: z.enum(['all', 'location']).default('all'),
  targetCities: z.array(z.string()).optional(),
  targetStates: z.array(z.string()).optional(),
  targetCountry: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  maxViewsPerUser: z.number().int().positive().default(3),
  status: z.enum(['draft', 'active', 'paused', 'closed']).default('active'),
});

const refundSchema = z.object({
  referenceId: z.string().min(1),
  type: z.enum(['job', 'marketplace_order']),
});

export default (app: Router): void => {
  app.use('/admin', router);

  const svc = Container.get(AdminService);
  const cloudinary = Container.get(CloudinaryService);

  // ─── User Management ──────────────────────────────────────────────────────

  router.get('/users', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listUsers(req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/users/pending', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getPendingApprovals();
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.put('/users/:id/approve', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.approveUser(req.params.id);
      res.json({ success: true, message: 'User approved' });
    } catch (e) { next(e); }
  });

  router.put('/users/:id/block', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.blockUser(req.params.id);
      res.json({ success: true, message: 'User blocked' });
    } catch (e) { next(e); }
  });

  router.put('/users/:id/unblock', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.unblockUser(req.params.id);
      res.json({ success: true, message: 'User unblocked' });
    } catch (e) { next(e); }
  });

  // ─── Campaigns ────────────────────────────────────────────────────────────

  router.post('/campaigns', authenticate, requireAdmin, validate(campaignSchema), upload.array('media', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      const media = files?.length
        ? await Promise.all(files.map(f => cloudinary.uploadBuffer(f.buffer, 'campaigns', 'auto')))
        : [];

      const body = {
        ...req.body,
        targetCities: req.body.targetCities ? JSON.parse(req.body.targetCities) : undefined,
        targetStates: req.body.targetStates ? JSON.parse(req.body.targetStates) : undefined,
        maxViewsPerUser: Number(req.body.maxViewsPerUser) || 3,
        media,
        ctaLink: req.body.ctaLink || null,
      };

      const data = await svc.createCampaign(body);
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/campaigns', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listCampaigns(req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/campaigns/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getCampaign(req.params.id);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.put('/campaigns/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.updateCampaign(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.delete('/campaigns/:id', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteCampaign(req.params.id);
      res.json({ success: true, message: 'Campaign deleted' });
    } catch (e) { next(e); }
  });

  // ─── Orders & Revenue ─────────────────────────────────────────────────────

  router.get('/orders/jobs', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listAdminJobs(req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/orders/marketplace', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listAdminOrders(req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/orders/active', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getActiveBookings();
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/orders/revenue', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getRevenue(req.query.startDate as string, req.query.endDate as string);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/refund', authenticate, requireAdmin, validate(refundSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.manualRefund(req.body.referenceId, req.body.type);
      res.json({ success: true, message: 'Refund processed' });
    } catch (e) { next(e); }
  });

  // ─── Subscription & Quota Management ─────────────────────────────────────

  const subSvc = Container.get(SubscriptionService);

  router.post('/users/:userId/subscription', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { planId, days } = req.body;
      const result = await subSvc.adminGrantSubscription(req.currentUser!.userId, req.params.userId, planId, days || 30);
      res.json(result);
    } catch (e) { next(e); }
  });

  router.delete('/users/:userId/subscription', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await subSvc.adminCancelUserSubscription(req.currentUser!.userId, req.params.userId);
      res.json(result);
    } catch (e) { next(e); }
  });

  router.post('/users/:userId/quota', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseLimit = Number(req.body.baseLimit);
      const addonLimit = Number(req.body.addonLimit);
      if (isNaN(baseLimit) || isNaN(addonLimit)) {
        throw new BadRequestError('baseLimit and addonLimit are required and must be numbers');
      }
      const result = await subSvc.adminSetQuota(req.currentUser!.userId, req.params.userId, baseLimit, addonLimit);
      res.json(result);
    } catch (e) { next(e); }
  });

  router.post('/users/:userId/addons', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { quantity } = req.body;
      await subSvc.adminGrantAddons(req.currentUser!.userId, req.params.userId, quantity);
      res.json({ success: true, message: 'Add-ons granted' });
    } catch (e) { next(e); }
  });

  // ─── Campaign Status Management ──────────────────────────────────────────

  router.patch('/campaigns/:id/status', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body; // active, paused, discarded
      await svc.updateCampaign(req.params.id, { status });
      res.json({ success: true, message: `Campaign status updated to ${status}` });
    } catch (e) { next(e); }
  });
};

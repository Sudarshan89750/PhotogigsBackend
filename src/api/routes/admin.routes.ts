import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { AdminService } from '../../services/admin.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

const campaignSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  ctaText: z.string().optional(),
  ctaLink: z.string().url().optional(),
  targetType: z.enum(['all', 'location']).default('all'),
  targetCities: z.array(z.string()).optional(),
  targetStates: z.array(z.string()).optional(),
  targetCountry: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  maxViewsPerUser: z.number().int().positive().default(3),
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

  router.post('/campaigns', authenticate, requireAdmin, upload.array('media', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      const media = files?.length
        ? await Promise.all(files.map(f => cloudinary.uploadBuffer(f.buffer, 'campaigns', 'auto')))
        : [];

      // Parse JSON arrays that come as strings from multipart
      const body = {
        ...req.body,
        targetCities: req.body.targetCities ? JSON.parse(req.body.targetCities) : undefined,
        targetStates: req.body.targetStates ? JSON.parse(req.body.targetStates) : undefined,
        maxViewsPerUser: req.body.maxViewsPerUser ? Number(req.body.maxViewsPerUser) : 3,
        media,
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
};

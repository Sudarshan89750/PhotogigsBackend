import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { SubscriptionService } from '../../services/subscription.service';
import { authenticate, requireApproved, requireAdmin } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/subscriptions', router);

  const svc = Container.get(SubscriptionService);

  const upgradeSchema = z.object({
    planId: z.string().uuid(),
  });

  const addonSchema = z.object({
    quantity: z.number().int().positive(),
  });

  const verifySchema = z.object({
    transactionId: z.string(),
    type: z.enum(['subscription', 'addon']).optional(),
  });

  const adminGrantSubscriptionSchema = z.object({
    userId: z.string().uuid(),
    planId: z.string().uuid(),
    durationDays: z.number().int().positive().optional().default(30),
  });

  const adminGrantAddonsSchema = z.object({
    userId: z.string().uuid(),
    quantity: z.number().int().positive(),
  });

  router.get('/plans', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getPlans();
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/active', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getSubscription(req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/upgrade', authenticate, requireApproved, validate(upgradeSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.createSubscriptionPayment(req.currentUser!.userId, req.body.planId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/buy-addon', authenticate, requireApproved, validate(addonSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.purchaseAddon(req.currentUser!.userId, req.body.quantity);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/verify', authenticate, validate(verifySchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId, type } = req.body;
      if (!transactionId) throw new Error('transactionId required');

      let result;
      if (type === 'addon') {
        result = await svc.verifyAddonPayment(transactionId);
      } else {
        result = await svc.verifySubscriptionPayment(transactionId);
      }
      res.json({ ...result });
    } catch (e) { next(e); }
  });

  // Admin endpoints - grant subscription directly without payment
  router.post('/admin/grant-subscription', authenticate, requireAdmin, validate(adminGrantSubscriptionSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, planId, durationDays } = req.body;
      const data = await svc.adminCreateSubscription(req.currentUser!.userId, userId, planId, durationDays);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/admin/grant-addons', authenticate, requireAdmin, validate(adminGrantAddonsSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, quantity } = req.body;
      const data = await svc.adminGrantAddons(req.currentUser!.userId, userId, quantity);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

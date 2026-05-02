import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { AdminService } from '../../services/admin.service';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/analytics', router);
  const svc = Container.get(AdminService);

  router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = (req.query.role as string) ?? 'freelancer';
      const data = await svc.getUserAnalytics(req.currentUser!.userId, role as 'freelancer' | 'client');
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/admin', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getPlatformAnalytics(
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

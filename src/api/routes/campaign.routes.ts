import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { AdminService } from '../../services/admin.service';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/campaigns', router);
  const svc = Container.get(AdminService);

  router.post('/:id/click', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.recordCampaignClick(req.params.id);
      res.json({ success: true, message: 'Click recorded' });
    } catch (e) { next(e); }
  });
};

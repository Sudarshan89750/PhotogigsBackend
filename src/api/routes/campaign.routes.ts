import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { AdminService } from '../../services/admin.service';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/campaigns', router);
  const svc = Container.get(AdminService);

  router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getActiveCampaigns();
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getCampaign(req.params.id);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/:id/click', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.recordCampaignClick(req.params.id);
      if (req.currentUser) {
        await svc.recordCampaignClickForUser(req.params.id, req.currentUser.userId);
      }
      res.json({ success: true, message: 'Click recorded' });
    } catch (e) { next(e); }
  });
};
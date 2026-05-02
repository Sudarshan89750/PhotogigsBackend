import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { FeedService } from '../../services/feed.service';
import { optionalAuthenticate } from '../middlewares/auth.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/feed', router);
  const svc = Container.get(FeedService);

  router.get('/', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getFeed(req.query as Record<string, unknown>, req.currentUser?.userId);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/trending-hashtags', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getTrendingHashtags();
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

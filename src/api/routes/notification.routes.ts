import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { NotificationService } from '../../services/notification.service';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/notifications', router);
  const svc = Container.get(NotificationService);

  router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
      const limit = Math.min(50, parseInt((req.query.limit as string) ?? '30', 10));
      const unreadOnly = req.query.unreadOnly === 'true';
      const result = await svc.getForUser(req.currentUser!.userId, page, limit, unreadOnly);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  router.get('/unread-count', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unreadCount = await svc.getUnreadCount(req.currentUser!.userId);
      res.json({ success: true, data: { unreadCount } });
    } catch (e) { next(e); }
  });

  router.put('/read-all', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const modifiedCount = await svc.markAllRead(req.currentUser!.userId);
      res.json({ success: true, data: { modifiedCount } });
    } catch (e) { next(e); }
  });

  router.put('/:id/read', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.markRead(req.params.id, req.currentUser!.userId);
      res.json({ success: true, message: 'Marked as read' });
    } catch (e) { next(e); }
  });

  router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteOne(req.params.id, req.currentUser!.userId);
      res.json({ success: true, message: 'Deleted' });
    } catch (e) { next(e); }
  });
};

import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { DisputeService } from '../../services/dispute.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, requireApproved, requireAdmin } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';

const router = Router();

const resolveSchema = z.object({
  resolution: z.enum(['refund', 'force_complete', 'reject']),
  adminNotes: z.string().min(1),
});

export default (app: Router): void => {
  app.use('/disputes', router);

  const svc = Container.get(DisputeService);
  const cloudinary = Container.get(CloudinaryService);

  // Raise dispute
  router.post('/', authenticate, requireApproved, upload.array('evidence', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, referenceId, reason, description } = req.body;
      const files = req.files as Express.Multer.File[];
      const evidence = files?.length
        ? await Promise.all(files.map(f => cloudinary.uploadBuffer(f.buffer, 'disputes', 'auto')))
        : [];

      const data = await svc.raiseDispute({
        raisedBy: req.currentUser!.userId,
        type,
        referenceId,
        reason,
        description,
        evidence,
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Admin: list disputes
  router.get('/', authenticate, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listDisputes(req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  // Admin: resolve dispute
  router.post('/:id/resolve', authenticate, requireAdmin, validate(resolveSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.resolveDispute(req.params.id, req.body.resolution, req.body.adminNotes);
      res.json({ success: true, message: `Dispute resolved with ${req.body.resolution}` });
    } catch (e) { next(e); }
  });
};

import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { ProposalService } from '../../services/proposal.service';
import { authenticate, requireApproved, requireProMembership } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';

const router = Router();

const createProposalSchema = z.object({
  jobId: z.string().min(1),
  coverLetter: z.string().min(20),
  proposedPrice: z.coerce.number().positive(),
  estimatedDuration: z.string().optional(),
  portfolioLinks: z.array(z.string().url()).optional(),
});

const acceptSchema = z.object({
  jobId: z.string().min(1),
  message: z.string().optional(),
});

export default (app: Router): void => {
  app.use('/proposals', router);

  const svc = Container.get(ProposalService);

  // Submit proposal – approved freelancer only
  router.post('/', authenticate, requireProMembership, requireApproved, validate(createProposalSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.createProposal({
        freelancerId: req.currentUser!.userId,
        ...req.body,
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Get proposals for a job (client only)
  router.get('/job/:jobId', authenticate, requireProMembership, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getProposalsForJob(req.params.jobId, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Accept proposal
  router.post('/:id/accept', authenticate, requireApproved, validate(acceptSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.acceptProposal(req.params.id, req.currentUser!.userId, req.body.message);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Reject proposal
  router.post('/:id/reject', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.rejectProposal(req.params.id, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Withdraw proposal (freelancer)
  router.put('/:id/withdraw', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.withdrawProposal(req.params.id, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

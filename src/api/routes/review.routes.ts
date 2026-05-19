import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { JobService } from '../../services/job.service';
import { UserService } from '../../services/user.service';
import { NotificationService } from '../../services/notification.service';
import { parsePagination, buildMeta } from '../../utils/pagination';
import { authenticate, requireApproved } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { NotFoundError, ForbiddenError } from '../../utils/errors';

const router = Router();

const createReviewSchema = z.object({
  jobId: z.string().min(1),
  revieweeId: z.string().min(1),
  rating: z.number().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export default (app: Router): void => {
  app.use('/reviews', router);

  const jobService = Container.get(JobService);
  const userService = Container.get(UserService);
  const notifService = Container.get(NotificationService);
  const reviewModel = Container.get<any>('reviewModel');

  router.post('/', authenticate, requireApproved, validate(createReviewSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobId, revieweeId, rating, comment } = req.body;
      const reviewerId = req.currentUser!.userId;

      if (reviewerId === revieweeId) {
        throw new ForbiddenError('You cannot review yourself');
      }

      const job = await jobService.getJobById(jobId);
      if (!job) throw new NotFoundError('Job not found');

      const isClient = job.clientId === reviewerId;
      const isFreelancer = job.freelancerId === reviewerId;

      if (!isClient && !isFreelancer) {
        throw new ForbiddenError('Only participants can review');
      }

      if (job.status !== 'closed') {
        throw new ForbiddenError('Can only review completed jobs');
      }

      const existing = await reviewModel.findOne({ jobId, reviewerId });
      if (existing) throw new ForbiddenError('You have already reviewed this job');

      const review = await reviewModel.create({
        jobId,
        reviewerId,
        revieweeId,
        rating,
        comment: comment ?? '',
      });

      await userService.updateRating(revieweeId);

      const reviewer = await userService.getById(reviewerId);
      await notifService.create({
        userId: revieweeId,
        type: 'review_received',
        title: 'New Review',
        body: `${reviewer?.first_name ?? 'Someone'} left you a ${rating}-star review`,
        referenceId: jobId,
        referenceType: 'job',
      });

      res.status(201).json({ success: true, data: review });
    } catch (e) { next(e); }
  });

  router.get('/job/:jobId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reviews = await reviewModel
        .find({ jobId: req.params.jobId })
        .sort({ createdAt: -1 })
        .lean();
      res.json({ success: true, data: reviews });
    } catch (e) { next(e); }
  });

  router.get('/user/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const reviews = await reviewModel
        .find({ revieweeId: req.params.userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit + 1)
        .lean();
      
      const hasNextPage = reviews.length > limit;
      if (hasNextPage) reviews.pop();
      
      res.json({ success: true, data: reviews, meta: buildMeta({ page, limit, hasNextPage }) });
    } catch (e) { next(e); }
  });

  // Edit review
  router.put('/:reviewId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rating, comment } = req.body;
      const review = await reviewModel.findOneAndUpdate(
        { _id: req.params.reviewId, reviewerId: req.currentUser!.userId },
        { $set: { rating, comment, updatedAt: new Date() } },
        { new: true }
      );
      if (!review) throw new NotFoundError('Review not found or not yours');
      
      await userService.updateRating(review.revieweeId);
      res.json({ success: true, data: review });
    } catch (e) { next(e); }
  });

  // Delete review
  router.delete('/:reviewId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const review = await reviewModel.findOneAndDelete({ 
        _id: req.params.reviewId, 
        reviewerId: req.currentUser!.userId 
      });
      if (!review) throw new NotFoundError('Review not found or not yours');
      
      await userService.updateRating(review.revieweeId);
      res.json({ success: true, message: 'Review deleted' });
    } catch (e) { next(e); }
  });

  // Add review response (business owner reply)
  router.post('/:reviewId/respond', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { response } = req.body;
      const review = await reviewModel.findOneAndUpdate(
        { _id: req.params.reviewId, revieweeId: req.currentUser!.userId },
        { $set: { response, respondedAt: new Date() } },
        { new: true }
      );
      if (!review) throw new NotFoundError('Review not found or not yours');
      
      res.json({ success: true, data: review });
    } catch (e) { next(e); }
  });
};
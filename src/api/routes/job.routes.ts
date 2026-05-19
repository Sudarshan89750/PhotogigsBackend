import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { JobService } from '../../services/job.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, requireApproved, optionalAuthenticate, requireProMembership } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';
import { jobLimiter } from '../middlewares/rate-limit.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const createJobSchema = z.object({
  title: z.string().min(5),
  description: z.string().min(20),
  category: z.string().min(1),
  budget: z.coerce.number().positive(),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  eventDate: z.string().datetime().optional(),
  duration: z.string().optional(),
  deliverables: z.string().optional(),
  requirements: z.array(z.string()).optional(),
});

// No payment schema needed; marked as paid manually.

const revisionSchema = z.object({
  notes: z.string().min(1),
});

// FIX: Submission accepts pre-uploaded Cloudinary URLs for large deliverable files
// (RAW files, video walkthroughs, etc.) that should never buffer through Node.
// Images can still be multipart-uploaded (images only, 10MB cap).
const submitSchema = z.object({
  description: z.string().default(''),
  // JSON array of Cloudinary URLs for deliverables uploaded directly by the client
  fileUrls: z.string().optional(),
});

export default (app: Router): void => {
  app.use('/jobs', router);

  const svc = Container.get(JobService);
  const cloudinary = Container.get(CloudinaryService);

  // Apply rate limiting to write operations
  router.post('/', jobLimiter, authenticate, requireProMembership, requireApproved, validate(createJobSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.createJob({
        clientId: req.currentUser!.userId,
        ...req.body,
        eventDate: req.body.eventDate ? new Date(req.body.eventDate) : undefined,
      });
      res.status(201).json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/:jobId/mark-paid', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.markAsPaid(req.params.jobId, req.currentUser!.userId);
      res.json({ success: true, message: 'Job marked as paid' });
    } catch (e) { next(e); }
  });

  router.get('/', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listJobs(req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  router.get('/map', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getJobsForMap(req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data });
    } catch (e) { next(e); }
  });

  router.get('/my/posted', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getClientJobs(req.currentUser!.userId, req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  router.get('/my/posted/counts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getPostedJobProposalCounts(req.currentUser!.userId);
      res.json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  router.get('/my/assigned', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getFreelancerJobs(req.currentUser!.userId, req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  router.get('/:jobId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getJobById(req.params.jobId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // FIX: Submit work — image thumbnails via memoryStorage, large deliverables via pre-uploaded URLs
  router.post('/:jobId/submit', authenticate, requireApproved, upload.array('images', 5), async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Server-side image thumbnails (previews only — not for raw/video deliverables)
      const imageFiles = req.files as Express.Multer.File[];
      const serverUploadedUrls = imageFiles?.length
        ? await Promise.all(imageFiles.map(f => cloudinary.uploadBuffer(f.buffer, 'submissions', 'image')))
        : [];

      // Pre-uploaded URLs for large deliverables (raw files, video, etc.)
      let preUploadedUrls: string[] = [];
      if (req.body.fileUrls) {
        try {
          const parsed: string[] = JSON.parse(req.body.fileUrls);
          preUploadedUrls = parsed.filter(url =>
            typeof url === 'string' &&
            url.startsWith('https://res.cloudinary.com/') &&
            cloudinary.isOwnedUrl(url, 'submissions')
          );
        } catch { /* ignore malformed input */ }
      }

      const allFileUrls = [...serverUploadedUrls, ...preUploadedUrls];
      if (!allFileUrls.length) throw new BadRequestError('At least one file or fileUrl required');

      const data = await svc.submitWork(
        req.params.jobId,
        req.currentUser!.userId,
        req.body.description ?? '',
        allFileUrls
      );
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/:jobId/revision', authenticate, requireApproved, validate(revisionSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.requestRevision(req.params.jobId, req.currentUser!.userId, req.body.notes);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/:jobId/confirm-receipt', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.confirmReceipt(req.params.jobId, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/:jobId/cancel', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.cancelJob(req.params.jobId, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Close/Complete a job (client marks as completed)
  router.post('/:jobId/close', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.closeJob(req.params.jobId, req.currentUser!.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

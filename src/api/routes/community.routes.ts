import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { CommunityService } from '../../services/community.service';
import { UserService } from '../../services/user.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, optionalAuthenticate, requireProMembership } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload } from '../middlewares/upload.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const commentSchema = z.object({
  content: z.string().min(1).max(1000),
  parentCommentId: z.string().optional(),
});

const shareSchema = z.object({
  sharedTo: z.enum(['in_app', 'external']),
});

// FIX: Posts now accept pre-uploaded media URLs (from Cloudinary direct upload)
// Images only can still be uploaded via multipart (for backwards compat).
// Videos MUST be uploaded directly to Cloudinary first — send the secure_url here.
const createPostSchema = z.object({
  content: z.string().min(1).max(5000),
  hashtags: z.string().optional(),  // JSON array string from multipart
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  // Pre-uploaded media URLs (from direct Cloudinary upload — required for video)
  mediaUrls: z.string().optional(), // JSON array of Cloudinary URLs already uploaded
});

export default (app: Router): void => {
  app.use('/community', router);

  const svc = Container.get(CommunityService);
  const userSvc = Container.get(UserService);
  const cloudinary = Container.get(CloudinaryService);

  // ─── Posts ────────────────────────────────────────────────────────────────

  // Images can be multipart-uploaded here (images only, 10MB each).
  // For video posts: first call GET /api/v1/users/cloudinary-signature?folder=posts&resourceType=video
  // then upload directly to Cloudinary, then pass the returned URL in mediaUrls JSON field.
  router.post('/posts', authenticate, requireProMembership, upload.array('media', 10), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, hashtags, city, state, country, latitude, longitude, mediaUrls } = req.body;
      if (!content) throw new BadRequestError('Content is required');

      // Check quota before processing
      await userSvc.checkImageQuota(req.currentUser!.userId, 1);

      // Upload any server-received image files (images only — no video via memoryStorage)
      const uploadedFiles = req.files as Express.Multer.File[];
      const serverUploadedUrls = uploadedFiles?.length
        ? await Promise.all(uploadedFiles.map(f => cloudinary.uploadBuffer(f.buffer, 'posts', 'image')))
        : [];

      // Accept pre-uploaded URLs from direct Cloudinary upload (for video)
      let preUploadedUrls: string[] = [];
      if (mediaUrls) {
        try {
          const parsed: string[] = JSON.parse(mediaUrls);
          // Validate ownership — only accept URLs from our Cloudinary account
          preUploadedUrls = parsed.filter(url =>
            typeof url === 'string' &&
            url.startsWith('https://res.cloudinary.com/') &&
            cloudinary.isOwnedUrl(url, 'posts')
          );
        } catch { /* ignore malformed mediaUrls */ }
      }

      const media = [...serverUploadedUrls, ...preUploadedUrls];

      let parsedHashtags: string[] = [];
      try { parsedHashtags = hashtags ? JSON.parse(hashtags) : []; }
      catch { parsedHashtags = []; }

      const data = await svc.createPost({
        authorId: req.currentUser!.userId,
        content,
        media,
        hashtags: parsedHashtags,
        city, state, country,
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined,
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/posts/:postId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getPost(req.params.postId, req.currentUser?.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.delete('/posts/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deletePost(req.params.id, req.currentUser!.userId);
      res.json({ success: true, message: 'Post deleted' });
    } catch (e) { next(e); }
  });

  // ─── Likes ────────────────────────────────────────────────────────────────

  router.post('/posts/:id/like', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.togglePostLike(req.params.id, req.currentUser!.userId);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  // ─── Comments ─────────────────────────────────────────────────────────────

  router.post('/posts/:postId/comments', authenticate, validate(commentSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.addComment({
        postId: req.params.postId,
        authorId: req.currentUser!.userId,
        ...req.body,
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.get('/posts/:postId/comments', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getComments(req.params.postId, req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.delete('/comments/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteComment(req.params.id, req.currentUser!.userId);
      res.json({ success: true, message: 'Comment deleted' });
    } catch (e) { next(e); }
  });

  router.post('/comments/:id/like', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.toggleCommentLike(req.params.id, req.currentUser!.userId);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  // ─── Save / Share ─────────────────────────────────────────────────────────

  router.post('/posts/:id/save', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.toggleSave(req.params.id, req.currentUser!.userId);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.post('/posts/:id/share', authenticate, validate(shareSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.sharePost(req.params.id, req.currentUser!.userId, req.body.sharedTo);
      res.json({ success: true, message: 'Shared' });
    } catch (e) { next(e); }
  });

  // ─── Hashtags ─────────────────────────────────────────────────────────────

  router.get('/hashtags/suggest', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = req.query;
      const data = await svc.suggestHashtags(String(q || ''));
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // ─── Follow ───────────────────────────────────────────────────────────────

  router.post('/follow/:userId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.toggleFollow(req.currentUser!.userId, req.params.userId);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/followers/:userId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getFollowers(req.params.userId, req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/following/:userId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.getFollowing(req.params.userId, req.query as Record<string, unknown>);
      res.json({ success: true, ...result });
    } catch (e) { next(e); }
  });

  router.get('/follow-stats/:userId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getFollowStats(req.params.userId, req.currentUser?.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

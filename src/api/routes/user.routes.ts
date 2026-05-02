import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { UserService } from '../../services/user.service';
import { CloudinaryService, UploadFolder } from '../../services/cloudinary.service';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { upload, uploadDocument, validateMagicBytes } from '../middlewares/upload.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(20).optional(),
  lastName: z.string().min(1).max(25).optional(),
  phone: z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits').optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  bio: z.string().max(500).optional(),
  skills: z.array(z.string()).optional(),
  hourlyRate: z.coerce.number().positive().optional(),
  portfolioUrls: z.array(z.string().url()).optional(),
});

const pushTokenSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().min(1),
});

const signatureSchema = z.object({
  folder: z.enum(['posts', 'submissions', 'chat', 'marketplace', 'campaigns', 'avatars', 'id-documents', 'disputes']),
  resourceType: z.enum(['image', 'video', 'raw']).default('image'),
});

export default (app: Router): void => {
  app.use('/users', router);

  const svc = Container.get(UserService);
  const cloudinary = Container.get(CloudinaryService);

  router.get('/profile', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await svc.getById(req.currentUser!.userId);
      res.json({ success: true, data: user });
    } catch (e) { next(e); }
  });

  router.put('/profile', authenticate, validate(updateProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.updateProfile({ userId: req.currentUser!.userId, ...req.body });
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  router.post('/upload-avatar', authenticate, upload.single('avatar'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded');

      // Validate actual file content via magic bytes
      const ALLOWED_AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
      const isValid = await validateMagicBytes(req.file.buffer, ALLOWED_AVATAR_MIMES);
      if (!isValid) throw new BadRequestError('File content does not match an allowed image type');

      const url = await cloudinary.uploadBuffer(req.file.buffer, 'avatars', 'image');
      const data = await svc.updateAvatar(req.currentUser!.userId, url);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // ID document accepts PDF + images
  router.post('/upload-id', authenticate, uploadDocument.single('idDocument'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded');

      // Validate actual file content via magic bytes — prevents MIME spoofing
      const ALLOWED_DOC_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      const isValid = await validateMagicBytes(req.file.buffer, ALLOWED_DOC_MIMES);
      if (!isValid) throw new BadRequestError('File content does not match an allowed document type (JPEG, PNG, WebP, PDF)');

      const url = await cloudinary.uploadBuffer(req.file.buffer, 'id-documents', 'auto');
      const data = await svc.uploadIdDocument(req.currentUser!.userId, url);
      res.json({ success: true, message: 'ID uploaded, pending admin approval', data });
    } catch (e) { next(e); }
  });

  // FIX: Signed upload signature endpoint — lets the browser upload video/large
  // media DIRECTLY to Cloudinary without the file ever touching Node.js heap.
  router.get('/cloudinary-signature', authenticate, validate(signatureSchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { folder, resourceType } = req.query as { folder: UploadFolder; resourceType: 'image' | 'video' | 'raw' };
      
      // Quota check
      await svc.checkImageQuota(req.currentUser!.userId, 1);
      
      const params = cloudinary.generateSignedUploadParams(folder, resourceType, req.currentUser!.userId);
      res.json({ success: true, data: params });
    } catch (e) { next(e); }
  });

  router.post('/push-token', authenticate, validate(pushTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.registerFcmToken(req.currentUser!.userId, req.body.token, req.body.deviceId);
      res.json({ success: true, message: 'Token registered' });
    } catch (e) { next(e); }
  });

  router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getPublicProfile(req.params.userId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });
};

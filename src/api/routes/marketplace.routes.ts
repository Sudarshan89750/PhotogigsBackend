import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { MarketplaceService } from '../../services/marketplace.service';
import { CloudinaryService } from '../../services/cloudinary.service';
import { authenticate, requireApproved, optionalAuthenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { marketplaceLimiter, writeLimiter } from '../middlewares/rate-limit.middleware';
import { BadRequestError } from '../../utils/errors';

const router = Router();

const createListingSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  listingType: z.enum(['sell', 'rent']),
  category: z.string().min(1),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor']),
  brand: z.string().optional(),
  model: z.string().optional(),
  price: z.coerce.number().positive(),
  rentalPricePerDay: z.coerce.number().positive().optional(),
  depositAmount: z.coerce.number().nonnegative().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

const orderSchema = z.object({
  rentalStartDate: z.string().optional(),
  rentalEndDate: z.string().optional(),
});

// No payment schema needed; marked as paid manually.
export default (app: Router): void => {
  app.use('/marketplace', router);

  const svc = Container.get(MarketplaceService);
  const cloudinary = Container.get(CloudinaryService);

  // Create listing – approved users only
  // Images must be uploaded directly to Cloudinary first, then send URLs here.
  // Use GET /api/v1/users/cloudinary-signature?folder=marketplace&resourceType=image
  router.post('/listings', writeLimiter, authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createListingSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(parsed.error.errors.map(e => e.message).join('; '));

      // Accept pre-uploaded Cloudinary URLs (images and videos)
      let images: string[] = [];
      if (req.body.imageUrls) {
        try {
          const urls: unknown[] = JSON.parse(req.body.imageUrls);
          images = urls.filter((url): url is string =>
            typeof url === 'string' &&
            url.startsWith('https://res.cloudinary.com/') &&
            cloudinary.isOwnedUrl(url, 'marketplace')
          );
        } catch { /* ignore malformed imageUrls */ }
      }

      const data = await svc.createListing({
        ...parsed.data,
        sellerId: req.currentUser!.userId,
        images,
      });
      res.status(201).json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Browse listings – public
  router.get('/listings', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.listListings(req.query as Record<string, unknown>);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (e) { next(e); }
  });

  // Get listing detail
  router.get('/listings/:listingId', optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.getListing(req.params.listingId);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Update listing
  router.put('/listings/:id', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.updateListing(req.params.id, req.currentUser!.userId, req.body);
      res.json({ success: true, data });
    } catch (e) { next(e); }
  });

  // Delete listing
  router.delete('/listings/:id', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.deleteListing(req.params.id, req.currentUser!.userId);
      res.json({ success: true, message: 'Listing deleted' });
    } catch (e) { next(e); }
  });

  // Create order (buy/rent)
  router.post('/listings/:listingId/order', authenticate, requireApproved, validate(orderSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.createOrder(req.params.listingId, req.currentUser!.userId, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  // Mark as paid manually
  router.post('/orders/:orderId/mark-paid', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.markAsPaid(req.params.orderId, req.currentUser!.userId);
      res.json({ success: true, message: 'Order marked as paid', data });
    } catch (e) { next(e); }
  });

  // Confirm receipt
  router.post('/orders/:orderId/confirm-receipt', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.confirmReceipt(req.params.orderId, req.currentUser!.userId);
      res.json({ success: true, message: 'Receipt confirmed', data });
    } catch (e) { next(e); }
  });

  // Return rental
  router.post('/orders/:orderId/return', authenticate, requireApproved, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await svc.returnRental(
        req.params.orderId,
        req.currentUser!.userId,
        req.currentUser!.role === 'admin'
      );
      res.json({ success: true, message: 'Rental marked as returned, deposit refunded', data });
    } catch (e) { next(e); }
  });
};

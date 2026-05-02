import mongoose from 'mongoose';
import { Service, Inject, Container } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { NotificationService } from './notification.service';
import { buildGeoNearFilter, buildGeoPoint } from '../utils/geo';
import { parsePagination, buildMeta } from '../utils/pagination';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors';

@Service()
export class MarketplaceService {
  private notif: NotificationService;

  constructor(
    @Inject('listingModel') private listingModel: any,
    @Inject('marketplaceOrderModel') private orderModel: any,
    @Inject('pgPool') private db: any,
    @Inject('logger') private logger: any
  ) {
    this.notif = Container.get(NotificationService);
  }

  async createListing(data: Record<string, unknown> & { sellerId: string; latitude?: number; longitude?: number }) {
    const listing = await this.listingModel.create({
      ...data,
      // FIX #3: Populate GeoJSON location for 2dsphere index
      ...(data.latitude && data.longitude
        ? { location: buildGeoPoint(data.latitude as number, data.longitude as number) }
        : {}),
    });

    const images = data.images as string[];
    if (images && images.length > 0) {
      await this.db.query(
        'UPDATE users SET used_images = used_images + $1 WHERE id = $2',
        [images.length, data.sellerId]
      ).catch((err: any) => this.logger.error('Failed to increment used_images for listing', err));
    }

    return listing;
  }

  async listListings(query: Record<string, unknown>) {
    const { page, limit, skip, lastSeenId } = parsePagination(query);
    const filter: Record<string, any> = { status: 'active' };

    if (query.listingType) filter.listingType = query.listingType;
    if (query.category) filter.category = query.category;

    const queryTermRaw =
      typeof query.q === 'string' ? query.q :
      typeof query.search === 'string' ? query.search :
      '';
    const queryTerm = queryTermRaw.trim();

    if (query.minPrice || query.maxPrice) {
      filter.price = {
        ...(query.minPrice ? { $gte: Number(query.minPrice) } : {}),
        ...(query.maxPrice ? { $lte: Number(query.maxPrice) } : {}),
      };
    }

    const hasGeo = query.latitude && query.longitude && query.radiusKm;
    const hasText = queryTerm.length > 0;
    let data: any[] = [];

    // FIX #2: Solve MongoDB Special Index Collision ($text + $near)
    if (hasGeo && hasText) {
      const radiusInMeters = Number(query.radiusKm) * 1000;
      const lng = Number(query.longitude);
      const lat = Number(query.latitude);

      const pipeline: any[] = [
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [lng, lat] },
            distanceField: 'dist.calculated',
            maxDistance: radiusInMeters,
            query: filter,
            spherical: true,
          },
        },
        { $match: { $text: { $search: queryTerm } } },
        { $sort: { _id: -1 } },
      ];

      if (lastSeenId) pipeline.push({ $match: { _id: { $lt: new mongoose.Types.ObjectId(lastSeenId) } } });
      
      // FIX #3: Fetch Limit + 1 to check hasNextPage without expensive countDocuments
      pipeline.push({ $limit: limit + 1 });
      data = await this.listingModel.aggregate(pipeline);
    } else {
      // Normal path for simple search or simple geo or neither
      if (hasText) {
        const escaped = queryTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        filter.$or = [
          { title: { $regex: rx } },
          { description: { $regex: rx } },
          { category: { $regex: rx } },
          { city: { $regex: rx } },
          { brand: { $regex: rx } },
          { model: { $regex: rx } },
        ];
      }
      if (hasGeo) {
        Object.assign(
          filter,
          buildGeoNearFilter(Number(query.latitude), Number(query.longitude), Number(query.radiusKm))
        );
      }

      if (lastSeenId) filter._id = { $lt: lastSeenId };

      data = await this.listingModel
        .find(filter)
        .sort({ _id: -1 })
        .skip(lastSeenId ? 0 : skip)
        .limit(limit + 1) // Fetch Limit + 1
        .lean();
    }

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    const nextCursor = hasNextPage ? data[data.length - 1]._id.toString() : undefined;
    return { 
      data, 
      meta: buildMeta({ page, limit, hasNextPage, nextCursor }) 
    };
  }

  async getListing(listingId: string) {
    const listing = await this.listingModel.findById(listingId).lean();
    if (!listing) throw new NotFoundError('Listing not found');
    return listing;
  }

  async updateListing(listingId: string, sellerId: string, updates: Record<string, unknown>) {
    const listing = await this.listingModel.findOneAndUpdate(
      { _id: listingId, sellerId },
      { $set: updates },
      { new: true }
    );
    if (!listing) throw new NotFoundError('Listing not found or access denied');
    return listing;
  }

  async deleteListing(listingId: string, sellerId: string) {
    const listing = await this.listingModel.findOne({ _id: listingId, sellerId });
    if (!listing) throw new NotFoundError('Listing not found or access denied');

    if (listing.images && listing.images.length > 0) {
      await this.db.query(
        'UPDATE users SET used_images = GREATEST(used_images - $1, 0) WHERE id = $2',
        [listing.images.length, sellerId]
      ).catch((err: any) => this.logger.error('Failed to decrement used_images for listing delete', err));
    }

    await listing.deleteOne();
  }

  async createOrder(
    listingId: string,
    buyerId: string,
    body: { rentalStartDate?: string; rentalEndDate?: string }
  ) {
    const listing = await this.listingModel.findById(listingId);
    if (!listing) throw new NotFoundError('Listing not found');
    if (listing.status !== 'active') throw new BadRequestError('Listing is not available');
    if (listing.sellerId === buyerId) throw new ForbiddenError('Cannot buy your own listing');

    let amount = listing.price;
    let rentalStartDate: Date | undefined;
    let rentalEndDate: Date | undefined;

    if (listing.listingType === 'rent') {
      if (!body.rentalStartDate || !body.rentalEndDate) {
        throw new BadRequestError('Rental dates required');
      }
      rentalStartDate = new Date(body.rentalStartDate);
      rentalEndDate = new Date(body.rentalEndDate);
      const days = Math.ceil(
        (rentalEndDate.getTime() - rentalStartDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days <= 0) throw new BadRequestError('Invalid rental date range');
      amount = listing.rentalPricePerDay! * days + (listing.depositAmount ?? 0);
    }

    const order = await this.orderModel.create({
      listingId,
      buyerId,
      sellerId: listing.sellerId,
      orderType: listing.listingType,
      amount,
      depositAmount: listing.depositAmount,
      rentalStartDate,
      rentalEndDate,
      status: 'pending',
    });

    // Mark listing as reserved tentatively
    listing.status = 'reserved';
    await listing.save();

    await this.notif.create({
      userId: listing.sellerId,
      type: 'new_order',
      title: 'New Order Reserved',
      body: `A buyer has reserved your listing. Waiting for payment.`,
      referenceId: String(order._id),
      referenceType: 'marketplace_order',
    });

    return { order };
  }

  async markAsPaid(orderId: string, buyerId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, buyerId, status: 'pending' });
    if (!order) throw new NotFoundError('Order not found or not pending');

    order.status = 'paid';
    await order.save();

    await this.notif.create({
      userId: order.sellerId,
      type: 'payment_marked',
      title: 'Buyer Marked Paid',
      body: `Buyer marked payment as complete for your listing. Please verify receipt.`,
      referenceId: String(order._id),
      referenceType: 'marketplace_order',
    });

    return order;
  }

  async confirmReceipt(orderId: string, sellerId: string) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await this.orderModel.findOne({ _id: orderId, sellerId, status: 'paid' }).session(session);
      if (!order) throw new NotFoundError('Order not found or not in paid state');

      const updatedListing = await this.listingModel.findOneAndUpdate(
        { _id: order.listingId, status: 'reserved' },
        { status: order.orderType === 'rent' ? 'rented' : 'sold' },
        { session, new: true }
      );

      if (!updatedListing) {
        throw new BadRequestError('Item is not in reserved state.');
      }

      order.status = 'completed';
      await order.save({ session });

      await this.notif.create({
        userId: order.buyerId,
        type: 'receipt_confirmed',
        title: 'Payment Confirmed',
        body: `Seller confirmed payment for your order.`,
        referenceId: String(order._id),
        referenceType: 'marketplace_order',
      }, session);

      await session.commitTransaction();
      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async returnRental(orderId: string, requesterId: string, isAdmin: boolean) {
    const filter: Record<string, unknown> = { _id: orderId, status: 'completed', orderType: 'rent' };
    if (!isAdmin) filter.sellerId = requesterId;

    const order = await this.orderModel.findOne(filter);
    if (!order) throw new NotFoundError('Order not found or not eligible for return');

    order.status = 'returned';
    await order.save();

    // Restore listing to active
    await this.listingModel.findByIdAndUpdate(order.listingId, { status: 'active' });

    return order;
  }
}

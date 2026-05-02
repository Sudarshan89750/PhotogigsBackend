import mongoose, { Schema } from 'mongoose';
import { IMarketplaceOrder } from '../../interfaces/IMarketplace';

const MarketplaceOrderSchema = new Schema<IMarketplaceOrder & mongoose.Document>(
  {
    listingId: { type: String, required: true, index: true },
    buyerId: { type: String, required: true, index: true },
    sellerId: { type: String, required: true, index: true },
    orderType: { type: String, enum: ['sell', 'rent'], required: true },
    amount: { type: Number, required: true },
    depositAmount: Number,
    rentalStartDate: Date,
    rentalEndDate: Date,
    status: {
      type: String,
      enum: ['pending', 'paid', 'returned', 'cancelled'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IMarketplaceOrder & mongoose.Document>(
  'MarketplaceOrder',
  MarketplaceOrderSchema
);

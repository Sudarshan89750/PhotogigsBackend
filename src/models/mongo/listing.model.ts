import mongoose, { Schema } from 'mongoose';
import { IListing } from '../../interfaces/IMarketplace';

// 'model' is a reserved word in Mongoose Schema definitions — use 'modelName' field instead
// and map it to 'model' via the schema path rename pattern
// Use a plain SchemaDefinition (no generic) to avoid the mongoose Document type
// conflicting with the 'modelName' field name
const ListingSchema = new Schema(
  {
    sellerId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    listingType: { type: String, enum: ['sell', 'rent'], required: true },
    category: { type: String, required: true, index: true },
    condition: { type: String, required: true },
    brand: { type: String },
    modelName: { type: String },   // stored as 'modelName' in DB, exposed as 'model' via virtual
    price: { type: Number, required: true },
    rentalPricePerDay: { type: Number },
    depositAmount: { type: Number },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    latitude: { type: Number },
    longitude: { type: Number },
    // FIX #3: GeoJSON location field for 2dsphere index
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    images: [String],
    status: {
      type: String,
      enum: ['active', 'sold', 'rented', 'inactive'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    // Virtual to expose 'model' field on the document (reads from 'modelName')
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ListingSchema.virtual('model').get(function (this: any) {
  return this.modelName;
});

// FIX #3: 2dsphere index for accurate radial geo queries
ListingSchema.index({ location: '2dsphere' });
// Accurate text search for 1M+ MAU collections
// $text search is significantly faster than case-insensitive regex
ListingSchema.index({ title: 'text', brand: 'text', description: 'text' });

ListingSchema.index({ status: 1, listingType: 1, category: 1 });

export default mongoose.model<IListing>('Listing', ListingSchema);

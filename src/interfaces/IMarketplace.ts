export type ListingType = 'sell' | 'rent';
export type ListingStatus = 'active' | 'sold' | 'rented' | 'inactive';
export type OrderStatus = 'pending' | 'paid' | 'returned' | 'cancelled';

export interface IListing {
  _id: string;
  sellerId: string;
  title: string;
  description: string;
  listingType: ListingType;
  category: string;
  condition: string;
  brand?: string;
  model?: string;
  price: number;
  rentalPricePerDay?: number;
  depositAmount?: number;
  city: string;
  state: string;
  country: string;
  latitude?: number;
  longitude?: number;
  location?: { type: 'Point'; coordinates: [number, number] }; // FIX #3: GeoJSON for 2dsphere
  images: string[];
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMarketplaceOrder {
  _id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  orderType: ListingType;
  amount: number;
  depositAmount?: number;
  rentalStartDate?: Date;
  rentalEndDate?: Date;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

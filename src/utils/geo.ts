/**
 * Builds a MongoDB $nearSphere geo query against a GeoJSON `location` field.
 *
 * Requires a `2dsphere` index on the collection's `location` field.
 * Replace the old flat-earth bounding box approach entirely.
 *
 * Usage:
 *   Model.find({ status: 'open', ...buildGeoNearFilter(lat, lon, radiusKm) })
 *
 * Schema requirement (add to any model that needs geo search):
 *   location: {
 *     type: { type: String, enum: ['Point'], default: 'Point' },
 *     coordinates: { type: [Number] }   // [longitude, latitude]  ← note the order
 *   }
 */
export const buildGeoNearFilter = (
  lat: number,
  lon: number,
  radiusKm: number
): Record<string, unknown> => ({
  location: {
    $nearSphere: {
      $geometry: {
        type: 'Point',
        coordinates: [lon, lat], // GeoJSON is [longitude, latitude]
      },
      $maxDistance: radiusKm * 1000, // metres
    },
  },
});

/**
 * Build a GeoJSON Point object to store on a document.
 * Call this whenever lat/lon are set on a Job or Listing.
 *
 * Example (in service before model.create):
 *   const geoPoint = buildGeoPoint(dto.latitude, dto.longitude);
 *   await JobModel.create({ ...dto, location: geoPoint });
 */
export const buildGeoPoint = (
  lat: number,
  lon: number
): { type: 'Point'; coordinates: [number, number] } => ({
  type: 'Point',
  coordinates: [lon, lat], // GeoJSON order: [longitude, latitude]
});

/**
 * Haversine distance between two lat/lon points — kept for display purposes
 * (e.g. showing "12 km away" on a listing card). NOT used for DB queries.
 */
export const haversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

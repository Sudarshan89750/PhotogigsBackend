import mongoose, { Schema } from 'mongoose';
import { IJob } from '../../interfaces/IJob';

const JobSchema = new Schema<IJob & mongoose.Document>(
  {
    clientId: { type: String, required: true, index: true },
    freelancerId: { type: String, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true, index: true },
    budget: { type: Number, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    latitude: Number,
    longitude: Number,
    // FIX #3: 2dsphere index requires a GeoJSON location field
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    eventDate: Date,
    duration: String,
    deliverables: String,
    requirements: [String],
    images: [String],
    status: {
      type: String,
      enum: ['draft', 'open', 'in_progress', 'submitted', 'revision', 'completed', 'cancelled', 'disputed'],
      default: 'draft',
      index: true,
    },
    acceptedProposalId: String,
    submissionFiles: [String],
    submissionDescription: String,
    revisionNotes: String,
  },
  { timestamps: true }
);

// FIX #3: 2dsphere index for accurate radial geo queries
// Query pattern: db.jobs.find({ location: { $nearSphere: { $geometry: { type:'Point', coordinates:[lon,lat] }, $maxDistance: radiusMetres } } })
JobSchema.index({ location: '2dsphere' });
// Efficient full-text search for job discovery
JobSchema.index({ title: 'text', description: 'text', deliverables: 'text', requirements: 'text' });

JobSchema.index({ status: 1, category: 1 });

export default mongoose.model<IJob & mongoose.Document>('Job', JobSchema);

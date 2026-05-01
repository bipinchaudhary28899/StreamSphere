import mongoose, { Schema, Document } from 'mongoose';

export interface IDeadZone extends Document {
  location: { type: 'Point'; coordinates: [number, number] };
  radius_meters: number;
  signal_score: number;   // 0–1, lower = worse coverage
  sample_count: number;
  last_updated: Date;
  source: 'crowdsourced' | 'user_reported' | 'inferred';
}

const deadZoneSchema = new Schema<IDeadZone>(
  {
    location: {
      type:        { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },
    radius_meters: { type: Number, default: 100 },
    signal_score:  { type: Number, required: true, min: 0, max: 1 },
    sample_count:  { type: Number, default: 1 },
    last_updated:  { type: Date, default: Date.now },
    source: {
      type: String,
      enum: ['crowdsourced', 'user_reported', 'inferred'],
      default: 'inferred',
    },
  },
  { timestamps: true },
);

deadZoneSchema.index({ location: '2dsphere' });

export const DeadZone = mongoose.model<IDeadZone>('DeadZone', deadZoneSchema);

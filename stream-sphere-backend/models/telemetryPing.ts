import mongoose, { Schema, Document } from 'mongoose';

export interface ITelemetryPing extends Document {
  session_id:       string;
  timestamp:        Date;
  // GeoJSON point — enables $nearSphere / $geoWithin queries for dead-zone
  // detection and radio-map building.  The application layer MUST populate this
  // from lat/lng when inserting (see telemetry.service.ts).
  location: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  lat:              number;   // kept as scalars for fast tile-range filters
  lng:              number;
  speed_kmh:        number;
  heading:          number;
  signal_strength:  number | null;
  downlink_mbps:    number | null;
  rtt_ms:           number | null;
  connection_type:  string | null;
  battery_level:    number | null;
  buffer_level_sec: number | null;
  bitrate_kbps:     number | null;
}

const telemetryPingSchema = new Schema<ITelemetryPing>(
  {
    session_id: { type: String, required: true },
    timestamp:  { type: Date,   required: true },
    location: {
      type:        { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },   // [lng, lat]
    },
    lat:              { type: Number, required: true },
    lng:              { type: Number, required: true },
    speed_kmh:        { type: Number, default: 0 },
    heading:          { type: Number, default: 0 },
    signal_strength:  { type: Number, default: null },
    downlink_mbps:    { type: Number, default: null },
    rtt_ms:           { type: Number, default: null },
    connection_type:  { type: String, default: null },
    battery_level:    { type: Number, default: null },
    buffer_level_sec: { type: Number, default: null },
    bitrate_kbps:     { type: Number, default: null },
  },
  { timestamps: false, versionKey: false },
);

// Primary query: fetch timeline for a session
telemetryPingSchema.index({ session_id: 1, timestamp: 1 });

// Geospatial — enables $nearSphere, $geoWithin for dead-zone + radio-map queries
telemetryPingSchema.index({ location: '2dsphere' });

// TTL — raw pings are ephemeral signal; the intelligence is summarised into
// radio_map_cache and streaming_sessions at session end.  Auto-delete after 2 days.
telemetryPingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86_400 * 2 });

export const TelemetryPing = mongoose.model<ITelemetryPing>(
  'TelemetryPing',
  telemetryPingSchema,
);
